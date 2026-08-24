import { describe, it, expect } from 'vitest';
import {
  normalizeServerUrl, parseOpenStates, buildAuthHeader,
  buildExternalId, parseExternalId, buildUrn, issueUrl,
  escapeQueryValue, buildIssuesQuery, parseOneDevRemote,
  mapListEntry, mapIssueDetail,
} from '../src/onedevClient';

describe('config helpers', () => {
  it('normalizes server URLs by stripping trailing slashes', () => {
    expect(normalizeServerUrl('https://dev.example.com/')).toBe('https://dev.example.com');
    expect(normalizeServerUrl('https://dev.example.com')).toBe('https://dev.example.com');
  });

  it('parses openStates as trimmed comma-separated names, defaulting to Open', () => {
    expect(parseOpenStates('Open, In Progress ,')).toEqual(['Open', 'In Progress']);
    expect(parseOpenStates(undefined)).toEqual(['Open']);
    expect(parseOpenStates('')).toEqual(['Open']);
  });

  it('builds Basic auth when username is set, Bearer otherwise', () => {
    expect(buildAuthHeader({ username: 'ahmad', apiToken: 'tok' }))
      .toBe('Basic ' + Buffer.from('ahmad:tok').toString('base64'));
    expect(buildAuthHeader({ apiToken: 'tok' })).toBe('Bearer tok');
    expect(buildAuthHeader({ username: '', apiToken: 'tok' })).toBe('Bearer tok');
  });
});

describe('ids, urns, urls', () => {
  it('round-trips externalId with nested project paths', () => {
    const ext = buildExternalId('org/sub/app', 42);
    expect(ext).toBe('org/sub/app#42');
    expect(parseExternalId(ext)).toEqual({ project: 'org/sub/app', number: 42 });
  });

  it('rejects malformed externalIds', () => {
    expect(() => parseExternalId('no-hash')).toThrow(/Invalid OneDev externalId/);
    expect(() => parseExternalId('proj#notanumber')).toThrow(/Invalid OneDev externalId/);
  });

  it('builds urn and web url', () => {
    expect(buildUrn('org/app', 7)).toBe('onedev://org/app#7');
    expect(issueUrl('https://dev.example.com', 'org/app', 7))
      .toBe('https://dev.example.com/org/app/~issues/7');
  });
});

describe('issue query building', () => {
  it('escapes quotes and backslashes in query values', () => {
    expect(escapeQueryValue('plain')).toBe('plain');
    expect(escapeQueryValue('say "hi" \\ done')).toBe('say \\"hi\\" \\\\ done');
  });

  it('builds a project-scoped query with a state disjunction', () => {
    expect(buildIssuesQuery({ project: 'org/app', states: ['Open', 'Reopened'] }))
      .toBe('"Project" is "org/app" and ("State" is "Open" or "State" is "Reopened")');
  });

  it('builds a project-scoped query with a single state', () => {
    expect(buildIssuesQuery({ project: 'org/app', states: ['Open'] }))
      .toBe('"Project" is "org/app" and "State" is "Open"');
  });

  it('omits the state clause when states is empty or absent (i.e. state filter "all")', () => {
    expect(buildIssuesQuery({ project: 'org/app', states: [] })).toBe('"Project" is "org/app"');
    expect(buildIssuesQuery({ project: 'org/app' })).toBe('"Project" is "org/app"');
  });
});

describe('parseOneDevRemote', () => {
  it('extracts the project path from https remotes on the configured host', () => {
    expect(parseOneDevRemote('https://dev.example.com', 'https://dev.example.com/org/app'))
      .toBe('org/app');
    expect(parseOneDevRemote('https://dev.example.com', 'https://dev.example.com/org/app.git'))
      .toBe('org/app');
  });

  it('extracts from ssh remotes on the same host', () => {
    expect(parseOneDevRemote('https://dev.example.com', 'ssh://git@dev.example.com:6611/org/app'))
      .toBe('org/app');
    expect(parseOneDevRemote('https://dev.example.com', 'git@dev.example.com:org/app.git'))
      .toBe('org/app');
  });

  it('returns null for other hosts or garbage', () => {
    expect(parseOneDevRemote('https://dev.example.com', 'https://github.com/org/app.git')).toBeNull();
    expect(parseOneDevRemote('https://dev.example.com', 'not a url')).toBeNull();
  });
});

describe('issue mapping', () => {
  const issue = {
    id: 123, number: 42, title: 'Crash on save', state: 'Open',
    description: 'It crashes.',
    submitDate: '2026-08-01T10:00:00Z',
    lastActivity: { date: '2026-08-20T12:00:00Z' },
    submitter: { name: 'ahmad', fullName: 'Ahmad A.' },
  };

  it('maps a list entry', () => {
    expect(mapListEntry(issue, 'org/app', 'https://dev.example.com')).toEqual({
      externalId: 'org/app#42',
      urn: 'onedev://org/app#42',
      url: 'https://dev.example.com/org/app/~issues/42',
      title: 'Crash on save',
      state: 'Open',
      updatedAt: '2026-08-20T12:00:00Z',
    });
  });

  it('maps full detail', () => {
    const d = mapIssueDetail(issue, 'org/app', 'https://dev.example.com');
    expect(d.external).toEqual({
      providerId: 'onedev-issues',
      externalId: 'org/app#42',
      urn: 'onedev://org/app#42',
      url: 'https://dev.example.com/org/app/~issues/42',
      titleSnapshot: 'Crash on save',
      stateSnapshot: 'Open',
    });
    expect(d.primaryType).toBe('bug');
    expect(d.body).toBe('It crashes.');
    expect(d.status).toBe('Open');
    expect(d.labels).toEqual([]);
    expect(d.authorIdentity).toEqual({ email: null, displayName: 'Ahmad A.', gitName: 'Ahmad A.' });
    expect(d.upstreamCreatedAt).toBe('2026-08-01T10:00:00Z');
    expect(d.upstreamUpdatedAt).toBe('2026-08-20T12:00:00Z');
  });

  it('tolerates missing optional fields (version differences)', () => {
    const bare = { number: 7, title: 'x', state: 'Closed' };
    const d = mapIssueDetail(bare, 'org/app', 'https://dev.example.com');
    expect(d.body).toBe('');
    expect(d.authorIdentity).toBeNull();
    expect(d.upstreamCreatedAt).toBeNull();
    expect(d.upstreamUpdatedAt).toBeNull();
    expect(mapListEntry(bare, 'org/app', 'https://dev.example.com').updatedAt).toBeNull();
  });

  it('throws when the issue has no usable number field', () => {
    const noNumber = { title: 'x', state: 'Open' };
    expect(() => mapListEntry(noNumber, 'org/app', 'https://dev.example.com'))
      .toThrow(/no usable "number"/);
    expect(() => mapIssueDetail(noNumber, 'org/app', 'https://dev.example.com'))
      .toThrow(/no usable "number"/);
  });
});
