import { z } from 'zod';
import { type AuthConfig, authSchema, type RequestSpec, requestSchema, type TestCase, type TestFile } from '../schema.js';
import { CurlImportError } from './map-flags.js';

// Only what the importer reads is described; everything else in a collection is ignored by zod
// and, where it would change the request, reported as a warning below.
const keyValue = z.object({ key: z.string().optional(), value: z.unknown().optional(), disabled: z.boolean().optional(), type: z.string().optional(), src: z.unknown().optional() });

/** v2.1 lists auth parameters as `[{ key, value }]`; v2.0 uses a plain object. */
const authParams = z.union([z.array(keyValue), z.record(z.string(), z.unknown())]);
const postmanAuth = z.object({ type: z.string() }).catchall(authParams.or(z.unknown()));

const postmanUrl = z.union([
  z.string(),
  z.object({ raw: z.string().optional(), variable: z.array(keyValue).optional() }),
]);

const postmanBody = z.object({
  mode: z.string().optional(),
  raw: z.string().optional(),
  urlencoded: z.array(keyValue).optional(),
  formdata: z.array(keyValue).optional(),
  options: z.object({ raw: z.object({ language: z.string().optional() }).optional() }).optional(),
});

const postmanRequest = z.union([
  z.string(),
  z.object({
    method: z.string().optional(),
    url: postmanUrl.optional(),
    header: z.array(keyValue).optional(),
    body: postmanBody.nullish(),
    auth: postmanAuth.nullish(),
  }),
]);

const postmanEvent = z.object({ listen: z.string().optional(), script: z.object({ exec: z.union([z.array(z.string()), z.string()]).optional() }).optional() });

type PostmanItem = {
  name?: string | undefined;
  item?: PostmanItem[] | undefined;
  request?: z.infer<typeof postmanRequest> | undefined;
  auth?: z.infer<typeof postmanAuth> | null | undefined;
  event?: Array<z.infer<typeof postmanEvent>> | undefined;
};

const postmanItem: z.ZodType<PostmanItem> = z.lazy(() =>
  z.object({
    name: z.string().optional(),
    item: z.array(postmanItem).optional(),
    request: postmanRequest.optional(),
    auth: postmanAuth.nullish(),
    event: z.array(postmanEvent).optional(),
  }),
);

const postmanCollection = z.object({
  info: z.object({ name: z.string().optional(), schema: z.string().optional() }),
  item: z.array(postmanItem),
  auth: postmanAuth.nullish(),
  event: z.array(postmanEvent).optional(),
  variable: z.array(keyValue).optional(),
});

/** A Postman environment export: `{ name, values: [{ key, value, enabled }] }`. */
const postmanEnvironment = z.object({
  name: z.string().optional(),
  values: z.array(z.object({ key: z.string(), value: z.unknown().optional(), enabled: z.boolean().optional() })),
});

type Auth = z.infer<typeof postmanAuth>;

export type ImportedFile = { /** Suggested file name, without directory. */ path: string; file: TestFile };

export type ImportedProject = {
  files: ImportedFile[];
  /** Blocks for `auth:` in httpi.yaml, created from OAuth 2.0 settings. */
  auth: Record<string, AuthConfig>;
  /** Variables the source defines, for an environment of httpi.yaml. */
  variables: Record<string, string>;
  warnings: string[];
};

const text = (value: unknown): string => (typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value));

export function slug(name: string, fallback: string): string {
  const cleaned = name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || fallback;
}

/** The parameters of an auth block as a plain map, whichever way the collection wrote them. */
function authValues(auth: Auth): Record<string, string> {
  const params = auth[auth.type];
  if (Array.isArray(params)) {
    return Object.fromEntries((params as Array<z.infer<typeof keyValue>>).filter((param) => param.key !== undefined).map((param) => [param.key as string, text(param.value)]));
  }
  if (params !== null && typeof params === 'object') return Object.fromEntries(Object.entries(params).map(([key, value]) => [key, text(value)]));
  return {};
}

const hasVariable = (value: string) => value.includes('{{');

/** Percent-encodes form text but keeps `{{variables}}` readable. */
const encodeKeepingVariables = (value: string) =>
  value.split(/(\{\{[^{}]*\}\})/).map((part, index) => (index % 2 === 1 ? part : encodeURIComponent(part))).join('');

class Converter {
  readonly warnings: string[] = [];
  readonly auth: Record<string, AuthConfig> = {};

  warn(where: string, message: string): void {
    this.warnings.push(`${where}: ${message}`);
  }

  private url(where: string, url: z.infer<typeof postmanUrl> | undefined): string {
    const raw = typeof url === 'string' ? url : (url?.raw ?? '');
    const values = new Map((typeof url === 'object' ? (url.variable ?? []) : []).map((variable) => [variable.key, text(variable.value)]));
    // Postman path variables (/users/:id) become their saved value, or a {{variable}} to fill in.
    return raw.replace(/(?<=\/):([A-Za-z_]\w*)/g, (_match, name: string) => {
      const value = values.get(name);
      if (value !== undefined && value !== '') return value;
      this.warn(where, `path variable ":${name}" has no value; it became {{${name}}}`);
      return `{{${name}}}`;
    });
  }

  private body(where: string, body: z.infer<typeof postmanBody> | null | undefined, headers: Record<string, string>): RequestSpec['body'] {
    const mode = body?.mode;
    if (body === null || body === undefined || mode === undefined || mode === 'none') return undefined;
    const hasContentType = Object.keys(headers).some((name) => name.toLowerCase() === 'content-type');
    if (mode === 'raw') {
      if (body.raw === undefined || body.raw === '') return undefined;
      if (body.options?.raw?.language === 'json' && !hasContentType) headers['Content-Type'] = 'application/json';
      return { text: body.raw };
    }
    if (mode === 'urlencoded') {
      const fields = (body.urlencoded ?? []).filter((field) => field.disabled !== true && field.key !== undefined);
      if (fields.length === 0) return undefined;
      return { text: fields.map((field) => `${encodeKeepingVariables(field.key as string)}=${encodeKeepingVariables(text(field.value))}`).join('&') };
    }
    if (mode === 'formdata') {
      const fields: string[] = [];
      for (const field of (body.formdata ?? []).filter((entry) => entry.disabled !== true && entry.key !== undefined)) {
        if (field.type !== 'file') fields.push(`${field.key}=${text(field.value)}`);
        else if (typeof field.src === 'string' && field.src !== '') fields.push(`${field.key}=@${field.src}`);
        else this.warn(where, `form file "${field.key}" has no path; add it as "${field.key}=@<path>"`);
      }
      return fields.length > 0 ? { form: fields } : undefined;
    }
    this.warn(where, mode === 'graphql' ? 'GraphQL bodies are not supported; the body was left out' : `body mode "${mode}" is not supported; the body was left out`);
    return undefined;
  }

  /** Applies Postman auth to the request: a header, a query parameter or a reference to an `auth` block. */
  private applyAuth(where: string, auth: Auth | null | undefined, request: { url: string; headers: Record<string, string>; auth?: string }): void {
    if (auth === null || auth === undefined || auth.type === 'noauth') return;
    if (Object.keys(request.headers).some((name) => name.toLowerCase() === 'authorization')) return; // an explicit header wins in Postman too
    const values = authValues(auth);
    if (auth.type === 'bearer') {
      request.headers.Authorization = `Bearer ${values.token ?? ''}`;
    } else if (auth.type === 'basic') {
      const { username = '', password = '' } = values;
      if (hasVariable(username) || hasVariable(password)) {
        request.headers.Authorization = 'Basic {{basicAuth}}';
        this.warn(where, 'basic auth uses variables; set basicAuth to the base64 of "user:password"');
      } else {
        request.headers.Authorization = `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;
      }
    } else if (auth.type === 'apikey') {
      const { key = '', value = '' } = values;
      if (values.in === 'query') request.url += `${request.url.includes('?') ? '&' : '?'}${encodeKeepingVariables(key)}=${encodeKeepingVariables(value)}`;
      else request.headers[key] = value;
    } else if (auth.type === 'oauth2') {
      const name = this.oauth(where, values);
      if (name !== undefined) request.auth = name;
    } else {
      this.warn(where, `auth type "${auth.type}" is not supported; add the credentials by hand`);
    }
  }

  /** Turns Postman OAuth 2.0 settings into an `auth` block; the client secret is never copied. */
  private oauth(where: string, values: Record<string, string>): string | undefined {
    const grant = values.grant_type ?? 'authorization_code';
    const flow = grant === 'client_credentials' ? 'client_credentials' : grant.startsWith('authorization_code') ? 'authorization_code' : undefined;
    if (flow === undefined) {
      this.warn(where, `OAuth 2.0 grant "${grant}" is not supported; only client_credentials and authorization_code are`);
      return undefined;
    }
    const scopes = (values.scope ?? '').split(/\s+/).filter(Boolean);
    const secretReference = hasVariable(values.clientSecret ?? '') ? values.clientSecret : '${CLIENT_SECRET}';
    const candidate = authSchema.safeParse({
      type: 'oauth2',
      flow,
      tokenUrl: values.accessTokenUrl,
      clientId: values.clientId,
      ...(flow === 'authorization_code' && { authorizationUrl: values.authUrl }),
      ...((flow === 'client_credentials' || (values.clientSecret ?? '') !== '') && { clientSecret: secretReference }),
      ...(scopes.length > 0 && { scopes }),
      ...(values.client_authentication === 'body' && { clientAuth: 'body' }),
    });
    if (!candidate.success) {
      this.warn(where, 'the OAuth 2.0 settings are incomplete (token URL, client id); add the auth block by hand');
      return undefined;
    }
    const existing = Object.entries(this.auth).find(([, block]) => JSON.stringify(block) === JSON.stringify(candidate.data));
    if (existing !== undefined) return existing[0];
    let name = 'main';
    for (let suffix = 2; this.auth[name] !== undefined; suffix++) name = `main${suffix}`;
    this.auth[name] = candidate.data;
    if (values.clientSecret !== undefined && values.clientSecret !== '' && !hasVariable(values.clientSecret)) {
      this.warn(where, `the OAuth client secret was not copied; auth "${name}" reads it from \${CLIENT_SECRET}`);
    }
    return name;
  }

  /** One Postman request as a test, or undefined when it cannot be one. */
  test(where: string, name: string, item: PostmanItem, inheritedAuth: Auth | null | undefined): TestCase | undefined {
    const source = item.request;
    if (source === undefined) return undefined;
    const request = typeof source === 'string' ? { url: source } : source;
    const headers: Record<string, string> = {};
    for (const header of (request.header ?? []).filter((entry) => entry.disabled !== true && entry.key !== undefined && entry.key !== '')) {
      headers[header.key as string] = text(header.value);
    }
    const url = this.url(where, request.url);
    if (url === '') {
      this.warn(where, 'the request has no URL; it was left out');
      return undefined;
    }
    const body = this.body(where, request.body, headers);
    const draft: { url: string; headers: Record<string, string>; auth?: string } = { url, headers };
    this.applyAuth(where, request.auth === undefined ? inheritedAuth : request.auth, draft);
    for (const event of item.event ?? []) {
      const code = [event.script?.exec ?? []].flat().join('').trim();
      if (code !== '') this.warn(where, `the ${event.listen === 'prerequest' ? 'pre-request' : 'test'} script was not converted`);
    }
    const parsed = requestSchema.safeParse({ method: (request.method ?? 'GET').toUpperCase(), ...draft, ...(body !== undefined && { body }) });
    if (!parsed.success) {
      this.warn(where, `the request is not valid for httpi and was left out (${parsed.error.issues[0]?.message ?? 'invalid'})`);
      return undefined;
    }
    return { name, request: parsed.data, expect: {} };
  }

  /** Every request under `items`, depth first; nested folder names become part of the test name. */
  tests(items: PostmanItem[], path: string[], prefix: string[], inheritedAuth: Auth | null | undefined): TestCase[] {
    return items.flatMap((item, index) => {
      const name = item.name?.trim() || `request ${index + 1}`;
      const auth = item.auth === undefined ? inheritedAuth : item.auth;
      if (item.item !== undefined) return this.tests(item.item, [...path, name], [...prefix, name], auth);
      const test = this.test([...path, name].join(' / '), [...prefix, name].join(' / '), item, auth);
      return test === undefined ? [] : [test];
    });
  }
}

function parseJson(source: string, label: string): unknown {
  try {
    return JSON.parse(source);
  } catch (cause) {
    throw new CurlImportError(`${label}: not valid JSON: ${(cause as Error).message}`, { cause });
  }
}

/** True when the JSON looks like a Postman collection (used to detect the format of `httpi import`). */
export function isPostmanCollection(data: unknown): boolean {
  return postmanCollection.safeParse(data).success && typeof (data as { info: { schema?: unknown } }).info.schema === 'string'
    && (data as { info: { schema: string } }).info.schema.includes('getpostman.com');
}

/**
 * Converts a Postman collection (v2.0 or v2.1): one test file per top-level folder, plus one for
 * the requests outside any folder. Whatever cannot be converted is reported, never dropped quietly.
 */
export function importPostman(source: string): ImportedProject {
  const parsed = postmanCollection.safeParse(parseJson(source, 'Postman collection'));
  if (!parsed.success) throw new CurlImportError('this is not a Postman collection (v2.0 or v2.1): it needs "info" and "item"');
  const collection = parsed.data;
  const version = /v(\d+\.\d+)/.exec(collection.info.schema ?? '')?.[1];
  if (version !== undefined && !version.startsWith('2.')) throw new CurlImportError(`Postman collection format v${version} is not supported; export it as v2.1`);

  const converter = new Converter();
  const title = collection.info.name?.trim() || 'Postman collection';
  for (const event of collection.event ?? []) {
    if ([event.script?.exec ?? []].flat().join('').trim() !== '') converter.warn(title, `the collection-level ${event.listen === 'prerequest' ? 'pre-request' : 'test'} script was not converted`);
  }

  const files: ImportedFile[] = [];
  const used = new Set<string>();
  const add = (name: string, tests: TestCase[]) => {
    if (tests.length === 0) return;
    const base = slug(name, 'requests');
    let path = `${base}.yaml`;
    for (let suffix = 2; used.has(path); suffix++) path = `${base}-${suffix}.yaml`;
    used.add(path);
    files.push({ path, file: { version: 1, name, tests } });
  };

  add(title, converter.tests(collection.item.filter((item) => item.item === undefined), [], [], collection.auth));
  for (const folder of collection.item.filter((item) => item.item !== undefined)) {
    const name = folder.name?.trim() || 'folder';
    const auth = folder.auth === undefined ? collection.auth : folder.auth;
    add(name, converter.tests(folder.item as PostmanItem[], [name], [], auth));
  }
  if (files.length === 0) throw new CurlImportError('the Postman collection has no requests to import');

  const variables = Object.fromEntries(
    (collection.variable ?? []).filter((variable) => variable.key !== undefined && variable.disabled !== true).map((variable) => [variable.key as string, text(variable.value)]),
  );
  return { files, auth: converter.auth, variables, warnings: converter.warnings };
}

/** The enabled variables of a Postman environment export, with the environment name. */
export function importPostmanEnvironment(source: string): { name: string; variables: Record<string, string> } {
  const parsed = postmanEnvironment.safeParse(parseJson(source, 'Postman environment'));
  if (!parsed.success) throw new CurlImportError('this is not a Postman environment export: it needs "values"');
  return {
    name: slug(parsed.data.name ?? '', 'postman'),
    variables: Object.fromEntries(parsed.data.values.filter((entry) => entry.enabled !== false).map((entry) => [entry.key, text(entry.value)])),
  };
}
