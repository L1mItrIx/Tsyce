import { describe, expect, test } from 'vitest';
import { createWizardState, HTTP_METHODS, wizardReducer } from '../../src/tui/wizard-state.js';

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

test('method selection wraps through the visible methods and commits the chosen method', () => {
  const initial = createWizardState();
  const post = wizardReducer(initial, { type: 'move-method', direction: 1 });
  expect(post.input).toBe('POST');
  expect(wizardReducer(post, { type: 'next' }).request.method).toBe('POST');
  const previous = wizardReducer(initial, { type: 'move-method', direction: -1 });
  expect(previous.input).toBe(HTTP_METHODS.at(-1));
  expect(wizardReducer(previous, { type: 'move-method', direction: 1 }).input).toBe('GET');
  expect(wizardReducer(initial, { type: 'next' }).request.method).toBe('GET');
});

test('custom methods remain editable and method arrows cannot change later stages', () => {
  const state = submit(createWizardState(), 'PROPFIND');
  expect(state.request.method).toBe('PROPFIND');
  expect(wizardReducer(state, { type: 'move-method', direction: 1 })).toBe(state);
});

test('the JSON body preset adds the required content type without overwriting an existing one', () => {
  const state = { ...createWizardState(), step: 'body' as const };
  const json = wizardReducer(state, { type: 'json-example' });
  expect(JSON.parse(json.input)).toEqual({ name: 'Ana' });
  expect(json.request.headers['Content-Type']).toBe('application/json');
  const custom = { ...state, request: { ...state.request, headers: { 'content-type': 'application/custom+json', Authorization: 'Bearer fake' } } };
  expect(wizardReducer(custom, { type: 'json-example' }).request.headers).toEqual(custom.request.headers);
  expect(wizardReducer(createWizardState(), { type: 'json-example' }).step).toBe('method');
});

test('captured-token header replaces manual Authorization without exposing the token or duplicating headers', () => {
  const state = { ...createWizardState(), step: 'headers' as const, input: 'X-Test: yes\nauthorization: old' };
  const next = wizardReducer(state, { type: 'use-captured-token' });
  expect(next.input).toBe('X-Test: yes\nAuthorization: Bearer {{authToken}}');
  expect(wizardReducer(next, { type: 'use-captured-token' }).input).toBe(next.input);
});

describe('files and data in the wizard', () => {
  const atBody = () => ([
    { type: 'input', value: 'POST' }, { type: 'next' },
    { type: 'input', value: 'https://api.example/upload' }, { type: 'next' },
    { type: 'next' },
  ] as const).reduce(wizardReducer, createWizardState());

  test('attaching a file sends it as a multipart form and goes to the review', () => {
    const state = wizardReducer(atBody(), { type: 'attach-file', path: 'files/a b.pdf' });
    expect(state.step).toBe('review');
    expect(state.request.body).toEqual({ form: ['file=@files/a b.pdf'] });
  });

  test('going back keeps the attached file unless text replaces it or "no body" removes it', () => {
    const attached = wizardReducer(wizardReducer(atBody(), { type: 'attach-file', path: 'a.pdf' }), { type: 'back' });
    expect([attached.step, attached.input]).toEqual(['body', '']);
    expect(wizardReducer(attached, { type: 'next' }).request.body).toEqual({ form: ['file=@a.pdf'] });
    const typed = wizardReducer(wizardReducer(attached, { type: 'input', value: 'hello' }), { type: 'next' });
    expect(typed.request.body).toEqual({ text: 'hello' });
    const none = wizardReducer(attached, { type: 'no-body' });
    expect(none.step).toBe('review');
    expect(none.request.body).toBeUndefined();
  });

  test('a data file is chosen at the review, kept through edits, and can be removed', () => {
    const review = wizardReducer(atBody(), { type: 'no-body' });
    const withData = wizardReducer(review, { type: 'use-data', path: 'data/users.csv' });
    expect(withData.data).toBe('data/users.csv');
    const edited = wizardReducer(wizardReducer(withData, { type: 'back' }), { type: 'next' });
    expect(edited.data).toBe('data/users.csv');
    expect(wizardReducer(withData, { type: 'clear-data' }).data).toBeUndefined();
    expect(wizardReducer(withData, { type: 'next' })).toMatchObject({ step: 'ready', data: 'data/users.csv' });
  });

  test('these actions do nothing outside their step', () => {
    const start = createWizardState();
    expect(wizardReducer(start, { type: 'attach-file', path: 'a' })).toBe(start);
    expect(wizardReducer(start, { type: 'no-body' })).toBe(start);
    expect(wizardReducer(start, { type: 'use-data', path: 'a.csv' })).toBe(start);
    expect(wizardReducer(start, { type: 'clear-data' })).toBe(start);
  });
});
