import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { assertCliIsBuilt, httpi } from './helpers.js';

let server: Server;
let baseUrl: string;
let root: string;
let issued = 0;
let tokenStatus = 200;
const calls: string[] = [];
const tokenRequests: Array<{ authorization: string | undefined; body: string }> = [];

const BASIC = `Basic ${Buffer.from('ci-client:CI_CLIENT_SECRET').toString('base64')}`;

beforeAll(async () => {
  assertCliIsBuilt();
  // A fake authorization server plus an API that only accepts the last token it issued.
  server = createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8').on('data', (chunk: string) => (body += chunk));
    req.on('end', () => {
      calls.push(`${req.method} ${req.url}`);
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/oauth/token') {
        tokenRequests.push({ authorization: req.headers.authorization, body });
        const params = new URLSearchParams(body);
        const viaBody = params.get('client_id') === 'ci-client' && params.get('client_secret') === 'CI_CLIENT_SECRET';
        const publicRefresh = params.get('client_id') === 'ci-client' && params.get('client_secret') === null && params.get('grant_type') === 'refresh_token';
        const badRefresh = params.get('grant_type') === 'refresh_token' && params.get('refresh_token') !== 'USER_REFRESH_TOKEN';
        if (tokenStatus !== 200 || badRefresh || (req.headers.authorization !== BASIC && !viaBody && !publicRefresh)) {
          res.writeHead(tokenStatus === 200 ? 401 : tokenStatus);
          res.end('{"error":"invalid_client","error_description":"Client authentication failed"}');
          return;
        }
        res.end(JSON.stringify({ access_token: `OAUTH_TOKEN_${++issued}`, token_type: 'Bearer', expires_in: 3600 }));
      } else {
        res.writeHead(req.headers.authorization === `Bearer OAUTH_TOKEN_${issued}` ? 200 : 401);
        res.end(JSON.stringify({ seen: req.headers.authorization ?? null }));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
beforeEach(async () => {
  calls.length = 0; tokenRequests.length = 0; issued = 0; tokenStatus = 200;
  root = await mkdtemp(join(tmpdir(), 'e2e-oauth-'));
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(root, { recursive: true, force: true });
});

async function write(path: string, content: unknown): Promise<void> {
  const full = join(root, path);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, typeof content === 'string' ? content : JSON.stringify(content));
}

const guarded = (name: string, path: string, auth: string | null = 'main') => ({
  name,
  request: { url: `{{baseUrl}}${path}`, ...(auth !== null && { auth }) },
  expect: { status: 200 },
});

async function project(auth: object = {}, tests: object[] = [guarded('list users', '/users'), guarded('one user', '/users/7')]): Promise<void> {
  await write('httpi.yaml', {
    version: 1,
    env: { default: 'local', environments: { local: { baseUrl } } },
    auth: {
      main: { type: 'oauth2', flow: 'client_credentials', tokenUrl: '{{baseUrl}}/oauth/token', clientId: 'ci-client', clientSecret: '${CLIENT_SECRET}', scopes: ['users.read'], ...auth },
    },
    run: ['tests/*.yaml'],
    report: { junit: 'reports/junit.xml' },
  });
  await write('tests/users.yaml', { version: 1, tests });
  await write('tests/zz-public.yaml', { version: 1, tests: [{ name: 'public', request: { url: '{{baseUrl}}/public' }, expect: { status: 401 } }] });
}

const env = { CLIENT_SECRET: 'CI_CLIENT_SECRET' };

test('client_credentials: one token request for the whole run, sent as Bearer only where auth is used, never printed', async () => {
  await project();
  const run = await httpi(['run', '--show-response'], { cwd: root, env });
  expect(run.stderr).toBe('');
  expect(calls).toEqual(['POST /oauth/token', 'GET /users', 'GET /users/7', 'GET /public']);
  expect(tokenRequests).toEqual([{ authorization: BASIC, body: 'grant_type=client_credentials&scope=users.read' }]);
  expect(run.stdout).toContain('✓ list users (200,');
  expect(run.stdout).toContain('"seen": "Bearer [REDACTED]"');
  expect(run.stdout).toContain('"seen": null');
  expect(run.stdout).toContain('2 files, 3 tests: 3 passed');
  const junit = await readFile(join(root, 'reports', 'junit.xml'), 'utf8');
  expect(run.stdout + run.stderr + junit).not.toMatch(/OAUTH_TOKEN_|CI_CLIENT_SECRET/);
  expect(run.code).toBe(0);
});

test('clientAuth: body sends the client credentials in the form', async () => {
  await project({ clientAuth: 'body', scopes: undefined });
  const run = await httpi(['run'], { cwd: root, env });
  expect(tokenRequests).toEqual([{ authorization: undefined, body: 'grant_type=client_credentials&client_id=ci-client&client_secret=CI_CLIENT_SECRET' }]);
  expect(run.code).toBe(0);
});

test.each<[name: string, auth: object, request: { authorization: string | undefined; body: string }]>([
  [
    'a confidential client',
    { flow: 'refresh_token', refreshToken: '${REFRESH_TOKEN}' },
    { authorization: BASIC, body: 'grant_type=refresh_token&refresh_token=USER_REFRESH_TOKEN&scope=users.read' },
  ],
  [
    'a public client',
    { flow: 'refresh_token', refreshToken: '${REFRESH_TOKEN}', clientSecret: undefined, scopes: undefined },
    { authorization: undefined, body: 'grant_type=refresh_token&refresh_token=USER_REFRESH_TOKEN&client_id=ci-client' },
  ],
])('refresh_token: %s exchanges the refresh token once and never prints it', async (_name, auth, request) => {
  await project(auth);
  const run = await httpi(['run', '--show-response'], { cwd: root, env: { ...env, REFRESH_TOKEN: 'USER_REFRESH_TOKEN' } });
  expect(tokenRequests).toEqual([request]);
  expect(calls).toEqual(['POST /oauth/token', 'GET /users', 'GET /users/7', 'GET /public']);
  expect(run.stdout + run.stderr).not.toMatch(/OAUTH_TOKEN_|USER_REFRESH_TOKEN|CI_CLIENT_SECRET/);
  expect(run.code).toBe(0);
});

test('refresh_token: an expired refresh token stops the run with exit 3', async () => {
  await project({ flow: 'refresh_token', refreshToken: '${REFRESH_TOKEN}' });
  const run = await httpi(['run'], { cwd: root, env: { ...env, REFRESH_TOKEN: 'EXPIRED_REFRESH_TOKEN' } });
  expect(run.stderr).toBe('httpi: auth "main": the token endpoint answered 401 (invalid_client: Client authentication failed)\n');
  expect(run.stderr).not.toContain('EXPIRED_REFRESH_TOKEN');
  expect(run.code).toBe(3);
});

test('no token is requested when no test uses auth', async () => {
  await project({}, [guarded('anonymous', '/users', null)]);
  const run = await httpi(['run'], { cwd: root, env: { CLIENT_SECRET: undefined } });
  expect(calls).toEqual(['GET /users', 'GET /public']);
  expect(run.code).toBe(1);
});

test('exit 3 without running any test when the token endpoint refuses the client', async () => {
  await project();
  const run = await httpi(['run'], { cwd: root, env: { CLIENT_SECRET: 'WRONG_SECRET' } });
  expect(run.stdout).toBe('');
  expect(run.stderr).toBe('httpi: auth "main": the token endpoint answered 401 (invalid_client: Client authentication failed)\n');
  expect(calls).toEqual(['POST /oauth/token']);
  expect(run.code).toBe(3);
});

test('exit 3 when the token endpoint cannot be reached', async () => {
  await project({ tokenUrl: 'http://127.0.0.1:1/oauth/token' });
  const run = await httpi(['run'], { cwd: root, env });
  expect(run.stderr).toMatch(/^httpi: auth "main": cannot reach the token endpoint: /);
  expect(calls).toEqual([]);
  expect(run.code).toBe(3);
});

test.each<[name: string, setup: () => Promise<void>, runEnv: NodeJS.ProcessEnv, stderr: string]>([
  ['the client secret variable is not set', () => project(), { CLIENT_SECRET: undefined }, 'httpi: unresolved variable: ${CLIENT_SECRET}\n'],
  ['a test names an auth block that does not exist', () => project({}, [guarded('x', '/users', 'admin')]), env, 'httpi: test "x": auth "admin" is not declared in httpi.yaml; available: main\n'],
  [
    'a test uses auth and its own Authorization header',
    () => project({}, [{ name: 'both', request: { url: '{{baseUrl}}/users', auth: 'main', headers: { Authorization: 'Bearer {{authTokenFromElsewhere}}' } } }]),
    { ...env, authTokenFromElsewhere: 'x' },
    'httpi: test "both": use either auth "main" or an Authorization header, not both\n',
  ],
])('exit 2 before sending anything when %s', async (_name, setup, runEnv, stderr) => {
  await setup();
  const run = await httpi(['run'], { cwd: root, env: runEnv });
  expect(run.stderr).toBe(stderr);
  expect(calls).toEqual([]);
  expect(run.code).toBe(2);
});

test('auth outside a project run is refused: single file, export', async () => {
  await project();
  const single = await httpi(['run', 'tests/users.yaml', '--var', `baseUrl=${baseUrl}`], { cwd: root, env });
  expect(single.stderr).toContain('auth "main" is not available: declare it under "auth" in httpi.yaml and run the project with httpi run');
  expect(single.code).toBe(2);

  const exported = await httpi(['export', 'tests/users.yaml', '--var', `baseUrl=${baseUrl}`], { cwd: root, env });
  expect(exported.stdout).toBe('');
  expect(exported.stderr).toContain('must be executed with httpi run');
  expect(exported.code).toBe(2);
  expect(calls).toEqual([]);
});

test('httpi validate checks auth names and auth variables without asking for a token', async () => {
  await project({ tokenUrl: '{{missingHost}}/oauth/token' }, [guarded('ok', '/users'), guarded('unknown', '/users', 'admin')]);
  const result = await httpi(['validate'], { cwd: root, env: { CLIENT_SECRET: undefined, missingHost: undefined } });
  expect(result.stdout).toBe(
    'tests/users.yaml: test "unknown": auth "admin" is not declared in httpi.yaml; available: main\n' +
      'httpi.yaml: auth "main": unresolved variable: {{missingHost}}\n' +
      '2 problems in 2 files, 3 tests\n',
  );
  expect(calls).toEqual([]);
  expect(result.code).toBe(2);
});
