import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, render } from 'ink-testing-library';
import { NewWizard } from '../../src/tui/new-wizard.js';
import { runRequest } from '../../src/core/runner/exec.js';
import { detectCurl } from '../../src/core/runner/detect.js';
import { checkExpectations } from '../../src/core/asserts.js';
import type { RequestSpec, Expect } from '../../src/core/schema.js';

afterEach(cleanup);
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
    const key = async (input: string) => { app.stdin.write(input); await tick(); };
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
  const key = async (input: string) => { app.stdin.write(input); await tick(); };
  await tick(); await key('\r'); await key('http://example.test'); await key('\r'); await key('\t'); await key('\t'); await key('\r');
  await vi.waitFor(() => expect(app.lastFrame()).toContain('connection refused'));
  expect(complete).not.toHaveBeenCalled();
  await key('\u0003');
  await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
  expect(signal?.aborted).toBe(true);
});
