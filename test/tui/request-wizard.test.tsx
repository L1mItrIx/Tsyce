import { afterEach, expect, test, vi } from 'vitest';
import { act } from 'react';
import { cleanup, render } from 'ink-testing-library';
import { RequestWizard } from '../../src/tui/request-wizard.js';
import { MouseProvider } from '../../src/tui/mouse-controls.js';
import { clickLabel } from './mouse-helpers.js';

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

test('mouse selects a method, skips optional fields and requires a separate send click', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const done = vi.fn();
  let app!: ReturnType<typeof render>;
  await act(async () => { app = render(<MouseProvider><RequestWizard onComplete={done} onCancel={vi.fn()} /></MouseProvider>); });
  await clickLabel(app, 'POST');
  expect(app.lastFrame()).toContain('[POST]');
  expect(done).not.toHaveBeenCalled();
  await clickLabel(app, '[ Next ]');
  await act(async () => { app.stdin.write('https://example.test/users'); });
  await clickLabel(app, '[ Next ]');
  expect(app.lastFrame()).toContain('Headers are optional metadata');
  await clickLabel(app, '[ Skip headers ]');
  expect(app.lastFrame()).toContain('The body is data sent to the API');
  await clickLabel(app, '[ No body ]');
  expect(done).not.toHaveBeenCalled();
  await clickLabel(app, '[ Send request ]');
  expect(done).toHaveBeenCalledExactlyOnceWith({ method: 'POST', url: 'https://example.test/users', headers: {} });
});

test('mouse JSON presets generate a usable content type and body; Back and Cancel are clickable', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const done = vi.fn(); const cancel = vi.fn();
  let app!: ReturnType<typeof render>;
  await act(async () => { app = render(<MouseProvider><RequestWizard onComplete={done} onCancel={cancel} /></MouseProvider>); });
  await clickLabel(app, 'POST'); await clickLabel(app, '[ Next ]');
  await act(async () => { app.stdin.write('https://example.test/users'); });
  await clickLabel(app, '[ Next ]'); await clickLabel(app, '[ Add JSON header ]');
  expect(app.lastFrame()).toContain('Content-Type: application/json');
  await clickLabel(app, '[ Next ]'); await clickLabel(app, '[ Use JSON example ]');
  expect(app.lastFrame()).toContain('"name": "Ana"');
  await clickLabel(app, '[ Next ]'); await clickLabel(app, '[ Back ]');
  expect(app.lastFrame()).toContain('"name": "Ana"');
  await clickLabel(app, '[ Next ]'); await clickLabel(app, '[ Send request ]');
  expect(done).toHaveBeenCalledExactlyOnceWith({ method: 'POST', url: 'https://example.test/users', headers: { 'Content-Type': 'application/json' }, body: { text: '{\n  "name": "Ana"\n}' } });
  await act(async () => { app.unmount(); });
  await act(async () => { app = render(<MouseProvider><RequestWizard onComplete={done} onCancel={cancel} /></MouseProvider>); });
  await clickLabel(app, '[ Cancel ]'); expect(cancel).toHaveBeenCalledOnce();
});
