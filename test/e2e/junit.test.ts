import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { httpi } from './helpers.js';

test('JUnit reporter preserves exit 0/1/2/3 and emits XML only on stdout', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'junit-e2e-'));
  const server = createServer((_req, res) => { res.writeHead(200); res.end('ok'); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const closed = createServer();
  await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
  const closedUrl = `http://127.0.0.1:${(closed.address() as AddressInfo).port}`;
  await new Promise((resolve) => closed.close(resolve));
  try {
    for (const [name, request, expected, code] of [
      ['pass', { url }, { status: 200 }, 0], ['fail', { url }, { status: 201 }, 1],
      ['network', { url: closedUrl }, {}, 3],
    ] as const) {
      const file = join(dir, `${name}.json`);
      await writeFile(file, JSON.stringify({ version: 1, tests: [{ name, request, expect: expected }] }));
      const report = await httpi(['run', file, '--reporter', 'junit']);
      expect(report.code).toBe(code);
      expect(report.stdout).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\n<testsuites/);
      expect(report.stdout).toContain(`name="${name}"`);
      expect(report.stderr).toBe('');
    }
    const invalid = await httpi(['run', join(dir, 'missing.yaml'), '--reporter', 'junit']);
    expect(invalid.code).toBe(2); expect(invalid.stdout).toBe('');
    expect((await httpi(['run', 'missing.yaml', '--reporter', 'html'])).code).toBe(2);
  } finally {
    server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});
