import { useMemo, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Expect } from '../core/schema.js';
import type { RunResult } from '../core/runner/exec.js';
import { assertionChoices, selectedExpectations } from './assertion-choices.js';
import { MouseTarget } from './mouse-controls.js';

export type AssertionMenuProps = { result: RunResult; onComplete: (expected: Expect) => void; onCancel: () => void };

export function AssertionMenu({ result, onComplete, onCancel }: AssertionMenuProps) {
  const choices = useMemo(() => assertionChoices(result), [result]);
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState(new Set(choices.length > 0 ? [0] : []));
  const [time, setTime] = useState<string | null>(null);
  const [maxTimeMs, setMaxTimeMs] = useState<number | undefined>();
  const [error, setError] = useState<string | null>(null);
  const finished = useRef(false);
  const cancel = () => { if (!finished.current) { finished.current = true; onCancel(); } };
  const toggle = (index: number) => {
    if (finished.current || time !== null || !choices[index]) return;
    setCursor(index);
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(index)) next.delete(index); else next.add(index);
      return next;
    });
  };
  const complete = () => {
    if (finished.current || time !== null) return;
    finished.current = true;
    const expected = selectedExpectations(choices, [...selected].sort((a, b) => a - b));
    onComplete(maxTimeMs === undefined ? expected : { ...expected, maxTimeMs });
  };
  const applyTime = () => {
    const value = Number(time);
    if (!Number.isFinite(value) || value <= 0) setError('Enter a positive number of milliseconds.');
    else { setMaxTimeMs(value); setTime(null); setError(null); }
  };
  useInput((input, key) => {
    if (finished.current) return;
    if (key.ctrl && input === 'c') { cancel(); return; }
    if (time !== null) {
      if (key.escape) { setTime(null); setError(null); }
      else if (key.return) applyTime();
      else if (key.backspace || key.delete) setTime(time.slice(0, -1));
      else if (!key.ctrl && input) setTime(time + input);
      return;
    }
    if (input === 't') setTime('');
    else if (key.upArrow) setCursor(Math.max(0, cursor - 1));
    else if (key.downArrow) setCursor(Math.min(choices.length - 1, cursor + 1));
    else if (input === ' ') toggle(cursor);
    else if (key.return) complete();
  });
  const start = Math.max(0, cursor - 5);
  return <Box flexDirection="column">
    <Text bold>Choose assertions — received {result.status}, {result.timeMs} ms</Text>
    <MouseTarget onScroll={(direction) => { if (time === null && !finished.current) setCursor((previous) => Math.max(0, Math.min(choices.length - 1, previous + direction * 3))); }}>
      {choices.slice(start, start + 8).map((choice, i) => <MouseTarget key={start + i} disabled={time !== null} onClick={() => toggle(start + i)}>
        <Text>{start + i === cursor ? '>' : ' '} [{selected.has(start + i) ? 'x' : ' '}] {choice.label}</Text>
      </MouseTarget>)}
    </MouseTarget>
    <Text dimColor>↑/↓: move · Space: toggle · t: time limit · Enter: save · Ctrl+C: cancel</Text>
    <Text dimColor>{selected.size} selected · {choices.length} available{choices.length >= 190 ? ' (response options limited)' : ''}</Text>
    {maxTimeMs !== undefined && <Text>Custom time limit: {maxTimeMs} ms</Text>}
    {time !== null && <Text>Maximum time in ms: {time}▌</Text>}
    <Box gap={2} flexWrap="wrap">
      <MouseTarget onClick={complete} disabled={time !== null}><Text color="cyan">[ Save test ]</Text></MouseTarget>
      <MouseTarget onClick={() => { if (time === null) setTime(''); else applyTime(); }}>
        <Text>[ {time === null ? 'Time limit' : 'Apply time'} ]</Text>
      </MouseTarget>
      <MouseTarget onClick={cancel}><Text>[ Cancel ]</Text></MouseTarget>
    </Box>
    <Text dimColor>Click an assertion to toggle · Mouse wheel: scroll</Text>
    {error !== null && <Text color="red">{error}</Text>}
  </Box>;
}
