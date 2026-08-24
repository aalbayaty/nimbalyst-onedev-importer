export const PROVIDER_ID = 'onedev-issues';
export const URN_SCHEME = 'onedev';

export interface OneDevConfig {
  serverUrl: string;
  username?: string;
  apiToken: string;
  openStates: string[];
  project?: string;
}

export function normalizeServerUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

export function parseOpenStates(raw: string | undefined): string[] {
  const states = (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return states.length > 0 ? states : ['Open'];
}

export function buildAuthHeader(cfg: Pick<OneDevConfig, 'username' | 'apiToken'>): string {
  if (cfg.username && cfg.username.length > 0) {
    return 'Basic ' + Buffer.from(`${cfg.username}:${cfg.apiToken}`).toString('base64');
  }
  return `Bearer ${cfg.apiToken}`;
}

export function buildExternalId(project: string, number: number): string {
  return `${project}#${number}`;
}

export function parseExternalId(externalId: string): { project: string; number: number } {
  const hash = externalId.lastIndexOf('#');
  const project = hash >= 0 ? externalId.slice(0, hash) : '';
  const number = hash >= 0 ? Number(externalId.slice(hash + 1)) : NaN;
  if (!project || !Number.isFinite(number)) {
    throw new Error(`Invalid OneDev externalId: ${externalId}`);
  }
  return { project, number };
}

export function buildUrn(project: string, number: number): string {
  return `${URN_SCHEME}://${project}#${number}`;
}

export function issueUrl(serverUrl: string, project: string, number: number): string {
  return `${normalizeServerUrl(serverUrl)}/${project}/~issues/${number}`;
}

export function escapeQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function buildIssuesQuery(opts: { project: string; states?: string[] }): string {
  const clauses: string[] = [`"Project" is "${escapeQueryValue(opts.project)}"`];
  const states = opts.states ?? [];
  if (states.length === 1) {
    clauses.push(`"State" is "${escapeQueryValue(states[0])}"`);
  } else if (states.length > 1) {
    clauses.push('(' + states.map((s) => `"State" is "${escapeQueryValue(s)}"`).join(' or ') + ')');
  }
  return clauses.join(' and ');
}

export function parseOneDevRemote(serverUrl: string, remoteUrl: string): string | null {
  let host: string;
  try {
    host = new URL(normalizeServerUrl(serverUrl)).host.split(':')[0];
  } catch {
    return null;
  }
  const url = remoteUrl.trim();
  // https://host[:port]/project/path(.git)?  or  ssh://git@host[:port]/project/path(.git)?
  let m = /^(?:https?|ssh):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/.exec(url);
  if (m) return m[1] === host ? m[2] : null;
  // git@host:project/path(.git)?
  m = /^[^@\s]+@([^:\s]+):(.+?)(?:\.git)?$/.exec(url);
  if (m) return m[1] === host ? m[2] : null;
  return null;
}

function lastActivityDate(issue: Record<string, any>): string | null {
  return issue.lastActivity?.date ?? issue.lastUpdate?.date ?? issue.updateDate ?? issue.submitDate ?? null;
}

export function mapListEntry(issue: Record<string, any>, project: string, serverUrl: string) {
  const number = Number(issue.number);
  return {
    externalId: buildExternalId(project, number),
    urn: buildUrn(project, number),
    url: issueUrl(serverUrl, project, number),
    title: String(issue.title ?? ''),
    state: String(issue.state ?? ''),
    updatedAt: lastActivityDate(issue),
  };
}

export function mapIssueDetail(issue: Record<string, any>, project: string, serverUrl: string) {
  const number = Number(issue.number);
  const submitterName: string | null =
    issue.submitter?.fullName ?? issue.submitter?.name ?? issue.submitterName ?? null;
  return {
    external: {
      providerId: PROVIDER_ID,
      externalId: buildExternalId(project, number),
      urn: buildUrn(project, number),
      url: issueUrl(serverUrl, project, number),
      titleSnapshot: String(issue.title ?? ''),
      stateSnapshot: String(issue.state ?? ''),
    },
    primaryType: 'bug' as const,
    title: String(issue.title ?? ''),
    body: String(issue.description ?? ''),
    status: String(issue.state ?? ''),
    labels: [] as string[],
    authorIdentity: submitterName
      ? { email: null, displayName: submitterName, gitName: submitterName }
      : null,
    upstreamCreatedAt: issue.submitDate ?? null,
    upstreamUpdatedAt: lastActivityDate(issue),
  };
}
