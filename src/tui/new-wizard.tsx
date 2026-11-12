import { useEffect, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { RequestSpec, Expect } from '../core/schema.js';
import type { RunResult } from '../core/runner/exec.js';
import { RequestWizard } from './request-wizard.js';
import { AssertionMenu } from './assertion-menu.js';
import { MouseTarget } from './mouse-controls.js';

export type SendRequest = (request: RequestSpec, signal: AbortSignal) => Promise<RunResult>;
type NewWizardProps = {
  sendRequest: SendRequest;
  onComplete: (request: RequestSpec, expected: Expect) => void;
  onCancel: () => void;
  onError?: (error: Error) => void;
  actionLabel?: string;
};

export function NewWizard({ sendRequest, onComplete, onCancel, onError, actionLabel = 'Save test' }: NewWizardProps) {
  const [mode, setMode] = useState<'form' | 'running' | 'asserts' | 'error'>('form');
  const [request, setRequest] = useState<RequestSpec | null>(null);
  const [response, setResponse] = useState<RunResult | null>(null);
  const [error, setError] = useState('');
  const controller = useRef(new AbortController());
  const finished = useRef(false);
  const sending = useRef(false);
  useEffect(() => () => { controller.current.abort(); }, []);
  const cancel = () => {
    if (finished.current) return;
    finished.current = true;
    controller.current.abort();
    onCancel();
  };
  const send = async (value: RequestSpec) => {
    if (finished.current || sending.current) return;
    sending.current = true;
    setRequest(value); setMode('running'); setError('');
    try {
      const result = await sendRequest(value, controller.current.signal);
      if (finished.current) return;
      if (result.error !== null) { setError(result.error); setMode('error'); }
      else { setResponse(result); setMode('asserts'); }
    } catch (cause) {
      if (finished.current) return;
      const failure = cause instanceof Error ? cause : new Error(String(cause));
      if (onError) { finished.current = true; onError(failure); }
      else { setError(failure.message); setMode('error'); }
    } finally {
      sending.current = false;
    }
  };
  useInput((input, key) => {
    if (key.ctrl && input === 'c') cancel();
    else if (mode === 'error' && key.return && request) void send(request);
    else if (mode === 'error' && key.escape) setMode('form');
  }, { isActive: mode === 'running' || mode === 'error' });
  if (mode === 'form') return <RequestWizard onComplete={(value) => { void send(value); }} onCancel={cancel} />;
  if (mode === 'asserts' && response && request) return <AssertionMenu result={response} onCancel={cancel} actionLabel={actionLabel} onComplete={(expected) => {
    if (finished.current) return;
    finished.current = true; onComplete(request, expected);
  }} />;
  return <Box flexDirection="column">
    <Text>{mode === 'running' ? 'Sending request… Ctrl+C: cancel' : `Request failed: ${JSON.stringify(error)}`}</Text>
    {mode === 'error' && <Text>Enter: retry · Esc: edit · Ctrl+C: cancel</Text>}
    <Box gap={2}>
      {mode === 'error' && <>
        <MouseTarget onClick={() => { if (request) void send(request); }}><Text>[ Retry ]</Text></MouseTarget>
        <MouseTarget onClick={() => setMode('form')}><Text>[ Edit request ]</Text></MouseTarget>
      </>}
      <MouseTarget onClick={cancel}><Text>[ Cancel ]</Text></MouseTarget>
    </Box>
  </Box>;
}
