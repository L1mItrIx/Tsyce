import { useMemo, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Expect } from '../core/schema.js';
import type { RunResult } from '../core/runner/exec.js';
import { assertionChoices, selectedExpectations } from './assertion-choices.js';

export type AssertionMenuProps = { result: RunResult; onComplete: (expected: Expect) => void; onCancel: () => void };

export function AssertionMenu({ result, onComplete, onCancel }: AssertionMenuProps) {
  const choices = useMemo(() => assertionChoices(result), [result]);
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState(new Set(choices.length > 0 ? [0] : []));
  const [time, setTime] = useState<string | null>(null);
  const [maxTimeMs, setMaxTimeMs] = useState<number | undefined>();
  const [error, setError] = useState<string | null>(null);
  const finished = useRef(false);
  useInput((input, key) => {
    if (finished.current) return;
    if (key.ctrl && input === 'c') { finished.current = true; onCancel(); return; }
    if (time !== null) {
      if (key.escape) { setTime(null); setError(null); }
      else if (key.return) {
        const value = Number(time);
        if (!Number.isFinite(value) || value <= 0) setError('Enter a positive number of milliseconds.');
        else { setMaxTimeMs(value); setTime(null); setError(null); }
      } else if (key.backspace || key.delete) setTime(time.slice(0, -1));
      else if (!key.ctrl && input) setTime(time + input);
      return;
    }
    if (input === 't') setTime('');
    else if (key.upArrow) setCursor(Math.max(0, cursor - 1));
    else if (key.downArrow) setCursor(Math.min(choices.length - 1, cursor + 1));
    else if (input === ' ' && choices[cursor]) {
      const next = new Set(selected);
      if (next.has(cursor)) next.delete(cursor); else next.add(cursor);
      setSelected(next);
    } else if (key.return) {
      finished.current = true;
      const expected = selectedExpectations(choices, [...selected].sort((a, b) => a - b));
      onComplete(maxTimeMs === undefined ? expected : { ...expected, maxTimeMs });
    }
  });
  const start = Math.max(0, cursor - 5);
  return <Box flexDirection="column">
    <Text bold>Choose assertions — received {result.status}, {result.timeMs} ms</Text>
    {choices.slice(start, start + 8).map((choice, i) => <Text key={start + i}>
      {start + i === cursor ? '>' : ' '} [{selected.has(start + i) ? 'x' : ' '}] {choice.label}
    </Text>)}
    <Text dimColor>↑/↓: move · Space: toggle · t: time limit · Enter: save · Ctrl+C: cancel</Text>
    <Text dimColor>{selected.size} selected · {choices.length} available{choices.length >= 190 ? ' (response options limited)' : ''}</Text>
    {maxTimeMs !== undefined && <Text>Custom time limit: {maxTimeMs} ms</Text>}
    {time !== null && <Text>Maximum time in ms: {time}▌</Text>}
    {error !== null && <Text color="red">{error}</Text>}
  </Box>;
}
