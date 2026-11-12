import { useRef, useState } from 'react';
import { Box, Text, render, useInput } from 'ink';
import type { TestCase } from '../core/schema.js';
import { defaultTestName } from '../core/file.js';
import { NewWizard, type SendRequest } from './new-wizard.js';
import { MouseProvider, MouseTarget } from './mouse-controls.js';

type SuiteWizardProps = { sendRequest: SendRequest; onComplete: (tests: TestCase[]) => void; onCancel: () => void; onError?: (error: Error) => void };

export function SuiteWizard({ sendRequest, onComplete, onCancel, ...options }: SuiteWizardProps) {
  const [tests, setTests] = useState<TestCase[]>([]);
  const [editing, setEditing] = useState(true);
  const finished = useRef(false);
  const cancel = () => { if (!finished.current) { finished.current = true; onCancel(); } };
  const save = () => { if (!finished.current && tests.length > 0) { finished.current = true; onComplete(tests); } };
  const addAnother = () => { if (!finished.current) setEditing(true); };
  useInput((input, key) => {
    if (key.ctrl && input === 'c') cancel();
    else if (input.toLowerCase() === 'a') addAnother();
    else if (key.return) save();
  }, { isActive: !editing });
  if (editing) return <NewWizard key={tests.length} sendRequest={sendRequest} {...options} actionLabel="Add request"
    onComplete={(request, expected) => {
      setTests((previous) => [...previous, { name: defaultTestName(request), request, expect: expected }]);
      setEditing(false);
    }} onCancel={() => { if (tests.length > 0) setEditing(false); else cancel(); }} />;
  return <Box flexDirection="column">
    <Text bold>{tests.length} {tests.length === 1 ? 'request' : 'requests'} ready</Text>
    <Text>Requests will run in this order:</Text>
    {tests.map((test, index) => <Text key={index}>{index + 1}. {test.name}</Text>)}
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
export async function launchWizard(sendRequest: SendRequest): Promise<TestCase[] | null> {
  let instance: ReturnType<typeof render> | undefined;
  try {
    return await new Promise<TestCase[] | null>((resolve, reject) => {
      instance = render(<MouseProvider><SuiteWizard sendRequest={sendRequest}
        onComplete={resolve} onCancel={() => resolve(null)} onError={reject} /></MouseProvider>,
      { stdout: process.stderr, exitOnCtrlC: false, patchConsole: false, alternateScreen: true, interactive: true });
    });
  } finally {
    instance?.unmount();
    await instance?.waitUntilExit();
  }
}
