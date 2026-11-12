import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import {
  parseTestFile,
  readEnvironment,
  readTestFile,
  stringifyTestFile,
  TestFileError,
  writeTestFile,
} from '../../src/core/file.js';

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
