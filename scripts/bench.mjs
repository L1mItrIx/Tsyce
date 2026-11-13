// Measures how long httpi takes compared with calling curl directly, against a local server.
// Usage: node scripts/bench.mjs [--iterations N] [--json]      (run `npm run build` first)
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const iterations = Number(args[args.indexOf('--iterations') + 1]) || 20;
const asJson = args.includes('--json');
const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const curl = process.env.HTTPI_CURL || (process.platform === 'win32' ? 'curl.exe' : 'curl');

// Only used to find a free port; the server that answers runs in a child process (see below).
const probe = createServer();
await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${probe.address().port}/ping`;
await new Promise((resolve) => probe.close(resolve));

const dir = mkdtempSync(join(tmpdir(), 'httpi-bench-'));
const test = (name) => ({ name, request: { url }, expect: { status: 200, json: [{ path: '$.ok', equals: true }] } });
writeFileSync(join(dir, 'one.json'), JSON.stringify({ version: 1, tests: [test('ping')] }));
writeFileSync(join(dir, 'ten.json'), JSON.stringify({ version: 1, tests: Array.from({ length: 10 }, (_, i) => test(`ping ${i + 1}`)) }));
const body = join(dir, 'body');

// spawnSync blocks this process, so the server must live in another one to answer.
const serverScript = join(dir, 'server.mjs');
writeFileSync(serverScript, `import { createServer } from 'node:http';
const s = createServer((_q, r) => r.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}'));
s.listen(${Number(new URL(url).port)}, '127.0.0.1', () => process.stdout.write('ready\\n'));`);
const { spawn } = await import('node:child_process');
const child = spawn(process.execPath, [serverScript], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((resolve) => child.stdout.once('data', resolve));

function measure(command, commandArgs, times = 1) {
  const samples = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    for (let j = 0; j < times; j++) {
      const result = spawnSync(command, commandArgs, { stdio: 'ignore' });
      if (result.status !== 0) throw new Error(`${command} ${commandArgs.join(' ')} exited with ${result.status}`);
    }
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  const at = (q) => samples[Math.min(samples.length - 1, Math.floor(q * samples.length))];
  return { medianMs: Math.round(at(0.5)), p90Ms: Math.round(at(0.9)) };
}

const curlArgs = ['-q', '-sS', '-o', body, url];
const results = {
  environment: { platform: `${process.platform}-${process.arch}`, node: process.version, curl: spawnSync(curl, ['--version'], { encoding: 'utf8' }).stdout.split(' ')[1], iterations },
  nodeStartup: measure(process.execPath, ['-e', '']),
  httpiHelp: measure(process.execPath, [cli, '--help']),
  curlOneRequest: measure(curl, curlArgs),
  httpiOneRequest: measure(process.execPath, [cli, 'run', join(dir, 'one.json')]),
  curlTenRequests: measure(curl, curlArgs, 10),
  httpiTenRequests: measure(process.execPath, [cli, 'run', join(dir, 'ten.json')]),
};
child.kill();
rmSync(dir, { recursive: true, force: true });

if (asJson) {
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
} else {
  const row = (label, { medianMs, p90Ms }) => `| ${label} | ${medianMs} | ${p90Ms} |`;
  process.stdout.write([
    `${results.environment.platform}, Node ${results.environment.node}, curl ${results.environment.curl}, ${iterations} runs each`,
    '',
    '| Measurement | Median (ms) | p90 (ms) |',
    '|---|---|---|',
    row('node -e "" (Node startup alone)', results.nodeStartup),
    row('httpi --help (httpi startup)', results.httpiHelp),
    row('curl, 1 request', results.curlOneRequest),
    row('httpi run, 1 request with 2 asserts', results.httpiOneRequest),
    row('curl, 10 requests (10 processes)', results.curlTenRequests),
    row('httpi run, 10 requests in one file', results.httpiTenRequests),
    '',
  ].join('\n'));
}
