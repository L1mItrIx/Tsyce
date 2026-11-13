import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { act } from 'react';
import { cleanup, render } from 'ink-testing-library';
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import type { RunResult } from '../../src/core/runner/exec.js';
import type { RequestSpec } from '../../src/core/schema.js';
import { MouseProvider } from '../../src/tui/mouse-controls.js';
import { RequestWizard } from '../../src/tui/request-wizard.js';
import { SuiteWizard } from '../../src/tui/suite-wizard.js';
import { clickLabel } from './mouse-helpers.js';

let root: string;

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'wizard-files-')));
  await mkdir(join(root, 'data'));
  await mkdir(join(root, 'uploads'));
  await writeFile(join(root, 'data', 'users.csv'), 'name\nAna\nLuis\n');
  await writeFile(join(root, 'data', 'broken.csv'), 'name\n"open\n');
  await writeFile(join(root, 'uploads', 'avatar.png'), 'png');
});
afterAll(() => rm(root, { recursive: true, force: true }));
afterEach(async () => {
  await act(async () => { cleanup(); });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false });
});
const tick = () => new Promise((resolve) => setTimeout(resolve, 60));

async function toBody(app: ReturnType<typeof render>, url: string) {
  await tick();
  await clickLabel(app, 'POST'); await clickLabel(app, '[ Next ]');
  app.stdin.write(url); await tick();
  await clickLabel(app, '[ Next ]'); await clickLabel(app, '[ Skip headers ]');
}

test('Attach a file opens the picker in the YAML folder and sends the file as multipart, relative to the YAML', async () => {
  const complete = vi.fn();
  const app = render(<MouseProvider><RequestWizard baseDir={root} onComplete={complete} onCancel={vi.fn()} /></MouseProvider>);
  await toBody(app, 'https://api.example/upload');
  await clickLabel(app, '[ Attach a file ]');
  await tick();
  expect(app.lastFrame()).toContain('Choose the file to upload');
  await clickLabel(app, 'uploads/'); await tick();
  await clickLabel(app, 'avatar.png'); await tick();
  expect(app.lastFrame()).toContain('Body: multipart form (file=@uploads/avatar.png)');
  await clickLabel(app, '[ Send request ]');
  expect(complete).toHaveBeenCalledExactlyOnceWith({ method: 'POST', url: 'https://api.example/upload', headers: {}, body: { form: ['file=@uploads/avatar.png'] } });
});

test('Ctrl+O opens the picker from the body step and Escape returns to it', async () => {
  const app = render(<MouseProvider><RequestWizard baseDir={root} onComplete={vi.fn()} onCancel={vi.fn()} /></MouseProvider>);
  await toBody(app, 'https://api.example/upload');
  app.stdin.write('\u000F'); await tick();
  expect(app.lastFrame()).toContain('Choose the file to upload');
  app.stdin.write('\u001B'); await tick();
  expect(app.lastFrame()).toContain('Body (literal text; empty for none)');
});

const ok = (status = 200): RunResult => ({ status, timeMs: 1, headers: { 'content-type': ['application/json'] }, body: '{"ok":true}', curlExitCode: 0, error: null });

test('a data file chosen at the review fills {{data.*}} with its first row for the live request and is saved on the test', async () => {
  const send = vi.fn(async (_request: RequestSpec, _signal: AbortSignal, _data?: string) => ok());
  const complete = vi.fn();
  const app = render(<MouseProvider><SuiteWizard baseDir={root} sendRequest={send} onComplete={complete} onCancel={vi.fn()} /></MouseProvider>);
  await tick();
  await clickLabel(app, '[ Next ]');
  app.stdin.write('https://api.example/users/{{data.name}}'); await tick();
  await clickLabel(app, '[ Next ]'); await clickLabel(app, '[ Skip headers ]'); await clickLabel(app, '[ No body ]');
  app.stdin.write('d'); await tick();
  expect(app.lastFrame()).toContain('Choose a CSV or JSON data file');
  expect(app.lastFrame()).not.toContain('uploads/avatar.png');
  await clickLabel(app, 'data/'); await tick();
  await clickLabel(app, 'users.csv'); await tick();
  expect(app.lastFrame()).toContain('Data: data/users.csv (runs once per row; the first row is used now)');
  await clickLabel(app, '[ Send request ]');
  await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
  expect(send.mock.calls[0]![0]).toMatchObject({ url: 'https://api.example/users/Ana' });
  await vi.waitFor(() => expect(app.lastFrame()).toContain('Add request'));
  await clickLabel(app, '[ Add request ]');
  await vi.waitFor(() => expect(app.lastFrame()).toContain('1 request ready'));
  await clickLabel(app, '[ Save file ]');
  await vi.waitFor(() => expect(complete).toHaveBeenCalledOnce());
  expect(complete.mock.calls[0]![0][0]).toMatchObject({ request: { url: 'https://api.example/users/{{data.name}}' }, data: 'data/users.csv' });
});

test('a data file that cannot be read is shown as an error to fix, not a crash', async () => {
  const send = vi.fn(async () => ok());
  const failed = vi.fn();
  const app = render(<MouseProvider><SuiteWizard baseDir={root} sendRequest={send} onComplete={vi.fn()} onCancel={vi.fn()} onError={failed} /></MouseProvider>);
  await tick();
  await clickLabel(app, '[ Next ]');
  app.stdin.write('https://api.example/{{data.name}}'); await tick();
  await clickLabel(app, '[ Next ]'); await clickLabel(app, '[ Skip headers ]'); await clickLabel(app, '[ No body ]');
  app.stdin.write('d'); await tick();
  await clickLabel(app, 'data/'); await tick();
  await clickLabel(app, 'broken.csv'); await tick();
  await clickLabel(app, '[ Send request ]');
  await vi.waitFor(() => expect(app.lastFrame()).toContain('data/broken.csv:2: a quoted field is never closed'));
  expect(app.lastFrame()).not.toContain(root);
  expect(send).not.toHaveBeenCalled();
  expect(failed).not.toHaveBeenCalled();
});
