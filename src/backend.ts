import { spawn } from 'node:child_process';
import type { OneDevConfig } from './onedevClient';
import {
  normalizeServerUrl, parseOpenStates, buildAuthHeader,
  parseExternalId, buildIssuesQuery,
  parseOneDevRemote, mapListEntry, mapIssueDetail, escapeQueryValue,
} from './onedevClient';
import { oneDevGetJson } from './http';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

type Logger = (level: string, message: string) => void;

function runGit(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn('git', args, { cwd, timeout: 10_000, stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout?.on('data', (d) => { out += d.toString(); });
    child.on('close', () => resolve(out));
    child.on('error', () => resolve(''));
  });
}

function settingReader(ctx: any): (key: string) => unknown {
  const surfaces: Array<(key: string) => unknown> = [
    (k) => ctx?.services?.configuration?.get?.(k),
    (k) => ctx?.services?.config?.[k],
    (k) => ctx?.configuration?.[k],
    (k) => ctx?.config?.[k],
    (k) => ctx?.settings?.[k],
  ];
  return (key) => {
    for (const read of surfaces) {
      try {
        const v = read(key);
        if (v !== undefined && v !== null && v !== '') return v;
      } catch { /* surface not present */ }
    }
    return undefined;
  };
}

function resolveConfig(ctx: any): OneDevConfig | null {
  const get = settingReader(ctx);
  const serverUrlRaw = (get('serverUrl') as string) ?? process.env.ONEDEV_URL ?? '';
  const apiToken = (get('apiToken') as string) ?? process.env.ONEDEV_TOKEN ?? '';
  if (!serverUrlRaw.trim() || !apiToken.trim()) return null;
  return {
    serverUrl: normalizeServerUrl(serverUrlRaw),
    username: (get('username') as string) ?? process.env.ONEDEV_USERNAME ?? undefined,
    apiToken: apiToken.trim(),
    openStates: parseOpenStates(get('openStates') as string | undefined),
    project: ((get('project') as string) ?? '').trim() || undefined,
  };
}

function requireConfig(ctx: any): OneDevConfig {
  const cfg = resolveConfig(ctx);
  if (!cfg) {
    throw new Error(
      'OneDev is not configured — set Server URL and API Token in Settings (OneDev Importer), ' +
      'or export ONEDEV_URL and ONEDEV_TOKEN.',
    );
  }
  return cfg;
}

function target(cfg: OneDevConfig) {
  return { serverUrl: cfg.serverUrl, authHeader: buildAuthHeader(cfg) };
}

export function activate(ctx: any) {
  const services = ctx?.services ?? {};
  const workspacePath: string = services.workspacePath ?? process.cwd();
  const log: Logger = services.log ?? (() => {});

  log('debug', `onedev: ctx keys=[${Object.keys(ctx ?? {}).join(',')}] ` +
    `services keys=[${Object.keys(services).join(',')}]`);

  return {
    methods: {
      'importer.isAuthenticated': async () => {
        const cfg = resolveConfig(ctx);
        if (!cfg) return false;
        try {
          await oneDevGetJson(target(cfg), '/~api/projects?offset=0&count=1');
          return true;
        } catch (err: any) {
          log('debug', `onedev: auth probe failed: ${err?.message ?? err}`);
          return false;
        }
      },

      'importer.listBindings': async () => {
        const cfg = requireConfig(ctx);
        if (cfg.project) return [{ id: cfg.project, label: cfg.project }];
        const remotes = await runGit(['remote', '-v'], workspacePath);
        const seen = new Set<string>();
        const bindings: Array<{ id: string; label: string }> = [];
        for (const line of remotes.split('\n')) {
          const parts = line.split(/\s+/);
          if (parts.length < 2) continue;
          const project = parseOneDevRemote(cfg.serverUrl, parts[1]);
          if (project && !seen.has(project)) {
            seen.add(project);
            bindings.push({ id: project, label: project });
          }
        }
        if (bindings.length > 0) {
          log('debug', `onedev: ${bindings.length} binding(s) from git remotes`);
          return bindings;
        }
        const projects = await oneDevGetJson(target(cfg), '/~api/projects?offset=0&count=100');
        const rawProjects = Array.isArray(projects) ? projects : [];
        const mapped = rawProjects
          .filter((p: any) => typeof p.path === 'string' && p.path.length > 0)
          .map((p: any) => ({ id: p.path as string, label: p.path as string }));
        if (mapped.length === 0 && rawProjects.length > 0) {
          throw new Error(
            'OneDev did not report project paths; set the Project setting in Settings (OneDev Importer) ' +
            'to your project path, e.g. org/app.',
          );
        }
        return mapped;
      },

      'importer.list': async (params: any) => {
        const cfg = requireConfig(ctx);
        const project: string = params.binding.id;
        const filters = params.filters ?? {};
        log('debug', `onedev: list filters state=${String(filters.state)} limit=${String(filters.limit)} ` +
          `cursor=${String(filters.cursor)} search=${filters.search ? 'yes' : 'no'}`);
        const count = Math.min(Math.max(1, Number(filters.limit) || DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
        const offset = filters.cursor ? Number(filters.cursor) || 0 : 0;
        const states = (filters.state ?? 'open') === 'open' ? cfg.openStates : [];
        const query = buildIssuesQuery({ project, states });
        const issues = await oneDevGetJson(
          target(cfg),
          `/~api/issues?query=${encodeURIComponent(query)}&offset=${offset}&count=${count}`,
        );
        const rawIssues = Array.isArray(issues) ? issues : [];
        let items: ReturnType<typeof mapListEntry>[] = [];
        for (const i of rawIssues) {
          try {
            items.push(mapListEntry(i, project, cfg.serverUrl));
          } catch (err: any) {
            log('warn', `onedev: skipping malformed issue in ${project}: ${err?.message ?? err}`);
          }
        }
        if (filters.search) {
          const needle = String(filters.search).toLowerCase();
          items = items.filter(
            (e) => e.title.toLowerCase().includes(needle) || e.externalId.toLowerCase().includes(needle),
          );
        }
        const nextCursor = rawIssues.length >= count
          ? String(offset + count)
          : undefined;
        return { items, nextCursor };
      },

      'importer.fetch': async (params: any) => {
        const cfg = requireConfig(ctx);
        const { project, number } = parseExternalId(params.externalId);
        const query =
          `"Project" is "${escapeQueryValue(project)}" and "Number" is "${number}"`;
        let issues: any;
        try {
          issues = await oneDevGetJson(
            target(cfg),
            `/~api/issues?query=${encodeURIComponent(query)}&offset=0&count=1`,
          );
        } catch (err: any) {
          // Only fall back on HTTP 4xx (query-format rejection); rethrow other errors.
          if (!/OneDev HTTP 4\d\d /.test(err?.message ?? '')) {
            throw err;
          }
          // Some OneDev versions want the number criterion as "project#number".
          const alt = `"Number" is "${escapeQueryValue(`${project}#${number}`)}"`;
          issues = await oneDevGetJson(
            target(cfg),
            `/~api/issues?query=${encodeURIComponent(alt)}&offset=0&count=1`,
          );
        }
        const issue = Array.isArray(issues) ? issues[0] : null;
        if (!issue) throw new Error(`OneDev issue ${params.externalId} not found`);
        return mapIssueDetail(issue, project, cfg.serverUrl);
      },
    },
  };
}
