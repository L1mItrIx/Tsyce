import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, render } from 'ink-testing-library';
import { AssertionMenu } from '../../src/tui/assertion-menu.js';
import { act } from 'react';
import { MouseProvider } from '../../src/tui/mouse-controls.js';
import { clickLabel } from './mouse-helpers.js';

afterEach(cleanup);
const tick = () => new Promise((resolve) => setTimeout(resolve, 50));

test('selects status by default, toggles another assert and accepts a custom time limit', async () => {
  const done = vi.fn();
  const app = render(<AssertionMenu result={{ status: 200, timeMs: 11, headers: {}, body: '{}', error: null, curlExitCode: 0 }} onComplete={done} onCancel={vi.fn()} />);
  const key = async (value: string) => { app.stdin.write(value); await tick(); };
  await tick();
  expect(app.lastFrame()).toContain('[x] Status = 200');
  await key('\u001b[B'); await key(' ');
  await key('t'); await key('bad'); await key('\r');
  expect(app.lastFrame()).toContain('positive number');
  for (let i = 0; i < 3; i++) await key('\u007f');
  await key('800'); await key('\r'); await key('\r');
  expect(done).toHaveBeenCalledExactlyOnceWith({ status: 200, maxTimeMs: 800 });
});

test('Ctrl+C cancels selection', async () => {
  const cancel = vi.fn();
  const app = render(<AssertionMenu result={{ status: 200, timeMs: 1, headers: {}, body: '', error: null, curlExitCode: 0 }} onComplete={vi.fn()} onCancel={cancel} />);
  await tick(); app.stdin.write('\u0003'); await tick();
  expect(cancel).toHaveBeenCalledOnce();
});

test('mouse toggles assertions, configures a time limit and saves only once', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const done = vi.fn();
  let app!: ReturnType<typeof render>;
  await act(async () => { app = render(<MouseProvider><AssertionMenu result={{ status: 200, timeMs: 11, headers: {}, body: '{}', error: null, curlExitCode: 0 }} onComplete={done} onCancel={vi.fn()} /></MouseProvider>); });
  await clickLabel(app, 'Time <=');
  expect(app.lastFrame()).toContain('[x] Time <=');
  await clickLabel(app, '[ Time limit ]');
  await clickLabel(app, '[ Save test ]'); expect(done).not.toHaveBeenCalled();
  await act(async () => { app.stdin.write('800'); });
  await clickLabel(app, '[ Apply time ]'); await clickLabel(app, '[ Save test ]'); await clickLabel(app, '[ Save test ]');
  expect(done).toHaveBeenCalledExactlyOnceWith({ status: 200, maxTimeMs: 800 });
  await act(async () => { cleanup(); });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false });
});
