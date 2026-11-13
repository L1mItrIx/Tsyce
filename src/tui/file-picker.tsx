import { readdir } from 'node:fs/promises';
import { useEffect, useReducer, useRef } from 'react';
import { Box, render, Text, useInput } from 'ink';
import { createPickerState, pickerReducer } from './file-picker-state.js';
import { MouseProvider, MouseTarget } from './mouse-controls.js';

export type FilePickerProps = {
  /** Directory shown first (absolute). */
  startDir: string;
  /** Extensions to offer, such as ".csv"; leave out to offer every file. */
  extensions?: string[];
  title: string;
  hint?: string;
  /** Receives the absolute path of the chosen file. */
  onSelect: (path: string) => void;
  onCancel: () => void;
};

const WINDOW = 10;

/** Browses the disk from `startDir` with the keyboard or the mouse and hands back one file. */
export function FilePicker({ startDir, extensions = [], title, hint, onSelect, onCancel }: FilePickerProps) {
  const [state, dispatch] = useReducer(pickerReducer, undefined, () => createPickerState(startDir, extensions));
  const notified = useRef(false);

  useEffect(() => {
    if (state.status !== 'loading') return;
    let current = true;
    const dir = state.dir;
    readdir(dir, { withFileTypes: true })
      .then((entries) => { if (current) dispatch({ type: 'loaded', dir, names: entries.map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() })) }); })
      .catch((cause: unknown) => { if (current) dispatch({ type: 'failed', dir, message: cause instanceof Error ? cause.message : String(cause) }); });
    return () => { current = false; };
  }, [state.status, state.dir]);

  useEffect(() => {
    if (notified.current) return;
    if (state.status === 'selected' && state.selected !== null) { notified.current = true; onSelect(state.selected); }
    if (state.status === 'cancelled') { notified.current = true; onCancel(); }
  }, [state, onSelect, onCancel]);

  useInput((input, key) => {
    if ((key.ctrl && input === 'c') || key.escape) dispatch({ type: 'cancel' });
    else if (key.upArrow) dispatch({ type: 'move', delta: -1 });
    else if (key.downArrow) dispatch({ type: 'move', delta: 1 });
    else if (key.pageUp) dispatch({ type: 'move', delta: -WINDOW });
    else if (key.pageDown) dispatch({ type: 'move', delta: WINDOW });
    else if (key.return || key.rightArrow) dispatch({ type: 'open' });
    else if (key.backspace || key.delete || key.leftArrow) dispatch({ type: 'up' });
  });

  const start = Math.max(0, Math.min(state.cursor - Math.floor(WINDOW / 2), state.entries.length - WINDOW));
  const shown = state.entries.slice(start, start + WINDOW);
  return <Box flexDirection="column">
    <Text bold>{title}</Text>
    {hint !== undefined && <Text dimColor>{hint}</Text>}
    <Text color="cyan">{state.dir}</Text>
    {extensions.length > 0 && <Text dimColor>Showing folders and {extensions.join(', ')} files</Text>}
    {state.status === 'loading' && <Text dimColor>Reading the folder…</Text>}
    {state.status === 'ready' && state.entries.length === 0 && <Text dimColor>(nothing to choose here)</Text>}
    <MouseTarget onScroll={(direction) => dispatch({ type: 'move', delta: direction * 3 })}>
      {shown.map((entry, offset) => {
        const index = start + offset;
        const label = entry.kind === 'file' ? entry.name : `${entry.name}/`;
        return <MouseTarget key={`${state.dir}:${entry.name}`} onClick={() => dispatch({ type: 'open', index })}>
          <Text {...(index === state.cursor ? { inverse: true } : {})} {...(entry.kind === 'file' ? {} : { color: 'blue' })}>
            {index === state.cursor ? '> ' : '  '}{label}
          </Text>
        </MouseTarget>;
      })}
    </MouseTarget>
    {state.entries.length > WINDOW && <Text dimColor>{state.cursor + 1}/{state.entries.length}</Text>}
    {state.error !== null && <Text color="red">Cannot read this folder: {state.error}</Text>}
    <Text dimColor>↑/↓: move · Enter or →: open · ← or Backspace: parent folder · Esc: cancel</Text>
    <MouseTarget onClick={() => dispatch({ type: 'cancel' })}><Text>[ Cancel ]</Text></MouseTarget>
  </Box>;
}

/** Runs the picker on its own screen (stderr) and resolves with the chosen file, or null when cancelled. */
export async function launchFilePicker(options: Omit<FilePickerProps, 'onSelect' | 'onCancel'>): Promise<string | null> {
  let instance: ReturnType<typeof render> | undefined;
  try {
    return await new Promise<string | null>((resolve) => {
      instance = render(<MouseProvider><FilePicker {...options} onSelect={resolve} onCancel={() => resolve(null)} /></MouseProvider>,
        { stdout: process.stderr, exitOnCtrlC: false, patchConsole: false, alternateScreen: true, interactive: true });
    });
  } finally {
    instance?.unmount();
    await instance?.waitUntilExit();
  }
}
