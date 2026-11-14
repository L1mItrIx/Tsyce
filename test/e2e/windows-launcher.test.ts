import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { httpi } from './helpers.js';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const methods: string[] = [];
let origin: string; let root: string; let pausePrompt = '';
const server = createServer((req, res) => {
  methods.push(req.method!); let body = '';
  req.setEncoding('utf8').on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(req.method === 'POST' ? 201 : 200);
    res.end(JSON.stringify(req.method === 'DELETE' ? {} : { id: req.method === 'POST' ? 101 : 1, title: 'Original', ...JSON.parse(body || '{}') }));
  });
});
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'httpi-click & ! %HTTPI_TEST_TRAP%-'));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  if (process.platform === 'win32') {
    // Read cmd's own localized prompt instead of assuming an English Windows installation.
    const probe = spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', 'pause'], { input: '\n', encoding: 'utf8', timeout: 2000 });
    expect(probe.status).toBe(0); pausePrompt = probe.stdout.trim(); expect(pausePrompt).not.toBe('');
  }
});
afterAll(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await rm(root, { recursive: true, force: true }); });

test('the remote demo executes all five methods through the real CLI against a controlled server', async () => {
  const result = await httpi(['run', join(repo, 'examples/remotas/httpi.yaml'), '--var', `baseUrl=${origin}`, '--show-response']);
  expect(result.code).toBe(0); expect(result.stderr).toBe('');
  expect(result.stdout).toContain('5 tests: 5 passed');
  expect(methods).toEqual(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
});

const nativeCases = process.platform === 'win32' ? ['project', 'demo', 'yaml', 'json', 'failed', 'invalid', 'network', 'missing-file', 'missing-build', 'missing-node', 'pause'] : [];
test.each(nativeCases)('Windows double-click launcher: %s', async (scenario) => {
  const dir = join(root, scenario); await mkdir(join(dir, 'dist'), { recursive: true });
  const script = join(dir, 'probar.cmd'); await copyFile(join(repo, 'probar.cmd'), script);
  await writeFile(join(dir, 'package.json'), '{"type":"module"}');
  await writeFile(join(dir, 'dist/cli.js'), `import ${JSON.stringify(pathToFileURL(join(repo, 'dist/cli.js')).href)};`);
  const testFile = join(dir, 'request & ! %HTTPI_TEST_TRAP%.yaml');
  const flow = { version: 1, tests: [{ name: 'test', request: { url: scenario === 'network' ? 'http://127.0.0.1:1' : origin, timeoutMs: 1000 }, expect: { status: scenario === 'failed' ? 201 : 200 } }] };
  await writeFile(testFile, JSON.stringify(flow));
  let target = testFile;
  if (scenario === 'project' || scenario === 'invalid' || scenario === 'pause') {
    target = ''; await writeFile(join(dir, 'httpi.yaml'), scenario === 'invalid' ? 'version: invalid' : JSON.stringify({ version: 1, run: [testFile] }));
  }
  if (scenario === 'demo') {
    target = '';
    const project = join(dir, 'examples/remotas/httpi.yaml'); await mkdir(dirname(project), { recursive: true });
    await writeFile(project, JSON.stringify({ version: 1, run: [testFile] }));
  }
  if (scenario === 'json') { target = join(dir, 'request.json'); await writeFile(target, JSON.stringify(flow)); }
  if (scenario === 'missing-file') target = join(dir, 'missing.yaml');
  if (scenario === 'missing-build') await rm(join(dir, 'dist/cli.js'));
  const env = { ...process.env, HTTPI_NO_PAUSE: scenario === 'pause' ? '' : '1', HTTPI_TEST_SCRIPT: script, HTTPI_TEST_FILE: target, HTTPI_TEST_TRAP: 'MUST_NOT_EXPAND' };
  if (scenario === 'missing-node') for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') env[key as keyof typeof env] = '';
  const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', '""%HTTPI_TEST_SCRIPT%" "%HTTPI_TEST_FILE%""'], { env, windowsVerbatimArguments: true });
    let stdout = ''; let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
    child.on('error', reject); child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end('\n');
  });
  const expected = scenario === 'failed' ? 1 : scenario === 'network' ? 3 : ['invalid', 'missing-file', 'missing-build', 'missing-node'].includes(scenario) ? 2 : 0;
  expect(result.code, result.stdout + result.stderr).toBe(expected);
  expect(result.stdout).toContain(expected === 0 ? 'ALL TESTS PASSED' : expected === 1 ? 'TESTS FAILED' : expected === 2 ? 'COULD NOT RUN' : 'CONNECTION OR AUTHENTICATION ERROR');
  if (scenario === 'pause') expect(result.stdout).toContain(pausePrompt);
  else expect(result.stdout).not.toContain(pausePrompt);
  if (scenario === 'invalid') expect(result.stdout).not.toContain('Running the public remote demo');
});
