import { describe, expect, test } from 'vitest';
import { expectSchema, testFileSchema } from '../../src/core/schema.js';

const minimal = { version: 1, tests: [{ name: 't', request: { url: 'http://x' } }] };

test('authentication capture is optional, strict and requires a valid JSONPath', () => {
  expect(testFileSchema.safeParse({ ...minimal, tests: [{ ...minimal.tests[0], capture: { authToken: '$.access_token' } }] }).success).toBe(true);
  for (const capture of [{}, { token: '$.token' }, { authToken: '$[' }, { authToken: 123 }]) {
    expect(testFileSchema.safeParse({ ...minimal, tests: [{ ...minimal.tests[0], capture }] }).success).toBe(false);
  }
});

describe('testFileSchema', () => {
  test('accepts the minimal file', () => {
    expect(testFileSchema.safeParse(minimal).success).toBe(true);
  });

  test.each([
    ['unsupported version', { ...minimal, version: 2 }],
    ['missing version', { tests: minimal.tests }],
    ['no tests', { version: 1, tests: [] }],
    ['unknown top-level key', { ...minimal, steps: [] }],
    ['test without name', { version: 1, tests: [{ request: { url: 'http://x' } }] }],
    ['request without url', { version: 1, tests: [{ name: 't', request: {} }] }],
  ])('rejects %s', (_name, input) => {
    expect(testFileSchema.safeParse(input).success).toBe(false);
  });
});

describe('expectSchema', () => {
  test.each([
    ['single status', { status: 200 }],
    ['status list', { status: [200, 201] }],
    ['max time', { maxTimeMs: 800 }],
    ['header equals / contains', { headers: { a: { equals: 'x' }, b: { contains: 'y' } } }],
    ['json equals with any JSON value', { json: [{ path: '$.a', equals: { b: [1, null] } }] }],
    ['json exists false', { json: [{ path: '$.a', exists: false }] }],
    ['json contains', { json: [{ path: '$.a', contains: 'x' }] }],
    ['json matches', { json: [{ path: '$.a', matches: '^\\d+$' }] }],
    ['json type', { json: [{ path: '$.a', type: 'array' }] }],
  ])('accepts %s', (_name, input) => {
    expect(expectSchema.safeParse(input).success).toBe(true);
  });

  test.each([
    ['status out of range', { status: 99 }],
    ['empty status list', { status: [] }],
    ['non-positive max time', { maxTimeMs: 0 }],
    ['header with two matchers', { headers: { a: { equals: 'x', contains: 'y' } } }],
    ['header with no matcher', { headers: { a: {} } }],
    ['json assert without matcher', { json: [{ path: '$.a' }] }],
    ['json assert with two matchers', { json: [{ path: '$.a', equals: 1, exists: true }] }],
    ['json assert without path', { json: [{ equals: 1 }] }],
    ['path that is not JSONPath', { json: [{ path: 'a.b', exists: true }] }],
    ['path with JSONPath syntax error', { json: [{ path: '$.a[', exists: true }] }],
    ['invalid regex', { json: [{ path: '$.a', matches: '(' }] }],
    ['unknown type', { json: [{ path: '$.a', type: 'date' }] }],
    ['unknown assert key', { bodyContains: 'x' }],
  ])('rejects %s', (_name, input) => {
    expect(expectSchema.safeParse(input).success).toBe(false);
  });
});
