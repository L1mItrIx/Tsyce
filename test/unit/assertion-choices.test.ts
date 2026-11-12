import { expect, test } from 'vitest';
import { assertionChoices, selectedExpectations } from '../../src/tui/assertion-choices.js';
import { checkExpectations } from '../../src/core/asserts.js';
import type { RunResult } from '../../src/core/runner/exec.js';

const result: RunResult = { status: 201, timeMs: 120, headers: { 'content-type': ['application/json; charset=utf-8'], 'x-test': ['one', 'two'] },
  body: JSON.stringify({ id: 3, 'odd.key': { "quote'": 'a.b*' }, list: [null, true], empty: {} }), error: null, curlExitCode: 0 };

test('every generated assertion validates the original response, including escaped JSON paths', () => {
  const choices = assertionChoices(result);
  const selected = selectedExpectations(choices, choices.map((_, i) => i));
  const checks = checkExpectations(selected, result);
  expect(checks.length).toBeGreaterThan(12);
  expect(checks.every((check) => check.ok)).toBe(true);
  expect(selected.status).toBe(201);
  expect(selected.headers?.['content-type']).toEqual({ contains: 'application/json' });
  expect(selected.json?.some((rule) => rule.path.includes('odd.key'))).toBe(true);
  expect(selected.json?.some((rule) => 'matches' in rule)).toBe(true);
  expect(selected.json?.some((rule) => 'type' in rule)).toBe(true);
});

test('non-JSON has no JSON options; failed network has no assertions', () => {
  const choices = assertionChoices({ ...result, body: '<html>not JSON</html>' });
  expect(choices.some((choice) => choice.expect.json)).toBe(false);
  expect(assertionChoices({ ...result, status: 0, error: 'connection refused', curlExitCode: 7 })).toEqual([]);
  expect(selectedExpectations(choices, [])).toEqual({});
});

test('limits options for large responses and never renders raw terminal control characters', () => {
  const choices = assertionChoices({ ...result, body: JSON.stringify(Array.from({ length: 2000 }, () => '\u001b[2J')) });
  expect(choices.length).toBeLessThanOrEqual(200);
  expect(choices.every((choice) => !choice.label.includes('\u001b'))).toBe(true);
});

test('token fields offer exists/type checks but never literal token assertions', () => {
  const choices = assertionChoices({ ...result, body: '{"access_token":"SECRET_VALUE","refresh_token":null}' });
  expect(JSON.stringify(choices)).not.toContain('SECRET_VALUE');
  expect(choices.some((choice) => choice.expect.json?.some((rule) => rule.path.includes('access_token') && 'exists' in rule))).toBe(true);
});
