import { type AssertResult, checkExpectations } from './asserts.js';
import { type RunResult, runRequest } from './runner/exec.js';
import type { TestFile } from './schema.js';
import { captureAuthToken, maskSecrets } from './capture.js';
import { resolveVars, type VarSources } from './vars.js';

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
  /** Authentication response fields were intentionally withheld, not absent from the server. */
  responseHidden?: boolean;
};

/** The outcomes of one test file within a run; `name` is its title in reports. */
export type Suite = { name: string | undefined; outcomes: TestOutcome[] };

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

const EMPTY_SOURCES: VarSources = { cli: {}, system: {}, file: {} };

function resolvedTest(test: TestFile['tests'][number], sources: VarSources, runtime: VarSources['runtime']) {
  const { capture, ...rest } = test;
  return { ...resolveVars(rest, { ...sources, runtime: runtime ?? {} }), ...(capture ? { capture } : {}) };
}

/** Validate every reference before sending anything, reserving authToken for prior captures. */
export function validateRunVariables(input: TestFile | TestFile[], sources: VarSources = EMPTY_SOURCES): void {
  const tests = [input].flat().flatMap((file) => file.tests);
  const hasCapture = tests.some((test) => test.capture);
  let available = false;
  for (const test of tests) {
    resolvedTest(test, sources, hasCapture ? { authToken: available ? '[runtime token]' : undefined } : sources.runtime);
    if (test.capture) available = true;
  }
}

/**
 * Runs several files as one flow, in order: a token captured in one file is available to the
 * next ones. Returns the outcomes of each file; a file the flow never reached has none.
 */
export async function runTestFiles(files: TestFile[], curlBin: string, sources: VarSources = EMPTY_SOURCES): Promise<TestOutcome[][]> {
  validateRunVariables(files, sources);
  const secrets: string[] = [];
  const runtime = files.some((file) => file.tests.some((test) => test.capture)) ? { authToken: undefined as string | undefined } : undefined;
  const perFile: TestOutcome[][] = files.map(() => []);
  flow: for (const [index, file] of files.entries()) {
    const outcomes = perFile[index]!;
    for (const template of file.tests) {
      const test = resolvedTest(template, sources, runtime ?? sources.runtime);
      const result = await runRequest(curlBin, test.request);
      const asserts = result.error === null ? checkExpectations(test.expect, result) : [];
      if (test.capture) {
        let captured = false;
        if (runtime) runtime.authToken = undefined;
        if (result.error === null && asserts.every((assert) => assert.ok)) {
          try {
            const token = captureAuthToken(result, test.capture);
            secrets.push(token); if (runtime) runtime.authToken = token; captured = true;
          } catch { /* Report a failed prerequisite without exposing the authentication response. */ }
        }
        const safeAsserts = asserts.map((assert, index) => ({ ok: assert.ok, label: `authentication assertion ${index + 1}`, ...(!assert.ok ? { message: 'Authentication assertion failed; flow stopped' } : {}) }));
        safeAsserts.push({ ok: captured, label: 'authentication token captured', ...(!captured ? { message: 'Authentication or token capture failed; flow stopped; remaining requests were not executed' } : {}) });
        outcomes.push({ name: test.name, responseHidden: true, result: { ...result, headers: {}, body: '[authentication response hidden]', error: result.error === null ? null : 'Authentication request failed; flow stopped' }, asserts: safeAsserts });
        if (!captured) break flow;
      } else outcomes.push({ name: test.name, result, asserts });
    }
  }
  // Preserve structural field names even when a token is a short substring such as "a".
  return perFile.map((outcomes) => outcomes.map((outcome) => ({
    ...outcome,
    name: maskSecrets(outcome.name, secrets),
    result: { ...outcome.result, headers: maskSecrets(outcome.result.headers, secrets), body: maskSecrets(outcome.result.body, secrets), error: maskSecrets(outcome.result.error, secrets) },
    asserts: outcome.asserts.map((assert) => ({ ...assert, label: maskSecrets(assert.label, secrets), ...(assert.message !== undefined ? { message: maskSecrets(assert.message, secrets) } : {}) })),
  })));
}

/** Runs the tests of a file one after another, in file order. */
export async function runTestFile(file: TestFile, curlBin: string, sources: VarSources = EMPTY_SOURCES): Promise<TestOutcome[]> {
  return (await runTestFiles([file], curlBin, sources))[0]!;
}
