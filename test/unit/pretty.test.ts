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

test('response mode includes status, repeated headers and a readable JSON body even for failed assertions', () => {
  const response: TestOutcome = { ...outcomes[1]!, result: { ...outcomes[1]!.result, headers: { 'content-type': ['application/json'], 'x-multi': ['one', 'two'] }, body: '{"error":"Not found"}' } };
  const report = formatPretty(undefined, [response], { color: false, showResponse: true });
  expect(report).toContain('Response: HTTP 404');
  expect(report).toContain('content-type: application/json');
  expect(report).toContain('x-multi: one');
  expect(report).toContain('x-multi: two');
  expect(report).toContain('"error": "Not found"');
  expect(report).toContain('1 test: 0 passed, 1 failed');
  expect(formatPretty(undefined, [response], { color: false })).not.toContain('Response:');
});

test('plain text, empty bodies and terminal control characters are represented safely', () => {
  const raw = { ...outcomes[0]!, result: { ...outcomes[0]!.result, body: 'hello\r\n\u001b[2J\0world' } };
  const report = formatPretty(undefined, [raw, outcomes[0]!], { color: false, showResponse: true });
  expect(report).toContain('hello\n');
  expect(report).toContain('\\x1b[2J\\x00world');
  expect(report).not.toContain('\u001b');
  expect(report).not.toContain('\0');
  expect(report).toContain('(empty)');
});

test('response formatting preserves large numeric IDs instead of rounding them', () => {
  const response = { ...outcomes[0]!, result: { ...outcomes[0]!.result, body: '{"id":9007199254740993}' } };
  expect(formatPretty(undefined, [response], { color: false, showResponse: true })).toContain('9007199254740993');
});
