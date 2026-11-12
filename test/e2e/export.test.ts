import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { assertCliIsBuilt, httpi } from './helpers.js';

let dir: string;
let server: Server;
let url: string;
const received: { method: string | undefined; url: string | undefined; header: string | undefined; body: string }[] = [];

beforeAll(async () => {
  assertCliIsBuilt();
  dir = await mkdtemp(join(tmpdir(), 'e2e-export-'));
  server = createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8').on('data', (chunk: string) => (body += chunk));
    req.on('end', () => {
      received.push({ method: req.method, url: req.url, header: req.headers['x-literal'] as string | undefined, body });
      res.end('exported request received');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
});

async function fixture(name: string, requests: object[]): Promise<string> {
  const path = join(dir, `${name}.json`);
  await writeFile(path, JSON.stringify({ version: 1, tests: requests.map((request) => ({ name, request })) }));
  return path;
}

test.each(['bash', 'cmd', 'powershell'])('CLI exports all requests as %s without running them', async (dialect) => {
  const path = await fixture(dialect, [{ url: `${url}/one` }, { method: 'HEAD', url: `${url}/two` }]);
  const before = received.length;
  const result = await httpi(['export', path, '--dialect', dialect]);
  expect(result.code).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout).toContain(`${url}/one`);
  expect(result.stdout).toContain(`${url}/two`);
  expect(result.stdout).toContain('--head');
  expect(received.length).toBe(before);
});

test('export resolves --env, --var and system variables with the runner precedence', async () => {
  const path = await fixture('variables', [{ url: '{{baseUrl}}/${HTTPI_EXPORT_PATH}' }]);
  await writeFile(join(dir, 'httpi.env.yaml'), 'dev: { baseUrl: "http://file.test" }\n');
  const result = await httpi(['export', path, '--env', 'dev', '--var', 'baseUrl=http://cli.test'], {
    env: { HTTPI_EXPORT_PATH: 'from-system' },
  });
  expect(result.code).toBe(0);
  expect(result.stdout).toContain('http://cli.test/from-system');
});

test('invalid arguments, files and unresolved variables return 2 without partial output', async () => {
  const missingVar = await fixture('missing-variable', [{ url: 'http://example.test' }, { url: '{{HTTPI_EXPORT_MISSING}}' }]);
  const lineBreak = await fixture('line-break', [{ url: 'http://example.test' }, { url: 'http://example.test', body: { text: 'a\nb' } }]);
  for (const args of [
    ['export'], ['export', 'not-a-file.json'], ['export', missingVar, '--dialect', 'fish'],
    ['export', missingVar], ['export', lineBreak, '--dialect', 'cmd'],
  ]) {
    const result = await httpi(args, { env: { HTTPI_EXPORT_MISSING: undefined } });
    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).not.toBe('');
  }
});

// The CI matrix exercises Bash on Unix and cmd/PowerShell on Windows with actual curl.
test.each(process.platform === 'win32' ? ['cmd', 'powershell'] : ['bash'])(
  '%s: the exported script sends the exact request through the native shell and curl', async (dialect) => {
    const body = '{"name":"it\'s here", "path":"C:\\tmp\\", "literal":"%PATH% !X! & | ^ ( ) $HOME `whoami`"}';
    const header = 'quotes " \' $HOME `whoami` & | < > ^ ( ) %PATH% !X!';
    const path = await fixture('native', [{ method: 'PATCH', url: `${url}/send?x=%20&y=(ok)`, headers: { 'X-Literal': header }, body: { text: body } }]);
    const result = await httpi(['export', path, '--dialect', dialect]);
    expect(result.code).toBe(0);
    const script = join(dir, dialect === 'cmd' ? 'request.cmd' : dialect === 'powershell' ? 'request.ps1' : 'request.sh');
    await writeFile(script, result.stdout);
    const before = received.length;
    const executed = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = dialect === 'cmd'
        ? spawn('cmd.exe', ['/d', '/c', script])
        : dialect === 'powershell'
          ? spawn('pwsh', ['-NoProfile', '-NonInteractive', '-File', script])
          : spawn('bash', ['--noprofile', '--norc', script]);
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
      child.on('error', reject);
      child.on('close', (code) => resolve({ code, stdout, stderr }));
    });
    expect(executed.stderr).toBe('');
    expect(executed.code).toBe(0);
    expect(executed.stdout).toContain('exported request received');
    expect(received.slice(before)).toEqual([{ method: 'PATCH', url: '/send?x=%20&y=(ok)', header, body }]);
  },
);
