import { expect, test } from 'vitest';
import { createWizardState, wizardReducer } from '../../src/tui/wizard-state.js';

const submit = (state: ReturnType<typeof createWizardState>, value: string) =>
  wizardReducer(wizardReducer(state, { type: 'input', value }), { type: 'next' });

test('builds a validated request without mutating previous states', () => {
  const initial = createWizardState();
  const method = submit(initial, 'post');
  const url = submit(method, 'https://example.test/users');
  const headers = submit(url, 'Content-Type: application/json\nAuthorization: Bearer fake');
  const body = submit(headers, '{"name":"Ana"}');
  expect(body.step).toBe('review');
  expect(body.request).toEqual({ method: 'POST', url: 'https://example.test/users', headers: {
    'Content-Type': 'application/json', Authorization: 'Bearer fake',
  }, body: { text: '{"name":"Ana"}' } });
  expect(wizardReducer(body, { type: 'next' }).step).toBe('ready');
  expect(initial.request.method).toBe('GET');
  expect(initial.request.headers).toEqual({});
});

test('defaults to GET and permits empty headers and body', () => {
  let state = submit(createWizardState(), '');
  state = submit(state, 'http://localhost:3000');
  state = submit(state, '');
  state = submit(state, '');
  expect(state.request.method).toBe('GET');
  expect(state.request.body).toBeUndefined();
});

test.each([
  ['method', 'GET;whoami'], ['url', 'file:///etc/passwd'], ['url', 'https://'],
  ['headers', 'no colon'], ['headers', ': empty name'], ['headers', 'Bad Name: value'],
  ['headers', 'A: first\na: repeated'], ['headers', 'A: nul\0value'],
] as const)('rejects invalid %s input without advancing', (step, value) => {
  const state = { ...createWizardState(), step };
  const result = submit(state, value);
  expect(result.step).toBe(step);
  expect(result.error).not.toBeNull();
  expect(result.request).toEqual(state.request);
});

test('back restores saved values, clears errors, and allows removing the body', () => {
  let state = submit(createWizardState(), 'POST');
  state = submit(state, 'http://example.test');
  state = submit(state, 'X-Test: a:b');
  state = submit(state, 'payload');
  state = wizardReducer(state, { type: 'back' });
  expect(state.input).toBe('payload');
  state = submit(state, '');
  expect(state.request.body).toBeUndefined();
  state = wizardReducer(wizardReducer(state, { type: 'back' }), { type: 'back' });
  expect(state.input).toBe('X-Test: a:b');
});

test('cancel is terminal and next at the first step cannot go back', () => {
  const initial = createWizardState();
  expect(wizardReducer(initial, { type: 'back' })).toEqual(initial);
  const cancelled = wizardReducer(initial, { type: 'cancel' });
  expect(cancelled.step).toBe('cancelled');
  expect(submit(cancelled, 'POST')).toBe(cancelled);
});
