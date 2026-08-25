import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
const PROVIDER_ID = "onedev-issues";
const URN_SCHEME = "onedev";
function normalizeServerUrl(raw) {
  return raw.trim().replace(/\/+$/, "");
}
function parseOpenStates(raw) {
  const states = (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return states.length > 0 ? states : ["Open"];
}
function buildAuthHeader(cfg) {
  if (cfg.username && cfg.username.length > 0) {
    return "Basic " + Buffer.from(`${cfg.username}:${cfg.apiToken}`).toString("base64");
  }
  return `Bearer ${cfg.apiToken}`;
}
function buildExternalId(project, number) {
  return `${project}#${number}`;
}
function parseExternalId(externalId) {
  const hash = externalId.lastIndexOf("#");
  const project = hash >= 0 ? externalId.slice(0, hash) : "";
  const number = hash >= 0 ? Number(externalId.slice(hash + 1)) : NaN;
  if (!project || !Number.isFinite(number)) {
    throw new Error(`Invalid OneDev externalId: ${externalId}`);
  }
  return { project, number };
}
function buildUrn(project, number) {
  return `${URN_SCHEME}://${project}#${number}`;
}
function issueUrl(serverUrl, project, number) {
  return `${normalizeServerUrl(serverUrl)}/${project}/~issues/${number}`;
}
function escapeQueryValue(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
function buildIssuesQuery(opts) {
  const clauses = [`"Project" is "${escapeQueryValue(opts.project)}"`];
  const states = opts.states ?? [];
  if (states.length === 1) {
    clauses.push(`"State" is "${escapeQueryValue(states[0])}"`);
  } else if (states.length > 1) {
    clauses.push("(" + states.map((s) => `"State" is "${escapeQueryValue(s)}"`).join(" or ") + ")");
  }
  return clauses.join(" and ");
}
function parseOneDevRemote(serverUrl, remoteUrl) {
  let host;
  try {
    host = new URL(normalizeServerUrl(serverUrl)).host.split(":")[0];
  } catch {
    return null;
  }
  const url = remoteUrl.trim();
  let m = /^(?:https?|ssh):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/.exec(url);
  if (m) return m[1] === host ? m[2] : null;
  m = /^[^@\s]+@([^:\s]+):(.+?)(?:\.git)?$/.exec(url);
  if (m) return m[1] === host ? m[2] : null;
  return null;
}
function lastActivityDate(issue) {
  return issue.lastActivity?.date ?? issue.lastUpdate?.date ?? issue.updateDate ?? issue.submitDate ?? null;
}
function mapListEntry(issue, project, serverUrl) {
  const number = Number(issue.number);
  if (!Number.isFinite(number)) throw new Error(`OneDev issue in ${project} has no usable "number" field`);
  return {
    externalId: buildExternalId(project, number),
    urn: buildUrn(project, number),
    url: issueUrl(serverUrl, project, number),
    title: String(issue.title ?? ""),
    state: String(issue.state ?? ""),
    updatedAt: lastActivityDate(issue)
  };
}
function mapIssueDetail(issue, project, serverUrl) {
  const number = Number(issue.number);
  if (!Number.isFinite(number)) throw new Error(`OneDev issue in ${project} has no usable "number" field`);
  const submitterName = issue.submitter?.fullName ?? issue.submitter?.name ?? issue.submitterName ?? null;
  return {
    external: {
      providerId: PROVIDER_ID,
      externalId: buildExternalId(project, number),
      urn: buildUrn(project, number),
      url: issueUrl(serverUrl, project, number),
      titleSnapshot: String(issue.title ?? ""),
      stateSnapshot: String(issue.state ?? "")
    },
    primaryType: "bug",
    title: String(issue.title ?? ""),
    body: String(issue.description ?? ""),
    status: String(issue.state ?? ""),
    labels: [],
    authorIdentity: submitterName ? { email: null, displayName: submitterName, gitName: submitterName } : null,
    upstreamCreatedAt: issue.submitDate ?? null,
    upstreamUpdatedAt: lastActivityDate(issue)
  };
}
const DEFAULT_TIMEOUT_MS = 15e3;
async function oneDevGetJson(target2, pathAndQuery, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const url = `${target2.serverUrl}${pathAndQuery}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: { Authorization: target2.authHeader, Accept: "application/json" },
      signal: controller.signal
    });
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new Error(`OneDev request timed out after ${timeoutMs}ms: GET ${pathAndQuery}`);
    }
    throw new Error(`OneDev request failed: GET ${pathAndQuery}: ${err?.message ?? err}`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const snippet = (await res.text().catch(() => "")).slice(0, 200);
    throw new Error(`OneDev HTTP ${res.status} for GET ${pathAndQuery}: ${snippet}`);
  }
  try {
    return await res.json();
  } catch {
    throw new Error(
      `OneDev returned a non-JSON response for GET ${pathAndQuery} — check that Server URL points at a OneDev server`
    );
  }
}
function readExtensionConfigurationFromFile(filePath, extensionId) {
  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    const configuration = parsed?.extensionSettings?.[extensionId]?.configuration;
    if (configuration && typeof configuration === "object" && !Array.isArray(configuration)) {
      return configuration;
    }
    return {};
  } catch {
    return {};
  }
}
function appSettingsCandidatePaths() {
  const home = homedir();
  const appData = process.env.APPDATA || join(home, "AppData", "Roaming");
  return [
    join(home, ".config", "@nimbalyst", "electron", "app-settings.json"),
    join(appData, "@nimbalyst", "electron", "app-settings.json"),
    join(home, "Library", "Application Support", "@nimbalyst", "electron", "app-settings.json")
  ];
}
function readAppSettingsConfiguration(extensionId) {
  for (const path of appSettingsCandidatePaths()) {
    const config = readExtensionConfigurationFromFile(path, extensionId);
    if (Object.keys(config).length > 0) return config;
  }
  return {};
}
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const EXTENSION_ID = "com.nimbalyst-community.onedev-importer";
function runGit(args, cwd) {
  return new Promise((resolve) => {
    const child = spawn("git", args, { cwd, timeout: 1e4, stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    child.stdout?.on("data", (d) => {
      out += d.toString();
    });
    child.on("close", () => resolve(out));
    child.on("error", () => resolve(""));
  });
}
function settingReader(ctx) {
  const surfaces = [
    (k) => ctx?.services?.configuration?.get?.(k),
    (k) => ctx?.services?.config?.[k],
    (k) => ctx?.configuration?.[k],
    (k) => ctx?.config?.[k],
    (k) => ctx?.settings?.[k],
    // Workaround for the host not delivering `configuration` to backend
    // modules: read this extension's own key from Nimbalyst's
    // app-settings.json directly. Re-evaluated on every read (no caching)
    // so changes made in Settings apply without a backend restart. See
    // appSettingsFile.ts for details; remove once the platform fixes delivery.
    (k) => readAppSettingsConfiguration(EXTENSION_ID)[k]
  ];
  return (key) => {
    for (const read of surfaces) {
      try {
        const v = read(key);
        if (v !== void 0 && v !== null && v !== "") return v;
      } catch {
      }
    }
    return void 0;
  };
}
function resolveConfig(ctx) {
  const get = settingReader(ctx);
  const serverUrlRaw = get("serverUrl") ?? process.env.ONEDEV_URL ?? "";
  const apiToken = get("apiToken") ?? process.env.ONEDEV_TOKEN ?? "";
  if (!serverUrlRaw.trim() || !apiToken.trim()) return null;
  return {
    serverUrl: normalizeServerUrl(serverUrlRaw),
    username: get("username") ?? process.env.ONEDEV_USERNAME ?? void 0,
    apiToken: apiToken.trim(),
    openStates: parseOpenStates(get("openStates")),
    project: (get("project") ?? "").trim() || void 0
  };
}
function requireConfig(ctx) {
  const cfg = resolveConfig(ctx);
  if (!cfg) {
    throw new Error(
      "OneDev is not configured — set Server URL and API Token in Settings (OneDev Importer), or export ONEDEV_URL and ONEDEV_TOKEN."
    );
  }
  return cfg;
}
function target(cfg) {
  return { serverUrl: cfg.serverUrl, authHeader: buildAuthHeader(cfg) };
}
function activate(ctx) {
  const services = ctx?.services ?? {};
  const workspacePath = services.workspacePath ?? process.cwd();
  const log = services.log ?? (() => {
  });
  log("debug", `onedev: ctx keys=[${Object.keys(ctx ?? {}).join(",")}] services keys=[${Object.keys(services).join(",")}]`);
  return {
    methods: {
      "importer.isAuthenticated": async () => {
        const cfg = resolveConfig(ctx);
        if (!cfg) return false;
        try {
          await oneDevGetJson(target(cfg), "/~api/projects?offset=0&count=1");
          return true;
        } catch (err) {
          log("debug", `onedev: auth probe failed: ${err?.message ?? err}`);
          return false;
        }
      },
      "importer.listBindings": async () => {
        const cfg = requireConfig(ctx);
        if (cfg.project) return [{ id: cfg.project, label: cfg.project }];
        const remotes = await runGit(["remote", "-v"], workspacePath);
        const seen = /* @__PURE__ */ new Set();
        const bindings = [];
        for (const line of remotes.split("\n")) {
          const parts = line.split(/\s+/);
          if (parts.length < 2) continue;
          const project = parseOneDevRemote(cfg.serverUrl, parts[1]);
          if (project && !seen.has(project)) {
            seen.add(project);
            bindings.push({ id: project, label: project });
          }
        }
        if (bindings.length > 0) {
          log("debug", `onedev: ${bindings.length} binding(s) from git remotes`);
          return bindings;
        }
        const projects = await oneDevGetJson(target(cfg), "/~api/projects?offset=0&count=100");
        const rawProjects = Array.isArray(projects) ? projects : [];
        const mapped = rawProjects.filter((p) => typeof p.path === "string" && p.path.length > 0).map((p) => ({ id: p.path, label: p.path }));
        if (mapped.length === 0 && rawProjects.length > 0) {
          throw new Error(
            "OneDev did not report project paths; set the Project setting in Settings (OneDev Importer) to your project path, e.g. org/app."
          );
        }
        return mapped;
      },
      "importer.list": async (params) => {
        const cfg = requireConfig(ctx);
        const project = params.binding.id;
        const filters = params.filters ?? {};
        log("debug", `onedev: list filters state=${String(filters.state)} limit=${String(filters.limit)} cursor=${String(filters.cursor)} search=${filters.search ? "yes" : "no"}`);
        const count = Math.min(Math.max(1, Number(filters.limit) || DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
        const offset = filters.cursor ? Number(filters.cursor) || 0 : 0;
        const states = (filters.state ?? "open") === "open" ? cfg.openStates : [];
        const query = buildIssuesQuery({ project, states });
        const issues = await oneDevGetJson(
          target(cfg),
          `/~api/issues?query=${encodeURIComponent(query)}&offset=${offset}&count=${count}`
        );
        const rawIssues = Array.isArray(issues) ? issues : [];
        let items = [];
        for (const i of rawIssues) {
          try {
            items.push(mapListEntry(i, project, cfg.serverUrl));
          } catch (err) {
            log("warn", `onedev: skipping malformed issue in ${project}: ${err?.message ?? err}`);
          }
        }
        if (filters.search) {
          const needle = String(filters.search).toLowerCase();
          items = items.filter(
            (e) => e.title.toLowerCase().includes(needle) || e.externalId.toLowerCase().includes(needle)
          );
        }
        const nextCursor = rawIssues.length >= count ? String(offset + count) : void 0;
        return { items, nextCursor };
      },
      "importer.fetch": async (params) => {
        const cfg = requireConfig(ctx);
        const { project, number } = parseExternalId(params.externalId);
        const query = `"Project" is "${escapeQueryValue(project)}" and "Number" is "${number}"`;
        let issues;
        try {
          issues = await oneDevGetJson(
            target(cfg),
            `/~api/issues?query=${encodeURIComponent(query)}&offset=0&count=1`
          );
        } catch (err) {
          if (!/OneDev HTTP 4\d\d /.test(err?.message ?? "")) {
            throw err;
          }
          const alt = `"Number" is "${escapeQueryValue(`${project}#${number}`)}"`;
          issues = await oneDevGetJson(
            target(cfg),
            `/~api/issues?query=${encodeURIComponent(alt)}&offset=0&count=1`
          );
        }
        const issue = Array.isArray(issues) ? issues[0] : null;
        if (!issue) throw new Error(`OneDev issue ${params.externalId} not found`);
        return mapIssueDetail(issue, project, cfg.serverUrl);
      }
    }
  };
}
export {
  activate
};
//# sourceMappingURL=backend.js.map
