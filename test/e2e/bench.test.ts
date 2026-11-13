import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { assertCliIsBuilt } from './helpers.js';

const script = fileURLToPath(new URL('../../scripts/bench.mjs', import.meta.url));

test('the benchmark script measures httpi against curl and reports every measurement', async () => {
  assertCliIsBuilt();
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, [script, '--iterations', '2', '--json'], { stdio: ['ignore', 'pipe', 'inherit'] });
    let text = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (text += chunk));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(text) : reject(new Error(`bench exited with ${code}`))));
  });
  const results = JSON.parse(output) as Record<string, { medianMs: number; p90Ms: number }> & { environment: { iterations: number } };
  expect(results.environment.iterations).toBe(2);
  for (const key of ['nodeStartup', 'httpiHelp', 'curlOneRequest', 'httpiOneRequest', 'curlTenRequests', 'httpiTenRequests']) {
    expect(results[key]!.medianMs).toBeGreaterThanOrEqual(0);
    expect(results[key]!.p90Ms).toBeGreaterThanOrEqual(results[key]!.medianMs);
  }
}, 60_000);
