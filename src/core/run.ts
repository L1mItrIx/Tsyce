import { type AssertResult, checkExpectations } from './asserts.js';
import { type RunResult, runRequest } from './runner/exec.js';
import type { TestFile } from './schema.js';
import { captureAuthToken, captureValue, maskSecrets } from './capture.js';
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

const captureNames = (tests: TestFile['tests']) => [...new Set(tests.flatMap((test) => Object.keys(test.capture ?? {})))];

/**
 * Validate every reference before sending anything. A captured name is reserved for the whole
 * run: it has no value until the test that captures it, even if the system defines one.
 */
export function validateRunVariables(input: TestFile | TestFile[], sources: VarSources = EMPTY_SOURCES): void {
  const tests = [input].flat().flatMap((file) => file.tests);
  const names = captureNames(tests);
  const available = new Set<string>();
  for (const test of tests) {
    const runtime = Object.fromEntries(names.map((name) => [name, available.has(name) ? '[captured]' : undefined]));
    resolvedTest(test, sources, names.length > 0 ? runtime : sources.runtime);
    for (const name of Object.keys(test.capture ?? {})) available.add(name);
  }
}

/**
 * Runs several files as one flow, in order: values captured in one file are available to the
 * next ones. Returns the outcomes of each file; a file the flow never reached has none.
 */
export async function runTestFiles(files: TestFile[], curlBin: string, sources: VarSources = EMPTY_SOURCES): Promise<TestOutcome[][]> {
  validateRunVariables(files, sources);
  const secrets: string[] = [];
  const names = captureNames(files.flatMap((file) => file.tests));
  const runtime: Record<string, string | undefined> | undefined = names.length > 0 ? Object.fromEntries(names.map((name) => [name, undefined])) : undefined;
  const perFile: TestOutcome[][] = files.map(() => []);
  flow: for (const [index, file] of files.entries()) {
    const outcomes = perFile[index]!;
    for (const template of file.tests) {
      const test = resolvedTest(template, sources, runtime ?? sources.runtime);
      const result = await runRequest(curlBin, test.request);
      const asserts = result.error === null ? checkExpectations(test.expect, result) : [];
      if (!test.capture || !runtime) { outcomes.push({ name: test.name, result, asserts }); continue; }

      // A test that captures is a prerequisite of what follows: if it fails, the flow stops.
      const ready = result.error === null && asserts.every((assert) => assert.ok);
      const hidden = Object.hasOwn(test.capture, 'authToken');
      const captures: AssertResult[] = [];
      for (const [name, path] of Object.entries(test.capture)) {
        runtime[name] = undefined;
        if (name === 'authToken') {
          let captured = false;
          if (ready) {
            try {
              const token = captureAuthToken(result, { authToken: path });
              secrets.push(token); runtime.authToken = token; captured = true;
            } catch { /* Report a failed prerequisite without exposing the authentication response. */ }
          }
          captures.push({ ok: captured, label: 'authentication token captured', ...(!captured ? { message: 'Authentication or token capture failed; flow stopped; remaining requests were not executed' } : {}) });
          continue;
        }
        const label = `capture ${name} from ${path}`;
        if (!ready) { captures.push({ ok: false, label, message: 'not captured: the request or its asserts failed; flow stopped' }); continue; }
        try {
          runtime[name] = captureValue(result, path);
          captures.push({ ok: true, label });
        } catch (error) {
          captures.push({ ok: false, label, message: `${(error as Error).message}; flow stopped; remaining requests were not executed` });
        }
      }
      if (hidden) {
        const safeAsserts = asserts.map((assert, index) => ({ ok: assert.ok, label: `authentication assertion ${index + 1}`, ...(!assert.ok ? { message: 'Authentication assertion failed; flow stopped' } : {}) }));
        outcomes.push({ name: test.name, responseHidden: true, result: { ...result, headers: {}, body: '[authentication response hidden]', error: result.error === null ? null : 'Authentication request failed; flow stopped' }, asserts: [...safeAsserts, ...captures] });
      } else outcomes.push({ name: test.name, result, asserts: [...asserts, ...captures] });
      if (!captures.every((capture) => capture.ok)) break flow;
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
