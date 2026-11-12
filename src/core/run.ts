import type { AssertResult } from './asserts.js';
import type { RunResult } from './runner/exec.js';

export const EXIT = {
  /** Every test passed. */
  ok: 0,
  /** At least one assert failed. */
  assertFailed: 1,
  /** Invalid file, unresolved variable or wrong usage. */
  invalid: 2,
  /** curl missing or too old, or a request got no response. */
  curl: 3,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export type TestOutcome = {
  name: string;
  result: RunResult;
  /** Empty when curl got no response: there is nothing to check. */
  asserts: AssertResult[];
};

export type OutcomeStatus = 'passed' | 'failed' | 'errored';

export function outcomeStatus(outcome: TestOutcome): OutcomeStatus {
  if (outcome.result.error !== null) return 'errored';
  return outcome.asserts.every((assert) => assert.ok) ? 'passed' : 'failed';
}

export function exitCodeFor(outcomes: TestOutcome[]): ExitCode {
  const statuses = outcomes.map(outcomeStatus);
  if (statuses.includes('errored')) return EXIT.curl;
  if (statuses.includes('failed')) return EXIT.assertFailed;
  return EXIT.ok;
}
