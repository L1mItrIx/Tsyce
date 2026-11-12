import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { httpi } from './helpers.js';

let root: string; let outside: string; let origin: string;
let issued = 0; let token = ''; let shortToken = false; const calls: string[] = [];
const server = createServer((req, res) => {
  calls.push(req.url!); res.setHeader('Content-Type', 'application/json');
  if (req.url === '/login') { issued++; token = shortToken ? 'a' : `MCP_PRIVATE_TOKEN_${issued}`; res.end(JSON.stringify({ access_token: token })); }
  else { res.writeHead(req.headers.authorization === `Bearer ${token}` ? 200 : 401); res.end(JSON.stringify({ authorization: req.headers.authorization })); }
});
const message = (id: number, method: string, params = {}) => ({ jsonrpc: '2.0', id, method, params });
const init = message(0, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
const ready = { jsonrpc: '2.0', method: 'notifications/initialized' };
async function rpc(messages: unknown[], options: string[] = []) {
  const result = await httpi(['mcp', '--root', root, ...options], { stdin: [init, ready, ...messages].map((item) => JSON.stringify(item)).join('\n') + '\n' });
  expect(result.code).toBe(0); expect(result.stderr).toBe('');
  return result.stdout.trim().split('\n').map((line) => JSON.parse(line));
}
const call = (id: number, name: string, args: object) => message(id, 'tools/call', { name, arguments: args });
const flow = () => ({ version: 1, tests: [
  { name: 'login', request: { method: 'POST', url: `${origin}/login` }, expect: { status: 200 }, capture: { authToken: '$.access_token' } },
  { name: 'private', request: { url: `${origin}/private`, headers: { Authorization: 'Bearer {{authToken}}' } }, expect: { status: 200 } },
] });
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'httpi-mcp-')); outside = await mkdtemp(join(tmpdir(), 'httpi-outside-'));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await writeFile(join(root, 'auth.yaml'), JSON.stringify(flow()));
  await writeFile(join(root, 'httpi.env.yaml'), 'qa:\n  secret: SECRET_ENV_VALUE\n');
  await writeFile(join(root, 'unrelated.json'), '{"private":"DO_NOT_LIST"}');
  await writeFile(join(outside, 'outside.yaml'), JSON.stringify(flow()));
});
afterAll(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); });

test('MCP initializes, advertises tools and inspects metadata without credentials', async () => {
  const results = await rpc([message(1, 'ping'), message(2, 'tools/list'), call(3, 'list_tests', {}), call(4, 'inspect_test', { file: 'auth.yaml' })]);
  expect(results[0].result.protocolVersion).toBe('2025-11-25');
  expect(results[2].result.tools.map((tool: { name: string }) => tool.name)).toEqual(['list_tests', 'inspect_test', 'create_test', 'run_test']);
  expect(results[3].result.structuredContent.files).toEqual(['auth.yaml']);
  expect(results[4].result.structuredContent.tests).toHaveLength(2);
  expect(JSON.stringify(results)).not.toContain('SECRET_ENV_VALUE');
  expect(JSON.stringify(results[4])).not.toContain('Bearer');
});

test('MCP runs the real authentication flow and returns structured results without response secrets', async () => {
  const before = issued;
  const results = await rpc([call(1, 'run_test', { file: 'auth.yaml' }), call(2, 'run_test', { file: 'auth.yaml' })], ['--allow-run', '--allow-origin', origin]);
  for (const result of results.slice(1)) {
    expect(result.result.isError).toBe(false); expect(result.result.structuredContent.exitCode).toBe(0);
    expect(result.result.structuredContent.summary).toEqual({ executed: 2, passed: 2, failed: 0, errored: 0 });
  }
  expect(issued).toBe(before + 2); expect(JSON.stringify(results)).not.toContain('MCP_PRIVATE_TOKEN_');
});

test('execution and creation need startup permissions, and origins are enforced before any request', async () => {
  const before = calls.length;
  const denied = await rpc([call(1, 'run_test', { file: 'auth.yaml' }), call(2, 'create_test', { file: 'denied.yaml', testFile: flow() })]);
  expect(denied.slice(1).every((response) => response.result.isError)).toBe(true);
  const originDenied = await rpc([call(1, 'run_test', { file: 'auth.yaml' })], ['--allow-run']);
  expect(originDenied[1].result.isError).toBe(true); expect(calls.length).toBe(before);
});

test('creation validates the schema and never overwrites files', async () => {
  const results = await rpc([call(1, 'create_test', { file: 'created.yaml', testFile: flow() }), call(2, 'create_test', { file: 'created.yaml', testFile: flow() }), call(3, 'create_test', { file: 'invalid.yaml', testFile: {} })], ['--allow-write']);
  expect(results[1].result.isError).toBe(false); expect(results[2].result.isError).toBe(true); expect(results[3].error.code).toBe(-32602);
  expect(await readFile(join(root, 'created.yaml'), 'utf8')).toContain('capture:');
});

test('absolute/traversal paths, environment files and symlinks cannot escape the root', async () => {
  await symlink(outside, join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  const results = await rpc([
    call(1, 'inspect_test', { file: join(outside, 'outside.yaml') }), call(2, 'inspect_test', { file: '../outside.yaml' }),
    call(3, 'inspect_test', { file: 'linked/outside.yaml' }), call(4, 'inspect_test', { file: 'httpi.env.yaml' }),
    call(5, 'create_test', { file: 'linked/new.yaml', testFile: flow() }),
  ], ['--allow-write']);
  expect(results.slice(1).every((response) => response.result.isError)).toBe(true);
});

test('MCP handles invalid JSON, unknown tools/methods and invalid arguments without losing the session', async () => {
  const result = await httpi(['mcp', '--root', root], { stdin: '{bad}\n' + [init, ready, message(1, 'unknown'), call(2, 'missing', {}), call(3, 'inspect_test', { file: 1 }), message(4, 'ping')].map((item) => JSON.stringify(item)).join('\n') + '\n' });
  const replies = result.stdout.trim().split('\n').map((line) => JSON.parse(line));
  expect(result.code).toBe(0); expect(replies.map((item) => item.error?.code)).toEqual([-32700, undefined, -32601, -32602, -32602, undefined]);
});

test('MCP refuses unapproved environments, redirects and multipart file reads', async () => {
  await writeFile(join(root, 'redirect.yaml'), JSON.stringify({ version: 1, tests: [{ name: 'redirect', request: { url: origin, followRedirects: true } }] }));
  await writeFile(join(root, 'upload.yaml'), JSON.stringify({ version: 1, tests: [{ name: 'upload', request: { url: origin, body: { form: ['file=@/private/file'] } } }] }));
  const before = calls.length;
  const results = await rpc([call(1, 'run_test', { file: 'auth.yaml', env: 'qa' }), call(2, 'run_test', { file: 'redirect.yaml' }), call(3, 'run_test', { file: 'upload.yaml' })], ['--allow-run', '--allow-origin', origin]);
  expect(results.slice(1).every((item) => item.result.isError)).toBe(true); expect(calls.length).toBe(before);
});

test('approved environments work; failing assertions are tool errors with exit 1', async () => {
  await writeFile(join(root, 'failed.yaml'), JSON.stringify({ version: 1, tests: [{ name: 'failure', request: { url: origin }, expect: { status: 201 } }] }));
  const results = await rpc([call(1, 'run_test', { file: 'auth.yaml', env: 'qa' }), call(2, 'run_test', { file: 'failed.yaml' })], ['--allow-run', '--allow-origin', origin, '--allow-env', 'qa']);
  expect(results[1].result.structuredContent.exitCode).toBe(0);
  expect(results[2].result.isError).toBe(true); expect(results[2].result.structuredContent.exitCode).toBe(1);
  expect(results[2].result.structuredContent.summary.failed).toBe(1);
});

test('all origins are checked before starting and runtime tokens cannot change a URL', async () => {
  await writeFile(join(root, 'unapproved.yaml'), JSON.stringify({ version: 1, tests: [...flow().tests, { name: 'external', request: { url: 'https://unapproved.invalid' } }] }));
  await writeFile(join(root, 'token-url.yaml'), JSON.stringify({ version: 1, tests: [...flow().tests, { name: 'token URL', request: { url: `${origin}/{{ authToken }}` } }] }));
  const before = calls.length;
  const results = await rpc([call(1, 'run_test', { file: 'unapproved.yaml' }), call(2, 'run_test', { file: 'token-url.yaml' })], ['--allow-run', '--allow-origin', origin]);
  expect(results.slice(1).every((response) => response.result.isError)).toBe(true); expect(calls.length).toBe(before);
});

test('creating a flow extracts literal Authorization values without echoing or persisting them', async () => {
  const results = await rpc([call(1, 'create_test', { file: 'secret.yaml', testFile: { version: 1, tests: [{ name: 'secret', request: { url: origin, headers: { Authorization: 'Bearer PRIVATE_LITERAL' } } }] } })], ['--allow-write']);
  expect(results[1].result.structuredContent.requiredVariables).toEqual(['token']);
  expect(JSON.stringify(results)).not.toContain('PRIVATE_LITERAL');
  expect(await readFile(join(root, 'secret.yaml'), 'utf8')).not.toContain('PRIVATE_LITERAL');
});

test('short captured tokens do not corrupt the structured outcome fields', async () => {
  shortToken = true;
  try {
    const results = await rpc([call(1, 'run_test', { file: 'auth.yaml' })], ['--allow-run', '--allow-origin', origin]);
    expect(results[1].result.structuredContent.exitCode).toBe(0);
    expect(results[1].result.structuredContent.summary.passed).toBe(2);
  } finally { shortToken = false; }
});
