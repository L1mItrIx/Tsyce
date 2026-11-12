import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { TestFileError } from '../../src/core/file.js';
import { expandRun, findProjectFile, readProjectFile } from '../../src/core/project.js';
import { projectFileSchema } from '../../src/core/schema.js';

let root: string;

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'project-test-')));
  await mkdir(join(root, 'tests', 'admin', 'deep'), { recursive: true });
  for (const file of ['tests/login.yaml', 'tests/users.yaml', 'tests/admin/b.yaml', 'tests/admin/a.yaml', 'tests/admin/notes.txt']) {
    await writeFile(join(root, file), '');
  }
});

afterAll(() => rm(root, { recursive: true, force: true }));

describe('projectFileSchema', () => {
  test('accepts the PLAN example shape and reads environment scalars as text', () => {
    const project = projectFileSchema.parse({
      version: 1,
      name: 'API de usuarios',
      env: { default: 'dev', environments: { dev: { baseUrl: 'http://localhost:3000', retries: 3 }, prod: { baseUrl: 'https://api.example.com' } } },
      run: ['tests/login.yaml', { file: 'tests/users.yaml' }, 'tests/admin/*.yaml'],
    });
    expect(project.env?.environments.dev).toEqual({ baseUrl: 'http://localhost:3000', retries: '3' });
    expect(project.run).toHaveLength(3);
  });

  test.each([
    ['missing run', { version: 1 }],
    ['empty run', { version: 1, run: [] }],
    ['unsupported version', { version: 2, run: ['a.yaml'] }],
    ['unknown key', { version: 1, run: ['a.yaml'], schedule: 'daily' }],
    ['run entry without file', { version: 1, run: [{}] }],
    ['run entry with an unknown key', { version: 1, run: [{ file: 'a.yaml', retries: 2 }] }],
    ['env without environments', { version: 1, run: ['a.yaml'], env: { default: 'dev' } }],
  ])('rejects %s', (_name, input) => {
    expect(projectFileSchema.safeParse(input).success).toBe(false);
  });
});

describe('findProjectFile', () => {
  test('finds httpi.yaml in the directory or in a parent; null when there is none', async () => {
    expect(findProjectFile(join(root, 'tests', 'admin', 'deep'))).toBeNull();
    await writeFile(join(root, 'httpi.yaml'), 'version: 1\nrun: [tests/login.yaml]\n');
    expect(findProjectFile(root)).toBe(join(root, 'httpi.yaml'));
    expect(findProjectFile(join(root, 'tests', 'admin', 'deep'))).toBe(join(root, 'httpi.yaml'));
  });

  test('the closest one wins', async () => {
    await writeFile(join(root, 'tests', 'admin', 'httpi.yaml'), 'version: 1\nrun: [a.yaml]\n');
    try {
      expect(findProjectFile(join(root, 'tests', 'admin', 'deep'))).toBe(join(root, 'tests', 'admin', 'httpi.yaml'));
    } finally {
      await rm(join(root, 'tests', 'admin', 'httpi.yaml'));
    }
  });
});

describe('readProjectFile', () => {
  test('reads a valid file and explains an invalid one', async () => {
    const path = join(root, 'httpi.yaml');
    await writeFile(path, 'version: 1\nname: Demo\nrun:\n  - tests/login.yaml\n');
    expect(await readProjectFile(path)).toEqual({ version: 1, name: 'Demo', run: ['tests/login.yaml'] });

    await writeFile(path, 'version: 1\nrun: tests/login.yaml\n');
    const invalid = readProjectFile(path);
    await expect(invalid).rejects.toThrow(TestFileError);
    await expect(invalid).rejects.toThrow(/httpi\.yaml: invalid project file\n.*\n.*→ at run/);
  });
});

describe('expandRun', () => {
  const expand = (run: unknown[]) => expandRun(projectFileSchema.parse({ version: 1, run }), join(root, 'httpi.yaml'));
  const abs = (...files: string[]) => files.map((file) => join(root, ...file.split('/')));

  test('keeps the order of the list and sorts the matches of a pattern', async () => {
    expect(await expand(['tests/users.yaml', 'tests/admin/*.yaml', { file: 'tests/login.yaml' }])).toEqual(
      abs('tests/users.yaml', 'tests/admin/a.yaml', 'tests/admin/b.yaml', 'tests/login.yaml'),
    );
  });

  test('** crosses directories', async () => {
    expect(await expand(['tests/**/*.yaml'])).toEqual(
      abs('tests/admin/a.yaml', 'tests/admin/b.yaml', 'tests/login.yaml', 'tests/users.yaml'),
    );
  });

  test('a file listed twice runs twice', async () => {
    expect(await expand(['tests/login.yaml', 'tests/login.yaml'])).toEqual(abs('tests/login.yaml', 'tests/login.yaml'));
  });

  test('a missing file or a pattern without matches is an error, not an empty run', async () => {
    await expect(expand(['tests/nope.yaml'])).rejects.toThrow(/httpi\.yaml: run entry "tests\/nope\.yaml" does not exist/);
    await expect(expand(['tests/*.json'])).rejects.toThrow(/httpi\.yaml: run pattern "tests\/\*\.json" matches no files/);
    await expect(expand(['tests/nope.yaml'])).rejects.toThrow(TestFileError);
  });
});
