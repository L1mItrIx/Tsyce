import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, test } from 'vitest';

const CLI = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));

type CliResult = { code: number | null; stdout: string; stderr: string };

function httpi(args: string[], env: NodeJS.ProcessEnv = {}): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

let server: Server;
let baseUrl: string;
let dir: string;

async function testFile(name: string, content: string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, content);
  return path;
}

beforeAll(async () => {
  if (!existsSync(CLI)) throw new Error('dist/cli.js is missing: run `npm run build` before the e2e tests');
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
  const result = await httpi(['run', path], { HTTPI_CURL: 'httpi-no-such-curl-binary' });
  expect(result.stdout).toBe('');
  expect(result.stderr).toMatch(/^httpi: cannot run curl binary "httpi-no-such-curl-binary"/);
  expect(result.code).toBe(3);
});
