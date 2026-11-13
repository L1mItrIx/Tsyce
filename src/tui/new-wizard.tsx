import { useEffect, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { RequestSpec, Expect } from '../core/schema.js';
import { captureAuthToken, maskSecrets, responseTokenFields } from '../core/capture.js';
import { checkExpectations } from '../core/asserts.js';
import type { RunResult } from '../core/runner/exec.js';
import { RequestWizard } from './request-wizard.js';
import { AssertionMenu } from './assertion-menu.js';
import { MouseTarget } from './mouse-controls.js';
import { TokenPicker } from './token-picker.js';

/** Sends one request; `data` is the data file of the test, whose first row fills {{data.<column>}}. */
export type SendRequest = (request: RequestSpec, signal: AbortSignal, data?: string) => Promise<RunResult>;
export type CapturedAuth = { capture: { authToken: string }; value: string };
type NewWizardProps = {
  sendRequest: SendRequest;
  onComplete: (request: RequestSpec, expected: Expect, auth?: CapturedAuth, data?: string) => void;
  onCancel: () => void;
  onError?: (error: Error) => void;
  actionLabel?: string;
  hasCapturedToken?: boolean;
  sensitiveValues?: string[];
  /** Directory of the YAML being written (see RequestWizard). */
  baseDir?: string;
};

export function NewWizard({ sendRequest, onComplete, onCancel, onError, actionLabel = 'Save test', hasCapturedToken = false, sensitiveValues = [], baseDir }: NewWizardProps) {
  const [data, setData] = useState<string | undefined>(undefined);
  const [mode, setMode] = useState<'form' | 'running' | 'asserts' | 'error' | 'token'>('form');
  const [request, setRequest] = useState<RequestSpec | null>(null);
  const [response, setResponse] = useState<RunResult | null>(null);
  const [error, setError] = useState('');
  const [auth, setAuth] = useState<CapturedAuth | null>(null);
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
  const send = async (value: RequestSpec, dataFile: string | undefined = data) => {
    if (finished.current || sending.current) return;
    sending.current = true;
    setRequest(value); setData(dataFile); setMode('running'); setError('');
    try {
      const result = await sendRequest(value, controller.current.signal, dataFile);
      if (finished.current) return;
      if (result.error !== null) { setError(maskSecrets(result.error, sensitiveValues)); setMode('error'); }
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
  if (mode === 'form') return <RequestWizard hasCapturedToken={hasCapturedToken} {...(baseDir !== undefined && { baseDir })}
    onComplete={(value, dataFile) => { void send(value, dataFile); }} onCancel={cancel} />;
  if (mode === 'token' && response) return <TokenPicker result={response} onBack={() => setMode('asserts')} onCancel={cancel} onSelect={(path) => {
    const capture = { authToken: path };
    setAuth({ capture, value: captureAuthToken(response, capture) });
    setMode('asserts');
  }} />;
  if (mode === 'asserts' && response && request) return <AssertionMenu key={auth?.capture.authToken ?? 'no-capture'}
    result={maskSecrets(response, [...sensitiveValues, ...(auth ? [auth.value] : [])])} onCancel={cancel} actionLabel={actionLabel}
    {...(responseTokenFields(response).length > 0 ? { onCapture: () => setMode('token') } : {})}
    {...(auth ? { tokenPath: auth.capture.authToken, validate: (expected: Expect) => checkExpectations(expected, response).every((assert) => assert.ok) ? null : 'Authentication assertions must pass before reusing this token.' } : {})}
    onComplete={(expected) => {
    if (finished.current) return;
    finished.current = true;
    onComplete(request, expected, auth ?? undefined, data);
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
