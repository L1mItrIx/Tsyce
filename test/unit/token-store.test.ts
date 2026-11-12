import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { authorizationUrl, createPkce, redirectUriFor } from '../../src/core/auth/login.js';
import { readTokenSet } from '../../src/core/auth/oauth.js';
import { isUsable, readStoredTokens, saveStoredToken, tokenStorePath } from '../../src/core/auth/token-store.js';
import { TestFileError } from '../../src/core/file.js';
import { authSchema } from '../../src/core/schema.js';

test('tokenStorePath is .httpi/tokens.json next to httpi.yaml', () => {
  expect(tokenStorePath(join('repo', 'api', 'httpi.yaml'))).toBe(join(process.cwd(), 'repo', 'api', '.httpi', 'tokens.json'));
});

test('isUsable: no expiry is usable; otherwise until 30 seconds before it expires', () => {
  const now = 1_000_000;
  expect(isUsable({ accessToken: 'a' }, now)).toBe(true);
  expect(isUsable({ accessToken: 'a', expiresAt: now + 31_000 }, now)).toBe(true);
  expect(isUsable({ accessToken: 'a', expiresAt: now + 30_000 }, now)).toBe(false);
  expect(isUsable({ accessToken: 'a', expiresAt: now - 1 }, now)).toBe(false);
});

test('readTokenSet keeps the refresh token and turns expires_in into an absolute time', () => {
  expect(readTokenSet('main', 200, '{"access_token":"a","refresh_token":"r","expires_in":3600}', 5_000)).toEqual({ accessToken: 'a', refreshToken: 'r', expiresAt: 3_605_000 });
  expect(readTokenSet('main', 200, '{"access_token":"a","expires_in":"soon","refresh_token":""}', 5_000)).toEqual({ accessToken: 'a' });
});

test('the store saves logins by name, keeps the others, and is private to the user', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'token-store-'));
  try {
    const path = join(dir, '.httpi', 'tokens.json');
    expect(await readStoredTokens(path)).toEqual({});
    await saveStoredToken(path, 'main', { accessToken: 'a1', refreshToken: 'r1', expiresAt: 10 });
    await saveStoredToken(path, 'admin', { accessToken: 'b1' });
    await saveStoredToken(path, 'main', { accessToken: 'a2' });
    expect(await readStoredTokens(path)).toEqual({ main: { accessToken: 'a2' }, admin: { accessToken: 'b1' } });
    if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o600);

    await writeFile(path, '{"main":{"accessToken":""}} SECRET_IN_FILE');
    const damaged = readStoredTokens(path);
    await expect(damaged).rejects.toThrow(TestFileError);
    await expect(damaged).rejects.toThrow(/the token store is damaged; delete it and log in again/);
    await expect(damaged).rejects.not.toThrow(/SECRET_IN_FILE/);
    expect(await readFile(path, 'utf8')).toContain('SECRET_IN_FILE');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

const codeFlow = authSchema.parse({
  type: 'oauth2',
  flow: 'authorization_code',
  authorizationUrl: 'https://id.example/authorize?tenant=acme',
  tokenUrl: 'https://id.example/token',
  clientId: 'desktop app',
  scopes: ['openid', 'users.read'],
});
if (codeFlow.flow !== 'authorization_code') throw new Error('unexpected flow');

test('PKCE: the challenge is the base64url SHA-256 of a long random verifier', () => {
  const first = createPkce();
  const second = createPkce();
  expect(first.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(first.verifier).not.toBe(second.verifier);
  expect(first.challenge).toBe(createHash('sha256').update(first.verifier).digest('base64url'));
});

test('the authorization URL keeps the provider query and adds the standard parameters; default callback port 8787', () => {
  expect(redirectUriFor(codeFlow)).toBe('http://127.0.0.1:8787/callback');
  const url = new URL(authorizationUrl(codeFlow, 'STATE', 'CHALLENGE'));
  expect(`${url.origin}${url.pathname}`).toBe('https://id.example/authorize');
  expect(Object.fromEntries(url.searchParams)).toEqual({
    tenant: 'acme',
    response_type: 'code',
    client_id: 'desktop app',
    redirect_uri: 'http://127.0.0.1:8787/callback',
    scope: 'openid users.read',
    state: 'STATE',
    code_challenge: 'CHALLENGE',
    code_challenge_method: 'S256',
  });
});
