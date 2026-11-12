import { outcomeStatus, type Suite, type TestOutcome } from '../run.js';

function xml(value: string): string {
  return value
    .replace(/[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/gu, '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

const failed = (outcomes: TestOutcome[]) => outcomes.filter((outcome) => outcomeStatus(outcome) === 'failed').length;
const errored = (outcomes: TestOutcome[]) => outcomes.filter((outcome) => outcomeStatus(outcome) === 'errored').length;
const seconds = (outcomes: TestOutcome[]) => outcomes.reduce((total, outcome) => total + outcome.result.timeMs, 0) / 1000;
const counts = (outcomes: TestOutcome[]) =>
  `tests="${outcomes.length}" failures="${failed(outcomes)}" errors="${errored(outcomes)}" time="${seconds(outcomes)}"`;

/** JUnit XML with one testsuite per file and one testcase per request; failures are distinct from transport errors. */
export function formatJUnitSuites(suites: Suite[]): string {
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', `<testsuites ${counts(suites.flatMap((suite) => suite.outcomes))}>`];
  for (const { name, outcomes } of suites) {
    const suite = xml(name ?? 'httpi');
    lines.push(`  <testsuite name="${suite}" ${counts(outcomes)}>`);
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
    lines.push('  </testsuite>');
  }
  lines.push('</testsuites>');
  return lines.join('\n');
}

/** JUnit XML for a single test file. */
export function formatJUnit(name: string | undefined, outcomes: TestOutcome[]): string {
  return formatJUnitSuites([{ name, outcomes }]);
}
