import { spawn } from 'node:child_process';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
    const auth = await httpi(['run', fileURLToPath(new URL('../../examples/auth.yaml', import.meta.url)), '--env', 'dev', '--var', `baseUrl=${url}`, '--show-response']);
    expect(auth.code).toBe(0); expect(auth.stdout).toContain('2 tests: 2 passed');
    expect(auth.stdout).not.toContain('demo_token_');

    // The complete project, copied so that its report is not written into the repository.
    const project = await mkdtemp(join(tmpdir(), 'example-project-'));
    try {
      await cp(fileURLToPath(new URL('../../examples/proyecto', import.meta.url)), project, { recursive: true });
      const env = { DEMO_CLIENT_SECRET: 'demo-secret' };
      const valid = await httpi(['validate', '--var', `baseUrl=${url}`], { cwd: project, env });
      expect(valid.stdout).toBe('valid: 3 files, 4 tests; no requests were sent\n');
      const whole = await httpi(['run', '--var', `baseUrl=${url}`], { cwd: project, env });
      expect(whole.stderr).toBe('');
      expect(whole.stdout).toContain('Alta de usuario [row 3]\n\n✓ Crear a Pérez, María (201,');
      expect(whole.stdout).toContain('✓ Estadísticas con el token OAuth (200,');
      expect(whole.stdout).toContain('5 files, 8 tests: 8 passed');
      expect(whole.stdout).not.toContain('oauth_demo_');
      expect(whole.code).toBe(0);
      expect(await readFile(join(project, 'reports', 'junit.xml'), 'utf8')).toContain('<testsuites tests="8" failures="0" errors="0"');

      const wrongSecret = await httpi(['run', '--var', `baseUrl=${url}`], { cwd: project, env: { DEMO_CLIENT_SECRET: 'nope' } });
      expect(wrongSecret.stderr).toContain('auth "demo": the token endpoint answered 401 (invalid_client: Use demo-client / demo-secret)');
      expect(wrongSecret.code).toBe(3);
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  } finally { server.kill(); }
});
