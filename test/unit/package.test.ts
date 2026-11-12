import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const pkg = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;

test('package is ESM, targets Node >= 22 and exposes the httpi bin', () => {
  expect(pkg.type).toBe('module');
  expect(pkg.engines).toEqual({ node: '>=22' });
  expect(pkg.bin).toEqual({ httpi: 'dist/cli.js' });
  expect(pkg.files).toEqual(['dist']);
});

test('check runs typecheck, tests and build', () => {
  const scripts = pkg.scripts as Record<string, string>;
  expect(scripts.check).toBe('npm run typecheck && npm run test && npm run build');
});
