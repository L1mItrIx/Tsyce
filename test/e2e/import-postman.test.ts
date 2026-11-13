import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { assertCliIsBuilt, httpi } from './helpers.js';

const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/postman/${name}`, import.meta.url));
const COLLECTION = fixture('shop.postman_collection.json');

let server: Server;
let baseUrl: string;
let dir: string;
const calls: string[] = [];

beforeAll(async () => {
  assertCliIsBuilt();
  server = createServer((req, res) => { calls.push(`${req.method} ${req.url}`); res.end('{}'); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
beforeEach(async () => { calls.length = 0; dir = await mkdtemp(join(tmpdir(), 'e2e-import-postman-')); });
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
});

async function allText(root: string): Promise<string> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name));
  return (await Promise.all(files.map((file) => readFile(file, 'utf8')))).join('\n');
}

test('a Postman collection becomes a project: tests per folder, httpi.yaml with environment and auth, no secrets on disk', async () => {
  const project = join(dir, 'shop');
  const result = await httpi(['import', COLLECTION, '-o', project, '--environment', fixture('staging.postman_environment.json')]);
  expect(result.stdout).toBe('');
  expect(result.stderr.split('\n')).toEqual([
    'httpi: read as a Postman collection (use --from to change it)',
    'warning: Shop API: the collection-level pre-request script was not converted',
    'warning: Users / List users: the test script was not converted',
    'warning: Users / Admin / Delete user: path variable ":id" has no value; it became {{id}}',
    'warning: Orders & Payments / Search orders: the OAuth client secret was not copied; auth "main" reads it from ${CLIENT_SECRET}',
    'warning: Orders & Payments / Upload receipt: form file "photo" has no path; add it as "photo=@<path>"',
    'warning: Orders & Payments / Order graph: GraphQL bodies are not supported; the body was left out',
    'warning: Orders & Payments / Signed: auth type "awsv4" is not supported; add the credentials by hand',
    'created tests/shop-api.yaml (1 test)',
    'created tests/users.yaml (4 tests)',
    'created tests/orders-payments.yaml (5 tests)',
    'secret: a literal credential was replaced by a variable (Authorization → {{basicAuth}}); give it a value with --var or in httpi.local.yaml',
    'created httpi.yaml',
    'httpi: 10 tests have no asserts yet; add "expect" blocks, then check the project with "httpi validate"',
    '',
  ]);
  expect(result.code).toBe(0);

  expect((await readdir(join(project, 'tests'))).sort()).toEqual(['orders-payments.yaml', 'shop-api.yaml', 'users.yaml']);
  const yaml = await readFile(join(project, 'httpi.yaml'), 'utf8');
  expect(yaml).toContain('name: Shop API\n');
  expect(yaml).toContain('default: shop-staging\n');
  expect(yaml).toContain('baseUrl: https://staging.shop.example\n');
  expect(yaml).toContain('customerId: "42"\n');
  expect(yaml).toContain('clientSecret: ${CLIENT_SECRET}\n');
  expect(await readFile(join(project, 'tests', 'users.yaml'), 'utf8')).toContain('Authorization: Basic {{basicAuth}}');
  expect(await allText(project)).not.toMatch(/FAKE_PASSWORD|FAKE_CLIENT_SECRET|FAKE_STALE_ACCESS_TOKEN|YWRtaW46RkFLRV9QQVNTV09SRA/);
});

test('the imported project validates once its variables have values, and its requests run', async () => {
  const project = join(dir, 'shop');
  expect((await httpi(['import', COLLECTION, '-o', project])).code).toBe(0);

  const missing = await httpi(['validate'], { cwd: project, env: { token: undefined, newUser: undefined, basicAuth: undefined, id: undefined, customerId: undefined, apiKey: undefined } });
  expect(missing.stdout).toContain('tests/orders-payments.yaml: test "Upload receipt": multipart file tests/receipts/r1.pdf does not exist\n');
  expect(missing.stdout).toContain('httpi.yaml: unresolved variables: {{customerId}}, {{apiKey}}, {{token}}, {{newUser}}, {{id}}, {{basicAuth}}\n');
  expect(missing.code).toBe(2);

  await writeFile(join(project, 'httpi.local.yaml'), `baseUrl: ${baseUrl}\ntoken: t\nnewUser: Ana\nbasicAuth: x\nid: 7\n`);
  await rm(join(project, 'tests', 'orders-payments.yaml'));
  const run = await httpi(['run'], { cwd: project });
  expect(calls).toEqual(['GET /health', 'GET /users?page=1&limit=20', 'POST /users', 'DELETE /users/7?force=true', 'GET /users/7']);
  expect(run.stdout).toContain('2 files, 5 tests: 5 passed');
  expect(run.code).toBe(0);
});

test('importing into an existing project adds to httpi.yaml without replacing it, and never overwrites tests', async () => {
  const project = join(dir, 'shop');
  expect((await httpi(['init', project])).code).toBe(0);
  const first = await httpi(['import', COLLECTION, '-o', project]);
  expect(first.stderr).toContain('added auth "main" to httpi.yaml\nadded environment "imported" to httpi.yaml\n');
  const yaml = await readFile(join(project, 'httpi.yaml'), 'utf8');
  expect(yaml).toContain('default: dev\n');
  expect(yaml).toContain('baseUrl: https://api.shop.example\n');

  const again = await httpi(['import', COLLECTION, '-o', project]);
  expect(again.stderr).toMatch(/^httpi: read as a Postman collection.*\nhttpi: these files already exist; nothing was written: .*shop-api\.yaml, .*users\.yaml, .*orders-payments\.yaml\n$/);
  expect(again.code).toBe(2);
  expect(await readFile(join(project, 'httpi.yaml'), 'utf8')).toBe(yaml);
});

test('--keep-secrets leaves literal credentials in the tests', async () => {
  const project = join(dir, 'shop');
  const result = await httpi(['import', COLLECTION, '-o', project, '--keep-secrets']);
  expect(result.stderr).not.toContain('secret:');
  expect(await readFile(join(project, 'tests', 'users.yaml'), 'utf8')).toContain(`Authorization: Basic ${Buffer.from('admin:FAKE_PASSWORD').toString('base64')}`);
});

test.each<[name: string, args: string[], stderr: RegExp]>([
  ['a collection without an output directory', ['import', COLLECTION], /this import produces several files; pass the project directory with -o <directory>/],
  ['curl-only options with a collection', ['import', COLLECTION, '-o', 'x', '--name', 'n'], /--dialect and --name only apply to a curl command/],
  ['--from postman with something else', ['import', fixture('staging.postman_environment.json'), '--from', 'postman', '-o', 'x'], /this is not a Postman collection \(v2\.0 or v2\.1\)/],
  ['an unknown format', ['import', COLLECTION, '--from', 'insomnia'], /^error: option '--from <format>' argument 'insomnia' is invalid/],
])('exit 2 for %s', async (_name, args, stderr) => {
  const result = await httpi(args, { cwd: dir });
  expect(result.stdout).toBe('');
  expect(result.stderr).toMatch(stderr);
  expect(await readdir(dir)).toEqual([]);
  expect(result.code).toBe(2);
});

test('--from curl still reads JSON-looking input as a command, and --environment is refused for curl', async () => {
  const result = await httpi(['import', '--from', 'curl', '--environment', 'x.json'], { stdin: `curl ${baseUrl}/x` });
  expect(result.stderr).toContain('--environment only applies to a Postman collection');
  expect(result.code).toBe(2);
});
