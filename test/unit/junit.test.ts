import { expect, test } from 'vitest';
import { formatJUnit, formatJUnitSuites } from '../../src/core/reporter/junit.js';
import type { TestOutcome } from '../../src/core/run.js';

const pass: TestOutcome = { name: 'works', result: { status: 200, timeMs: 125, headers: {}, body: '', curlExitCode: 0, error: null }, asserts: [{ ok: true, label: 'status is 200' }] };

test('reports passes, assertion failures and curl errors separately with seconds', () => {
  const report = formatJUnit('suite', [pass,
    { ...pass, name: 'wrong status', asserts: [{ ok: false, label: 'status is 201', message: 'got 200' }] },
    { ...pass, name: 'network', result: { ...pass.result, curlExitCode: 7, error: 'connection refused' }, asserts: [] },
  ]);
  expect(report).toContain('tests="3" failures="1" errors="1" time="0.375"');
  expect(report).toContain('<testcase name="works" classname="suite" time="0.125" />');
  expect(report).toContain('<failure type="AssertionError" message="status is 201: got 200">');
  expect(report).toContain('<error type="CurlError" message="connection refused">');
});

test('escapes XML in names, errors and messages and removes forbidden control characters', () => {
  const report = formatJUnit('a&b"<>', [{ ...pass, name: "quote'\0\u001b🙌", asserts: [{ ok: false, label: '<status>', message: '&"' }] }]);
  expect(report).toContain('name="a&amp;b&quot;&lt;&gt;"');
  expect(report).toContain('name="quote&apos;🙌"');
  expect(report).toContain('&lt;status&gt;: &amp;&quot;');
  expect(report).not.toContain('\0');
  expect(report).not.toContain('\u001b');
});

test('empty suites have zero counts and a stable default name', () => {
  expect(formatJUnit(undefined, [])).toContain('<testsuite name="httpi" tests="0" failures="0" errors="0" time="0">');
});

test('a project run has one testsuite per file and totals on testsuites', () => {
  const failing = { ...pass, name: 'wrong status', asserts: [{ ok: false, label: 'status is 201', message: 'got 200' }] };
  const report = formatJUnitSuites([
    { name: 'Login', outcomes: [pass] },
    { name: 'tests/users.yaml', outcomes: [pass, failing] },
    { name: 'tests/admin.yaml', outcomes: [] },
  ]);
  expect(report).toContain('<testsuites tests="3" failures="1" errors="0" time="0.375">');
  expect(report).toContain('<testsuite name="Login" tests="1" failures="0" errors="0" time="0.125">');
  expect(report).toContain('<testsuite name="tests/users.yaml" tests="2" failures="1" errors="0" time="0.25">');
  expect(report).toContain('<testcase name="wrong status" classname="tests/users.yaml" time="0.125">');
  expect(report).toContain('<testsuite name="tests/admin.yaml" tests="0" failures="0" errors="0" time="0">');
  expect(report.match(/<\/testsuite>/g)).toHaveLength(3);
});
