import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { assertCliIsBuilt, httpi } from './helpers.js';

let server: Server;
let origin = '';
let root: string;
let outside: string;
const calls: string[] = [];

beforeAll(async () => {
  assertCliIsBuilt();
  server = createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8').on('data', (chunk: string) => (body += chunk));
    req.on('end', () => {
      calls.push(`${req.method} ${req.url}`);
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/oauth/token') res.end('{"access_token":"MCP_OAUTH_TOKEN","token_type":"Bearer"}');
      else if (req.url === '/login') res.end('{"session":"MCP_SESSION_VALUE"}');
      else res.writeHead(req.headers.authorization === 'Bearer MCP_OAUTH_TOKEN' ? 200 : 401).end('{"secret":"RESPONSE_BODY_SECRET"}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  outside = await mkdtemp(join(tmpdir(), 'mcp-project-outside-'));
  await writeFile(join(outside, 'escape.yaml'), JSON.stringify({ version: 1, tests: [{ name: 'x', request: { url: origin } }] }));
});
beforeEach(async () => {
  calls.length = 0;
  root = await mkdtemp(join(tmpdir(), 'mcp-project-'));
  await project();
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

async function write(path: string, content: unknown): Promise<void> {
  const full = join(root, path);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, typeof content === 'string' ? content : JSON.stringify(content));
}

async function project(extra: object = {}): Promise<void> {
  await write('httpi.yaml', {
    version: 1,
    name: 'MCP project',
    env: { default: 'qa', environments: { qa: { baseUrl: origin }, prod: { baseUrl: 'https://prod.invalid' } } },
    auth: { main: { type: 'oauth2', flow: 'client_credentials', tokenUrl: '{{baseUrl}}/oauth/token', clientId: 'ci', clientSecret: '${MCP_CLIENT_SECRET}' } },
    run: ['tests/login.yaml', { file: 'tests/users.yaml', data: 'data/users.csv' }],
    ...extra,
  });
  await write('httpi.local.yaml', 'personal: LOCAL_ONLY_VALUE\n');
  await write('data/users.csv', 'id\n1\n2\n');
  await write('tests/login.yaml', { version: 1, tests: [{ name: 'login', request: { method: 'POST', url: '{{baseUrl}}/login' }, capture: { session: '$.session' } }] });
  await write('tests/users.yaml', {
    version: 1,
    tests: [{ name: 'user {{data.id}}', request: { url: '{{baseUrl}}/users/{{data.id}}', auth: 'main', headers: { 'X-Session': '{{session}}' } }, expect: { status: 200 } }],
  });
}

const message = (id: number, method: string, params = {}) => ({ jsonrpc: '2.0', id, method, params });
const init = message(0, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
const ready = { jsonrpc: '2.0', method: 'notifications/initialized' };
const call = (id: number, name: string, args: object) => message(id, 'tools/call', { name, arguments: args });

async function rpc(messages: unknown[], options: string[] = []) {
  const result = await httpi(['mcp', '--root', root, ...options], {
    stdin: `${[init, ready, ...messages].map((item) => JSON.stringify(item)).join('\n')}\n`,
    env: { MCP_CLIENT_SECRET: 'MCP_CLIENT_SECRET_VALUE' },
  });
  expect(result.code).toBe(0);
  const replies = result.stdout.trim().split('\n').map((line) => JSON.parse(line) as { result: { isError: boolean; structuredContent: Record<string, unknown>; content: Array<{ text: string }> } });
  return { replies: replies.slice(1), all: result.stdout + result.stderr };
}

const SECRETS = /MCP_OAUTH_TOKEN|MCP_SESSION_VALUE|MCP_CLIENT_SECRET_VALUE|LOCAL_ONLY_VALUE|RESPONSE_BODY_SECRET/;
const allowed = () => ['--allow-run', '--allow-origin', origin, '--allow-env', 'qa'];

test('list_tests offers the project, and inspect_test describes it without secrets', async () => {
  const { replies, all } = await rpc([call(1, 'list_tests', {}), call(2, 'inspect_test', { file: 'httpi.yaml' })]);
  expect(replies[0]!.result.structuredContent).toMatchObject({ files: ['tests/login.yaml', 'tests/users.yaml'], projects: ['httpi.yaml'] });
  expect(replies[1]!.result.structuredContent).toEqual({
    file: 'httpi.yaml',
    project: true,
    name: 'MCP project',
    run: [{ file: 'tests/login.yaml' }, { file: 'tests/users.yaml', data: 'data/users.csv' }],
    environments: ['qa', 'prod'],
    defaultEnvironment: 'qa',
    auth: [{ name: 'main', flow: 'client_credentials' }],
  });
  expect(all).not.toMatch(SECRETS);
  expect(calls).toEqual([]);
});

test('run_test on httpi.yaml runs the whole project: OAuth token, shared capture, one request per data row', async () => {
  const { replies, all } = await rpc([call(1, 'run_test', { file: 'httpi.yaml' })], allowed());
  const result = replies[0]!.result;
  expect(result.isError).toBe(false);
  expect(calls).toEqual(['POST /oauth/token', 'POST /login', 'GET /users/1', 'GET /users/2']);
  expect(result.structuredContent).toMatchObject({
    exitCode: 0,
    summary: { executed: 3, passed: 3, failed: 0, errored: 0 },
    skipped: 0,
    tests: [
      { order: 1, file: 'tests/login.yaml', status: 'passed', httpStatus: 200 },
      { order: 2, file: 'tests/users.yaml [row 1]', status: 'passed', httpStatus: 200 },
      { order: 3, file: 'tests/users.yaml [row 2]', status: 'passed', httpStatus: 200 },
    ],
  });
  expect(all).not.toMatch(SECRETS);
});

test.each<[name: string, setup: () => Promise<void>, options: () => string[], args: object]>([
  ['the default environment is not approved', async () => {}, () => ['--allow-run', '--allow-origin', origin], {}],
  ['the chosen environment is not approved', async () => {}, allowed, { env: 'prod' }],
  ['an approved environment points to an unapproved origin', async () => {}, () => [...allowed(), '--allow-env', 'prod'], { env: 'prod' }],
  ['the token endpoint is not an approved origin', () => project({ auth: { main: { type: 'oauth2', flow: 'client_credentials', tokenUrl: 'https://id.invalid/token', clientId: 'ci', clientSecret: 'x' } } }), allowed, {}],
  ['a run entry leaves the root', async () => { await project({ run: [`../${outside.split(/[\\/]/).pop()}/escape.yaml`] }); }, allowed, {}],
  ['a test of the project uploads a file', async () => { await write('tests/login.yaml', { version: 1, tests: [{ name: 'up', request: { method: 'POST', url: '{{baseUrl}}/up', body: { form: ['f=@/etc/hosts'] } } }] }); }, allowed, {}],
  ['a captured value decides a URL', async () => { await write('tests/users.yaml', { version: 1, tests: [{ name: 'x', request: { url: '{{baseUrl}}/{{session}}' } }] }); }, allowed, {}],
  ['a variable has no value', async () => { await write('tests/users.yaml', { version: 1, tests: [{ name: 'x', request: { url: '{{baseUrl}}/{{nobody}}' } }] }); }, allowed, {}],
])('nothing is sent when %s', async (_name, setup, options, args) => {
  await setup();
  const { replies, all } = await rpc([call(1, 'run_test', { file: 'httpi.yaml', ...args })], options());
  expect(replies[0]!.result.isError).toBe(true);
  expect(calls).toEqual([]);
  expect(all).not.toMatch(SECRETS);
});

test('httpi.local.yaml cannot be read through MCP, and a file that uses auth only runs as part of its project', async () => {
  const { replies } = await rpc([call(1, 'inspect_test', { file: 'httpi.local.yaml' }), call(2, 'run_test', { file: 'tests/users.yaml' })], allowed());
  expect(replies[0]!.result.isError).toBe(true);
  expect(replies[0]!.result.content[0]!.text).toContain('not an environment or local values file');
  expect(replies[1]!.result.isError).toBe(true);
  expect(replies[1]!.result.content[0]!.text).toContain('run its httpi.yaml instead');
  expect(calls).toEqual([]);
});

test('a single file with its own data file runs once per row through MCP', async () => {
  await write('tests/rows.yaml', { version: 1, tests: [{ name: 'row {{data.id}}', request: { url: `${origin}/rows/{{data.id}}` }, data: '../data/users.csv' }] });
  const { replies } = await rpc([call(1, 'run_test', { file: 'tests/rows.yaml' })], ['--allow-run', '--allow-origin', origin]);
  expect(calls).toEqual(['GET /rows/1', 'GET /rows/2']);
  expect(replies[0]!.result.structuredContent).toMatchObject({ summary: { executed: 2, passed: 2 }, skipped: 0 });
});
