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
let token = '';
const calls: string[] = [];

beforeAll(async () => {
  assertCliIsBuilt();
  server = createServer((req, res) => {
    calls.push(`${req.method} ${req.url}`);
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/login') {
      token = `PROJECT_TOKEN_${calls.length}`;
      res.end(JSON.stringify({ access_token: token }));
    } else if (req.url?.startsWith('/health')) {
      res.end('{"ok":true}');
    } else {
      res.writeHead(req.headers.authorization === `Bearer ${token}` ? 200 : 401);
      res.end(JSON.stringify({ path: req.url }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(async () => {
  calls.length = 0;
  root = await mkdtemp(join(tmpdir(), 'e2e-project-'));
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

async function write(path: string, content: unknown): Promise<void> {
  const full = join(root, path);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, typeof content === 'string' ? content : JSON.stringify(content));
}

const guarded = (name: string, path: string, status = 200) => ({
  name,
  request: { url: `{{baseUrl}}${path}`, headers: { Authorization: 'Bearer {{authToken}}' } },
  expect: { status },
});

async function project(extra: object = {}): Promise<void> {
  await write('httpi.yaml', {
    version: 1,
    name: 'ignored: each file has its own title',
    env: { default: 'local', environments: { local: { baseUrl }, broken: { baseUrl: 'http://127.0.0.1:1' } } },
    run: ['tests/login.yaml', 'tests/admin/*.yaml', { file: 'tests/users.yaml' }],
    ...extra,
  });
  await write('tests/login.yaml', {
    version: 1,
    name: 'Login',
    tests: [{ name: 'log in', request: { method: 'POST', url: '{{baseUrl}}/login' }, expect: { status: 200 }, capture: { authToken: '$.access_token' } }],
  });
  await write('tests/users.yaml', { version: 1, tests: [guarded('list users', '/users'), guarded('one user', '/users/7')] });
  await write('tests/admin/b.yaml', { version: 1, tests: [guarded('admin b', '/admin/b')] });
  await write('tests/admin/a.yaml', { version: 1, name: 'Admin A', tests: [guarded('admin a', '/admin/a')] });
}

test('httpi run without arguments runs the project in order and shares the captured token between files', async () => {
  await project();
  await mkdir(join(root, 'tests', 'admin', 'deep'), { recursive: true });
  const result = await httpi(['run'], { cwd: join(root, 'tests', 'admin', 'deep') });

  expect(result.stderr).toBe('');
  expect(calls).toEqual(['POST /login', 'GET /admin/a', 'GET /admin/b', 'GET /users', 'GET /users/7']);
  expect(result.stdout.replace(/\d+ ms/g, 'N ms')).toBe(
    [
      'Login',
      '',
      '✓ log in (200, N ms)',
      '    ✓ authentication assertion 1',
      '    ✓ authentication token captured',
      '',
      'Admin A',
      '',
      '✓ admin a (200, N ms)',
      '    ✓ status is 200',
      '',
      'tests/admin/b.yaml',
      '',
      '✓ admin b (200, N ms)',
      '    ✓ status is 200',
      '',
      'tests/users.yaml',
      '',
      '✓ list users (200, N ms)',
      '    ✓ status is 200',
      '✓ one user (200, N ms)',
      '    ✓ status is 200',
      '',
      '4 files, 5 tests: 5 passed',
      '',
    ].join('\n'),
  );
  expect(result.stdout).not.toContain('PROJECT_TOKEN_');
  expect(result.code).toBe(0);
});

test('the project file can also be given by path, from any directory', async () => {
  await project();
  const result = await httpi(['run', join(root, 'httpi.yaml')], { cwd: tmpdir() });
  expect(result.stdout).toContain('4 files, 5 tests: 5 passed');
  expect(result.code).toBe(0);
});

test('exit 1 when an assert fails in any file; the other files still run', async () => {
  await project();
  await write('tests/admin/a.yaml', { version: 1, tests: [guarded('admin a', '/admin/a', 204)] });
  const result = await httpi(['run'], { cwd: root });
  expect(result.stdout).toContain('    ✗ status is 204: got 200');
  expect(result.stdout).toContain('4 files, 5 tests: 4 passed, 1 failed');
  expect(calls).toHaveLength(5);
  expect(result.code).toBe(1);
});

test('--reporter junit writes one testsuite per file', async () => {
  await project();
  const result = await httpi(['run', '--reporter', 'junit'], { cwd: root });
  expect(result.stdout).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>\n<testsuites tests="5" failures="0" errors="0" time="[\d.]+">/);
  expect(result.stdout.match(/<testsuite name="[^"]+"/g)).toEqual([
    '<testsuite name="Login"',
    '<testsuite name="Admin A"',
    '<testsuite name="tests/admin/b.yaml"',
    '<testsuite name="tests/users.yaml"',
  ]);
  expect(result.code).toBe(0);
});

test('report.junit writes the XML next to the normal report, replacing the previous one, also when tests fail', async () => {
  await project({ report: { junit: 'reports/ci/junit.xml' } });
  const first = await httpi(['run'], { cwd: join(root, 'tests') });
  expect(first.stdout).toContain('4 files, 5 tests: 5 passed');
  const xml = await readFile(join(root, 'reports', 'ci', 'junit.xml'), 'utf8');
  expect(xml).toContain('<testsuites tests="5" failures="0" errors="0"');
  expect(xml).not.toContain('PROJECT_TOKEN_');
  expect(xml.endsWith('</testsuites>\n')).toBe(true);

  await write('tests/admin/a.yaml', { version: 1, tests: [guarded('admin a', '/admin/a', 204)] });
  const second = await httpi(['run'], { cwd: root });
  expect(second.code).toBe(1);
  expect(await readFile(join(root, 'reports', 'ci', 'junit.xml'), 'utf8')).toContain('<testsuites tests="5" failures="1" errors="0"');
});

test('--env picks another environment of httpi.yaml and --var wins over it', async () => {
  await project();
  const broken = await httpi(['run', '--env', 'broken'], { cwd: root });
  expect(calls).toEqual([]);
  expect(broken.code).toBe(3);

  const fixed = await httpi(['run', '--env', 'broken', '--var', `baseUrl=${baseUrl}`], { cwd: root });
  expect(fixed.stdout).toContain('5 tests: 5 passed');
  expect(fixed.code).toBe(0);
});

test('a failed login stops the whole project and reports the files that did not run', async () => {
  await project();
  await write('tests/login.yaml', {
    version: 1,
    tests: [{ name: 'log in', request: { method: 'POST', url: '{{baseUrl}}/login' }, capture: { authToken: '$.missing' } }],
  });
  const result = await httpi(['run'], { cwd: root });
  expect(calls).toEqual(['POST /login']);
  expect(result.stdout).toContain('Admin A\n\n- not run: the flow stopped before this file');
  expect(result.stdout).toContain('4 files, 1 test: 0 passed, 1 failed');
  expect(result.code).toBe(1);
});

const captureFiles = async (run: string[]) => {
  await write('httpi.yaml', { version: 1, run });
  await write('tests/create.yaml', {
    version: 1,
    tests: [{ name: 'create', request: { url: `${baseUrl}/health` }, capture: { healthy: '$.ok' } }],
  });
  await write('tests/use.yaml', {
    version: 1,
    tests: [{ name: 'use {{healthy}}', request: { url: `${baseUrl}/health?seen={{healthy}}` }, expect: { status: 200 } }],
  });
};

test('a value captured in one file is available in the files that run after it', async () => {
  await captureFiles(['tests/create.yaml', 'tests/use.yaml']);
  const result = await httpi(['run'], { cwd: root });
  expect(calls).toEqual(['GET /health', 'GET /health?seen=true']);
  expect(result.stdout).toContain('    ✓ capture healthy from $.ok');
  expect(result.stdout).toContain('✓ use true (200,');
  expect(result.code).toBe(0);
});

test('exit 2 before sending anything when a file uses a value that is only captured later', async () => {
  await captureFiles(['tests/use.yaml', 'tests/create.yaml']);
  const result = await httpi(['run', '--var', 'healthy=stale'], { cwd: root });
  expect(result.stderr).toBe('httpi: unresolved variable: {{healthy}}\n');
  expect(calls).toEqual([]);
  expect(result.code).toBe(2);
});

test('exit 2 before sending anything when a later file uses a variable nobody defines', async () => {
  await project();
  await write('tests/users.yaml', { version: 1, tests: [{ name: 'x', request: { url: '{{baseUrl}}/{{missing}}' } }] });
  const result = await httpi(['run'], { cwd: root, env: { missing: undefined } });
  expect(result.stderr).toBe('httpi: unresolved variable: {{missing}}\n');
  expect(calls).toEqual([]);
  expect(result.code).toBe(2);
});

test.each<[name: string, setup: () => Promise<void>, args: string[], stderr: RegExp]>([
  ['no httpi.yaml anywhere', async () => {}, ['run'], /^httpi: no httpi\.yaml found in this directory or its parents; pass a test file: httpi run <file>\n$/],
  ['an invalid httpi.yaml', () => write('httpi.yaml', 'version: 1\n'), ['run'], /httpi\.yaml: invalid project file/],
  ['a run entry that does not exist', () => write('httpi.yaml', { version: 1, run: ['tests/nope.yaml'] }), ['run'], /run entry "tests\/nope\.yaml" does not exist/],
  ['an invalid test file in the project', async () => { await project(); await write('tests/admin/a.yaml', 'version: 1\n'); }, ['run'], /a\.yaml: invalid test file/],
  ['an unknown environment', () => project(), ['run', '--env', 'prod'], /no environment "prod"; available: local, broken/],
])('exit 2 for %s', async (_name, setup, args, stderr) => {
  await setup();
  const result = await httpi(args, { cwd: root });
  expect(result.stdout).toBe('');
  expect(result.stderr).toMatch(stderr);
  expect(calls).toEqual([]);
  expect(result.code).toBe(2);
});

test('httpi.env.yaml next to a project that declares env is ignored with a warning', async () => {
  await project();
  await write('httpi.env.yaml', 'local: { baseUrl: "http://127.0.0.1:1" }\n');
  const result = await httpi(['run'], { cwd: root });
  expect(result.stderr).toBe('warning: httpi.env.yaml is ignored: httpi.yaml declares the environments\n');
  expect(result.code).toBe(0);
});

test('running a single file still works inside a project and does not run the rest', async () => {
  await project();
  await write('tests/health.yaml', { version: 1, tests: [{ name: 'health', request: { url: `${baseUrl}/health` }, expect: { status: 200 } }] });
  const result = await httpi(['run', 'tests/health.yaml'], { cwd: root });
  expect(calls).toEqual(['GET /health']);
  expect(result.stdout).toContain('1 test: 1 passed');
  expect(result.code).toBe(0);
});

afterAll(async () => {
  // Each test made its own directory under the temp dir; remove the last one explicitly.
  await rm(root, { recursive: true, force: true });
});
