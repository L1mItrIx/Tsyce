import { afterEach, expect, test, vi } from 'vitest';
import { act } from 'react';
import { cleanup, render } from 'ink-testing-library';
import { RequestWizard } from '../../src/tui/request-wizard.js';

afterEach(async () => {
  await act(async () => { cleanup(); });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false });
});
const tick = () => new Promise((resolve) => setTimeout(resolve, 50));

test('keyboard edits the request and requires confirmation before handing it off', async () => {
  const complete = vi.fn();
  const app = render(<RequestWizard onComplete={complete} onCancel={vi.fn()} />);
  const key = async (value: string) => { app.stdin.write(value); await tick(); };
  await tick();
  expect(app.lastFrame()).toContain('Method');
  await key('POST'); await key('\r');
  await key('bad-url'); await key('\r');
  expect(app.lastFrame()).toContain('complete http:// or https:// URL');
  for (let i = 0; i < 7; i++) await key('\u007f');
  await key('https://example.test/users'); await key('\r');
  await key('X-Test: first'); await key('\r'); await key('Content-Type: application/json'); await key('\t');
  await key('{"name":"Ana"}'); await key('\t');
  expect(app.lastFrame()).toContain('Confirm request');
  expect(complete).not.toHaveBeenCalled();
  await key('\r');
  expect(complete).toHaveBeenCalledExactlyOnceWith({ method: 'POST', url: 'https://example.test/users',
    headers: { 'X-Test': 'first', 'Content-Type': 'application/json' }, body: { text: '{"name":"Ana"}' } });
});

test('Escape goes back and Ctrl+C cancels without handing off a request', async () => {
  const complete = vi.fn();
  const cancel = vi.fn();
  const app = render(<RequestWizard onComplete={complete} onCancel={cancel} />);
  await tick();
  app.stdin.write('\r'); await tick();
  expect(app.lastFrame()).toContain('URL');
  app.stdin.write('\u001b'); await tick();
  expect(app.lastFrame()).toContain('Method');
  app.stdin.write('\u0003'); await tick();
  expect(cancel).toHaveBeenCalledOnce();
  expect(complete).not.toHaveBeenCalled();
});

test('visible method buttons respond to arrows and Enter; the prompt and footer stay separate', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  let app!: ReturnType<typeof render>;
  await act(async () => { app = render(<RequestWizard onComplete={vi.fn()} onCancel={vi.fn()} />); });
  const key = async (value: string) => {
    await act(async () => {});
    await act(async () => { app.stdin.write(value); });
  };
  await act(async () => {});
  expect(app.lastFrame()).toContain('> GET');
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) expect(app.lastFrame()).toContain(method);
  await key('\u001b[C');
  expect(app.lastFrame()).toContain('> POST');
  await key('\r');
  expect(app.lastFrame()).toContain('URL');
  expect(app.lastFrame()).toContain('[POST]');
  await key('\u001b');
  await vi.waitFor(() => expect(app.lastFrame()).toContain('> POST'));
  expect(app.lastFrame()).toContain('Ctrl+C: cancel');
});
