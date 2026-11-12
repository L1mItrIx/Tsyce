import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { assertCliIsBuilt, httpi } from './helpers.js';

let server: Server;
let baseUrl: string;
let dir: string;

async function testFile(name: string, content: string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, content);
  return path;
}

beforeAll(async () => {
  assertCliIsBuilt();
  server = createServer((req, res) => {
    if (req.url === '/users/7') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 7, name: 'Ana' }));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  dir = await mkdtemp(join(tmpdir(), 'e2e-run-'));
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
});

const passingYaml = () => `
version: 1
name: Users API
tests:
  - name: GET user 7
    request:
      url: ${baseUrl}/users/7
    expect:
      status: 200
      headers:
        content-type: { contains: application/json }
      json:
        - { path: "$.name", equals: Ana }
`;

test('exit 0 when every assert passes; plain report on stdout without ANSI codes', async () => {
  const result = await httpi(['run', await testFile('pass.yaml', passingYaml())]);
  expect(result.stderr).toBe('');
  expect(result.stdout).toMatch(
    /^Users API\n\n✓ GET user 7 \(200, \d+ ms\)\n {4}✓ status is 200\n {4}✓ header content-type contains "application\/json"\n {4}✓ \$\.name equals "Ana"\n\n1 test: 1 passed\n$/,
  );
  expect(result.code).toBe(0);
});

test('a JSON test file works the same', async () => {
  const json = JSON.stringify({
    version: 1,
    tests: [{ name: 'json file', request: { url: `${baseUrl}/users/7` }, expect: { status: 200 } }],
  });
  const result = await httpi(['run', await testFile('pass.json', json)]);
  expect(result.stdout).toContain('1 test: 1 passed');
  expect(result.code).toBe(0);
});

test('--show-response runs a file without prompting and displays its response and assertions', async () => {
  for (const expectedStatus of [200, 201]) {
    const yaml = passingYaml().replace('status: 200', `status: ${expectedStatus}`);
    const result = await httpi(['run', await testFile(`response-${expectedStatus}.yaml`, yaml), '--show-response']);
    expect(result.code).toBe(expectedStatus === 200 ? 0 : 1);
    expect(result.stdout).toContain('Response: HTTP 200');
    expect(result.stdout).toContain('content-type: application/json');
    expect(result.stdout).toContain('"id": 7');
    expect(result.stdout).toContain('"name": "Ana"');
    expect(result.stdout).toContain('status is');
    expect(result.stderr).toBe('');
  }
});

test('response output is rejected with JUnit so XML stays machine-readable', async () => {
  const result = await httpi(['run', await testFile('response-junit.yaml', passingYaml()), '--reporter', 'junit', '--show-response']);
  expect(result.code).toBe(2);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('--show-response requires --reporter pretty');
});

test('exit 1 when an assert fails', async () => {
  const yaml = `
version: 1
tests:
  - name: ok
    request: { url: ${baseUrl}/users/7 }
    expect: { status: 200 }
  - name: missing user
    request: { url: ${baseUrl}/users/8 }
    expect: { status: 200 }
`;
  const result = await httpi(['run', await testFile('fail.yaml', yaml)]);
  expect(result.stdout).toContain('✗ missing user (404,');
  expect(result.stdout).toContain('    ✗ status is 200: got 404');
  expect(result.stdout).toContain('2 tests: 1 passed, 1 failed');
  expect(result.code).toBe(1);
});

test('exit 2 for an invalid test file, with the reason on stderr', async () => {
  const path = await testFile('invalid.yaml', 'version: 1\ntests:\n  - name: t\n    request: { uri: http://x }\n');
  const result = await httpi(['run', path]);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('invalid.yaml: invalid test file');
  expect(result.stderr).toContain('tests[0].request');
  expect(result.code).toBe(2);
});

test('exit 2 for a missing file', async () => {
  const result = await httpi(['run', join(dir, 'nope.yaml')]);
  expect(result.stderr).toMatch(/^httpi: .*nope\.yaml: cannot read file/);
  expect(result.code).toBe(2);
});

test.each([
  ['missing argument', ['run']],
  ['unknown command', ['frobnicate']],
  ['unknown option', ['run', 'x.yaml', '--frobnicate']],
])('exit 2 for wrong usage: %s', async (_name, args) => {
  const result = await httpi(args);
  expect(result.stderr).toMatch(/^error: /);
  expect(result.code).toBe(2);
});

test('--help exits 0', async () => {
  const result = await httpi(['--help']);
  expect(result.stdout).toContain('Usage: httpi');
  expect(result.code).toBe(0);
});

test('exit 3 when a request gets no response', async () => {
  const closed = createServer();
  await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
  const { port } = closed.address() as AddressInfo;
  await new Promise((resolve) => closed.close(resolve));

  const yaml = `version: 1\ntests:\n  - name: down\n    request: { url: "http://127.0.0.1:${port}/" }\n    expect: { status: 200 }\n`;
  const result = await httpi(['run', await testFile('down.yaml', yaml)]);
  expect(result.stdout).toMatch(/! down\n {4}curl error 7: /);
  expect(result.stdout).toContain('1 test: 0 passed, 1 errored');
  expect(result.code).toBe(3);
});

test('exit 3 when curl is not available', async () => {
  const path = await testFile('nocurl.yaml', passingYaml());
  const result = await httpi(['run', path], { env: { HTTPI_CURL: 'httpi-no-such-curl-binary' } });
  expect(result.stdout).toBe('');
  expect(result.stderr).toMatch(/^httpi: cannot run curl binary "httpi-no-such-curl-binary"/);
  expect(result.code).toBe(3);
});

const variablesYaml = `
version: 1
tests:
  - name: user {{id}} from {{source}}
    request:
      url: "{{baseUrl}}/users/{{id}}"
    expect:
      status: 200
      json:
        - { path: "$.name", equals: "\${E2E_EXPECTED_NAME}" }
`;

test('--env, --var and ${ENV} fill the variables; --var wins over the system and the env file', async () => {
  const path = await testFile('vars.yaml', variablesYaml);
  await testFile('httpi.env.yaml', `local: { baseUrl: "${baseUrl}", id: 999, source: env-file }\n`);
  const result = await httpi(['run', path, '--env', 'local', '--var', 'id=7', '--var', 'source=a=b'], {
    env: { E2E_EXPECTED_NAME: 'Ana', id: '555' },
  });
  expect(result.stderr).toBe('');
  expect(result.stdout).toContain('✓ user 7 from a=b (200,');
  expect(result.code).toBe(0);
});

test('exit 2 when a variable has no value, naming each one', async () => {
  const path = await testFile('unresolved.yaml', variablesYaml);
  const result = await httpi(['run', path, '--var', 'id=7'], { env: { E2E_EXPECTED_NAME: undefined, source: undefined, baseUrl: undefined } });
  expect(result.stdout).toBe('');
  expect(result.stderr).toBe('httpi: unresolved variables: {{source}}, {{baseUrl}}, ${E2E_EXPECTED_NAME}\n');
  expect(result.code).toBe(2);
});

test('exit 2 for an environment that is not in httpi.env.yaml', async () => {
  const path = await testFile('vars.yaml', variablesYaml);
  await testFile('httpi.env.yaml', 'local: { baseUrl: "http://x" }\n');
  const result = await httpi(['run', path, '--env', 'prod']);
  expect(result.stderr).toMatch(/no environment "prod"; available: local/);
  expect(result.code).toBe(2);
});

test('exit 2 for a malformed --var', async () => {
  const result = await httpi(['run', 'x.yaml', '--var', 'novalue']);
  expect(result.stderr).toMatch(/^error: option '--var <name=value>' argument 'novalue' is invalid\. Expected name=value\./);
  expect(result.code).toBe(2);
});
