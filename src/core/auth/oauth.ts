import { runRequest } from '../runner/exec.js';
import type { AuthConfig, RequestSpec, TestFile } from '../schema.js';
import { resolveVars, type VarSources } from '../vars.js';

/** A token could not be obtained: the token endpoint is unreachable or refused the request. */
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

/** The request to the token endpoint for one auth block whose variables are already resolved. */
export function tokenRequest(config: AuthConfig): RequestSpec {
  const inBody = config.clientAuth === 'body';
  const basic = Buffer.from(`${encodeURIComponent(config.clientId)}:${encodeURIComponent(config.clientSecret)}`).toString('base64');
  return {
    method: 'POST',
    url: config.tokenUrl,
    headers: { Accept: 'application/json', ...(!inBody && { Authorization: `Basic ${basic}` }) },
    body: {
      text: form({
        grant_type: config.flow,
        scope: config.scopes?.join(' '),
        ...(inBody && { client_id: config.clientId, client_secret: config.clientSecret }),
      }),
    },
    timeoutMs: 30_000,
  };
}

/** Reads the access token from a token endpoint response, or explains why there is none. */
export function readTokenResponse(name: string, status: number, body: string): string {
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
  return token;
}

/**
 * Obtains one token per auth name, asking each token endpoint once. Variables in the auth
 * blocks are resolved first, so a missing one fails before anything is sent.
 */
export async function obtainTokens(names: string[], auth: AuthBlocks, sources: VarSources, curlBin: string): Promise<Record<string, string>> {
  const configs = names.map((name) => [name, resolveVars(auth[name] as AuthConfig, sources)] as const);
  const tokens: Record<string, string> = {};
  for (const [name, config] of configs) {
    const result = await runRequest(curlBin, tokenRequest(config));
    if (result.error !== null) throw new AuthError(`auth "${name}": cannot reach the token endpoint: ${result.error}`);
    tokens[name] = readTokenResponse(name, result.status, result.body);
  }
  return tokens;
}
