import { expect, test } from 'vitest';
import { captureAuthToken, CaptureError, captureValue, maskSecrets, responseTokenFields } from '../../src/core/capture.js';
import type { RunResult } from '../../src/core/runner/exec.js';
const result: RunResult = { status: 200, timeMs: 1, headers: {}, body: '{"data":{"access_token":"FAKE_TOKEN"}}', error: null, curlExitCode: 0 };

test('finds token fields without exposing their values and captures nested strings', () => {
  expect(responseTokenFields(result)).toEqual(['$["data"]["access_token"]']);
  expect(captureAuthToken(result, { authToken: '$.data.access_token' })).toBe('FAKE_TOKEN');
});

test.each(['{}', '{"token":123}', '{"token":""}', '{"token":"Bearer "}', '{"token":"a\\r\\nb"}', 'not JSON'])('rejects missing or invalid token responses: %s', (body) => {
  expect(() => captureAuthToken({ ...result, body }, { authToken: '$.token' })).toThrow();
});

test('rejects unsuccessful authentication and ambiguous selectors', () => {
  expect(() => captureAuthToken({ ...result, status: 401 }, { authToken: '$.data.access_token' })).toThrow();
  expect(() => captureAuthToken({ ...result, body: '{"tokens":["a","b"]}' }, { authToken: '$.tokens[*]' })).toThrow();
  expect(maskSecrets({ token: 'Bearer FAKE_TOKEN', values: ['FAKE_TOKEN'] }, ['FAKE_TOKEN'])).toEqual({ token: 'Bearer [REDACTED]', values: ['[REDACTED]'] });
  expect(maskSecrets({ 'a+b': 'query=a%2Bb' }, ['a+b'])).toEqual({ '[REDACTED]': 'query=[REDACTED]' });
});

test.each<[string, string, string]>([
  ['text', '$.user.name', 'Ana'],
  ['a number', '$.user.id', '42'],
  ['a boolean', '$.user.active', 'true'],
  ['an empty text', '$.user.note', ''],
  ['one element of a list', '$.user.tags[1]', 'ops'],
])('captureValue reads %s as text', (_name, path, expected) => {
  const body = JSON.stringify({ user: { id: 42, name: 'Ana', active: true, note: '', tags: ['admin', 'ops'], profile: {}, deleted: null } });
  expect(captureValue({ ...result, body }, path)).toBe(expected);
});

test.each<[string, string, string, string]>([
  ['no match', '{"a":1}', '$.b', 'no match'],
  ['several matches', '{"a":[1,2]}', '$.a[*]', '2 matches; the path must select exactly one value'],
  ['an object', '{"a":{}}', '$.a', 'selected an object; only text, numbers and booleans can be captured'],
  ['an array', '{"a":[]}', '$.a', 'selected an array; only text, numbers and booleans can be captured'],
  ['null', '{"a":null}', '$.a', 'selected null; only text, numbers and booleans can be captured'],
  ['a body that is not JSON', '<html>', '$.a', 'response body is not valid JSON'],
])('captureValue rejects %s', (_name, body, path, message) => {
  expect(() => captureValue({ ...result, body }, path)).toThrow(CaptureError);
  expect(() => captureValue({ ...result, body }, path)).toThrow(message);
});
