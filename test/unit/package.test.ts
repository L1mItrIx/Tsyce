import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const pkg = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;

test('package is ESM, targets Node >= 22 and exposes the httpi bin', () => {
  expect(pkg.type).toBe('module');
  expect(pkg.engines).toEqual({ node: '>=22' });
  expect(pkg.bin).toEqual({ httpi: 'dist/cli.js' });
  expect(pkg.files).toEqual(['dist', 'schema', 'examples']);
});

test('release uses the selected npm name and verifies the source before packing', () => {
  expect(pkg.name).toBe('httpi-cli');
  expect(pkg.version).toBe('0.1.0');
  expect(pkg.private).not.toBe(true);
  expect((pkg.scripts as Record<string, string>).prepack).toBe('npm run check');
});

test('check runs typecheck, build and tests (e2e tests need dist/)', () => {
  const scripts = pkg.scripts as Record<string, string>;
  expect(scripts.check).toBe('npm run typecheck && npm run build && npm run test');
});
