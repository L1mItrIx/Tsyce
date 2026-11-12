import { expect, test } from 'vitest';
import { httpi } from './helpers.js';

test('new refuses non-interactive input with exit 2 instead of hanging', async () => {
  const result = await httpi(['new']);
  expect(result.code).toBe(2);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('interactive terminal');
});

test('new documents the destination and name arguments', async () => {
  const result = await httpi(['new', '--help']);
  expect(result.code).toBe(0);
  expect(result.stdout).toContain('--name');
  expect(result.stdout).toContain('httpi.test.yaml');
  expect(result.stdout).toContain('add requests in order');
});
