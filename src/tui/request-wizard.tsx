import { useEffect, useReducer, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import type { RequestSpec } from '../core/schema.js';
import { createWizardState, wizardReducer } from './wizard-state.js';

export type RequestWizardProps = { onComplete: (request: RequestSpec) => void; onCancel: () => void };
const labels = { method: 'Method (default GET)', url: 'URL', headers: 'Headers (one Name: value per line)', body: 'Body (literal text; empty for none)' };

export function RequestWizard({ onComplete, onCancel }: RequestWizardProps) {
  const [state, dispatch] = useReducer(wizardReducer, undefined, createWizardState);
  const notified = useRef(false);
  useEffect(() => {
    if (notified.current) return;
    if (state.step === 'ready') { notified.current = true; onComplete(state.request); }
    if (state.step === 'cancelled') { notified.current = true; onCancel(); }
  }, [state, onComplete, onCancel]);

  const multiline = state.step === 'headers' || state.step === 'body';
  useInput((input, key) => {
    if (key.ctrl && input === 'c') dispatch({ type: 'cancel' });
    else if (key.escape || (key.tab && key.shift)) dispatch({ type: 'back' });
    else if (key.tab || (key.return && !multiline)) dispatch({ type: 'next' });
    else if (key.return) dispatch({ type: 'input', value: `${state.input}\n` });
    else if (key.backspace || key.delete) dispatch({ type: 'input', value: Array.from(state.input).slice(0, -1).join('') });
    else if (!key.ctrl && !key.meta && input !== '' && !key.upArrow && !key.downArrow && !key.leftArrow && !key.rightArrow) {
      dispatch({ type: 'input', value: state.input + input });
    }
  });

  if (state.step === 'cancelled') return <Text>Cancelled.</Text>;
  if (state.step === 'ready') return <Text>Request confirmed.</Text>;
  return <Box flexDirection="column">
    <Text bold>httpi — new API test</Text>
    {state.step === 'review' ? <>
      <Text bold>Confirm request</Text>
      <Text>{state.request.method} {state.request.url}</Text>
      <Text>Headers: {Object.keys(state.request.headers).join(', ') || '(none)'}</Text>
      <Text>Body: {state.request.body && 'text' in state.request.body ? Buffer.byteLength(state.request.body.text) : 0} bytes</Text>
      <Text>Enter sends this request once to propose assertions. Esc edits it.</Text>
    </> : <>
      <Text>{labels[state.step]}</Text>
      <Text>{state.input}▌</Text>
      <Text dimColor>{multiline ? 'Enter: new line · Tab: next' : 'Enter or Tab: next'} · Esc: back · Ctrl+C: cancel</Text>
    </>}
    {state.error !== null && <Text color="red">{state.error}</Text>}
  </Box>;
}
