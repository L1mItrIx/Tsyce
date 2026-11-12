import { describe, expect, test } from 'vitest';
import { AuthError, authNamesUsed, checkAuthReferences, readTokenResponse, tokenRequest } from '../../src/core/auth/oauth.js';
import { authSchema, projectFileSchema, testFileSchema } from '../../src/core/schema.js';

const clientCredentials = { type: 'oauth2', flow: 'client_credentials', tokenUrl: 'https://id.example/token', clientId: 'my app', clientSecret: 's3:cr/et' };

describe('authSchema', () => {
  test('accepts client_credentials inside a project', () => {
    const project = projectFileSchema.parse({ version: 1, auth: { main: { ...clientCredentials, scopes: ['users.read'] } }, run: ['a.yaml'] });
    expect(project.auth?.main?.flow).toBe('client_credentials');
  });

  test.each([
    ['an unknown flow', { ...clientCredentials, flow: 'password' }],
    ['a missing client secret', { ...clientCredentials, clientSecret: undefined }],
    ['a missing token URL', { ...clientCredentials, tokenUrl: undefined }],
    ['an unknown key', { ...clientCredentials, audience: 'x' }],
    ['an unknown client auth method', { ...clientCredentials, clientAuth: 'jwt' }],
  ])('rejects %s', (_name, config) => {
    expect(authSchema.safeParse(config).success).toBe(false);
  });

  test('rejects an auth name that is not a simple name', () => {
    expect(projectFileSchema.safeParse({ version: 1, auth: { 'my auth': clientCredentials }, run: ['a.yaml'] }).success).toBe(false);
  });
});

describe('tokenRequest', () => {
  test('client_credentials with HTTP Basic by default; id and secret are form-encoded first', () => {
    expect(tokenRequest(authSchema.parse({ ...clientCredentials, scopes: ['users.read', 'users.write'] }))).toEqual({
      method: 'POST',
      url: 'https://id.example/token',
      headers: { Accept: 'application/json', Authorization: `Basic ${Buffer.from('my%20app:s3%3Acr%2Fet').toString('base64')}` },
      body: { text: 'grant_type=client_credentials&scope=users.read%20users.write' },
      timeoutMs: 30_000,
    });
  });

  test('clientAuth: body sends the credentials as form fields instead', () => {
    const request = tokenRequest(authSchema.parse({ ...clientCredentials, clientAuth: 'body' }));
    expect(request.headers).toEqual({ Accept: 'application/json' });
    expect(request.body).toEqual({ text: 'grant_type=client_credentials&client_id=my%20app&client_secret=s3%3Acr%2Fet' });
  });
});

describe('refresh_token', () => {
  const refresh = { type: 'oauth2', flow: 'refresh_token', tokenUrl: 'https://id.example/token', clientId: 'cli', refreshToken: 'r/t+1' };

  test('a confidential client authenticates with Basic and sends the refresh token in the form', () => {
    const request = tokenRequest(authSchema.parse({ ...refresh, clientSecret: 'shh', scopes: ['a'] }));
    expect(request.headers).toEqual({ Accept: 'application/json', Authorization: `Basic ${Buffer.from('cli:shh').toString('base64')}` });
    expect(request.body).toEqual({ text: 'grant_type=refresh_token&refresh_token=r%2Ft%2B1&scope=a' });
  });

  test('a public client has no secret: only its id goes in the body', () => {
    const request = tokenRequest(authSchema.parse(refresh));
    expect(request.headers).toEqual({ Accept: 'application/json' });
    expect(request.body).toEqual({ text: 'grant_type=refresh_token&refresh_token=r%2Ft%2B1&client_id=cli' });
  });

  test('the refresh token is required', () => {
    expect(authSchema.safeParse({ ...refresh, refreshToken: undefined }).success).toBe(false);
    expect(authSchema.safeParse({ ...refresh, refreshToken: '' }).success).toBe(false);
  });
});

describe('readTokenResponse', () => {
  test.each([
    ['a plain token', '{"access_token":"abc.def","token_type":"Bearer","expires_in":3600}'],
    ['a lowercase token type', '{"access_token":"abc.def","token_type":"bearer"}'],
    ['no token type', '{"access_token":"abc.def"}'],
  ])('returns the token from %s', (_name, body) => {
    expect(readTokenResponse('main', 200, body)).toBe('abc.def');
  });

  test.each<[name: string, status: number, body: string, message: string]>([
    ['an OAuth error', 401, '{"error":"invalid_client","error_description":"Unknown client","secret_echo":"s3cret"}', 'auth "main": the token endpoint answered 401 (invalid_client: Unknown client)'],
    ['an error without JSON', 502, '<html>Bad gateway s3cret</html>', 'auth "main": the token endpoint answered 502'],
    ['a success without token', 200, '{"token":"abc"}', 'auth "main": the token endpoint answered 200 without a usable access_token'],
    ['a token that is not text', 200, '{"access_token":123}', 'without a usable access_token'],
    ['a body that is not an object', 200, '["abc"]', 'without a usable access_token'],
    ['another token type', 200, '{"access_token":"abc","token_type":"mac"}', 'auth "main": token type "mac" is not supported; only Bearer tokens are'],
  ])('rejects %s', (_name, status, body, message) => {
    expect(() => readTokenResponse('main', status, body)).toThrow(AuthError);
    expect(() => readTokenResponse('main', status, body)).toThrow(message);
    try { readTokenResponse('main', status, body); } catch (error) { expect((error as Error).message).not.toContain('s3cret'); }
  });
});

describe('auth references in tests', () => {
  const file = (requests: object[]) => testFileSchema.parse({ version: 1, tests: requests.map((request, index) => ({ name: `t${index + 1}`, request: { url: 'http://x', ...request } })) });
  const auth = { main: authSchema.parse(clientCredentials), admin: authSchema.parse(clientCredentials) };

  test('authNamesUsed lists each name once, in order of first use', () => {
    expect(authNamesUsed([file([{ auth: 'admin' }, {}, { auth: 'main' }]), file([{ auth: 'admin' }])])).toEqual(['admin', 'main']);
    expect(authNamesUsed([file([{}])])).toEqual([]);
  });

  test('checkAuthReferences reports unknown names and a conflicting Authorization header', () => {
    expect(checkAuthReferences(file([{ auth: 'main' }, {}]), auth)).toEqual([]);
    expect(checkAuthReferences(file([{ auth: 'other' }, { auth: 'main', headers: { authorization: 'Bearer {{token}}' } }]), auth)).toEqual([
      'test "t1": auth "other" is not declared in httpi.yaml; available: main, admin',
      'test "t2": use either auth "main" or an Authorization header, not both',
    ]);
    expect(checkAuthReferences(file([{ auth: 'main' }]), undefined)).toEqual(['test "t1": auth "main" is not declared in httpi.yaml; available: (none)']);
  });
});
