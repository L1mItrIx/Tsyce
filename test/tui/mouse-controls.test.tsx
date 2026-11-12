import { act } from 'react';
import { Box, Text, render as renderInk } from 'ink';
import { PassThrough } from 'node:stream';
import { cleanup, render } from 'ink-testing-library';
import { afterEach, expect, test, vi } from 'vitest';
import { MOUSE_OFF, MOUSE_ON, MouseProvider, MouseTarget } from '../../src/tui/mouse-controls.js';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(async () => { await act(async () => { cleanup(); }); });

test('routes clicks to measured layout regions, ignores disabled targets and handles scrolling', async () => {
  const first = vi.fn(); const second = vi.fn(); const disabled = vi.fn(); const scroll = vi.fn();
  let app!: ReturnType<typeof render>;
  await act(async () => { app = render(<MouseProvider><Box gap={2}>
    <MouseTarget onClick={first}><Text>GET</Text></MouseTarget>
    <MouseTarget onClick={second} onScroll={scroll}><Text>POST</Text></MouseTarget>
    <MouseTarget disabled onClick={disabled}><Text>disabled</Text></MouseTarget>
  </Box></MouseProvider>); });
  await act(async () => { app.stdin.write('\u001b[<0;6;1M'); });
  expect(second).toHaveBeenCalledOnce(); expect(first).not.toHaveBeenCalled();
  await act(async () => { app.stdin.write('\u001b[<0;12;1M'); app.stdin.write('\u001b[<0;99;20M'); });
  expect(disabled).not.toHaveBeenCalled();
  await act(async () => { app.stdin.write('\u001b[<65;6;1M'); });
  expect(scroll).toHaveBeenCalledExactlyOnceWith(1);
  await act(async () => { app.unmount(); });
  expect(app.stdin.listenerCount('data')).toBe(0);
});

test('TTY modes are restored on exit and scrolling adjusts click coordinates for a short viewport', async () => {
  const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode: vi.fn() });
  const stdout = Object.assign(new PassThrough(), { isTTY: true, columns: 60, rows: 5 });
  let output = '';
  stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
  const clicked = vi.fn();
  let app!: ReturnType<typeof renderInk>;
  await act(async () => { app = renderInk(<MouseProvider>
    <Text>{Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n')}</Text>
    <MouseTarget onClick={clicked}><Text>Bottom button</Text></MouseTarget>
  </MouseProvider>, { stdin: stdin as unknown as NodeJS.ReadStream, stdout: stdout as unknown as NodeJS.WriteStream, debug: true, exitOnCtrlC: false, patchConsole: false }); });
  try {
    expect(output).toContain(MOUSE_ON);
    await act(async () => { stdin.write('\u001b[<0;1;11M'); });
    expect(clicked).not.toHaveBeenCalled();
    for (let i = 0; i < 3; i++) await act(async () => { stdin.write('\u001b[<65;1;1M'); });
    await act(async () => { stdin.write('\u001b[<0;1;5M'); });
    expect(clicked).toHaveBeenCalledOnce();
  } finally {
    await act(async () => { app.unmount(); });
    await app.waitUntilExit();
    app.cleanup();
    expect(output).toContain(MOUSE_OFF);
    expect(stdin.listenerCount('data')).toBe(0);
  }
});
