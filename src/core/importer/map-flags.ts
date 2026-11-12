import { z } from 'zod';
import { type RequestSpec, requestSchema } from '../schema.js';

/** The pasted text is not a usable curl command (not curl, no URL, invalid request). */
export class CurlImportError extends Error {
  override name = 'CurlImportError';
}

export type ImportedRequest = { request: RequestSpec; warnings: string[] };

type State = {
  method?: string;
  urls: string[];
  /** Keyed by lowercase name so a repeated header replaces the earlier one. */
  headers: Map<string, { name: string; value: string }>;
  data: string[];
  form: string[];
  json: boolean;
  get: boolean;
  followRedirects: boolean;
  insecure: boolean;
  compressed: boolean;
  timeoutMs?: number;
  warnings: string[];
};

type Flag = { takesValue: boolean; apply: (state: State, value: string, flag: string) => void };

function setHeader(state: State, name: string, value: string): void {
  const key = name.toLowerCase();
  if (state.headers.has(key)) {
    state.warnings.push(`header "${name}" is set more than once; only the last value was kept`);
  }
  state.headers.set(key, { name, value });
}

function addHeader(state: State, raw: string): void {
  const colon = raw.indexOf(':');
  if (colon > 0) {
    const name = raw.slice(0, colon).trim();
    const value = raw.slice(colon + 1).trim();
    if (value === '') state.warnings.push(`header "${name}:" removes a default curl header; not supported, ignored`);
    else setHeader(state, name, value);
  } else if (raw.endsWith(';') && raw.length > 1) {
    setHeader(state, raw.slice(0, -1).trim(), ''); // "Name;" sends the header with an empty value
  } else {
    state.warnings.push(`malformed header ${JSON.stringify(raw)} was ignored`);
  }
}

function addData(state: State, value: string, flag: string): void {
  if (value.startsWith('@') && flag !== '--data-raw') {
    state.warnings.push(`${flag} reads the body from a file (${value}); not supported, ignored`);
    return;
  }
  state.data.push(value);
}

/** Percent-encoding as curl does for --data-urlencode: unreserved characters stay, space becomes "+". */
function urlEncode(text: string): string {
  return encodeURIComponent(text)
    .replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
    .replaceAll('%20', '+');
}

function addUrlEncodedData(state: State, value: string, flag: string): void {
  const equals = value.indexOf('=');
  if (equals === -1 && value.includes('@')) {
    state.warnings.push(`${flag} reads the body from a file (${value}); not supported, ignored`);
  } else if (equals === -1) {
    state.data.push(urlEncode(value));
  } else {
    const name = value.slice(0, equals);
    state.data.push(`${name}${name === '' ? '' : '='}${urlEncode(value.slice(equals + 1))}`);
  }
}

function setBasicAuth(state: State, value: string, flag: string): void {
  if (!value.includes(':')) {
    state.warnings.push(`${flag} without a password makes curl ask for it; add the Authorization header by hand`);
    return;
  }
  setHeader(state, 'Authorization', `Basic ${Buffer.from(value, 'utf8').toString('base64')}`);
}

function setCookie(state: State, value: string, flag: string): void {
  if (!value.includes('=')) {
    state.warnings.push(`${flag} reads cookies from a file (${value}); not supported, ignored`);
    return;
  }
  setHeader(state, 'Cookie', value);
}

function setMaxTime(state: State, value: string, flag: string): void {
  const seconds = Number(value);
  if (value.trim() === '' || !Number.isFinite(seconds) || seconds <= 0) {
    state.warnings.push(`${flag} value ${JSON.stringify(value)} is not a positive number of seconds; ignored`);
    return;
  }
  state.timeoutMs = Math.round(seconds * 1000);
}

const withValue = (apply: Flag['apply']): Flag => ({ takesValue: true, apply });
const toggle = (apply: (state: State) => void): Flag => ({ takesValue: false, apply });

function alias(names: string[], flag: Flag): Array<[string, Flag]> {
  return names.map((name) => [name, flag]);
}

/** The whitelist of PLAN §3. Anything else produces a warning. */
const SUPPORTED = new Map<string, Flag>([
  ...alias(['-X', '--request'], withValue((state, value) => void (state.method = value.toUpperCase()))),
  ...alias(['-H', '--header'], withValue(addHeader)),
  ...alias(['-d', '--data', '--data-ascii', '--data-raw', '--data-binary'], withValue(addData)),
  ...alias(['--data-urlencode'], withValue(addUrlEncodedData)),
  ...alias(['--json'], withValue((state, value, flag) => {
    state.json = true;
    addData(state, value, flag);
  })),
  ...alias(['-F', '--form'], withValue((state, value) => void state.form.push(value))),
  ...alias(['-u', '--user'], withValue(setBasicAuth)),
  ...alias(['-b', '--cookie'], withValue(setCookie)),
  ...alias(['-A', '--user-agent'], withValue((state, value) => setHeader(state, 'User-Agent', value))),
  ...alias(['-e', '--referer'], withValue((state, value) => setHeader(state, 'Referer', value))),
  ...alias(['-m', '--max-time'], withValue(setMaxTime)),
  ...alias(['--url'], withValue((state, value) => void state.urls.push(value))),
  ...alias(['--compressed'], toggle((state) => void (state.compressed = true))),
  ...alias(['-L', '--location'], toggle((state) => void (state.followRedirects = true))),
  ...alias(['-k', '--insecure'], toggle((state) => void (state.insecure = true))),
  ...alias(['-G', '--get'], toggle((state) => void (state.get = true))),
]);

/**
 * curl flags outside the whitelist that take a value. They are only listed so their value
 * is skipped with the flag instead of being mistaken for the URL.
 */
const UNSUPPORTED_WITH_VALUE = new Set([
  '-o', '--output', '-w', '--write-out', '-x', '--proxy', '-U', '--proxy-user', '-c', '--cookie-jar',
  '-D', '--dump-header', '-E', '--cert', '--key', '--cacert', '--capath', '--cert-type', '--key-type',
  '--pass', '--pinnedpubkey', '--ciphers', '--tls-max', '-T', '--upload-file', '-r', '--range',
  '-K', '--config', '-y', '--speed-time', '-Y', '--speed-limit', '-z', '--time-cond', '-C', '--continue-at',
  '-t', '--telnet-option', '-Q', '--quote', '-P', '--ftp-port', '--connect-timeout', '--retry',
  '--retry-delay', '--retry-max-time', '--max-redirs', '--max-filesize', '--limit-rate', '--rate',
  '--resolve', '--connect-to', '--interface', '--local-port', '--dns-servers', '--doh-url',
  '--unix-socket', '--abstract-unix-socket', '--noproxy', '--proxy-header', '--preproxy', '--socks4',
  '--socks4a', '--socks5', '--socks5-hostname', '--oauth2-bearer', '--aws-sigv4', '--delegation',
  '--request-target', '--proto', '--proto-default', '--proto-redir', '--url-query', '--variable',
  '--form-string', '--keepalive-time', '--expect100-timeout', '--happy-eyeballs-timeout-ms',
  '--trace', '--trace-ascii', '--stderr', '--netrc-file', '--output-dir', '--create-file-mode',
  '--hostpubmd5', '--hostpubsha256', '--krb', '--login-options', '--mail-from', '--mail-rcpt',
  '--mail-auth', '--service-name', '--proxy-service-name', '--tlsuser', '--tlspassword', '--tls13-ciphers',
  '--curves', '--engine', '--egd-file', '--random-file', '--crlfile', '--alt-svc', '--hsts', '--etag-save',
  '--etag-compare', '--ipfs-gateway', '--parallel-max', '--haproxy-clientip', '--sasl-authzid',
]);

function handleFlag(state: State, flag: string, inlineValue: string | undefined, takeNext: () => string | undefined): void {
  const supported = SUPPORTED.get(flag);
  const takesValue = supported?.takesValue ?? UNSUPPORTED_WITH_VALUE.has(flag);
  let value = inlineValue;
  if (takesValue && value === undefined) {
    value = takeNext();
    if (value === undefined) {
      state.warnings.push(`flag ${flag} expects a value but the command ends there; ignored`);
      return;
    }
  }
  if (supported === undefined) {
    state.warnings.push(`unsupported flag ${flag}${takesValue ? ' (and its value)' : ''} was ignored`);
  } else if (!supported.takesValue && inlineValue !== undefined) {
    state.warnings.push(`flag ${flag} does not take a value; "${inlineValue}" was ignored`);
    supported.apply(state, '', flag);
  } else {
    supported.apply(state, value ?? '', flag);
  }
}

function isCurlBinary(token: string): boolean {
  const name = token.replaceAll('\\', '/').split('/').pop()?.toLowerCase();
  return name === 'curl' || name === 'curl.exe';
}

function buildRequest(state: State): unknown {
  const [url, ...extraUrls] = state.urls;
  if (url === undefined) throw new CurlImportError('the curl command has no URL');
  for (const extra of extraUrls) state.warnings.push(`extra argument ${JSON.stringify(extra)} was ignored`);

  if (state.json) {
    if (!state.headers.has('content-type')) state.headers.set('content-type', { name: 'Content-Type', value: 'application/json' });
    if (!state.headers.has('accept')) state.headers.set('accept', { name: 'Accept', value: 'application/json' });
  }
  if (state.form.length > 0 && state.data.length > 0) {
    state.warnings.push('both --form and --data were given; kept the form and ignored the data');
  }

  const data = state.data.join('&');
  const dataInQuery = state.get && state.data.length > 0;
  const body =
    state.form.length > 0 ? { form: state.form } : state.data.length > 0 && !dataInQuery ? { text: data } : undefined;

  return {
    method: state.method ?? (body === undefined ? 'GET' : 'POST'),
    url: dataInQuery ? `${url}${url.includes('?') ? '&' : '?'}${data}` : url,
    headers: Object.fromEntries([...state.headers.values()].map(({ name, value }) => [name, value])),
    ...(body !== undefined && { body }),
    ...(state.followRedirects && { followRedirects: true }),
    ...(state.insecure && { insecure: true }),
    ...(state.compressed && { compressed: true }),
    ...(state.timeoutMs !== undefined && { timeoutMs: state.timeoutMs }),
  };
}

/**
 * Turns the arguments of a curl command (already split by a tokenizer) into a request.
 * Flags outside the whitelist are never dropped silently: each one adds a warning.
 */
export function mapFlags(tokens: string[]): ImportedRequest {
  const args = tokens[0] === '$' ? tokens.slice(1) : [...tokens]; // "$ curl ..." copied with its prompt
  const binary = args.shift();
  if (binary === undefined) throw new CurlImportError('nothing to import: the input is empty');
  if (!isCurlBinary(binary)) throw new CurlImportError(`expected a curl command, but it starts with "${binary}"`);

  const state: State = {
    urls: [],
    headers: new Map(),
    data: [],
    form: [],
    json: false,
    get: false,
    followRedirects: false,
    insecure: false,
    compressed: false,
    warnings: [],
  };

  const takeNext = () => args.shift();
  for (let arg = args.shift(); arg !== undefined; arg = args.shift()) {
    if (arg.startsWith('--') && arg.length > 2) {
      const equals = arg.indexOf('=');
      if (equals === -1) handleFlag(state, arg, undefined, takeNext);
      else {
        // PLAN §3 asks to accept --flag=value, but curl itself rejects that spelling: say so.
        const flag = arg.slice(0, equals);
        state.warnings.push(`curl does not accept "${flag}=value"; it was read as "${flag} value"`);
        handleFlag(state, flag, arg.slice(equals + 1), takeNext);
      }
    } else if (arg.startsWith('-') && arg.length > 1 && arg !== '--') {
      // A cluster of short flags: -sSL, or -XPOST where the rest is the value of -X.
      for (let i = 1; i < arg.length; i++) {
        const flag = `-${arg[i]}`;
        const takesValue = SUPPORTED.get(flag)?.takesValue ?? UNSUPPORTED_WITH_VALUE.has(flag);
        const rest = arg.slice(i + 1);
        if (takesValue) {
          handleFlag(state, flag, rest === '' ? undefined : rest, takeNext);
          break;
        }
        handleFlag(state, flag, undefined, takeNext);
      }
    } else {
      state.urls.push(arg);
    }
  }

  const result = requestSchema.safeParse(buildRequest(state));
  if (!result.success) {
    throw new CurlImportError(`the curl command does not describe a valid request\n${z.prettifyError(result.error)}`);
  }
  return { request: result.data, warnings: state.warnings };
}

export type Secret = {
  /** Header the secret was found in, as written in the request. */
  header: string;
  /** Proposed variable name; the request refers to it as `{{variable}}`. */
  variable: string;
  /** The secret itself, removed from the request. */
  value: string;
};

function referencesVariable(value: string): boolean {
  return value.includes('{{') || value.includes('${');
}

function proposeSecret(header: string, value: string): { secret: Secret; replacement: string } | null {
  const name = header.toLowerCase();
  if (referencesVariable(value)) return null;
  if (name === 'cookie') return { secret: { header, variable: 'cookie', value }, replacement: '{{cookie}}' };
  if (name !== 'authorization') return null;

  // Keep the scheme readable in the file: "Bearer {{token}}", "Basic {{basicAuth}}".
  const space = value.indexOf(' ');
  const scheme = space === -1 ? '' : value.slice(0, space);
  const credentials = value.slice(space + 1).trim();
  const variable = { bearer: 'token', basic: 'basicAuth' }[scheme.toLowerCase()];
  if (variable === undefined || credentials === '') {
    return { secret: { header, variable: 'authorization', value }, replacement: '{{authorization}}' };
  }
  return { secret: { header, variable, value: credentials }, replacement: `${scheme} {{${variable}}}` };
}

/**
 * Moves credentials (Authorization and Cookie headers, which also covers -u and -b) out of the
 * request, leaving `{{variable}}` references so they are not saved in the test file.
 */
export function extractSecrets(request: RequestSpec): { request: RequestSpec; secrets: Secret[] } {
  const secrets: Secret[] = [];
  const headers = Object.fromEntries(
    Object.entries(request.headers).map(([header, value]) => {
      const proposal = proposeSecret(header, value);
      if (proposal === null) return [header, value];
      secrets.push(proposal.secret);
      return [header, proposal.replacement];
    }),
  );
  return { request: { ...request, headers }, secrets };
}
