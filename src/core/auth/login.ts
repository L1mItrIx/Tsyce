import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { AuthConfig } from '../schema.js';
import { AuthError, codeExchangeRequest, requestTokenSet } from './oauth.js';
import type { StoredToken } from './token-store.js';

type CodeFlowConfig = Extract<AuthConfig, { flow: 'authorization_code' }>;

export type LoginOptions = {
  curlBin: string;
  /** Called once with the URL the person must open in a browser. */
  announce: (authorizationUrl: string) => void;
  /** How long to wait for the person to finish in the browser. */
  timeoutMs?: number;
};

const base64url = (bytes: Buffer) => bytes.toString('base64url');

/** PKCE (RFC 7636): a random verifier and its SHA-256 challenge. */
export function createPkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  return { verifier, challenge: base64url(createHash('sha256').update(verifier).digest()) };
}

export const redirectUriFor = (config: CodeFlowConfig) => `http://127.0.0.1:${config.redirectPort}/callback`;

export function authorizationUrl(config: CodeFlowConfig, state: string, challenge: string): string {
  const url = new URL(config.authorizationUrl);
  const params = {
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: redirectUriFor(config),
    ...(config.scopes !== undefined && { scope: config.scopes.join(' ') }),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  };
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  return url.toString();
}

const page = (title: string, text: string) =>
  `<!doctype html><meta charset="utf-8"><title>httpi</title><body style="font-family:sans-serif;margin:3rem"><h1>${title}</h1><p>${text}</p></body>`;

/** Waits on the local callback for the provider to send the browser back with a code. */
function waitForCode(name: string, config: CodeFlowConfig, state: string, options: LoginOptions, url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const request = new URL(req.url ?? '/', redirectUriFor(config));
      if (request.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      const finish = (error: AuthError | null, code?: string) => {
        res.writeHead(error ? 400 : 200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(error ? page('Login failed', 'Go back to the terminal for details.') : page('Logged in', 'You can close this tab and go back to the terminal.'));
        clearTimeout(timer);
        server.close();
        server.closeAllConnections();
        if (error) reject(error);
        else resolve(code as string);
      };
      const params = request.searchParams;
      const code = params.get('code');
      if (params.get('state') !== state) finish(new AuthError(`auth "${name}": the callback carried an unexpected state; the login was not started by this command`));
      else if (params.get('error') !== null) finish(new AuthError(`auth "${name}": the provider refused the login (${[params.get('error'), params.get('error_description')].filter(Boolean).join(': ')})`));
      else if (code === null || code === '') finish(new AuthError(`auth "${name}": the callback carried no code`));
      else finish(null, code);
    });
    const timer = setTimeout(() => {
      server.close();
      server.closeAllConnections();
      reject(new AuthError(`auth "${name}": nobody finished the login in the browser in time`));
    }, options.timeoutMs ?? 300_000);
    server.once('error', (cause: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(new AuthError(
        cause.code === 'EADDRINUSE'
          ? `auth "${name}": port ${config.redirectPort} is busy; free it or set another redirectPort (and register it with the provider)`
          : `auth "${name}": cannot listen for the callback: ${cause.message}`,
      ));
    });
    // Only this machine can reach the callback.
    server.listen(config.redirectPort, '127.0.0.1', () => options.announce(url));
  });
}

/**
 * Interactive authorization_code login with PKCE: the person approves in a browser, the provider
 * redirects to a callback on 127.0.0.1, and the code is exchanged for tokens.
 */
export async function loginWithBrowser(name: string, config: CodeFlowConfig, options: LoginOptions): Promise<StoredToken> {
  const { verifier, challenge } = createPkce();
  const state = base64url(randomBytes(16));
  const code = await waitForCode(name, config, state, options, authorizationUrl(config, state, challenge));
  return requestTokenSet(name, codeExchangeRequest(config, code, redirectUriFor(config), verifier), options.curlBin);
}
