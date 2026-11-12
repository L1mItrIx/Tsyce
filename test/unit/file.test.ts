import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { parseTestFile, readTestFile, TestFileError } from '../../src/core/file.js';

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
