import { outcomeStatus, type TestOutcome } from '../run.js';

function xml(value: string): string {
  return value
    .replace(/[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/gu, '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

/** JUnit XML, with one testcase per request and failures distinct from transport errors. */
export function formatJUnit(name: string | undefined, outcomes: TestOutcome[]): string {
  const suite = xml(name ?? 'httpi');
  const failures = outcomes.filter((outcome) => outcomeStatus(outcome) === 'failed').length;
  const errors = outcomes.filter((outcome) => outcomeStatus(outcome) === 'errored').length;
  const time = outcomes.reduce((total, outcome) => total + outcome.result.timeMs, 0) / 1000;
  const counts = `tests="${outcomes.length}" failures="${failures}" errors="${errors}" time="${time}"`;
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', `<testsuites ${counts}>`, `  <testsuite name="${suite}" ${counts}>`];
  for (const outcome of outcomes) {
    const attrs = `name="${xml(outcome.name)}" classname="${suite}" time="${outcome.result.timeMs / 1000}"`;
    const status = outcomeStatus(outcome);
    if (status === 'passed') { lines.push(`    <testcase ${attrs} />`); continue; }
    const tag = status === 'errored' ? 'error' : 'failure';
    const type = status === 'errored' ? 'CurlError' : 'AssertionError';
    const message = xml(status === 'errored' ? outcome.result.error! : outcome.asserts
      .filter((assert) => !assert.ok).map((assert) => `${assert.label}: ${assert.message ?? 'failed'}`).join('; '));
    lines.push(`    <testcase ${attrs}>`, `      <${tag} type="${type}" message="${message}">${message}</${tag}>`, '    </testcase>');
  }
  lines.push('  </testsuite>', '</testsuites>');
  return lines.join('\n');
}
