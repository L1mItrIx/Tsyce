import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { act } from 'react';
import { cleanup, render } from 'ink-testing-library';
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import { FilePicker } from '../../src/tui/file-picker.js';
import { MouseProvider } from '../../src/tui/mouse-controls.js';
import { clickLabel } from './mouse-helpers.js';

let root: string;

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'file-picker-')));
  await mkdir(join(root, 'data', 'deep'), { recursive: true });
  await mkdir(join(root, '.hidden'));
  for (const file of ['notes.txt', 'users.csv', 'data/rows.json', 'data/deep/more.csv']) await writeFile(join(root, file), '');
});
afterAll(() => rm(root, { recursive: true, force: true }));
afterEach(async () => {
  await act(async () => { cleanup(); });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false });
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 60));

test('the keyboard browses folders and picks a file; only folders and the offered extensions are listed', async () => {
  const select = vi.fn();
  const app = render(<FilePicker startDir={root} extensions={['.csv', '.json']} title="Choose a data file" onSelect={select} onCancel={vi.fn()} />);
  const key = async (value: string) => { app.stdin.write(value); await tick(); };
  await tick();
  const frame = app.lastFrame() ?? '';
  expect(frame).toContain('Choose a data file');
  expect(frame).toContain('Showing folders and .csv, .json files');
  expect(frame).toContain('> ../');
  expect(frame).toContain('  data/');
  expect(frame).toContain('  users.csv');
  expect(frame).not.toContain('notes.txt');
  expect(frame).not.toContain('.hidden');

  await key('\u001B[B'); // data/
  await key('\r');
  expect(app.lastFrame()).toContain(join(root, 'data'));
  expect(app.lastFrame()).toContain('  rows.json');
  await key('\u001B[D'); // back to the parent folder
  expect(app.lastFrame()).not.toContain('rows.json');
  await key('\u001B[B'); await key('\u001B[B'); // users.csv
  await key('\r');
  await vi.waitFor(() => expect(select).toHaveBeenCalledOnce());
  expect(select).toHaveBeenCalledWith(join(root, 'users.csv'));
});

test('without extensions every file is offered; Escape cancels', async () => {
  const cancel = vi.fn();
  const select = vi.fn();
  const app = render(<FilePicker startDir={root} title="Choose a file" onSelect={select} onCancel={cancel} />);
  await tick();
  expect(app.lastFrame()).toContain('notes.txt');
  expect(app.lastFrame()).not.toContain('Showing folders and');
  app.stdin.write('\u001B');
  await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
  expect(select).not.toHaveBeenCalled();
});

test('the mouse opens folders and picks files', async () => {
  const select = vi.fn();
  const app = render(<MouseProvider><FilePicker startDir={root} extensions={['.csv']} title="Pick" onSelect={select} onCancel={vi.fn()} /></MouseProvider>);
  await tick();
  await clickLabel(app, 'data/');
  await tick();
  await clickLabel(app, 'deep/');
  await tick();
  await clickLabel(app, 'more.csv');
  await vi.waitFor(() => expect(select).toHaveBeenCalledWith(join(root, 'data', 'deep', 'more.csv')));
});

test('a folder that cannot be read says so and still lets you go back', async () => {
  const app = render(<FilePicker startDir={join(root, 'missing')} title="Pick" onSelect={vi.fn()} onCancel={vi.fn()} />);
  await tick();
  expect(app.lastFrame()).toContain('Cannot read this folder: ENOENT');
  app.stdin.write('\r');
  await tick();
  expect(app.lastFrame()).toContain('users.csv');
});
