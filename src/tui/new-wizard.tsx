import { useEffect, useRef, useState } from 'react';
import { Box, Text, render, useInput } from 'ink';
import type { RequestSpec, Expect } from '../core/schema.js';
import type { RunResult } from '../core/runner/exec.js';
import { RequestWizard } from './request-wizard.js';
import { AssertionMenu } from './assertion-menu.js';

type SendRequest = (request: RequestSpec, signal: AbortSignal) => Promise<RunResult>;
type Completed = { request: RequestSpec; expected: Expect };
type NewWizardProps = {
  sendRequest: SendRequest;
  onComplete: (request: RequestSpec, expected: Expect) => void;
  onCancel: () => void;
  onError?: (error: Error) => void;
};

export function NewWizard({ sendRequest, onComplete, onCancel, onError }: NewWizardProps) {
  const [mode, setMode] = useState<'form' | 'running' | 'asserts' | 'error'>('form');
  const [request, setRequest] = useState<RequestSpec | null>(null);
  const [response, setResponse] = useState<RunResult | null>(null);
  const [error, setError] = useState('');
  const controller = useRef(new AbortController());
  const finished = useRef(false);
  useEffect(() => () => { controller.current.abort(); }, []);
  const cancel = () => {
    if (finished.current) return;
    finished.current = true;
    controller.current.abort();
    onCancel();
  };
  const send = async (value: RequestSpec) => {
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
    }
  };
  useInput((input, key) => {
    if (key.ctrl && input === 'c') cancel();
    else if (mode === 'error' && key.return && request) void send(request);
    else if (mode === 'error' && key.escape) setMode('form');
  }, { isActive: mode === 'running' || mode === 'error' });
  if (mode === 'form') return <RequestWizard onComplete={(value) => { void send(value); }} onCancel={cancel} />;
  if (mode === 'asserts' && response && request) return <AssertionMenu result={response} onCancel={cancel} onComplete={(expected) => {
    if (finished.current) return;
    finished.current = true; onComplete(request, expected);
  }} />;
  return <Box flexDirection="column">
    <Text>{mode === 'running' ? 'Sending request… Ctrl+C: cancel' : `Request failed: ${JSON.stringify(error)}`}</Text>
    {mode === 'error' && <Text>Enter: retry · Esc: edit · Ctrl+C: cancel</Text>}
  </Box>;
}

/** Runs Ink on stderr so machine-readable output and saved YAML stay separate. */
export async function launchWizard(sendRequest: SendRequest): Promise<Completed | null> {
  let instance: ReturnType<typeof render> | undefined;
  try {
    return await new Promise<Completed | null>((resolve, reject) => {
      instance = render(<NewWizard sendRequest={sendRequest}
        onComplete={(request, expected) => resolve({ request, expected })}
        onCancel={() => resolve(null)} onError={reject} />,
      { stdout: process.stderr, exitOnCtrlC: false, patchConsole: false });
    });
  } finally {
    instance?.unmount();
    await instance?.waitUntilExit();
  }
}
