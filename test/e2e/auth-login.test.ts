import { createHash } from 'node:crypto';
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
let redirectPort: number;
let issued = 0;
let refreshed = 0;
let denyLogin = false;
let authorize: URLSearchParams | undefined;
const tokenBodies: string[] = [];
const apiCalls: string[] = [];

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

beforeAll(async () => {
  assertCliIsBuilt();
  // A fake OAuth provider (authorize + token endpoints) and an API that accepts its tokens.
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://provider');
    let body = '';
    req.setEncoding('utf8').on('data', (chunk: string) => (body += chunk));
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (url.pathname === '/authorize') {
        authorize = url.searchParams;
        const back = new URL(url.searchParams.get('redirect_uri') as string);
        back.searchParams.set('state', url.searchParams.get('state') as string);
        if (denyLogin) back.searchParams.set('error', 'access_denied');
        else back.searchParams.set('code', 'AUTH_CODE_1');
        res.writeHead(302, { Location: back.toString() }).end();
      } else if (url.pathname === '/token') {
        tokenBodies.push(body);
        const params = new URLSearchParams(body);
        if (params.get('grant_type') === 'authorization_code') {
          const challenge = createHash('sha256').update(params.get('code_verifier') ?? '').digest('base64url');
          const valid = params.get('code') === 'AUTH_CODE_1' && challenge === authorize?.get('code_challenge') && params.get('redirect_uri') === authorize?.get('redirect_uri') && params.get('client_id') === 'desktop-app';
          if (!valid) { res.writeHead(400).end('{"error":"invalid_grant"}'); return; }
          res.end(JSON.stringify({ access_token: `LOGIN_TOKEN_${++issued}`, refresh_token: 'REFRESH_TOKEN_1', expires_in: 3600, token_type: 'Bearer' }));
        } else if (params.get('grant_type') === 'refresh_token' && params.get('refresh_token') === `REFRESH_TOKEN_${refreshed + 1}`) {
          refreshed++;
          res.end(JSON.stringify({ access_token: `RENEWED_TOKEN_${refreshed}`, refresh_token: `REFRESH_TOKEN_${refreshed + 1}`, expires_in: 3600 }));
        } else {
          res.writeHead(400).end('{"error":"invalid_grant","error_description":"Refresh token expired"}');
        }
      } else {
        apiCalls.push(`${req.method} ${url.pathname} ${req.headers.authorization ?? '-'}`);
        res.writeHead(/^Bearer (LOGIN|RENEWED)_TOKEN_\d+$/.test(req.headers.authorization ?? '') ? 200 : 401).end('{}');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(async () => {
  issued = 0; refreshed = 0; denyLogin = false; authorize = undefined; tokenBodies.length = 0; apiCalls.length = 0;
  root = await mkdtemp(join(tmpdir(), 'e2e-auth-login-'));
  redirectPort = await freePort();
  await write('httpi.yaml', {
    version: 1,
    env: { default: 'local', environments: { local: { baseUrl } } },
    auth: {
      me: { type: 'oauth2', flow: 'authorization_code', authorizationUrl: '{{baseUrl}}/authorize', tokenUrl: '{{baseUrl}}/token', clientId: 'desktop-app', scopes: ['users.read'], redirectPort },
      ci: { type: 'oauth2', flow: 'client_credentials', tokenUrl: '{{baseUrl}}/token', clientId: 'ci', clientSecret: '${CLIENT_SECRET}' },
    },
    run: ['tests/me.yaml'],
  });
  await write('tests/me.yaml', { version: 1, tests: [{ name: 'who am I', request: { url: '{{baseUrl}}/me', auth: 'me' }, expect: { status: 200 } }] });
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

const storePath = () => join(root, '.httpi', 'tokens.json');
const readStore = async () => JSON.parse(await readFile(storePath(), 'utf8')) as Record<string, { accessToken: string; refreshToken?: string; expiresAt?: number }>;

/** Runs `httpi auth login me`; the "browser" is this test following the printed URL to the callback. */
function login() {
  let visited: Promise<Response> | undefined;
  return httpi(['auth', 'login', 'me'], {
    cwd: root,
    env: { HTTPI_NO_BROWSER: '1' },
    onStderr: (stderr) => {
      const url = /^(http\S+)$/m.exec(stderr)?.[1];
      if (url !== undefined && visited === undefined) visited = fetch(url);
    },
  });
}

test('auth login completes the code flow with PKCE and state, and httpi run then uses the stored token', async () => {
  const before = await httpi(['auth', 'status'], { cwd: root });
  expect(before.stdout).toBe('me: authorization_code, not logged in; run "httpi auth login me"\nci: client_credentials, token requested on every run\n');

  const result = await login();
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('Open this URL in a browser to log in:\n');
  expect(result.stderr).toContain('httpi: logged in as "me"; the token is stored in .httpi/tokens.json');
  expect(result.stderr).not.toMatch(/LOGIN_TOKEN_|REFRESH_TOKEN_|AUTH_CODE_/);
  expect(result.code).toBe(0);

  expect(Object.fromEntries(authorize ?? [])).toMatchObject({
    response_type: 'code',
    client_id: 'desktop-app',
    redirect_uri: `http://127.0.0.1:${redirectPort}/callback`,
    scope: 'users.read',
    code_challenge_method: 'S256',
  });
  expect(authorize?.get('state')).toMatch(/^[A-Za-z0-9_-]{22}$/);
  expect(tokenBodies).toHaveLength(1);
  expect(tokenBodies[0]).toMatch(/^grant_type=authorization_code&code=AUTH_CODE_1&redirect_uri=.*&code_verifier=[A-Za-z0-9_-]{43}&client_id=desktop-app$/);

  const store = await readStore();
  expect(store).toEqual({ me: { accessToken: 'LOGIN_TOKEN_1', refreshToken: 'REFRESH_TOKEN_1', expiresAt: expect.any(Number) } });

  const status = await httpi(['auth', 'status'], { cwd: root });
  expect(status.stdout).toMatch(/^me: authorization_code, logged in until \d{4}-\d\d-\d\dT[\d:.]+Z\n/);
  expect(status.stdout).not.toMatch(/LOGIN_TOKEN_|REFRESH_TOKEN_/);

  const run = await httpi(['run', '--show-response'], { cwd: root });
  expect(apiCalls).toEqual(['GET /me Bearer LOGIN_TOKEN_1']);
  expect(tokenBodies).toHaveLength(1);
  expect(run.stdout).toContain('1 file, 1 test: 1 passed');
  expect(run.stdout + run.stderr).not.toContain('LOGIN_TOKEN_1');
  expect(run.code).toBe(0);
});

test('an expired login is renewed with the refresh token and the rotated tokens are saved', async () => {
  await write('.httpi/tokens.json', { me: { accessToken: 'LOGIN_TOKEN_1', refreshToken: 'REFRESH_TOKEN_1', expiresAt: Date.now() - 1000 } });
  expect((await httpi(['auth', 'status'], { cwd: root })).stdout).toContain('me: authorization_code, expired; it will be renewed on the next run\n');

  const run = await httpi(['run'], { cwd: root });
  expect(tokenBodies).toEqual(['grant_type=refresh_token&refresh_token=REFRESH_TOKEN_1&client_id=desktop-app']);
  expect(apiCalls).toEqual(['GET /me Bearer RENEWED_TOKEN_1']);
  expect(run.code).toBe(0);
  expect(await readStore()).toEqual({ me: { accessToken: 'RENEWED_TOKEN_1', refreshToken: 'REFRESH_TOKEN_2', expiresAt: expect.any(Number) } });

  // The saved token is still good: the next run asks nobody.
  expect((await httpi(['run'], { cwd: root })).code).toBe(0);
  expect(tokenBodies).toHaveLength(1);
});

test.each<[name: string, store: object | null, stderr: string]>([
  ['nobody logged in', null, 'httpi: auth "me": not logged in; run "httpi auth login me"\n'],
  ['the login expired and there is no refresh token', { me: { accessToken: 'LOGIN_TOKEN_1', expiresAt: 1 } }, 'httpi: auth "me": the login expired; run "httpi auth login me"\n'],
  ['the refresh token is no longer accepted', { me: { accessToken: 'LOGIN_TOKEN_1', refreshToken: 'OLD_REFRESH', expiresAt: 1 } }, 'httpi: auth "me": the token endpoint answered 400 (invalid_grant: Refresh token expired)\n'],
])('exit 3 without running the tests when %s', async (_name, store, stderr) => {
  if (store !== null) await write('.httpi/tokens.json', store);
  const run = await httpi(['run'], { cwd: root });
  expect(run.stdout).toBe('');
  expect(run.stderr).toBe(stderr);
  expect(apiCalls).toEqual([]);
  expect(run.code).toBe(3);
});

test('a login the provider refuses stores nothing and exits 3', async () => {
  denyLogin = true;
  const result = await login();
  expect(result.stderr).toContain('httpi: auth "me": the provider refused the login (access_denied)\n');
  expect(tokenBodies).toEqual([]);
  await expect(readFile(storePath(), 'utf8')).rejects.toThrow();
  expect(result.code).toBe(3);
});

test('a callback with the wrong state is rejected', async () => {
  let visited = false;
  const result = await httpi(['auth', 'login', 'me'], {
    cwd: root,
    env: { HTTPI_NO_BROWSER: '1' },
    onStderr: (stderr) => {
      if (!visited && stderr.includes('http')) {
        visited = true;
        void fetch(`http://127.0.0.1:${redirectPort}/callback?code=STOLEN_CODE&state=forged`);
      }
    },
  });
  expect(result.stderr).toContain('the callback carried an unexpected state');
  expect(tokenBodies).toEqual([]);
  expect(result.code).toBe(3);
});

test.each<[name: string, args: string[], stderr: RegExp]>([
  ['an unknown auth name', ['auth', 'login', 'nope'], /^httpi: auth "nope" is not declared in httpi\.yaml; available: me, ci\n$/],
  ['a flow that needs no login', ['auth', 'login', 'ci'], /^httpi: auth "ci" uses client_credentials: it needs no login/],
  ['a missing name', ['auth', 'login'], /^error: missing required argument 'name'/],
])('exit 2 for %s', async (_name, args, stderr) => {
  const result = await httpi(args, { cwd: root, env: { HTTPI_NO_BROWSER: '1' } });
  expect(result.stderr).toMatch(stderr);
  expect(result.code).toBe(2);
});
