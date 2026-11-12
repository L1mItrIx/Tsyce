import { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { RunResult } from '../core/runner/exec.js';
import { responseTokenFields } from '../core/capture.js';
import { MouseTarget } from './mouse-controls.js';

export function TokenPicker({ result, onSelect, onBack, onCancel }: {
  result: RunResult; onSelect: (path: string) => void; onBack: () => void; onCancel: () => void;
}) {
  const paths = useMemo(() => responseTokenFields(result), [result]);
  const [cursor, setCursor] = useState(0);
  const move = (direction: number) => setCursor((previous) => Math.max(0, Math.min(paths.length - 1, previous + direction)));
  useInput((input, key) => {
    if (key.ctrl && input === 'c') onCancel();
    else if (key.escape) onBack();
    else if (key.upArrow) move(-1);
    else if (key.downArrow) move(1);
    else if (key.return && paths[cursor]) onSelect(paths[cursor]);
  });
  const start = Math.max(0, cursor - 5);
  return <Box flexDirection="column">
    <Text bold>Choose the authentication token field</Text>
    <Text>Choose access_token or token from the login response. Values are hidden.</Text>
    <Text dimColor>Use the access token for API requests, not a refresh token.</Text>
    <MouseTarget onScroll={(direction) => move(direction * 3)}>
      {paths.slice(start, start + 8).map((path, i) => <MouseTarget key={path} onClick={() => onSelect(path)}>
        <Text>{cursor === start + i ? '>' : ' '} {path}</Text>
      </MouseTarget>)}
    </MouseTarget>
    <Text dimColor>Click a field or use ↑/↓ and Enter · Esc: back · Ctrl+C: cancel</Text>
    <MouseTarget onClick={onBack}><Text>[ Back to assertions ]</Text></MouseTarget>
  </Box>;
}
