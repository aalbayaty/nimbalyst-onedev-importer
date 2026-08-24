import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'node:http';
import { oneDevGetJson } from '../src/http';

let server: http.Server;
let base: string;
let lastReq: http.IncomingMessage | null = null;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    lastReq = req;
    if (req.url?.startsWith('/ok')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([{ number: 1 }]));
    } else if (req.url?.startsWith('/slow')) {
      // never respond; the client should abort
    } else {
      res.writeHead(401, { 'Content-Type': 'text/plain' });
      res.end('bad token'.repeat(100));
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address() as { port: number };
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('oneDevGetJson', () => {
  const cfg = () => ({ serverUrl: base, authHeader: 'Bearer tok' });

  it('sends the auth header and parses JSON', async () => {
    const data = await oneDevGetJson(cfg(), '/ok?x=1');
    expect(data).toEqual([{ number: 1 }]);
    expect(lastReq?.headers.authorization).toBe('Bearer tok');
  });

  it('throws with status and truncated body on non-2xx', async () => {
    const err: Error = await oneDevGetJson(cfg(), '/nope').then(
      () => { throw new Error('expected rejection'); },
      (e: Error) => e,
    );
    expect(err.message).toMatch(/HTTP 401/);
    expect(err.message.length).toBeLessThan(300);
  });

  it('aborts after the timeout', async () => {
    await expect(oneDevGetJson(cfg(), '/slow', 200)).rejects.toThrow(/timed out|abort/i);
  }, 5000);
});
