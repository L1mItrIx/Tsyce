import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { assertCliIsBuilt, httpi } from './helpers.js';

let server: Server;
let url: string;
let root: string;
const calls: string[] = [];

beforeAll(async () => {
  assertCliIsBuilt();
  // POST /users answers 201 with the name it received, or 422 for the name "bad".
  server = createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8').on('data', (chunk: string) => (body += chunk));
    req.on('end', () => {
      calls.push(`${req.method} ${req.url} ${body}`.trim());
      res.setHeader('Content-Type', 'application/json');
      if (req.method !== 'POST') { res.end(JSON.stringify({ path: req.url })); return; }
      const name = (JSON.parse(body) as { name: string }).name;
      res.writeHead(name === 'bad' ? 422 : 201);
      res.end(JSON.stringify({ name }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
beforeEach(async () => { calls.length = 0; root = await mkdtemp(join(tmpdir(), 'e2e-data-')); });
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(root, { recursive: true, force: true });
});

async function write(path: string, content: unknown): Promise<string> {
  const full = join(root, path);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, typeof content === 'string' ? content : JSON.stringify(content));
  return full;
}

const createTest = (data?: string) => ({
  name: 'create {{data.name}}',
  request: { method: 'POST', url: `${url}/users`, body: { json: { name: '{{data.name}}', role: '{{data.role}}' } } },
  expect: { status: 201, json: [{ path: '$.name', equals: '{{data.name}}' }] },
  ...(data !== undefined && { data }),
});

test('a test with data runs once per CSV row; a failing row does not stop the others', async () => {
  await write('data/users.csv', 'name,role\nAna,admin\nbad,user\n"Pérez, Luis",user\n');
  const file = await write('tests/users.yaml', {
    version: 1,
    tests: [createTest('../data/users.csv'), { name: 'after', request: { url: `${url}/done` }, expect: { status: 200 } }],
  });
  const run = await httpi(['run', file], { cwd: tmpdir() });

  expect(run.stderr).toBe('');
  expect(calls).toEqual([
    'POST /users {"name":"Ana","role":"admin"}',
    'POST /users {"name":"bad","role":"user"}',
    'POST /users {"name":"Pérez, Luis","role":"user"}',
    'GET /done',
  ]);
  expect(run.stdout.replace(/\d+ ms/g, 'N ms')).toBe(
    [
      '✓ create Ana [row 1] (201, N ms)',
      '    ✓ status is 201',
      '    ✓ $.name equals "Ana"',
      '✗ create bad [row 2] (422, N ms)',
      '    ✗ status is 201: got 422',
      '    ✓ $.name equals "bad"',
      '✓ create Pérez, Luis [row 3] (201, N ms)',
      '    ✓ status is 201',
      '    ✓ $.name equals "Pérez, Luis"',
      '✓ after (200, N ms)',
      '    ✓ status is 200',
      '',
      '4 tests: 3 passed, 1 failed',
      '',
    ].join('\n'),
  );
  expect(run.code).toBe(1);
});

test('JSON data works the same and JUnit names each row', async () => {
  await write('tests/users.json', '[{"name":"Ana","role":"admin"},{"name":"Luis","role":"user"}]');
  const file = await write('tests/users.yaml', { version: 1, name: 'Users', tests: [createTest('users.json')] });
  const run = await httpi(['run', file, '--reporter', 'junit']);
  expect(run.stdout).toContain('<testsuite name="Users" tests="2" failures="0" errors="0"');
  expect(run.stdout).toContain('<testcase name="create Ana [row 1]" classname="Users"');
  expect(run.stdout).toContain('<testcase name="create Luis [row 2]" classname="Users"');
  expect(run.code).toBe(0);
});

test('data on a run entry repeats the whole file once per row, as one suite per row', async () => {
  await write('data/users.csv', 'name,role\nAna,admin\nLuis,user\n');
  await write('tests/users.yaml', {
    version: 1,
    name: 'User lifecycle',
    tests: [createTest(), { name: 'read {{data.name}}', request: { url: `${url}/users/{{data.name}}` }, expect: { status: 200 } }],
  });
  await write('tests/ping.yaml', { version: 1, tests: [{ name: 'ping', request: { url: `${url}/ping` }, expect: { status: 200 } }] });
  await write('httpi.yaml', { version: 1, run: [{ file: 'tests/users.yaml', data: 'data/users.csv' }, 'tests/ping.yaml'] });

  const run = await httpi(['run'], { cwd: root });
  expect(calls).toEqual([
    'POST /users {"name":"Ana","role":"admin"}',
    'GET /users/Ana',
    'POST /users {"name":"Luis","role":"user"}',
    'GET /users/Luis',
    'GET /ping',
  ]);
  expect(run.stdout).toContain('User lifecycle [row 1]\n\n✓ create Ana (201,');
  expect(run.stdout).toContain('User lifecycle [row 2]\n\n✓ create Luis (201,');
  expect(run.stdout).toContain('✓ read Luis (200,');
  expect(run.stdout).toContain('3 files, 5 tests: 5 passed');
  expect(run.code).toBe(0);
});

test.each<[name: string, csv: string | null, stderr: RegExp]>([
  ['a column the data file does not have', 'name\nAna\n', /^httpi: unresolved variable: \{\{data\.role\}\}\n$/],
  ['a data file that does not exist', null, /users\.csv: cannot read file/],
  ['a data file without rows', 'name,role\n', /users\.csv: the data file has a header but no rows/],
  ['a row with the wrong number of fields', 'name,role\nAna,admin\nLuis\n', /users\.csv:3: expected 2 fields like the header, found 1/],
])('exit 2 before sending anything for %s', async (_name, csv, stderr) => {
  if (csv !== null) await write('tests/users.csv', csv);
  const file = await write('tests/users.yaml', { version: 1, tests: [createTest('users.csv')] });
  const run = await httpi(['run', file]);
  expect(run.stdout).toBe('');
  expect(run.stderr).toMatch(stderr);
  expect(calls).toEqual([]);
  expect(run.code).toBe(2);
});

test('{{data.x}} without a data file is an unresolved variable', async () => {
  const file = await write('tests/users.yaml', { version: 1, tests: [createTest()] });
  const run = await httpi(['run', file, '--var', 'data.name=x', '--var', 'data.role=y']);
  expect(run.stderr).toBe('httpi: unresolved variables: {{data.name}}, {{data.role}}\n');
  expect(run.code).toBe(2);
});

test('export refuses a test that repeats over data instead of exporting it once', async () => {
  await write('tests/users.csv', 'name,role\nAna,admin\n');
  const file = await write('tests/users.yaml', { version: 1, tests: [createTest('users.csv')] });
  const run = await httpi(['export', file]);
  expect(run.stdout).toBe('');
  expect(run.stderr).toContain('must be executed with httpi run');
  expect(run.code).toBe(2);
});
