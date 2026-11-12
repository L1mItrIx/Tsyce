import { describe, expect, test } from 'vitest';
import { checkExpectations } from '../../src/core/asserts.js';
import type { RunResult } from '../../src/core/runner/exec.js';
import { expectSchema } from '../../src/core/schema.js';

const BODY = {
  id: 7,
  name: 'Ana',
  email: 'ana@example.com',
  active: true,
  deleted: null,
  tags: ['admin', 'ops'],
  profile: { age: 30 },
  items: [
    { id: 1, ok: true },
    { id: 2, ok: true },
  ],
};

function response(overrides: Partial<RunResult> = {}): RunResult {
  return {
    status: 201,
    timeMs: 120,
    headers: { 'content-type': ['application/json; charset=utf-8'], 'set-cookie': ['a=1', 'b=2'] },
    body: JSON.stringify(BODY),
    curlExitCode: 0,
    error: null,
    ...overrides,
  };
}

const check = (input: unknown, result = response()) => checkExpectations(expectSchema.parse(input), result);

type Case = [name: string, input: unknown, label: string, failure?: string];

function table(cases: Case[]) {
  test.each(cases)('%s', (_name, input, label, failure) => {
    const expected = failure === undefined ? { ok: true, label } : { ok: false, label, message: failure };
    expect(check(input)).toEqual([expected]);
  });
}

describe('status', () => {
  table([
    ['matches a single code', { status: 201 }, 'status is 201'],
    ['matches a list', { status: [200, 201] }, 'status is one of 200, 201'],
    ['fails on another code', { status: 200 }, 'status is 200', 'got 201'],
    ['fails outside the list', { status: [200, 204] }, 'status is one of 200, 204', 'got 201'],
  ]);
});

describe('maxTimeMs', () => {
  table([
    ['passes under the limit', { maxTimeMs: 800 }, 'time is at most 800 ms'],
    ['passes at the limit', { maxTimeMs: 120 }, 'time is at most 120 ms'],
    ['fails over the limit', { maxTimeMs: 100 }, 'time is at most 100 ms', 'took 120 ms'],
  ]);
});

describe('headers', () => {
  table([
    [
      'contains, with a case-insensitive name',
      { headers: { 'Content-Type': { contains: 'application/json' } } },
      'header Content-Type contains "application/json"',
    ],
    [
      'equals fails on a partial value',
      { headers: { 'content-type': { equals: 'application/json' } } },
      'header content-type equals "application/json"',
      'got "application/json; charset=utf-8"',
    ],
    [
      'any value of a repeated header may match',
      { headers: { 'set-cookie': { equals: 'b=2' } } },
      'header set-cookie equals "b=2"',
    ],
    [
      'missing header',
      { headers: { etag: { contains: 'x' } } },
      'header etag contains "x"',
      'header not present',
    ],
  ]);
});

describe('json', () => {
  table([
    ['exists', { json: [{ path: '$.id', exists: true }] }, '$.id exists'],
    ['exists also for a null value', { json: [{ path: '$.deleted', exists: true }] }, '$.deleted exists'],
    ['exists fails without match', { json: [{ path: '$.nope', exists: true }] }, '$.nope exists', 'no match'],
    ['not exists', { json: [{ path: '$.nope', exists: false }] }, '$.nope does not exist'],
    ['not exists fails on a match', { json: [{ path: '$.id', exists: false }] }, '$.id does not exist', 'found 7'],
    ['equals a string', { json: [{ path: '$.name', equals: 'Ana' }] }, '$.name equals "Ana"'],
    ['equals an object deeply', { json: [{ path: '$.profile', equals: { age: 30 } }] }, '$.profile equals {"age":30}'],
    ['equals does not coerce types', { json: [{ path: '$.id', equals: '7' }] }, '$.id equals "7"', 'got 7'],
    ['equals fails without match', { json: [{ path: '$.nope', equals: 1 }] }, '$.nope equals 1', 'no match'],
    ['equals holds for every matched node', { json: [{ path: '$.items[*].ok', equals: true }] }, '$.items[*].ok equals true'],
    ['equals fails if one matched node differs', { json: [{ path: '$.items[*].id', equals: 1 }] }, '$.items[*].id equals 1', 'got 2'],
    ['contains a substring', { json: [{ path: '$.email', contains: '@example.' }] }, '$.email contains "@example."'],
    ['contains an array element', { json: [{ path: '$.tags', contains: 'ops' }] }, '$.tags contains "ops"'],
    ['contains fails', { json: [{ path: '$.tags', contains: 'dev' }] }, '$.tags contains "dev"', 'got ["admin","ops"]'],
    ['contains on a number is a clear failure', { json: [{ path: '$.id', contains: '7' }] }, '$.id contains "7"', 'contains needs a string or an array, got number'],
    ['matches a regex', { json: [{ path: '$.email', matches: '^\\w+@example\\.com$' }] }, '$.email matches /^\\w+@example\\.com$/'],
    ['matches fails', { json: [{ path: '$.name', matches: '^\\d+$' }] }, '$.name matches /^\\d+$/', 'got "Ana"'],
    ['matches on a non-string', { json: [{ path: '$.id', matches: '7' }] }, '$.id matches /7/', 'matches needs a string, got number'],
    ['type array', { json: [{ path: '$.tags', type: 'array' }] }, '$.tags has type array'],
    ['type null', { json: [{ path: '$.deleted', type: 'null' }] }, '$.deleted has type null'],
    ['type fails', { json: [{ path: '$.id', type: 'string' }] }, '$.id has type string', 'got number'],
  ]);

  test('a body that is not JSON fails every json assert', () => {
    const results = check(
      { json: [{ path: '$.id', exists: true }, { path: '$.x', exists: false }] },
      response({ body: '<html>oops</html>' }),
    );
    expect(results).toEqual([
      { ok: false, label: '$.id exists', message: 'response body is not valid JSON' },
      { ok: false, label: '$.x does not exist', message: 'response body is not valid JSON' },
    ]);
  });
});

test('results follow the order status, time, headers, json; empty expect yields none', () => {
  const results = check({
    json: [{ path: '$.id', equals: 7 }],
    headers: { 'content-type': { contains: 'json' } },
    maxTimeMs: 50,
    status: 201,
  });
  expect(results.map((r) => [r.ok, r.label])).toEqual([
    [true, 'status is 201'],
    [false, 'time is at most 50 ms'],
    [true, 'header content-type contains "json"'],
    [true, '$.id equals 7'],
  ]);
  expect(check({})).toEqual([]);
});
