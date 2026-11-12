import { useEffect, useReducer, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import type { RequestSpec } from '../core/schema.js';
import { createWizardState, HTTP_METHODS, wizardReducer } from './wizard-state.js';
import { MouseTarget } from './mouse-controls.js';

export type RequestWizardProps = { onComplete: (request: RequestSpec) => void; onCancel: () => void; hasCapturedToken?: boolean };
const labels = { method: 'Method (default GET)', url: 'URL', headers: 'Headers (one Name: value per line)', body: 'Body (literal text; empty for none)' };
const methodColors = { GET: 'green', POST: 'yellow', PUT: 'blue', PATCH: 'magenta', DELETE: 'red', HEAD: 'cyan', OPTIONS: 'white' } as const;
const editorSteps = ['method', 'url', 'headers', 'body', 'review'] as const;

export function RequestWizard({ onComplete, onCancel, hasCapturedToken = false }: RequestWizardProps) {
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
    else if (state.step === 'method' && (key.upArrow || key.leftArrow || key.downArrow || key.rightArrow)) {
      dispatch({ type: 'move-method', direction: key.upArrow || key.leftArrow ? -1 : 1 });
    }
    else if (key.tab || (key.return && !multiline)) dispatch({ type: 'next' });
    else if (key.return) dispatch({ type: 'input', value: `${state.input}\n` });
    else if (key.backspace || key.delete) dispatch({ type: 'input', value: Array.from(state.input).slice(0, -1).join('') });
    else if (!key.ctrl && !key.meta && input !== '' && !key.upArrow && !key.downArrow && !key.leftArrow && !key.rightArrow) {
      dispatch({ type: 'input', value: state.input + input });
    }
  });

  if (state.step === 'cancelled') return <Text>Cancelled.</Text>;
  if (state.step === 'ready') return <Text>Request confirmed.</Text>;
  const method = state.step === 'method' ? state.input.trim().toUpperCase() || state.request.method : state.request.method;
  const methodColor = methodColors[method as keyof typeof methodColors] ?? 'white';
  const skip = () => { dispatch({ type: 'input', value: '' }); dispatch({ type: 'next' }); };
  const addJsonHeader = () => {
    if (/^\s*content-type\s*:/im.test(state.input)) return;
    dispatch({ type: 'input', value: `${state.input}${state.input.trim() ? '\n' : ''}Content-Type: application/json` });
  };
  return <Box flexDirection="column">
    <Box marginBottom={1} gap={2}>
      <Text color="#dd815d" bold>▐ HTTPi ▌</Text>
      <Box flexDirection="column">
        <Text bold>API test workspace <Text color={methodColor}>[{method}]</Text></Text>
        <Text dimColor>{process.cwd()}</Text>
      </Box>
    </Box>
    <Box gap={1} marginBottom={1} flexWrap="wrap">
      {editorSteps.map((step, i) => <Text key={step} color={state.step === step ? 'cyan' : 'gray'} bold={state.step === step}>
        {i + 1}. {step === 'review' ? 'confirm' : step}{i < editorSteps.length - 1 ? ' →' : ''}
      </Text>)}
    </Box>
    {state.step === 'review' ? <>
      <Text bold>Confirm request</Text>
      <Text><Text color={methodColor} bold>{state.request.method}</Text> {state.request.url}</Text>
      <Text>Headers: {Object.keys(state.request.headers).join(', ') || '(none)'}</Text>
      <Text>Body: {state.request.body && 'text' in state.request.body ? Buffer.byteLength(state.request.body.text) : 0} bytes</Text>
      <Box borderStyle="single" borderLeft={false} borderRight={false} borderColor="gray" marginTop={1}>
        <Text>❯ Enter sends this request once to propose assertions. Esc edits it.</Text>
      </Box>
    </> : <>
      {state.step === 'method' && <Box flexDirection="column" marginBottom={1}>
        <Text>Select an HTTP method</Text>
        <Box flexWrap="wrap" gap={1}>
          {HTTP_METHODS.map((item) => <MouseTarget key={item} onClick={() => dispatch({ type: 'input', value: item })}>
            <Text color={methodColors[item]} bold={method === item} inverse={method === item}>
              {method === item ? ` > ${item} ` : `   ${item} `}
            </Text>
          </MouseTarget>)}
        </Box>
      </Box>}
      {state.step === 'headers' && <Box flexDirection="column" marginBottom={1}>
        <Text>Headers are optional metadata: Content-Type describes the body; Authorization sends an API token.</Text>
        <Text dimColor>A public GET often needs no headers. Format: Name: value, one per line.</Text>
        <MouseTarget onClick={addJsonHeader} disabled={/^\s*content-type\s*:/im.test(state.input)}>
          <Text color="cyan">[ Add JSON header ]</Text>
        </MouseTarget>
        {hasCapturedToken && <MouseTarget onClick={() => dispatch({ type: 'use-captured-token' })}>
          <Text color="green">[ Use captured token ]</Text>
        </MouseTarget>}
      </Box>}
      {state.step === 'body' && <Box flexDirection="column" marginBottom={1}>
        <Text>The body is data sent to the API, for example {`{"name":"Ana"}`}.</Text>
        <Text dimColor>{state.request.method === 'GET' || state.request.method === 'HEAD'
          ? `${state.request.method} usually needs no body. Use No body to continue.`
          : 'POST, PUT and PATCH often send JSON. Use an example or enter the data your API expects.'}</Text>
        <MouseTarget onClick={() => dispatch({ type: 'json-example' })}>
          <Text color="cyan">[ Use JSON example ]</Text>
        </MouseTarget>
        <Text dimColor>The JSON example also adds Content-Type: application/json if absent.</Text>
      </Box>}
      <Box flexDirection="column" borderStyle="single" borderLeft={false} borderRight={false} borderColor="gray" paddingX={1}>
        <Text>{labels[state.step]}</Text>
        <Text><Text color="cyan">❯ </Text>{state.input || (state.step === 'method' ? 'GET' : '')}▌</Text>
      </Box>
      <Text dimColor>{state.step === 'method' ? 'Arrows: select · type: custom method · Enter: next' : multiline ? 'Enter: new line · Tab: next' : 'Enter or Tab: next'} · Esc: back · Ctrl+C: cancel</Text>
    </>}
    <Box gap={2} marginTop={1} flexWrap="wrap">
      <MouseTarget onClick={() => dispatch({ type: 'back' })} disabled={state.step === 'method'}>
        <Text dimColor={state.step === 'method'}>[ Back ]</Text>
      </MouseTarget>
      {multiline && <MouseTarget onClick={skip}>
        <Text>[ {state.step === 'headers' ? 'Skip headers' : 'No body'} ]</Text>
      </MouseTarget>}
      <MouseTarget onClick={() => dispatch({ type: 'next' })}>
        <Text color="cyan" bold>[ {state.step === 'review' ? 'Send request' : 'Next'} ]</Text>
      </MouseTarget>
      <MouseTarget onClick={() => dispatch({ type: 'cancel' })}><Text>[ Cancel ]</Text></MouseTarget>
    </Box>
    <Text dimColor>Click a method or button · Keyboard shortcuts remain available</Text>
    {state.error !== null && <Text color="red">{state.error}</Text>}
  </Box>;
}
