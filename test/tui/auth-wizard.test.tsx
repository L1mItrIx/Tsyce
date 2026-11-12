import { act } from 'react';
import { cleanup, render } from 'ink-testing-library';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  type AuthWizardAction,
  authWizardReducer,
  AuthWizard,
  buildAuthBlock,
  createAuthWizardState,
  fieldsFor,
} from '../../src/tui/auth-wizard.js';

afterEach(async () => {
  await act(async () => { cleanup(); });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false });
});
const tick = () => new Promise((resolve) => setTimeout(resolve, 50));

/** Feeds answers to the reducer: a string is typed and confirmed, anything else is a raw action. */
function answer(steps: Array<string | AuthWizardAction>, taken: string[] = []) {
  return steps.reduce(
    (state, step) => (typeof step === 'string' ? authWizardReducer(authWizardReducer(state, { type: 'input', value: step }), { type: 'next' }) : authWizardReducer(state, step)),
    createAuthWizardState(taken),
  );
}
const down: AuthWizardAction = { type: 'move', direction: 1 };
const next: AuthWizardAction = { type: 'next' };

describe('authWizardReducer', () => {
  test('client_credentials with defaults: the secret is saved as a variable name, never a value', () => {
    const state = answer(['', next, '{{baseUrl}}/oauth/token', 'ci-client', '', 'users.read  users.write']);
    expect(state.step).toBe('review');
    expect(buildAuthBlock(state)).toEqual({
      name: 'main',
      block: { type: 'oauth2', flow: 'client_credentials', tokenUrl: '{{baseUrl}}/oauth/token', clientId: 'ci-client', clientSecret: '${CLIENT_SECRET}', scopes: ['users.read', 'users.write'] },
    });
    expect(authWizardReducer(state, next).step).toBe('done');
  });

  test('authorization_code for a public client asks for the authorization URL and the callback port', () => {
    const state = answer(['me', down, next, 'https://id.example/token', 'https://id.example/authorize', '${CLIENT_ID}', '', '', '9000']);
    expect(fieldsFor('authorization_code')).toEqual(['name', 'flow', 'tokenUrl', 'authorizationUrl', 'clientId', 'secretVariable', 'scopes', 'redirectPort']);
    expect(buildAuthBlock(state)).toEqual({
      name: 'me',
      block: { type: 'oauth2', flow: 'authorization_code', tokenUrl: 'https://id.example/token', authorizationUrl: 'https://id.example/authorize', clientId: '${CLIENT_ID}', redirectPort: 9000 },
    });
  });

  test('refresh_token asks for the variable that holds the refresh token', () => {
    const state = answer(['user', down, down, next, 'https://id.example/token', 'cli', 'APP_SECRET', '', '']);
    expect(buildAuthBlock(state).block).toEqual({ type: 'oauth2', flow: 'refresh_token', tokenUrl: 'https://id.example/token', clientId: 'cli', clientSecret: '${APP_SECRET}', refreshToken: '${REFRESH_TOKEN}' });
  });

  test.each<[name: string, steps: Array<string | AuthWizardAction>, step: string, error: RegExp]>([
    ['a name already in httpi.yaml', ['main'], 'name', /already has an auth block named "main"/],
    ['a name with spaces', ['my auth'], 'name', /Use a simple name/],
    ['an empty token URL', ['x', next, ''], 'tokenUrl', /required/],
    ['a secret typed instead of a variable name', ['x', next, 'https://t', 'id', 's3cr3t-value!'], 'secretVariable', /NAME of an environment variable/],
    ['a port out of range', ['x', down, next, 'https://t', 'https://a', 'id', '', '', '70000'], 'redirectPort', /port between 1 and 65535/],
  ])('stays on the question and explains: %s', (_name, steps, step, error) => {
    const state = answer(steps, ['main']);
    expect(state.step).toBe(step);
    expect(state.error).toMatch(error);
  });

  test('back returns to the previous answer, and changing the flow changes the questions', () => {
    let state = answer(['x', next, 'https://t', 'id']);
    expect(state.step).toBe('secretVariable');
    state = authWizardReducer(state, { type: 'back' });
    expect([state.step, state.input]).toEqual(['clientId', 'id']);
    state = authWizardReducer(authWizardReducer(state, { type: 'back' }), { type: 'back' });
    expect(state.step).toBe('flow');
    state = authWizardReducer(authWizardReducer(state, down), next);
    state = authWizardReducer(state, next);
    expect(state.step).toBe('authorizationUrl');
    expect(authWizardReducer(createAuthWizardState(), { type: 'back' }).step).toBe('name');
  });

  test('cancel ends the wizard from any step', () => {
    expect(authWizardReducer(answer(['x', next]), { type: 'cancel' }).step).toBe('cancelled');
  });
});

describe('AuthWizard', () => {
  test('the keyboard answers the questions; nothing is handed off before the review is confirmed', async () => {
    const complete = vi.fn();
    const app = render(<AuthWizard taken={['main']} onComplete={complete} onCancel={vi.fn()} />);
    const key = async (value: string) => { app.stdin.write(value); await tick(); };
    await tick();
    expect(app.lastFrame()).toContain('Name of this auth block (default main)');
    await key('\r');
    expect(app.lastFrame()).toContain('already has an auth block named "main"');
    await key('ci'); await key('\r');
    expect(app.lastFrame()).toContain('> client_credentials');
    await key('\r');
    await key('{{baseUrl}}/oauth/token'); await key('\r');
    await key('ci-clientX'); await key('\u007f'); await key('\r');
    expect(app.lastFrame()).toContain('Only its name is saved, as ${NAME}');
    await key('\r');
    await key('\r');
    expect(app.lastFrame()).toContain('Add this auth block to httpi.yaml?');
    expect(app.lastFrame()).toContain('clientSecret: ${CLIENT_SECRET}');
    expect(complete).not.toHaveBeenCalled();
    await key('\r');
    await vi.waitFor(() => expect(complete).toHaveBeenCalledOnce());
    expect(complete).toHaveBeenCalledWith({
      name: 'ci',
      block: { type: 'oauth2', flow: 'client_credentials', tokenUrl: '{{baseUrl}}/oauth/token', clientId: 'ci-client', clientSecret: '${CLIENT_SECRET}' },
    });
  });

  test('arrows choose the flow, Escape goes back and Ctrl+C cancels', async () => {
    const complete = vi.fn();
    const cancel = vi.fn();
    const app = render(<AuthWizard onComplete={complete} onCancel={cancel} />);
    const key = async (value: string) => { app.stdin.write(value); await tick(); };
    await tick();
    await key('\r');
    await key('\u001B[B');
    expect(app.lastFrame()).toContain('> authorization_code');
    await key('\r');
    expect(app.lastFrame()).toContain('Token URL');
    await key('\u001B');
    expect(app.lastFrame()).toContain('OAuth 2.0 flow');
    await key('\u0003');
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
    expect(complete).not.toHaveBeenCalled();
  });
});
