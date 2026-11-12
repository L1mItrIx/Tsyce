import { act } from 'react';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanup, render } from 'ink-testing-library';
import { afterEach, expect, test, vi } from 'vitest';
import { SuiteWizard } from '../../src/tui/suite-wizard.js';
import { MouseProvider } from '../../src/tui/mouse-controls.js';
import { detectCurl } from '../../src/core/runner/detect.js';
import { runRequest } from '../../src/core/runner/exec.js';
import { prepareWizardFile, writeTestFile } from '../../src/core/file.js';
import type { TestCase } from '../../src/core/schema.js';
import { clickLabel } from './mouse-helpers.js';
import { httpi } from '../e2e/helpers.js';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(async () => { await act(async () => { cleanup(); }); });

test('two requests can be created, saved and rerun in order with independent authorization', async () => {
  const calls: string[] = [];
  const server = createServer((req, res) => {
    calls.push(`${req.method} ${req.headers.authorization}`);
    res.writeHead(req.method === 'POST' ? 201 : 200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const dir = await mkdtemp(join(tmpdir(), 'suite-wizard-'));
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/users`;
    const curl = await detectCurl(); const done = vi.fn<(tests: TestCase[]) => void>();
    let app!: ReturnType<typeof render>;
    await act(async () => { app = render(<MouseProvider><SuiteWizard sendRequest={(request, signal) => runRequest(curl.bin, request, signal)} onComplete={done} onCancel={vi.fn()} /></MouseProvider>); });
    for (const [method, token] of [['GET', 'FAKE_FIRST'], ['POST', 'FAKE_SECOND']]) {
      if (method === 'POST') await clickLabel(app, 'POST');
      await clickLabel(app, '[ Next ]'); await act(async () => { app.stdin.write(url); });
      await clickLabel(app, '[ Next ]'); await act(async () => { app.stdin.write(`Authorization: Bearer ${token}`); });
      await clickLabel(app, '[ Next ]'); await clickLabel(app, '[ No body ]'); await clickLabel(app, '[ Send request ]');
      await vi.waitFor(() => expect(app.lastFrame()).toContain('Choose assertions'));
      await clickLabel(app, '[ Add request ]');
      expect(done).not.toHaveBeenCalled();
      if (method === 'GET') await clickLabel(app, '[ Add another request ]');
    }
    expect(app.lastFrame()).toContain('2 requests ready');
    expect(calls).toEqual(['GET Bearer FAKE_FIRST', 'POST Bearer FAKE_SECOND']);
    await clickLabel(app, '[ Save file ]'); await clickLabel(app, '[ Save file ]');
    expect(done).toHaveBeenCalledOnce();
    const { file } = prepareWizardFile(done.mock.calls[0]![0], 'Flow');
    const path = join(dir, 'flow.yaml'); await writeTestFile(path, file);
    const run = await httpi(['run', path, '--var', 'token=FAKE_FIRST', '--var', 'token2=FAKE_SECOND']);
    expect(run.code).toBe(0); expect(run.stdout).toContain('2 tests: 2 passed');
    expect(calls).toEqual(['GET Bearer FAKE_FIRST', 'POST Bearer FAKE_SECOND', 'GET Bearer FAKE_FIRST', 'POST Bearer FAKE_SECOND']);
    await act(async () => { app.unmount(); });
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await rm(dir, { recursive: true, force: true }); }
});

test('cancelling a later request returns to the suite and preserves the earlier request', async () => {
  const done = vi.fn(); const cancel = vi.fn();
  let app!: ReturnType<typeof render>;
  await act(async () => { app = render(<MouseProvider><SuiteWizard sendRequest={async () => ({ status: 200, timeMs: 1, headers: {}, body: '', error: null, curlExitCode: 0 })} onComplete={done} onCancel={cancel} /></MouseProvider>); });
  await clickLabel(app, '[ Next ]'); await act(async () => { app.stdin.write('https://example.test'); });
  await clickLabel(app, '[ Next ]'); await clickLabel(app, '[ Skip headers ]'); await clickLabel(app, '[ No body ]');
  await clickLabel(app, '[ Send request ]'); await vi.waitFor(() => expect(app.lastFrame()).toContain('Choose assertions'));
  await clickLabel(app, '[ Add request ]');
  await act(async () => { app.stdin.write('a'); });
  await clickLabel(app, '[ Cancel ]');
  expect(cancel).not.toHaveBeenCalled(); expect(app.lastFrame()).toContain('1 request ready');
  await act(async () => { app.stdin.write('\r'); });
  expect(done).toHaveBeenCalledOnce(); expect(done.mock.calls[0]![0]).toHaveLength(1);
});

test('a token selected from the live login response is reused immediately and recaptured during replay', async () => {
  let issued = 0; let token = ''; const protectedTokens: string[] = [];
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/login') { token = `SECRET_LIVE_${++issued}`; res.end(JSON.stringify({ access_token: token })); }
    else { protectedTokens.push(req.headers.authorization!); res.writeHead(req.headers.authorization === `Bearer ${token}` ? 200 : 401); res.end(JSON.stringify({ authorization: req.headers.authorization })); }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const dir = await mkdtemp(join(tmpdir(), 'live-token-'));
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const curl = await detectCurl(); const done = vi.fn<(tests: TestCase[]) => void>();
    let app!: ReturnType<typeof render>;
    await act(async () => { app = render(<MouseProvider><SuiteWizard sendRequest={(request, signal) => runRequest(curl.bin, request, signal)} onComplete={done} onCancel={vi.fn()} /></MouseProvider>); });
    await clickLabel(app, 'POST'); await clickLabel(app, '[ Next ]');
    await act(async () => { app.stdin.write(`${url}/login`); });
    await clickLabel(app, '[ Next ]'); await clickLabel(app, '[ Skip headers ]'); await clickLabel(app, '[ No body ]'); await clickLabel(app, '[ Send request ]');
    await vi.waitFor(() => expect(app.lastFrame()).toContain('[ Use response token ]'));
    expect(app.frames.join('\n')).not.toContain('SECRET_LIVE_');
    await clickLabel(app, '[ Use response token ]'); await clickLabel(app, '$["access_token"]');
    expect(app.lastFrame()).toContain('value hidden');
    await clickLabel(app, '[ Add request ]'); await clickLabel(app, '[ Add another request ]'); await clickLabel(app, '[ Next ]');
    await act(async () => { app.stdin.write(`${url}/private`); });
    await clickLabel(app, '[ Next ]'); await clickLabel(app, '[ Use captured token ]');
    expect(app.lastFrame()).toContain('Bearer {{authToken}}');
    await clickLabel(app, '[ Next ]'); await clickLabel(app, '[ No body ]'); await clickLabel(app, '[ Send request ]');
    await vi.waitFor(() => expect(app.lastFrame()).toContain('Choose assertions'));
    await clickLabel(app, '[ Add request ]'); await clickLabel(app, '[ Save file ]');
    expect(protectedTokens).toEqual(['Bearer SECRET_LIVE_1']);
    const { file } = prepareWizardFile(done.mock.calls[0]![0]);
    const path = join(dir, 'auth.yaml'); await writeTestFile(path, file);
    const saved = await readFile(path, 'utf8');
    expect(saved).toContain('capture:'); expect(saved).not.toContain('SECRET_LIVE_');
    expect(app.frames.join('\n')).not.toContain('SECRET_LIVE_');
    const run = await httpi(['run', path, '--show-response']);
    expect(run.code).toBe(0); expect(run.stdout + run.stderr).not.toContain('SECRET_LIVE_');
    expect(protectedTokens).toEqual(['Bearer SECRET_LIVE_1', 'Bearer SECRET_LIVE_2']);
    await act(async () => { app.unmount(); });
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await rm(dir, { recursive: true, force: true }); }
});
