import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { httpi } from './helpers.js';

test('the README example runs against the supplied local API', async () => {
  const server = spawn(process.execPath, [fileURLToPath(new URL('../../examples/server.mjs', import.meta.url))], {
    env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    const url = await new Promise<string>((resolve, reject) => {
      server.once('error', reject);
      server.once('exit', (code) => reject(new Error(`example server exited ${code}`)));
      let output = '';
      server.stdout.setEncoding('utf8').on('data', (chunk: string) => {
        output += chunk;
        const match = /http:\/\/127\.0\.0\.1:\d+/.exec(output);
        if (match) resolve(match[0]);
      });
    });
    const result = await httpi(['run', fileURLToPath(new URL('../../examples/users.yaml', import.meta.url)), '--env', 'dev', '--var', `baseUrl=${url}`]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('1 passed');
    const batch = await httpi(['run', fileURLToPath(new URL('../../examples/requests.yaml', import.meta.url)), '--env', 'dev', '--var', `baseUrl=${url}`, '--show-response']);
    expect(batch.code).toBe(0);
    expect(batch.stdout).toContain('GET /users');
    expect(batch.stdout).toContain('POST /users');
    expect(batch.stdout.indexOf('GET /users')).toBeLessThan(batch.stdout.indexOf('POST /users'));
    expect(batch.stdout).toContain('Response: HTTP 200');
    expect(batch.stdout).toContain('Response: HTTP 201');
    expect(batch.stdout).toContain('"name": "Lucia"');
    expect(batch.stdout).toContain('2 tests: 2 passed');
  } finally { server.kill(); }
});
