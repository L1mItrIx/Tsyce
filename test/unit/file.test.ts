import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test } from 'vitest';
import {
  defaultTestName,
  prepareWizardFile,
  parseTestFile,
  readEnvironment,
  readTestFile,
  resolveFormPaths,
  stringifyTestFile,
  TestFileError,
  writeTestFile,
} from '../../src/core/file.js';
import { requestSchema, type TestCase } from '../../src/core/schema.js';

const wizardCase = (token: string): TestCase => ({
  name: 'GET /users', request: requestSchema.parse({ url: 'https://example.test/users', headers: { Authorization: `Bearer ${token}` } }), expect: { status: 200 },
});

test('wizard suites preserve request order and keep distinct credentials in distinct variables', () => {
  const first = wizardCase('FAKE_FIRST'); const second = wizardCase('FAKE_SECOND');
  const { file, secrets } = prepareWizardFile([first, second, first], 'Users flow');
  expect(file.name).toBe('Users flow');
  expect(file.tests.map((test) => test.request.headers.Authorization)).toEqual(['Bearer {{token}}', 'Bearer {{token2}}', 'Bearer {{token}}']);
  expect(secrets.map((secret) => secret.variable)).toEqual(['token', 'token2']);
  expect(JSON.stringify({ file, secrets })).not.toContain('FAKE_');
  expect(first.request.headers.Authorization).toBe('Bearer FAKE_FIRST');
  expect(parseTestFile(stringifyTestFile(file), 'wizard')).toEqual(file);
});

test('single-request naming remains compatible and generated variables do not collide with explicit references', () => {
  const first = wizardCase('{{token}}'); const second = wizardCase('FAKE_SECRET');
  expect(prepareWizardFile([first], 'Named request').file.tests[0]!.name).toBe('Named request');
  expect(prepareWizardFile([first, second]).file.tests[1]!.request.headers.Authorization).toBe('Bearer {{token2}}');
  expect(defaultTestName(second.request)).toBe('GET /users');
});

test('wizard files reject empty collections and empty explicit names', () => {
  expect(() => prepareWizardFile([])).toThrow(TestFileError);
  expect(() => prepareWizardFile([wizardCase('FAKE')], ' ')).toThrow('name must not be empty');
});

const PLAN_EXAMPLE_YAML = `
version: 1
name: Crear usuario
tests:
  - name: POST /users devuelve 201
    request:
      method: POST
      url: "{{baseUrl}}/users"
      headers:
        Content-Type: application/json
        Authorization: "Bearer {{token}}"
      body:
        json: { name: Ana }
    expect:
      status: 201
      maxTimeMs: 800
      headers:
        content-type: { contains: application/json }
      json:
        - { path: "$.id", exists: true }
        - { path: "$.name", equals: Ana }
`;

const PLAN_EXAMPLE_MODEL = {
  version: 1,
  name: 'Crear usuario',
  tests: [
    {
      name: 'POST /users devuelve 201',
      request: {
        method: 'POST',
        url: '{{baseUrl}}/users',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer {{token}}' },
        body: { json: { name: 'Ana' } },
      },
      expect: {
        status: 201,
        maxTimeMs: 800,
        headers: { 'content-type': { contains: 'application/json' } },
        json: [
          { path: '$.id', exists: true },
          { path: '$.name', equals: 'Ana' },
        ],
      },
    },
  ],
};

test('reads the PLAN example from YAML', () => {
  expect(parseTestFile(PLAN_EXAMPLE_YAML, 'users.yaml')).toEqual(PLAN_EXAMPLE_MODEL);
});

test('reads the same model from JSON', () => {
  expect(parseTestFile(JSON.stringify(PLAN_EXAMPLE_MODEL), 'users.json')).toEqual(PLAN_EXAMPLE_MODEL);
});

test('fills defaults: GET, no headers, empty expect', () => {
  const file = parseTestFile('version: 1\ntests:\n  - name: ping\n    request: { url: http://x }\n', 'a.yaml');
  expect(file.tests[0]).toEqual({
    name: 'ping',
    request: { method: 'GET', url: 'http://x', headers: {} },
    expect: {},
  });
});

test('broken YAML names the file and the position', () => {
  const act = () => parseTestFile('version: 1\ntests: [\n', 'broken.yaml');
  expect(act).toThrow(TestFileError);
  expect(act).toThrow(/^broken\.yaml: invalid YAML: .*line 3/s);
});

test('schema errors name the file and the field path', () => {
  const text = 'version: 1\ntests:\n  - name: t\n    request: { url: http://x, retries: 3 }\n';
  const act = () => parseTestFile(text, 'bad.yaml');
  expect(act).toThrow(TestFileError);
  expect(act).toThrow(/^bad\.yaml: invalid test file\n.*retries.*\n.*tests\[0\]\.request/s);
});

test('a malformed assert explains the expected shape', () => {
  const text = 'version: 1\ntests:\n  - name: t\n    request: { url: http://x }\n    expect: { json: [{ path: "$.a" }] }\n';
  expect(() => parseTestFile(text, 'bad.yaml')).toThrow(
    /exactly one of equals \| exists \| contains \| matches \| type.*\n.*tests\[0\]\.expect\.json\[0\]/,
  );
});

test('readTestFile reads from disk and reports a missing file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'httpi-test-file-'));
  try {
    const path = join(dir, 'users.yaml');
    await writeFile(path, PLAN_EXAMPLE_YAML);
    expect(await readTestFile(path)).toEqual(PLAN_EXAMPLE_MODEL);

    const missing = readTestFile(join(dir, 'nope.yaml'));
    await expect(missing).rejects.toThrow(TestFileError);
    await expect(missing).rejects.toThrow(/nope\.yaml: cannot read file/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('readEnvironment picks one environment from httpi.env.yaml next to the test file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'file-test-env-'));
  try {
    const testPath = join(dir, 'users.yaml');
    await writeFile(
      join(dir, 'httpi.env.yaml'),
      'dev:  { baseUrl: "http://localhost:3000", retries: 3, debug: true }\nprod: { baseUrl: "https://api.example.com" }\n',
    );
    expect(await readEnvironment(testPath, 'dev')).toEqual({
      baseUrl: 'http://localhost:3000',
      retries: '3',
      debug: 'true',
    });

    const unknown = readEnvironment(testPath, 'staging');
    await expect(unknown).rejects.toThrow(TestFileError);
    await expect(unknown).rejects.toThrow(/no environment "staging"; available: dev, prod/);

    await writeFile(join(dir, 'httpi.env.yaml'), 'dev: { nested: { a: 1 } }\n');
    await expect(readEnvironment(testPath, 'dev')).rejects.toThrow(/invalid environment file\n.*\n.*dev\.nested/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('stringifyTestFile writes YAML that reads back to the same model', () => {
  const file = parseTestFile(PLAN_EXAMPLE_YAML, 'users.yaml');
  expect(parseTestFile(stringifyTestFile(file), 'again.yaml')).toEqual(file);
});

test('stringifyTestFile leaves out empty headers and asserts, and keeps long or multi-line text intact', () => {
  const body = `{"note": "${'x'.repeat(120)}",\n  "b": 1}`;
  const file = parseTestFile(
    JSON.stringify({ version: 1, tests: [{ name: 'POST /x', request: { method: 'POST', url: 'http://x', body: { text: body } } }] }),
    'in.json',
  );
  const yaml = stringifyTestFile(file);
  expect(yaml).not.toContain('headers');
  expect(yaml).not.toContain('expect');
  expect(yaml.startsWith('version: 1\ntests:\n  - name: POST /x\n    request:\n      method: POST\n      url: http://x\n')).toBe(true);
  expect(parseTestFile(yaml, 'out.yaml')).toEqual(file);
});

test('writeTestFile creates the file and refuses to replace an existing one', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'file-test-write-'));
  try {
    const path = join(dir, 'new.yaml');
    const file = parseTestFile(PLAN_EXAMPLE_YAML, 'users.yaml');
    await writeTestFile(path, file);
    expect(await readFile(path, 'utf8')).toBe(stringifyTestFile(file));

    const again = writeTestFile(path, file);
    await expect(again).rejects.toThrow(TestFileError);
    await expect(again).rejects.toThrow(/new\.yaml: cannot write file: file already exists/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test.each<[name: string, field: string, expected: (base: string) => string]>([
  ['a plain value is not a file', 'name=Ana', () => 'name=Ana'],
  ['an e-mail value is not a file', 'email=ana@example.com', () => 'email=ana@example.com'],
  ['@path uploads a file', 'avatar=@img/a.png', (base) => `avatar=@${resolve(base, 'img/a.png')}`],
  ['<path sends the content of a file', 'note=<notes/n.txt', (base) => `note=<${resolve(base, 'notes/n.txt')}`],
  ['options after ; are kept', 'doc=@d.pdf;type=application/pdf;filename=x.pdf', (base) => `doc=@${resolve(base, 'd.pdf')};type=application/pdf;filename=x.pdf`],
  ['several files', 'docs=@a.txt,sub/b.txt', (base) => `docs=@${resolve(base, 'a.txt')},${resolve(base, 'sub/b.txt')}`],
  ['a parent directory', 'f=@../shared/f.bin', (base) => `f=@${resolve(base, '../shared/f.bin')}`],
  ['an absolute path stays', `f=@${resolve('/abs/f.bin')}`, () => `f=@${resolve('/abs/f.bin')}`],
  ['stdin stays', 'f=@-', () => 'f=@-'],
  ['a field without = stays', 'nonsense', () => 'nonsense'],
])('resolveFormPaths: %s', (_name, field, expected) => {
  const base = resolve('project', 'tests');
  const request = { method: 'POST', url: 'http://x', headers: {}, body: { form: [field] } };
  expect(resolveFormPaths(request, base)).toEqual({ ...request, body: { form: [expected(base)] } });
});

test('resolveFormPaths leaves other bodies alone', () => {
  const request = { method: 'POST', url: 'http://x', headers: {}, body: { text: 'a=@file' } };
  expect(resolveFormPaths(request, '/base')).toBe(request);
});
