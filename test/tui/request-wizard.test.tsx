import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, render } from 'ink-testing-library';
import { RequestWizard } from '../../src/tui/request-wizard.js';

afterEach(cleanup);
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
