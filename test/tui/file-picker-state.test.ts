import { join, parse, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { createPickerState, pathForYaml, type PickerAction, pickerEntries, pickerReducer, type PickerState } from '../../src/tui/file-picker-state.js';

const root = parse(process.cwd()).root;
const base = resolve(root, 'work', 'api');
const listing = [
  { name: 'users.csv', isDirectory: false },
  { name: 'tests', isDirectory: true },
  { name: 'Avatar.PNG', isDirectory: false },
  { name: '.git', isDirectory: true },
  { name: '.env', isDirectory: false },
  { name: 'data', isDirectory: true },
  { name: 'README.md', isDirectory: false },
];
const names = (state: PickerState) => state.entries.map((entry) => `${entry.kind}:${entry.name}`);
const run = (state: PickerState, ...actions: PickerAction[]) => actions.reduce(pickerReducer, state);
const loaded = (dir: string, entries = listing): PickerAction => ({ type: 'loaded', dir, names: entries });

describe('pickerEntries', () => {
  test('.. first, then folders, then files, each sorted without regard to case; hidden entries left out', () => {
    expect(pickerEntries(base, listing, []).map((entry) => `${entry.kind}:${entry.name}`)).toEqual([
      'parent:..', 'dir:data', 'dir:tests', 'file:Avatar.PNG', 'file:README.md', 'file:users.csv',
    ]);
  });

  test('extensions limit the files, ignoring case, but never the folders', () => {
    expect(pickerEntries(base, listing, ['.csv', '.png']).map((entry) => entry.name)).toEqual(['..', 'data', 'tests', 'Avatar.PNG', 'users.csv']);
  });

  test('there is no .. at the root of the file system', () => {
    expect(pickerEntries(root, listing, ['.csv']).map((entry) => entry.name)).toEqual(['data', 'tests', 'users.csv']);
  });
});

describe('pickerReducer', () => {
  const start = () => run(createPickerState(base, ['.CSV', '.json']), loaded(base));

  test('starts loading the start directory and lists it once loaded', () => {
    const initial = createPickerState(base, ['.CSV']);
    expect(initial).toMatchObject({ dir: base, status: 'loading', extensions: ['.csv'] });
    expect(names(start())).toEqual(['parent:..', 'dir:data', 'dir:tests', 'file:users.csv']);
    expect(start().status).toBe('ready');
  });

  test('moving stays inside the list', () => {
    expect(run(start(), { type: 'move', delta: 2 }).cursor).toBe(2);
    expect(run(start(), { type: 'move', delta: 99 }).cursor).toBe(3);
    expect(run(start(), { type: 'move', delta: -5 }).cursor).toBe(0);
  });

  test('opening a folder loads it; .. and up go to the parent', () => {
    const inData = run(start(), { type: 'move', delta: 1 }, { type: 'open' });
    expect(inData).toMatchObject({ dir: join(base, 'data'), status: 'loading', cursor: 0, entries: [] });
    const listed = run(inData, loaded(join(base, 'data'), [{ name: 'rows.json', isDirectory: false }]));
    expect(names(listed)).toEqual(['parent:..', 'file:rows.json']);
    expect(run(listed, { type: 'open' }).dir).toBe(base);
    expect(run(listed, { type: 'up' }).dir).toBe(base);
  });

  test('opening a file selects it by its absolute path; a click opens the entry it hits', () => {
    expect(run(start(), { type: 'open', index: 3 })).toMatchObject({ status: 'selected', selected: join(base, 'users.csv'), cursor: 3 });
    const selected = run(start(), { type: 'open', index: 3 });
    expect(run(selected, { type: 'move', delta: -1 }, { type: 'cancel' })).toBe(selected);
  });

  test('an answer for a directory already left is ignored', () => {
    const moved = run(start(), { type: 'open', index: 1 });
    expect(run(moved, loaded(base))).toBe(moved);
    expect(run(moved, { type: 'failed', dir: base, message: 'nope' })).toBe(moved);
  });

  test('a directory that cannot be read shows the error and the way back up', () => {
    const failed = run(start(), { type: 'open', index: 2 }, { type: 'failed', dir: join(base, 'tests'), message: 'EACCES: permission denied' });
    expect(failed).toMatchObject({ status: 'ready', error: 'EACCES: permission denied' });
    expect(names(failed)).toEqual(['parent:..']);
    expect(run(failed, { type: 'open' })).toMatchObject({ dir: base, error: null, status: 'loading' });
  });

  test('nothing happens at the root when going up, while loading, or on an empty list', () => {
    const atRoot = run(createPickerState(root), loaded(root, []));
    expect(run(atRoot, { type: 'up' })).toBe(atRoot);
    expect(run(atRoot, { type: 'open' })).toBe(atRoot);
    expect(run(atRoot, { type: 'move', delta: 1 })).toBe(atRoot);
    const loading = createPickerState(base);
    expect(run(loading, { type: 'open' }, { type: 'move', delta: 1 }, { type: 'up' })).toBe(loading);
  });

  test('cancel ends the picker', () => {
    expect(run(start(), { type: 'cancel' }).status).toBe('cancelled');
  });
});

test('pathForYaml writes the path relative to the YAML, with "/"', () => {
  expect(pathForYaml(base, join(base, 'data', 'users.csv'))).toBe('data/users.csv');
  expect(pathForYaml(join(base, 'tests'), join(base, 'data', 'users.csv'))).toBe('../data/users.csv');
  expect(pathForYaml(base, join(base, 'a.csv'))).toBe('a.csv');
});
