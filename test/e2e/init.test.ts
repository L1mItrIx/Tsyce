import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { parse } from 'yaml';
import { projectFileSchema } from '../../src/core/schema.js';
import { assertCliIsBuilt, httpi } from './helpers.js';

let server: Server;
let baseUrl: string;
let dir: string;

beforeAll(async () => {
  assertCliIsBuilt();
  server = createServer((_req, res) => res.end('ok'));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'e2e-init-')); });
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
});

test('httpi init creates a project that httpi run can execute right away', async () => {
  const init = await httpi(['init'], { cwd: dir });
  expect(init.stdout).toBe('');
  expect(init.stderr).toContain('created httpi.yaml\ncreated tests/example.yaml\ncreated data/.gitkeep\ncreated .github/workflows/httpi.yml\ncreated .gitignore\n');
  expect(init.code).toBe(0);

  expect((await readdir(dir)).sort()).toEqual(['.github', '.gitignore', 'data', 'httpi.yaml', 'tests']);
  expect(await readFile(join(dir, '.gitignore'), 'utf8')).toBe('.httpi/\nhttpi.local.yaml\nreports/\n');
  const project = projectFileSchema.parse(parse(await readFile(join(dir, 'httpi.yaml'), 'utf8')));
  expect(project.run).toEqual(['tests/*.yaml']);
  expect(project.report).toEqual({ junit: 'reports/junit.xml' });
  expect(await readFile(join(dir, '.github', 'workflows', 'httpi.yml'), 'utf8')).toContain('npx --yes httpi-cli run');

  await writeFile(join(dir, 'httpi.local.yaml'), `baseUrl: ${baseUrl}\n`);
  const run = await httpi(['run'], { cwd: dir, env: { baseUrl: undefined } });
  expect(run.stdout).toContain('✓ the API answers (200,');
  expect(run.stdout).toContain('1 file, 1 test: 1 passed');
  expect(await readFile(join(dir, 'reports', 'junit.xml'), 'utf8')).toContain('<testsuite name="Example" tests="1"');
  expect(run.code).toBe(0);
});

test('init in another directory keeps the files that already exist and only adds missing .gitignore lines', async () => {
  await writeFile(join(dir, '.gitignore'), 'node_modules/\nhttpi.local.yaml');
  const target = join(dir, 'api');
  const first = await httpi(['init', target]);
  expect(first.code).toBe(0);
  expect(await readFile(join(target, '.gitignore'), 'utf8')).toBe('.httpi/\nhttpi.local.yaml\nreports/\n');

  await rm(join(target, 'httpi.yaml'));
  await writeFile(join(target, 'tests', 'example.yaml'), 'mine');
  await writeFile(join(target, '.gitignore'), 'node_modules/\nhttpi.local.yaml');
  const again = await httpi(['init', target]);
  expect(again.stderr).toContain('created httpi.yaml\nkept    tests/example.yaml\nkept    data/.gitkeep\nkept    .github/workflows/httpi.yml\nupdated .gitignore\n');
  expect(await readFile(join(target, 'tests', 'example.yaml'), 'utf8')).toBe('mine');
  expect(await readFile(join(target, '.gitignore'), 'utf8')).toBe('node_modules/\nhttpi.local.yaml\n.httpi/\nreports/\n');
});

test('exit 2 and nothing changes when the project already exists', async () => {
  await writeFile(join(dir, 'httpi.yaml'), 'mine');
  const init = await httpi(['init'], { cwd: dir });
  expect(init.stderr).toMatch(/httpi\.yaml: the project already exists; nothing was changed\n$/);
  expect(await readdir(dir)).toEqual(['httpi.yaml']);
  expect(await readFile(join(dir, 'httpi.yaml'), 'utf8')).toBe('mine');
  expect(init.code).toBe(2);
});
