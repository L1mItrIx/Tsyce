import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { assertCliIsBuilt, httpi } from './helpers.js';

let server: Server;
let url: string;
let dir: string;
let created: unknown = { id: 7, slug: 'ana-7', owner: { name: 'Ana' } };
const calls: string[] = [];

beforeAll(async () => {
  assertCliIsBuilt();
  server = createServer((req, res) => {
    calls.push(`${req.method} ${req.url}`);
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'POST' && req.url === '/users') { res.writeHead(201); res.end(JSON.stringify(created)); return; }
    if (req.method === 'POST' && req.url === '/login') { res.end('{"access_token":"CAPTURE_TOKEN_1"}'); return; }
    res.end(JSON.stringify({ path: req.url, tag: req.headers['x-slug'] ?? null }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  dir = await mkdtemp(join(tmpdir(), 'e2e-capture-'));
});
beforeEach(() => { calls.length = 0; created = { id: 7, slug: 'ana-7', owner: { name: 'Ana' } }; });
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
});

async function flow(tests: unknown[]): Promise<string> {
  const file = join(dir, 'flow.json');
  await writeFile(file, JSON.stringify({ version: 1, tests }));
  return file;
}

const create = (capture: Record<string, string>, status = 201) => ({ name: 'create user', request: { method: 'POST', url: `${url}/users` }, expect: { status }, capture });
const read = () => ({
  name: 'read user {{userId}}',
  request: { url: `${url}/users/{{userId}}`, headers: { 'X-Slug': '{{slug}}' } },
  expect: { status: 200, json: [{ path: '$.path', equals: '/users/{{userId}}' }, { path: '$.tag', equals: '{{slug}}' }] },
});

test('values captured from one response are used by the next requests, in URL, headers and asserts', async () => {
  const run = await httpi(['run', await flow([create({ userId: '$.id', slug: '$.slug' }), read()]), '--show-response']);
  expect(run.stderr).toBe('');
  expect(calls).toEqual(['POST /users', 'GET /users/7']);
  expect(run.stdout).toContain('    ✓ status is 201\n    ✓ capture userId from $.id\n    ✓ capture slug from $.slug\n');
  expect(run.stdout).toContain('✓ read user 7 (200,');
  expect(run.stdout).toContain('    ✓ $.tag equals "ana-7"');
  // Ordinary captures are not secrets: the response stays visible.
  expect(run.stdout).toContain('"slug": "ana-7"');
  expect(run.code).toBe(0);
});

test('a captured name never falls back to an older value from --var or the system', async () => {
  const file = await flow([read(), create({ userId: '$.id', slug: '$.slug' })]);
  const run = await httpi(['run', file, '--var', 'userId=999'], { env: { slug: 'stale' } });
  expect(run.stderr).toBe('httpi: unresolved variables: {{userId}}, {{slug}}\n');
  expect(calls).toEqual([]);
  expect(run.code).toBe(2);
});

test.each<[name: string, body: unknown, capture: Record<string, string>, message: string]>([
  ['the path matches nothing', { id: 7 }, { userId: '$.id', slug: '$.slug' }, '    ✗ capture slug from $.slug: no match; flow stopped; remaining requests were not executed'],
  ['the path selects an object', { id: 7, slug: 'x', owner: {} }, { userId: '$.id', slug: '$.owner' }, 'capture slug from $.owner: selected an object; only text, numbers and booleans can be captured; flow stopped'],
])('the flow stops with exit 1 when %s', async (_name, body, capture, message) => {
  created = body;
  const run = await httpi(['run', await flow([create(capture), read()])]);
  expect(calls).toEqual(['POST /users']);
  expect(run.stdout).toContain('    ✓ capture userId from $.id\n');
  expect(run.stdout).toContain(message);
  expect(run.stdout).toContain('1 test: 0 passed, 1 failed');
  expect(run.code).toBe(1);
});

test('nothing is captured, and the flow stops, when the asserts of the capturing test fail', async () => {
  const run = await httpi(['run', await flow([create({ userId: '$.id', slug: '$.slug' }, 200), read()])]);
  expect(calls).toEqual(['POST /users']);
  expect(run.stdout).toContain('    ✗ status is 200: got 201\n    ✗ capture userId from $.id: not captured: the request or its asserts failed; flow stopped');
  expect(run.code).toBe(1);
});

test('authToken can be captured together with other values; only the token is redacted and its response hidden', async () => {
  const file = await flow([
    { name: 'log in', request: { method: 'POST', url: `${url}/login` }, capture: { authToken: '$.access_token', kind: '$.access_token' } },
    { name: 'use both', request: { url: `${url}/me`, headers: { Authorization: 'Bearer {{authToken}}', 'X-Slug': '{{kind}}' } }, expect: { status: 200 } },
  ]);
  const run = await httpi(['run', file, '--show-response']);
  expect(run.stdout).toContain('    ✓ authentication token captured\n    ✓ capture kind from $.access_token\n');
  expect(run.stdout).toContain('Authentication response hidden');
  expect(run.stdout).not.toContain('CAPTURE_TOKEN_1');
  expect(run.code).toBe(0);
});
