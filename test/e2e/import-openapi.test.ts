import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { assertCliIsBuilt, httpi } from './helpers.js';

const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/openapi/${name}`, import.meta.url));

let server: Server;
let baseUrl: string;
let dir: string;
const calls: string[] = [];

beforeAll(async () => {
  assertCliIsBuilt();
  server = createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8').on('data', (chunk: string) => (body += chunk));
    req.on('end', () => {
      calls.push(`${req.method} ${req.url} ${body}`.trim());
      res.writeHead(req.method === 'DELETE' ? 204 : 200, { 'Content-Type': 'application/json' }).end(req.method === 'DELETE' ? undefined : '{}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
beforeEach(async () => { calls.length = 0; dir = await mkdtemp(join(tmpdir(), 'e2e-import-openapi-')); });
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
});

test('an OpenAPI document becomes a project that validates and runs: every operation with its documented status', async () => {
  const project = join(dir, 'pets');
  const imported = await httpi(['import', fixture('petstore-expanded.yaml'), '-o', project]);
  expect(imported.stdout).toBe('');
  expect(imported.stderr).toBe(
    'httpi: read as an OpenAPI document (use --from to change it)\n' +
      'created tests/swagger-petstore.yaml (4 tests)\n' +
      'created httpi.yaml\n' +
      'httpi: each test only checks the status; add "expect" blocks, then check the project with "httpi validate"\n',
  );
  expect(imported.code).toBe(0);
  expect(await readFile(join(project, 'httpi.yaml'), 'utf8')).toContain('baseUrl: https://petstore.swagger.io/v2\n');

  const missing = await httpi(['validate'], { cwd: project, env: { id: undefined } });
  expect(missing.stdout).toBe('httpi.yaml: unresolved variable: {{id}}\n1 problem in 1 file, 4 tests\n');

  await writeFile(join(project, 'httpi.local.yaml'), `baseUrl: ${baseUrl}\nid: 7\n`);
  expect((await httpi(['validate'], { cwd: project, env: { id: undefined, baseUrl: undefined } })).stdout).toBe('valid: 1 file, 4 tests; no requests were sent\n');
  expect(calls).toEqual([]);

  const run = await httpi(['run'], { cwd: project, env: { id: undefined, baseUrl: undefined } });
  expect(calls).toEqual(['GET /pets', 'POST /pets {"name":"string","tag":"string"}', 'GET /pets/7', 'DELETE /pets/7']);
  expect(run.stdout).toContain('✓ deletePet (204,');
  expect(run.stdout).toContain('1 file, 4 tests: 4 passed');
  expect(run.code).toBe(0);
});

test('the larger Petstore 3 document: a file per tag, warnings on stderr, and a project that validates', async () => {
  const project = join(dir, 'petstore3');
  const imported = await httpi(['import', '--from', 'openapi', '-o', project], { stdin: await readFile(fixture('petstore3.yaml'), 'utf8') });
  expect(imported.stderr).toContain('warning: security scheme "petstore_auth": it only offers the implicit OAuth 2.0 flow;');
  expect(imported.stderr).toContain('warning: POST /pet/{petId}/uploadImage: request body of type application/octet-stream is not supported; the body was left out\n');
  expect(imported.stderr).toContain('created tests/pet.yaml (8 tests)\ncreated tests/store.yaml (4 tests)\ncreated tests/user.yaml (7 tests)\ncreated httpi.yaml\n');
  expect(imported.stderr).not.toContain('read as');
  expect((await readdir(join(project, 'tests'))).sort()).toEqual(['pet.yaml', 'store.yaml', 'user.yaml']);

  const variables = ['petId', 'tags', 'api_key', 'orderId', 'username'].flatMap((name) => ['--var', `${name}=x`]);
  const valid = await httpi(['validate', ...variables], { cwd: project });
  expect(valid.stdout).toBe('valid: 3 files, 19 tests; no requests were sent\n');
  expect(valid.code).toBe(0);
});

test.each<[name: string, args: string[], stdin: string, stderr: RegExp]>([
  ['an OpenAPI document without an output directory', ['import'], 'openapi: "3.0.0"\npaths:\n  /x:\n    get: {}\n', /this import produces several files; pass the project directory with -o <directory>/],
  ['Swagger 2 forced as OpenAPI', ['import', '--from', 'openapi', '-o', 'x'], 'swagger: "2.0"\npaths: {}\n', /Swagger 2\.0 is not supported; convert the document to OpenAPI 3 first/],
  ['--environment with OpenAPI', ['import', '-o', 'x', '--environment', 'e.json'], 'openapi: "3.0.0"\npaths:\n  /x:\n    get: {}\n', /--environment only applies to a Postman collection/],
])('exit 2 for %s', async (_name, args, stdin, stderr) => {
  const result = await httpi(args, { cwd: dir, stdin });
  expect(result.stderr).toMatch(stderr);
  expect(await readdir(dir)).toEqual([]);
  expect(result.code).toBe(2);
});
