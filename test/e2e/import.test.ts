import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { assertCliIsBuilt, httpi } from './helpers.js';

let server: Server;
let baseUrl: string;
let dir: string;

beforeAll(async () => {
  assertCliIsBuilt();
  // Answers 200 only to the exact request the pasted curl describes.
  server = createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8').on('data', (chunk: string) => (body += chunk));
    req.on('end', () => {
      const ok =
        req.method === 'POST' &&
        req.url === '/v1/users?team=core' &&
        req.headers.authorization === 'Bearer FAKE_TOKEN_123' &&
        req.headers['content-type'] === 'application/json' &&
        body === '{"name":"Ana","note":"it\'s here!"}';
      res.writeHead(ok ? 201 : 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok, method: req.method, url: req.url, headers: req.headers, body }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  dir = await mkdtemp(join(tmpdir(), 'e2e-import-'));
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
});

const bashCurl = () => `curl '${baseUrl}/v1/users?team=core' \\
  -H 'authorization: Bearer FAKE_TOKEN_123' \\
  -H 'content-type: application/json' \\
  --data-raw $'{"name":"Ana","note":"it\\'s here\\u0021"}'
`;

const cmdCurl = () => `curl ^"${baseUrl}/v1/users?team=core^" ^\r
  -H ^"authorization: Bearer FAKE_TOKEN_123^" ^\r
  -H ^"content-type: application/json^" ^\r
  --data-raw ^"^{^\\^"name^\\^":^\\^"Ana^\\^",^\\^"note^\\^":^\\^"it's here^!^\\^"^}^"\r
`;

const powershellCurl = () => `curl.exe "${baseUrl}/v1/users?team=core" \`
  -H "authorization: Bearer FAKE_TOKEN_123" \`
  -H "content-type: application/json" \`
  -d '{"name":"Ana","note":"it''s here!"}'
`;

test('a curl pasted on stdin becomes YAML on stdout, with the token moved to a variable', async () => {
  const result = await httpi(['import'], { stdin: bashCurl() });
  expect(result.stdout).toBe(
    [
      'version: 1',
      'tests:',
      '  - name: POST /v1/users',
      '    request:',
      '      method: POST',
      `      url: ${baseUrl}/v1/users?team=core`,
      '      headers:',
      '        authorization: Bearer {{token}}',
      '        content-type: application/json',
      '      body:',
      `        text: '{"name":"Ana","note":"it''s here!"}'`,
      '',
    ].join('\n'),
  );
  expect(result.stderr).toContain('httpi: read as a bash command');
  expect(result.stderr).toContain('secret: the authorization value was replaced by {{token}}');
  expect(result.stderr).not.toContain('FAKE_TOKEN_123');
  expect(result.code).toBe(0);
});

test.each([
  ['bash', bashCurl],
  ['cmd', cmdCurl],
  ['powershell', powershellCurl],
])('%s: import to a file, then httpi run sends the same request', async (dialect, curl) => {
  const curlFile = join(dir, `${dialect}.curl.txt`);
  const testFile = join(dir, `${dialect}.yaml`);
  await writeFile(curlFile, curl());

  const imported = await httpi(['import', curlFile, '-o', testFile, '--name', 'create user']);
  expect(imported.stderr).toContain(`httpi: read as a ${dialect} command`);
  expect(imported.stdout).toBe('');
  expect(imported.code).toBe(0);

  await writeFile(testFile, `${await readFile(testFile, 'utf8')}    expect:\n      status: 201\n`);
  const run = await httpi(['run', testFile, '--var', 'token=FAKE_TOKEN_123']);
  expect(run.stdout).toContain('✓ create user (201,');
  expect(run.code).toBe(0);

  const withoutToken = await httpi(['run', testFile], { env: { token: undefined } });
  expect(withoutToken.stderr).toBe('httpi: unresolved variable: {{token}}\n');
  expect(withoutToken.code).toBe(2);
});

test('--keep-secrets leaves the credentials in the file', async () => {
  const result = await httpi(['import', '--keep-secrets'], { stdin: bashCurl() });
  expect(result.stdout).toContain('authorization: Bearer FAKE_TOKEN_123');
  expect(result.stderr).not.toContain('secret:');
  expect(result.code).toBe(0);
});

test('unsupported flags are reported on stderr and the import still works', async () => {
  const result = await httpi(['import'], { stdin: `curl -sS --http2 -o out.json ${baseUrl}/x` });
  expect(result.stderr).toContain('warning: unsupported flag -s was ignored');
  expect(result.stderr).toContain('warning: unsupported flag --http2 was ignored');
  expect(result.stderr).toContain('warning: unsupported flag -o (and its value) was ignored');
  expect(result.stdout).toContain(`url: ${baseUrl}/x`);
  expect(result.code).toBe(0);
});

test('--dialect forces how the text is read', async () => {
  const result = await httpi(['import', '--dialect', 'cmd'], { stdin: `curl "${baseUrl}/a^&b"` });
  expect(result.stderr).not.toContain('read as a');
  expect(result.stdout).toContain(`url: ${baseUrl}/a^&b`);
  expect(result.code).toBe(0);
});

test.each<[name: string, args: string[], stdin: string, stderr: RegExp]>([
  ['not a curl command', ['import'], 'wget http://x', /^httpi: read as a bash command.*\nhttpi: expected a curl command, but it starts with "wget"\n$/],
  ['an unterminated quote', ['import'], "curl 'http://x", /httpi: unterminated single quote \('\)\n$/],
  ['empty input', ['import'], '', /httpi: nothing to import: the input is empty\n$/],
  ['an unknown dialect', ['import', '--dialect', 'fish'], 'curl http://x', /^error: option '--dialect <shell>' argument 'fish' is invalid/],
  ['a missing curl file', ['import', 'no-such-file.txt'], '', /^httpi: no-such-file\.txt: cannot read file/],
])('exit 2 for %s', async (_name, args, stdin, stderr) => {
  const result = await httpi(args, { stdin });
  expect(result.stdout).toBe('');
  expect(result.stderr).toMatch(stderr);
  expect(result.code).toBe(2);
});

test('exit 2 instead of replacing an existing output file', async () => {
  const existing = join(dir, 'existing.yaml');
  await writeFile(existing, 'keep me');
  const result = await httpi(['import', '-o', existing], { stdin: `curl ${baseUrl}/x` });
  expect(result.stderr).toContain('existing.yaml: cannot write file: file already exists');
  expect(await readFile(existing, 'utf8')).toBe('keep me');
  expect(result.code).toBe(2);
});
