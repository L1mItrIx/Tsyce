import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';

test('npm distribution contains the complete runtime, schema and examples without source or test artifacts', async () => {
  const npm = process.env.npm_execpath;
  if (!npm) throw new Error('Run this test through npm run check so npm_execpath is available.');
  // Inventory only: lifecycle scripts would recurse into this test via prepack -> check.
  const { stdout } = await promisify(execFile)(process.execPath, [npm, 'pack', '--dry-run', '--json', '--ignore-scripts']);
  const [pack] = JSON.parse(stdout) as { name: string; files: { path: string; mode: number }[] }[];
  expect(pack!.name).toBe('httpi-cli');
  const files = pack!.files.map((file) => file.path);
  expect(files).toContain('dist/cli.js');
  expect(files).toContain('dist/tui/new-wizard.js');
  expect(files).toContain('dist/core/reporter/junit.js');
  expect(files).toContain('schema/httpi.schema.json');
  expect(files).toContain('schema/httpi.project.schema.json');
  expect(files).toContain('examples/users.yaml');
  expect(files).toContain('README.md');
  expect(files.some((path) => /^(src|test|node_modules|\.claude|\.git)\//.test(path))).toBe(false);
});
