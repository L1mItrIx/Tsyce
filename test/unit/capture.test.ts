import { expect, test } from 'vitest';
import { captureAuthToken, maskSecrets, responseTokenFields } from '../../src/core/capture.js';
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
