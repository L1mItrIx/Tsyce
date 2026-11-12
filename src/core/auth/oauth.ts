import { runRequest } from '../runner/exec.js';
import type { AuthConfig, RequestSpec, TestFile } from '../schema.js';
import { resolveVars, type VarSources } from '../vars.js';
import { isUsable, readStoredTokens, saveStoredToken, type StoredToken } from './token-store.js';

/** A token could not be obtained: the token endpoint is unreachable or refused the request, or nobody logged in. */
export class AuthError extends Error {
  override name = 'AuthError';
}

export type AuthBlocks = Record<string, AuthConfig>;

/** The `auth` names the tests refer to, each once, in order of first use. */
export function authNamesUsed(files: TestFile[]): string[] {
  return [...new Set(files.flatMap((file) => file.tests.flatMap((test) => (test.request.auth === undefined ? [] : [test.request.auth]))))];
}

/** Problems in how a file uses `auth`, as messages; empty when everything is fine. */
export function checkAuthReferences(file: TestFile, auth: AuthBlocks | undefined): string[] {
  const available = Object.keys(auth ?? {});
  return file.tests.flatMap((test) => {
    const name = test.request.auth;
    if (name === undefined) return [];
    const problems: string[] = [];
    if (!available.includes(name)) {
      problems.push(`test "${test.name}": auth "${name}" is not declared in httpi.yaml; available: ${available.join(', ') || '(none)'}`);
    }
    if (Object.keys(test.request.headers).some((header) => header.toLowerCase() === 'authorization')) {
      problems.push(`test "${test.name}": use either auth "${name}" or an Authorization header, not both`);
    }
    return problems;
  });
}

const form = (fields: Record<string, string | undefined>) =>
  Object.entries(fields)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
    .join('&');

/** A POST to the token endpoint with the given grant fields, identifying the client as the block says. */
function tokenEndpointRequest(config: AuthConfig, grant: Record<string, string | undefined>): RequestSpec {
  const secret = config.clientSecret;
  // A public client (no secret) can only name itself in the body.
  const inBody = config.clientAuth === 'body' || secret === undefined;
  const basic = Buffer.from(`${encodeURIComponent(config.clientId)}:${encodeURIComponent(secret ?? '')}`).toString('base64');
  return {
    method: 'POST',
    url: config.tokenUrl,
    headers: { Accept: 'application/json', ...(!inBody && { Authorization: `Basic ${basic}` }) },
    body: { text: form({ ...grant, ...(inBody && { client_id: config.clientId, client_secret: secret }) }) },
    timeoutMs: 30_000,
  };
}

/** The token request of the flows that need no person: client_credentials and refresh_token. */
export function tokenRequest(config: AuthConfig): RequestSpec {
  if (config.flow === 'authorization_code') throw new Error('authorization_code needs a login: see auth/login.ts');
  return tokenEndpointRequest(config, {
    grant_type: config.flow,
    ...(config.flow === 'refresh_token' && { refresh_token: config.refreshToken }),
    scope: config.scopes?.join(' '),
  });
}

/** Exchanges the code of an authorization_code login, proving possession of the PKCE verifier. */
export function codeExchangeRequest(config: AuthConfig, code: string, redirectUri: string, verifier: string): RequestSpec {
  return tokenEndpointRequest(config, { grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier });
}

/** Renews a stored login with its refresh token. */
export function refreshRequest(config: AuthConfig, refreshToken: string): RequestSpec {
  return tokenEndpointRequest(config, { grant_type: 'refresh_token', refresh_token: refreshToken });
}

/** Reads what a token endpoint answered, or explains why there is no token. `now` is in epoch milliseconds. */
export function readTokenSet(name: string, status: number, body: string, now: number = Date.now()): StoredToken {
  let json: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) json = parsed as Record<string, unknown>;
  } catch { /* A non-JSON answer is reported by its status alone. */ }

  if (status < 200 || status >= 300) {
    // Only the standard error fields are shown: the rest of the body may echo credentials.
    const detail = [json.error, json.error_description].filter((part) => typeof part === 'string').join(': ');
    throw new AuthError(`auth "${name}": the token endpoint answered ${status}${detail ? ` (${detail})` : ''}`);
  }
  const token = json.access_token;
  if (typeof token !== 'string' || token === '' || /\s/.test(token)) {
    throw new AuthError(`auth "${name}": the token endpoint answered ${status} without a usable access_token`);
  }
  if (typeof json.token_type === 'string' && json.token_type.toLowerCase() !== 'bearer') {
    throw new AuthError(`auth "${name}": token type "${json.token_type}" is not supported; only Bearer tokens are`);
  }
  return {
    accessToken: token,
    ...(typeof json.refresh_token === 'string' && json.refresh_token !== '' && { refreshToken: json.refresh_token }),
    ...(typeof json.expires_in === 'number' && json.expires_in > 0 && { expiresAt: now + json.expires_in * 1000 }),
  };
}

/** The access token of a token endpoint response (see readTokenSet). */
export function readTokenResponse(name: string, status: number, body: string): string {
  return readTokenSet(name, status, body).accessToken;
}

/** Sends a token request and reads the answer. */
export async function requestTokenSet(name: string, request: RequestSpec, curlBin: string): Promise<StoredToken> {
  const result = await runRequest(curlBin, request);
  if (result.error !== null) throw new AuthError(`auth "${name}": cannot reach the token endpoint: ${result.error}`);
  return readTokenSet(name, result.status, result.body);
}

/** The token of an authorization_code block: the stored login, renewed with its refresh token when it expired. */
async function storedLoginToken(name: string, config: AuthConfig, storePath: string, curlBin: string): Promise<string> {
  const stored = (await readStoredTokens(storePath))[name];
  if (stored === undefined) throw new AuthError(`auth "${name}": not logged in; run "httpi auth login ${name}"`);
  if (isUsable(stored)) return stored.accessToken;
  if (stored.refreshToken === undefined) throw new AuthError(`auth "${name}": the login expired; run "httpi auth login ${name}"`);
  const renewed = await requestTokenSet(name, refreshRequest(config, stored.refreshToken), curlBin);
  // Servers that do not rotate refresh tokens omit it from the answer: keep the one we have.
  await saveStoredToken(storePath, name, { refreshToken: stored.refreshToken, ...renewed });
  return renewed.accessToken;
}

/**
 * Obtains one token per auth name, asking each token endpoint at most once. Variables in the
 * auth blocks are resolved first, so a missing one fails before anything is sent.
 */
export async function obtainTokens(names: string[], auth: AuthBlocks, sources: VarSources, curlBin: string, storePath: string): Promise<Record<string, string>> {
  const configs = names.map((name) => [name, resolveVars(auth[name] as AuthConfig, sources)] as const);
  const tokens: Record<string, string> = {};
  for (const [name, config] of configs) {
    tokens[name] =
      config.flow === 'authorization_code'
        ? await storedLoginToken(name, config, storePath, curlBin)
        : (await requestTokenSet(name, tokenRequest(config), curlBin)).accessToken;
  }
  return tokens;
}
