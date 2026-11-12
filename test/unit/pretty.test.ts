import { expect, test } from 'vitest';
import { formatPretty } from '../../src/core/reporter/pretty.js';
import type { TestOutcome } from '../../src/core/run.js';

const outcomes: TestOutcome[] = [
  {
    name: 'POST /users returns 201',
    result: { status: 201, timeMs: 120, headers: {}, body: '', curlExitCode: 0, error: null },
    asserts: [
      { ok: true, label: 'status is 201' },
      { ok: true, label: '$.id exists' },
    ],
  },
  {
    name: 'GET /users/7',
    result: { status: 404, timeMs: 12, headers: {}, body: '', curlExitCode: 0, error: null },
    asserts: [
      { ok: false, label: 'status is 200', message: 'got 404' },
      { ok: true, label: 'time is at most 800 ms' },
    ],
  },
  {
    name: 'GET /health',
    result: { status: 0, timeMs: 0, headers: {}, body: '', curlExitCode: 7, error: 'Failed to connect to 127.0.0.1 port 1' },
    asserts: [],
  },
];

test('plain report lists every test, its asserts and a summary', () => {
  expect(formatPretty('Users API', outcomes, { color: false })).toBe(
    [
      'Users API',
      '',
      '✓ POST /users returns 201 (201, 120 ms)',
      '    ✓ status is 201',
      '    ✓ $.id exists',
      '✗ GET /users/7 (404, 12 ms)',
      '    ✗ status is 200: got 404',
      '    ✓ time is at most 800 ms',
      '! GET /health',
      '    curl error 7: Failed to connect to 127.0.0.1 port 1',
      '',
      '3 tests: 1 passed, 1 failed, 1 errored',
    ].join('\n'),
  );
});

test('all green: no title, singular summary, no failure counters', () => {
  expect(formatPretty(undefined, outcomes.slice(0, 1), { color: false })).toBe(
    ['✓ POST /users returns 201 (201, 120 ms)', '    ✓ status is 201', '    ✓ $.id exists', '', '1 test: 1 passed'].join('\n'),
  );
});

test('color only adds ANSI codes around the same text', () => {
  const colored = formatPretty('Users API', outcomes, { color: true });
  expect(colored).toContain('\u001B[31m');
  expect(colored.replace(/\u001B\[\d+m/g, '')).toBe(formatPretty('Users API', outcomes, { color: false }));
});
