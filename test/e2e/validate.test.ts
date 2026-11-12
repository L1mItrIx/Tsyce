import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { assertCliIsBuilt, httpi } from './helpers.js';

let server: Server;
let baseUrl: string;
let root: string;
let requests = 0;

beforeAll(async () => {
  assertCliIsBuilt();
  server = createServer((_req, res) => { requests++; res.end('{}'); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
beforeEach(async () => { requests = 0; root = await mkdtemp(join(tmpdir(), 'e2e-validate-')); });
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

const project = (extra: object = {}) =>
  write('httpi.yaml', { version: 1, env: { default: 'dev', environments: { dev: { baseUrl }, prod: {} } }, run: ['tests/*.yaml'], ...extra });

test('a project fresh from httpi init is valid, and validating sends nothing', async () => {
  expect((await httpi(['init'], { cwd: root })).code).toBe(0);
  const result = await httpi(['validate'], { cwd: join(root, 'tests') });
  expect(result.stdout).toBe('valid: 1 file, 1 test; no requests were sent\n');
  expect(result.stderr).toBe('');
  expect(result.code).toBe(0);
});

test('a valid project with captures, data, uploads and CI secrets passes without sending requests', async () => {
  await project({ run: ['tests/login.yaml', { file: 'tests/users.yaml', data: 'data/users.csv' }] });
  await write('data/users.csv', 'name\nAna\nLuis\n');
  await write('tests/avatar.png', 'png');
  await write('tests/login.yaml', {
    version: 1,
    tests: [{ name: 'log in', request: { method: 'POST', url: '{{baseUrl}}/login', body: { json: { secret: '${CI_ONLY_SECRET}' } } }, capture: { authToken: '$.token' } }],
  });
  await write('tests/users.yaml', {
    version: 1,
    tests: [{
      name: 'create {{data.name}}',
      request: { method: 'POST', url: '{{baseUrl}}/users', headers: { Authorization: 'Bearer {{authToken}}' }, body: { form: ['name={{data.name}}', 'avatar=@avatar.png'] } },
    }],
  });
  const result = await httpi(['validate'], { cwd: root, env: { CI_ONLY_SECRET: undefined } });
  expect(result.stdout).toBe('valid: 2 files, 2 tests; no requests were sent\n');
  expect(requests).toBe(0);
  expect(result.code).toBe(0);
});

test('exit 2 listing every problem at once', async () => {
  await project({ run: ['tests/*.yaml', { file: 'tests/b-data.yaml', data: 'data/missing.csv' }] });
  await write('tests/a-broken.yaml', 'version: 1\ntests: []\n');
  await write('tests/b-data.yaml', {
    version: 1,
    tests: [{ name: 'rows', request: { url: '{{baseUrl}}/{{data.id}}/{{undefinedVar}}' }, data: 'rows.csv' }],
  });
  await write('tests/rows.csv', 'id\n1\n2,3\n');
  await write('tests/c-secrets.yaml', {
    version: 1,
    tests: [
      { name: 'literal token', request: { url: '{{baseUrl}}/x', headers: { Authorization: 'Bearer REAL_LOOKING_TOKEN', Cookie: 'sid=abc' } } },
      { name: 'upload', request: { method: 'POST', url: '{{baseUrl}}/{{alsoMissing}}', body: { form: ['doc=@nope.pdf', 'note=plain'] } } },
    ],
  });

  const result = await httpi(['validate'], { cwd: root, env: { undefinedVar: undefined, alsoMissing: undefined } });
  expect(result.stderr).toBe('');
  const lines = result.stdout.trimEnd().split('\n');
  expect(lines.slice(0, 3)).toEqual([
    'tests/a-broken.yaml: invalid test file',
    expect.stringContaining('Too small'),
    expect.stringContaining('→ at tests'),
  ]);
  expect(lines.slice(3)).toEqual([
    // Listed by the pattern and again by its own entry: reported once.
    expect.stringMatching(/^tests\/b-data\.yaml: tests[\\/]rows\.csv:3: expected 1 fields like the header, found 2$/),
    'tests/c-secrets.yaml: test "literal token": the Authorization header holds a literal credential; use a variable such as {{token}}',
    'tests/c-secrets.yaml: test "literal token": the Cookie header holds a literal credential; use a variable such as {{cookie}}',
    'tests/c-secrets.yaml: test "upload": multipart file tests/nope.pdf does not exist',
    expect.stringMatching(/^data\/missing\.csv: cannot read file: ENOENT/),
    'httpi.yaml: unresolved variable: {{alsoMissing}}',
    '7 problems in 4 files, 4 tests',
  ]);
  expect(result.stdout).not.toContain(root);
  expect(result.stdout).not.toContain('REAL_LOOKING_TOKEN');
  expect(requests).toBe(0);
  expect(result.code).toBe(2);
});

test('--env validates against another environment, and --var can supply a value', async () => {
  await project();
  await write('tests/a.yaml', { version: 1, tests: [{ name: 'a', request: { url: '{{baseUrl}}/a' } }] });
  expect((await httpi(['validate'], { cwd: root })).code).toBe(0);

  const prod = await httpi(['validate', '--env', 'prod'], { cwd: root, env: { baseUrl: undefined } });
  expect(prod.stdout).toBe('httpi.yaml: unresolved variable: {{baseUrl}}\n1 problem in 1 file, 1 test\n');
  expect(prod.code).toBe(2);

  expect((await httpi(['validate', '--env', 'prod', '--var', 'baseUrl=https://api.example.com'], { cwd: root })).code).toBe(0);
  const unknown = await httpi(['validate', '--env', 'staging'], { cwd: root });
  expect(unknown.stdout).toContain('httpi.yaml: no environment "staging"; available: dev, prod\n');
  expect(unknown.code).toBe(2);
});

test('exit 2 when there is no project or httpi.yaml itself is invalid', async () => {
  const none = await httpi(['validate'], { cwd: root });
  expect(none.stderr).toContain('no httpi.yaml found');
  expect(none.code).toBe(2);

  await write('httpi.yaml', 'version: 1\n');
  const invalid = await httpi(['validate'], { cwd: root });
  expect(invalid.stdout).toMatch(/^httpi\.yaml: invalid project file\n/);
  expect(invalid.stdout).toContain('1 problem in 0 files, 0 tests');
  expect(invalid.code).toBe(2);
});
