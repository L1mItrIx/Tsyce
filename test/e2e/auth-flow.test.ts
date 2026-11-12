import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { httpi } from './helpers.js';

let server: Server; let dir: string; let url: string;
let issued = 0; let token = ''; let denyLogin = false;
const calls: string[] = [];
const login = (status = 200, path = '$.access_token') => ({ name: 'login', request: { method: 'POST', url: `${url}/login` }, expect: { status }, capture: { authToken: path } });
const protectedRequest = () => ({ name: 'protected', request: { url: `${url}/private`, headers: { Authorization: 'Bearer {{authToken}}' } }, expect: { status: 200 } });
async function flow(tests: unknown[]): Promise<string> {
  const file = join(dir, 'flow.json');
  await writeFile(file, JSON.stringify({ version: 1, tests }));
  return file;
}

beforeAll(async () => {
  server = createServer((req, res) => {
    calls.push(req.url!); res.setHeader('Content-Type', 'application/json');
    if (req.url === '/login') {
      if (denyLogin) { res.writeHead(401); res.end('{"access_token":"PRIVATE_TOKEN_DENIED"}'); }
      else { token = `PRIVATE_TOKEN_${++issued}`; res.end(JSON.stringify({ access_token: token })); }
    } else {
      res.writeHead(req.headers.authorization === `Bearer ${token}` ? 200 : 401);
      res.end(JSON.stringify({ authorization: req.headers.authorization }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  dir = await mkdtemp(join(tmpdir(), 'auth-flow-'));
});
beforeEach(() => { calls.length = 0; issued = 0; token = ''; denyLogin = false; });
afterAll(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await rm(dir, { recursive: true, force: true }); });

test('each execution logs in, captures a fresh token and redacts pretty/JUnit output', async () => {
  const file = await flow([login(), protectedRequest()]);
  for (const reporter of ['pretty', 'junit']) {
    const run = await httpi(['run', file, '--reporter', reporter, ...(reporter === 'pretty' ? ['--show-response'] : [])], { env: { authToken: 'STALE_TOKEN' } });
    expect(run.code).toBe(0); expect(run.stdout + run.stderr).not.toContain('PRIVATE_TOKEN_');
    expect(run.stdout).toContain(reporter === 'pretty' ? '[REDACTED]' : '<testsuites');
  }
  expect(calls).toEqual(['/login', '/private', '/login', '/private']);
  expect(issued).toBe(2);
});

test.each(['missing token', 'failed assert', 'HTTP 401'])('%s stops the flow before the protected request without exposing the login response', async (reason) => {
  denyLogin = reason === 'HTTP 401';
  const file = await flow([login(denyLogin ? 401 : reason === 'failed assert' ? 201 : 200, reason === 'missing token' ? '$.missing' : '$.access_token'), protectedRequest()]);
  const run = await httpi(['run', file, '--show-response']);
  expect(run.code).toBe(1); expect(calls).toEqual(['/login']);
  expect(run.stdout + run.stderr).not.toContain('PRIVATE_TOKEN_');
  expect(run.stdout).toContain('flow stopped');
});

test('using a token before capture is invalid even when the system has an old token', async () => {
  const file = await flow([protectedRequest(), login()]);
  const run = await httpi(['run', file], { env: { authToken: 'STALE_TOKEN' } });
  expect(run.code).toBe(2); expect(calls).toEqual([]);
  expect(run.stderr).toContain('unresolved variable');
});

test('static export rejects capture flows instead of silently losing their authentication behavior', async () => {
  const file = await flow([login(), protectedRequest()]);
  const exported = await httpi(['export', file, '--var', 'authToken=stale']);
  expect(exported.code).toBe(2); expect(exported.stdout).toBe(''); expect(calls).toEqual([]);
});
