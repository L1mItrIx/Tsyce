import { expect, test } from 'vitest';
import type { RunResult } from '../../src/core/runner/exec.js';
import { exitCodeFor, type TestOutcome } from '../../src/core/run.js';

const ok: RunResult = { status: 200, timeMs: 10, headers: {}, body: '', curlExitCode: 0, error: null };
const down: RunResult = { status: 0, timeMs: 0, headers: {}, body: '', curlExitCode: 7, error: 'Failed to connect' };

const passed: TestOutcome = { name: 'passed', result: ok, asserts: [{ ok: true, label: 'status is 200' }] };
const noAsserts: TestOutcome = { name: 'no asserts', result: ok, asserts: [] };
const failed: TestOutcome = {
  name: 'failed',
  result: ok,
  asserts: [
    { ok: true, label: 'status is 200' },
    { ok: false, label: '$.id exists', message: 'no match' },
  ],
};
const errored: TestOutcome = { name: 'errored', result: down, asserts: [] };

test.each<[string, TestOutcome[], number]>([
  ['all passed', [passed, noAsserts], 0],
  ['one assert failed', [passed, failed], 1],
  ['a request got no response', [passed, errored], 3],
  ['network error wins over a failed assert', [failed, errored], 3],
])('%s → exit %i', (_name, outcomes, code) => {
  expect(exitCodeFor(outcomes)).toBe(code);
});
