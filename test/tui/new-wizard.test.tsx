import { createServer, type Server } from 'node:http';
import { act } from 'react';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, render } from 'ink-testing-library';
import { NewWizard } from '../../src/tui/new-wizard.js';
import { runRequest } from '../../src/core/runner/exec.js';
import { detectCurl } from '../../src/core/runner/detect.js';
import { checkExpectations } from '../../src/core/asserts.js';
import type { RequestSpec, Expect } from '../../src/core/schema.js';
import { MouseProvider } from '../../src/tui/mouse-controls.js';
import { clickLabel } from './mouse-helpers.js';

afterEach(cleanup);
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const tick = () => new Promise((resolve) => setTimeout(resolve, 50));

test('confirmed request runs real curl, then selection produces passing assertions', async () => {
  let server: Server;
  let calls = 0;
  server = createServer((_req, res) => { calls++; res.writeHead(201, { 'Content-Type': 'application/json' }); res.end('{"id":3}'); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const curl = await detectCurl();
    const done = vi.fn<(request: RequestSpec, expected: Expect) => void>();
    const app = render(<NewWizard sendRequest={(request, signal) => runRequest(curl.bin, request, signal)} onComplete={done} onCancel={vi.fn()} />);
    const key = async (input: string) => {
      // A visible Ink frame precedes passive input effects. Flush them before typing.
      await act(async () => {});
      await act(async () => { app.stdin.write(input); });
    };
    await tick(); await key('\r');
    await key(`http://127.0.0.1:${(server.address() as AddressInfo).port}/test`); await key('\r');
    await key('\t'); await key('\t');
    expect(calls).toBe(0);
    await key('\r');
    await vi.waitFor(() => expect(app.lastFrame()).toContain('Choose assertions'));
    expect(calls).toBe(1);
    await key('\r');
    await vi.waitFor(() => expect(done).toHaveBeenCalledOnce());
    const [request, expected] = done.mock.calls[0]!;
    expect(expected.status).toBe(201);
    const response = await runRequest(curl.bin, request);
    expect(checkExpectations(expected, response).every((assert) => assert.ok)).toBe(true);
  } finally {
    server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
  }
});

test('network failure offers retry/edit rather than saving assertions; Ctrl+C aborts running work', async () => {
  const complete = vi.fn(); const cancel = vi.fn(); let signal: AbortSignal | undefined;
  const send = vi.fn(async (_request: RequestSpec, currentSignal: AbortSignal) => {
    signal = currentSignal;
    return { status: 0, timeMs: 1, headers: {}, body: '', curlExitCode: 7, error: 'connection refused' };
  });
  const app = render(<NewWizard sendRequest={send} onComplete={complete} onCancel={cancel} />);
  const key = async (input: string) => {
    await act(async () => {});
    await act(async () => { app.stdin.write(input); });
  };
  await tick(); await key('\r'); await key('http://example.test'); await key('\r'); await key('\t'); await key('\t'); await key('\r');
  await vi.waitFor(() => expect(app.lastFrame()).toContain('connection refused'));
  expect(complete).not.toHaveBeenCalled();
  await key('\u0003');
  await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
  expect(signal?.aborted).toBe(true);
});

test('mouse retry cannot send duplicate requests and mouse Cancel aborts the active retry', async () => {
  const failure = { status: 0, timeMs: 1, headers: {}, body: '', curlExitCode: 7, error: 'connection refused' };
  const cancel = vi.fn(); let activeSignal: AbortSignal | undefined;
  const send = vi.fn((_request: RequestSpec, signal: AbortSignal) => {
    if (send.mock.calls.length === 1) return Promise.resolve(failure);
    activeSignal = signal;
    return new Promise<typeof failure>((resolve) => { signal.addEventListener('abort', () => resolve(failure), { once: true }); });
  });
  let app!: ReturnType<typeof render>;
  await act(async () => { app = render(<MouseProvider><NewWizard sendRequest={send} onComplete={vi.fn()} onCancel={cancel} /></MouseProvider>); });
  await clickLabel(app, '[ Next ]');
  await act(async () => { app.stdin.write('http://example.test'); });
  await clickLabel(app, '[ Next ]'); await clickLabel(app, '[ Skip headers ]'); await clickLabel(app, '[ No body ]');
  await clickLabel(app, '[ Send request ]');
  await vi.waitFor(() => expect(app.lastFrame()).toContain('[ Retry ]'));
  const lines = app.lastFrame()!.split('\n');
  const row = lines.findIndex((line) => line.includes('[ Retry ]'));
  const col = lines[row]!.indexOf('[ Retry ]');
  await act(async () => { app.stdin.write(`\u001b[<0;${col + 1};${row + 1}M`.repeat(2)); });
  expect(send).toHaveBeenCalledTimes(2);
  await clickLabel(app, '[ Cancel ]');
  expect(cancel).toHaveBeenCalledOnce();
  expect(activeSignal?.aborted).toBe(true);
  await act(async () => { app.unmount(); });
});
