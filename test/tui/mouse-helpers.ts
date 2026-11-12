import { act } from 'react';
import type { render } from 'ink-testing-library';

/** Locate the actual rendered label, so the tests also cover layout and wrapping. */
export async function clickLabel(app: ReturnType<typeof render>, label: string): Promise<void> {
  await act(async () => {});
  const lines = (app.lastFrame() ?? '').replace(/\u001b\[[\d;]*m/g, '').split('\n');
  const y = lines.findIndex((line) => line.includes(label));
  if (y < 0) throw new Error(`Cannot find clickable label: ${label}\n${app.lastFrame()}`);
  const x = lines[y]!.indexOf(label);
  await act(async () => { app.stdin.write(`\u001b[<0;${x + 1};${y + 1}M`); });
}
