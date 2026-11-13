import { dirname, extname, isAbsolute, join, parse, relative, sep } from 'node:path';

export type PickerEntry = { name: string; kind: 'parent' | 'dir' | 'file' };

export type PickerState = {
  /** Absolute directory being shown. */
  dir: string;
  entries: PickerEntry[];
  cursor: number;
  status: 'loading' | 'ready' | 'selected' | 'cancelled';
  /** Absolute path of the chosen file once status is 'selected'. */
  selected: string | null;
  error: string | null;
  /** Lowercase extensions to offer, such as ".csv"; empty offers every file. */
  extensions: string[];
};

export type PickerAction =
  | { type: 'loaded'; dir: string; names: Array<{ name: string; isDirectory: boolean }> }
  | { type: 'failed'; dir: string; message: string }
  | { type: 'move'; delta: number }
  | { type: 'open'; index?: number }
  | { type: 'up' }
  | { type: 'cancel' };

export function createPickerState(startDir: string, extensions: string[] = []): PickerState {
  return { dir: startDir, entries: [], cursor: 0, status: 'loading', selected: null, error: null, extensions: extensions.map((ext) => ext.toLowerCase()) };
}

const isRoot = (dir: string) => parse(dir).root === dir;
const byName = (a: PickerEntry, b: PickerEntry) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

/** What a directory shows: ".." first (except at the root), then folders, then the files the picker offers. Hidden entries are left out. */
export function pickerEntries(dir: string, names: Array<{ name: string; isDirectory: boolean }>, extensions: string[]): PickerEntry[] {
  const visible = names.filter((entry) => !entry.name.startsWith('.'));
  const dirs = visible.filter((entry) => entry.isDirectory).map((entry): PickerEntry => ({ name: entry.name, kind: 'dir' }));
  const files = visible
    .filter((entry) => !entry.isDirectory && (extensions.length === 0 || extensions.includes(extname(entry.name).toLowerCase())))
    .map((entry): PickerEntry => ({ name: entry.name, kind: 'file' }));
  return [...(isRoot(dir) ? [] : [{ name: '..', kind: 'parent' as const }]), ...dirs.sort(byName), ...files.sort(byName)];
}

function goTo(state: PickerState, dir: string): PickerState {
  return { ...state, dir, entries: [], cursor: 0, status: 'loading', error: null };
}

/** Pure file browser: listing the disk belongs to the component, which answers 'loading' with 'loaded' or 'failed'. */
export function pickerReducer(state: PickerState, action: PickerAction): PickerState {
  if (state.status === 'selected' || state.status === 'cancelled') return state;
  if (action.type === 'cancel') return { ...state, status: 'cancelled' };

  if (action.type === 'loaded' || action.type === 'failed') {
    if (action.dir !== state.dir || state.status !== 'loading') return state; // an answer for a directory we already left
    if (action.type === 'failed') {
      // Stay usable: offer the way back up instead of an empty screen.
      return { ...state, status: 'ready', entries: isRoot(state.dir) ? [] : [{ name: '..', kind: 'parent' }], cursor: 0, error: action.message };
    }
    return { ...state, status: 'ready', entries: pickerEntries(state.dir, action.names, state.extensions), cursor: 0, error: null };
  }
  if (state.status !== 'ready') return state;

  if (action.type === 'move') {
    if (state.entries.length === 0) return state;
    return { ...state, cursor: Math.max(0, Math.min(state.entries.length - 1, state.cursor + action.delta)) };
  }
  if (action.type === 'up') return isRoot(state.dir) ? state : goTo(state, dirname(state.dir));

  const index = action.index ?? state.cursor;
  const entry = state.entries[index];
  if (entry === undefined) return state;
  if (entry.kind === 'parent') return goTo(state, dirname(state.dir));
  if (entry.kind === 'dir') return goTo(state, join(state.dir, entry.name));
  return { ...state, cursor: index, status: 'selected', selected: join(state.dir, entry.name) };
}

/** How a chosen file is written in a YAML that lives in `baseDir`: relative, with "/", or absolute when there is no relative way (another drive). */
export function pathForYaml(baseDir: string, file: string): string {
  const path = relative(baseDir, file);
  if (path === '' || isAbsolute(path)) return file.split(sep).join('/');
  return path.split(sep).join('/');
}
