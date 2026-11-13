import { useRef, useState } from 'react';
import { Box, Text, render, useInput } from 'ink';
import type { TestCase } from '../core/schema.js';
import { resolve } from 'node:path';
import { readDataFile } from '../core/data.js';
import { defaultTestName, TestFileError } from '../core/file.js';
import type { RunResult } from '../core/runner/exec.js';
import { NewWizard, type SendRequest } from './new-wizard.js';
import { MouseProvider, MouseTarget } from './mouse-controls.js';
import { resolveVars, UnresolvedVariableError } from '../core/vars.js';
import { maskSecrets } from '../core/capture.js';

type SuiteWizardProps = {
  sendRequest: SendRequest;
  onComplete: (tests: TestCase[]) => void;
  onCancel: () => void;
  onError?: (error: Error) => void;
  /** Directory of the YAML being written: data files and uploads are relative to it. */
  baseDir?: string;
};

/** A request that could not be sent, shown like a network error so the person can fix it and retry. */
const notSent = (error: string): RunResult => ({ status: 0, timeMs: 0, headers: {}, body: '', curlExitCode: 0, error });

export function SuiteWizard({ sendRequest, onComplete, onCancel, baseDir = process.cwd(), ...options }: SuiteWizardProps) {
  const [tests, setTests] = useState<TestCase[]>([]);
  const [editing, setEditing] = useState(true);
  const [token, setToken] = useState<string | null>(null);
  const finished = useRef(false);
  const cancel = () => { if (!finished.current) { finished.current = true; onCancel(); } };
  const save = () => { if (!finished.current && tests.length > 0) { finished.current = true; onComplete(tests); } };
  const addAnother = () => { if (!finished.current) setEditing(true); };
  useInput((input, key) => {
    if (key.ctrl && input === 'c') cancel();
    else if (input.toLowerCase() === 'a') addAnother();
    else if (key.return) save();
  }, { isActive: !editing });
  if (editing) return <NewWizard key={tests.length} hasCapturedToken={token !== null} sensitiveValues={token ? [token] : []}
    baseDir={baseDir}
    sendRequest={async (request, signal, data) => {
      let resolved: typeof request;
      try {
        // The live request uses the first row; the saved test will run every row.
        const row = data === undefined ? undefined : (await readDataFile(resolve(baseDir, data)))[0];
        resolved = resolveVars(request, { cli: {}, system: process.env, file: {}, runtime: { authToken: token ?? undefined }, ...(row !== undefined && { data: row }) });
      } catch (cause) {
        if (!(cause instanceof TestFileError || cause instanceof UnresolvedVariableError)) throw cause;
        return notSent(cause.message);
      }
      try { return await sendRequest(resolved, signal, data); }
      catch (cause) { throw new Error(maskSecrets((cause as Error).message, token ? [token] : [])); }
    }} {...options} actionLabel="Add request"
    onComplete={(request, expected, auth, data) => {
      setTests((previous) => [...previous, { name: defaultTestName(request), request, expect: expected, ...(auth ? { capture: auth.capture } : {}), ...(data !== undefined ? { data } : {}) }]);
      if (auth) setToken(auth.value);
      setEditing(false);
    }} onCancel={() => { if (tests.length > 0) setEditing(false); else cancel(); }} />;
  return <Box flexDirection="column">
    <Text bold>{tests.length} {tests.length === 1 ? 'request' : 'requests'} ready</Text>
    <Text>Requests will run in this order:</Text>
    {tests.map((test, index) => <Text key={index}>{index + 1}. {test.name}</Text>)}
    {token !== null && <Text color="green">Captured auth token ready — value hidden. Use it in the next request's Headers.</Text>}
    <Text dimColor>Each request was sent once to choose assertions. Saving only writes the YAML.</Text>
    <Box gap={2} marginTop={1} flexWrap="wrap">
      <MouseTarget onClick={addAnother}><Text color="cyan">[ Add another request ]</Text></MouseTarget>
      <MouseTarget onClick={save}><Text color="green">[ Save file ]</Text></MouseTarget>
      <MouseTarget onClick={cancel}><Text>[ Discard file ]</Text></MouseTarget>
    </Box>
    <Text dimColor>a: add another request · Enter: save file · Ctrl+C: discard file</Text>
  </Box>;
}

/** Runs the multi-request editor on stderr and restores the terminal before writing the file. */
export async function launchWizard(sendRequest: SendRequest, baseDir: string = process.cwd()): Promise<TestCase[] | null> {
  let instance: ReturnType<typeof render> | undefined;
  try {
    return await new Promise<TestCase[] | null>((resolve, reject) => {
      instance = render(<MouseProvider><SuiteWizard sendRequest={sendRequest} baseDir={baseDir}
        onComplete={resolve} onCancel={() => resolve(null)} onError={reject} /></MouseProvider>,
      { stdout: process.stderr, exitOnCtrlC: false, patchConsole: false, alternateScreen: true, interactive: true });
    });
  } finally {
    instance?.unmount();
    await instance?.waitUntilExit();
  }
}
