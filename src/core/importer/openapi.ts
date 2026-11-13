import { parse } from 'yaml';
import { type AuthConfig, authSchema, type RequestSpec, requestSchema, type TestCase } from '../schema.js';
import { CurlImportError } from './map-flags.js';
import { type ImportedFile, type ImportedProject, slug } from './postman.js';

// An OpenAPI document is read as plain data: it is large, recursive and full of $ref, so each
// piece is narrowed where it is used instead of describing the whole specification.
type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => value !== null && typeof value === 'object' && !Array.isArray(value);
const object = (value: unknown): Json => (isObject(value) ? value : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const string = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);

const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;

/** A name usable as {{variable}}: other characters become "_". */
const variableName = (name: string) => name.replace(/[^\w.-]/g, '_').replace(/^(?![A-Za-z_])/, '_');

const encodeKeepingVariables = (value: string) =>
  value.split(/(\{\{[^{}]*\}\})/).map((part, index) => (index % 2 === 1 ? part : encodeURIComponent(part))).join('');

/** Parses the document (YAML or JSON) or returns undefined when the text is neither. */
export function parseOpenApiSource(source: string): unknown {
  try {
    return parse(source);
  } catch {
    return undefined;
  }
}

/** True for an OpenAPI 3.x document (used to detect the format of `httpi import`). */
export function isOpenApiDocument(data: unknown): boolean {
  return isObject(data) && typeof data.openapi === 'string' && isObject(data.paths);
}

class Converter {
  readonly warnings: string[] = [];
  readonly auth: Record<string, AuthConfig> = {};

  constructor(private readonly document: Json) {}

  warn(where: string, message: string): void {
    const warning = `${where}: ${message}`;
    if (!this.warnings.includes(warning)) this.warnings.push(warning);
  }

  /** Follows local `$ref`s (#/components/...); a remote or broken one is reported and yields {}. */
  resolve(where: string, value: unknown, seen: string[] = []): Json {
    const node = object(value);
    const reference = string(node.$ref);
    if (reference === undefined) return node;
    if (!reference.startsWith('#/')) {
      this.warn(where, `remote reference "${reference}" is not supported; it was ignored`);
      return {};
    }
    if (seen.includes(reference)) return {}; // a schema that contains itself
    let target: unknown = this.document;
    for (const part of reference.slice(2).split('/')) {
      target = object(target)[decodeURIComponent(part).replaceAll('~1', '/').replaceAll('~0', '~')];
    }
    if (!isObject(target)) {
      this.warn(where, `reference "${reference}" points to nothing; it was ignored`);
      return {};
    }
    return this.resolve(where, target, [...seen, reference]);
  }

  /** An example value for a schema: its own example, or one assembled from its properties. */
  example(where: string, schemaOrRef: unknown, depth = 0, seen: string[] = []): unknown {
    const reference = string(object(schemaOrRef).$ref);
    if (reference !== undefined && seen.includes(reference)) return undefined;
    const schema = this.resolve(where, schemaOrRef);
    const trail = reference === undefined ? seen : [...seen, reference];
    if (schema.example !== undefined) return schema.example;
    if (Array.isArray(schema.examples) && schema.examples.length > 0) return schema.examples[0];
    if (schema.default !== undefined) return schema.default;
    if (schema.const !== undefined) return schema.const;
    if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];
    if (depth > 6) return undefined;

    const alternatives = list(schema.oneOf).concat(list(schema.anyOf));
    if (alternatives.length > 0) {
      this.warn(where, 'the body schema offers alternatives (oneOf/anyOf) without an example; the first one was used');
      return this.example(where, alternatives[0], depth + 1, trail);
    }
    const merged = list(schema.allOf).map((part) => this.example(where, part, depth + 1, trail)).filter(isObject);
    const type = Array.isArray(schema.type) ? schema.type.find((entry) => entry !== 'null') : schema.type;
    if (type === 'object' || isObject(schema.properties) || merged.length > 0) {
      const properties = Object.entries(object(schema.properties)).flatMap(([name, property]) => {
        if (object(this.resolve(where, property)).readOnly === true) return [];
        const value = this.example(where, property, depth + 1, trail);
        return value === undefined ? [] : [[name, value] as const];
      });
      return Object.assign({}, ...merged, Object.fromEntries(properties)) as Json;
    }
    if (type === 'array') {
      const item = this.example(where, schema.items, depth + 1, trail);
      return item === undefined ? [] : [item];
    }
    if (type === 'string') return schema.format === 'date-time' ? '2026-01-01T00:00:00Z' : schema.format === 'date' ? '2026-01-01' : 'string';
    if (type === 'integer' || type === 'number') return 0;
    if (type === 'boolean') return false;
    return undefined;
  }

  /** The example of a media type: `example`, the first of `examples`, or one built from the schema. */
  private mediaExample(where: string, media: Json): unknown {
    if (media.example !== undefined) return media.example;
    const first = Object.values(object(media.examples))[0];
    if (first !== undefined) {
      const example = this.resolve(where, first);
      if (example.value !== undefined) return example.value;
    }
    return media.schema === undefined ? undefined : this.example(where, media.schema);
  }

  private body(where: string, operation: Json, headers: Record<string, string>): RequestSpec['body'] {
    if (operation.requestBody === undefined) return undefined;
    const content = object(this.resolve(where, operation.requestBody).content);
    const types = Object.keys(content);
    const pick = (test: (type: string) => boolean) => types.find((type) => test(type.split(';')[0]!.trim().toLowerCase()));
    const json = pick((type) => type === 'application/json' || type.endsWith('+json'));
    const form = pick((type) => type === 'application/x-www-form-urlencoded');
    const multipart = pick((type) => type === 'multipart/form-data');
    const plain = pick((type) => type.startsWith('text/'));
    const chosen = json ?? form ?? multipart ?? plain;
    if (chosen === undefined) {
      if (types.length > 0) this.warn(where, `request body of type ${types.join(', ')} is not supported; the body was left out`);
      return undefined;
    }
    const media = this.resolve(where, content[chosen]);
    const example = this.mediaExample(where, media);
    if (example === undefined) {
      this.warn(where, 'the request body has no example and none could be built from its schema; the body was left out');
      return undefined;
    }
    if (chosen === json) {
      headers['Content-Type'] = chosen;
      return { json: example as never };
    }
    if (chosen === plain) {
      headers['Content-Type'] = chosen;
      return { text: typeof example === 'string' ? example : JSON.stringify(example) };
    }
    const fields = Object.entries(object(example)).map(([name, value]) => [name, typeof value === 'string' ? value : JSON.stringify(value)] as const);
    if (fields.length === 0) {
      this.warn(where, 'the form body has no fields to fill in; the body was left out');
      return undefined;
    }
    if (chosen === form) return { text: fields.map(([name, value]) => `${encodeKeepingVariables(name)}=${encodeKeepingVariables(value)}`).join('&') };
    const properties = object(this.resolve(where, media.schema).properties);
    return {
      form: fields.map(([name, value]) => {
        if (object(this.resolve(where, properties[name])).format !== 'binary') return `${name}=${value}`;
        this.warn(where, `form field "${name}" is a file; replace <path> in "${name}=@<path>"`);
        return `${name}=@<path>`;
      }),
    };
  }

  /** Path, query and header parameters: required ones (and path ones) become {{variables}} or their example. */
  private parameters(where: string, pathItem: Json, operation: Json, draft: { url: string; headers: Record<string, string> }): void {
    const merged = new Map<string, Json>();
    for (const raw of [...list(pathItem.parameters), ...list(operation.parameters)]) {
      const parameter = this.resolve(where, raw);
      const name = string(parameter.name);
      if (name !== undefined) merged.set(`${String(parameter.in)}:${name}`, parameter);
    }
    const query: string[] = [];
    for (const parameter of merged.values()) {
      const name = parameter.name as string;
      const location = parameter.in;
      const schema = this.resolve(where, parameter.schema);
      // A value the document states is used; a made-up placeholder is not: the person fills the variable in.
      const sample = parameter.example
        ?? Object.values(object(parameter.examples)).map((entry) => this.resolve(where, entry).value)[0]
        ?? schema.example ?? schema.default ?? list(schema.enum)[0];
      const value = sample === undefined || isObject(sample) || Array.isArray(sample) ? `{{${variableName(name)}}}` : String(sample);
      if (location === 'path') draft.url = draft.url.replaceAll(`{${name}}`, value);
      else if (parameter.required !== true) continue; // optional parameters are left for the person to add
      else if (location === 'query') query.push(`${encodeKeepingVariables(name)}=${encodeKeepingVariables(value)}`);
      else if (location === 'header') draft.headers[name] = value;
      else this.warn(where, `required ${String(location)} parameter "${name}" is not supported; add it by hand`);
    }
    // Path parameters the document forgot to declare still have to be variables.
    draft.url = draft.url.replace(/(?<!\{)\{([^{}]+)\}(?!\})/g, (_match, name: string) => `{{${variableName(name)}}}`);
    if (query.length > 0) draft.url += `?${query.join('&')}`;
  }

  /** Applies the first security requirement of the operation (or of the document). */
  private security(where: string, operation: Json, draft: { url: string; headers: Record<string, string>; auth?: string }): void {
    const requirements = list(operation.security ?? this.document.security).map(object);
    if (requirements.length === 0 || requirements.some((requirement) => Object.keys(requirement).length === 0)) return; // public, or optional
    const schemes = object(object(this.document.components).securitySchemes);
    const [schemeName, scopes] = Object.entries(requirements[0] as Json)[0] as [string, unknown];
    const scheme = this.resolve(where, schemes[schemeName]);
    const variable = variableName(schemeName);
    const type = scheme.type;
    if (type === 'http' && String(scheme.scheme).toLowerCase() === 'bearer') draft.headers.Authorization = 'Bearer {{token}}';
    else if (type === 'http' && String(scheme.scheme).toLowerCase() === 'basic') draft.headers.Authorization = 'Basic {{basicAuth}}';
    else if (type === 'apiKey' && scheme.in === 'header' && string(scheme.name) !== undefined) draft.headers[scheme.name as string] = `{{${variable}}}`;
    else if (type === 'apiKey' && scheme.in === 'query' && string(scheme.name) !== undefined) {
      draft.url += `${draft.url.includes('?') ? '&' : '?'}${encodeKeepingVariables(scheme.name as string)}={{${variable}}}`;
    } else if (type === 'oauth2') {
      // Reported once per scheme, not once per operation that uses it.
      const name = this.oauth(`security scheme "${schemeName}"`, variable, object(scheme.flows), list(scopes).filter((scope): scope is string => typeof scope === 'string'));
      if (name !== undefined) draft.auth = name;
    } else {
      this.warn(where, `security scheme "${schemeName}" (${String(type ?? 'undefined')}) is not supported; add the credentials by hand`);
    }
  }

  /** An OAuth 2.0 security scheme as an `auth` block; client id and secret come from the environment. */
  private oauth(where: string, name: string, flows: Json, scopes: string[]): string | undefined {
    const absolute = (url: unknown) => (string(url)?.startsWith('/') ? `{{baseUrl}}${url as string}` : string(url));
    const clientCredentials = object(flows.clientCredentials);
    const authorizationCode = object(flows.authorizationCode);
    const candidate = isObject(flows.clientCredentials)
      ? { flow: 'client_credentials', tokenUrl: absolute(clientCredentials.tokenUrl), clientSecret: '${CLIENT_SECRET}' }
      : isObject(flows.authorizationCode)
        ? { flow: 'authorization_code', tokenUrl: absolute(authorizationCode.tokenUrl), authorizationUrl: absolute(authorizationCode.authorizationUrl) }
        : undefined;
    if (candidate === undefined) {
      this.warn(where, `it only offers the ${Object.keys(flows).join(', ') || 'no'} OAuth 2.0 flow; only clientCredentials and authorizationCode are supported, so its operations were imported without credentials`);
      return undefined;
    }
    const existing = this.auth[name];
    const allScopes = [...new Set([...(existing?.scopes ?? []), ...scopes])];
    const block = authSchema.safeParse({ type: 'oauth2', ...candidate, clientId: '${CLIENT_ID}', ...(allScopes.length > 0 && { scopes: allScopes }) });
    if (!block.success) {
      this.warn(where, 'its OAuth 2.0 flow is incomplete (token or authorization URL); add the auth block by hand');
      return undefined;
    }
    this.auth[name] = block.data;
    return name;
  }

  test(method: string, path: string, pathItem: Json, operation: Json): TestCase | undefined {
    const where = `${method.toUpperCase()} ${path}`;
    const draft: { url: string; headers: Record<string, string>; auth?: string } = { url: `{{baseUrl}}${path}`, headers: {} };
    this.parameters(where, pathItem, operation, draft);
    const body = this.body(where, operation, draft.headers);
    this.security(where, operation, draft);

    const parsed = requestSchema.safeParse({ method: method.toUpperCase(), ...draft, ...(body !== undefined && { body }) });
    if (!parsed.success) {
      this.warn(where, `the operation is not valid for httpi and was left out (${parsed.error.issues[0]?.message ?? 'invalid'})`);
      return undefined;
    }
    // The first documented 2xx is what a call that works should answer.
    const success = Object.keys(object(operation.responses)).map(Number).filter((code) => code >= 200 && code < 300).sort((a, b) => a - b)[0];
    return {
      name: string(operation.summary) ?? string(operation.operationId) ?? where,
      request: parsed.data,
      expect: success === undefined ? {} : { status: success },
    };
  }
}

/** The base URL of the API: the first server, with its variables replaced by their defaults. */
function baseUrl(document: Json, converter: Converter): string | undefined {
  const server = object(list(document.servers)[0]);
  const url = string(server.url);
  if (url === undefined) {
    converter.warn('servers', 'the document declares no server; set baseUrl in httpi.yaml');
    return undefined;
  }
  const filled = url.replace(/\{([^{}]+)\}/g, (match, name: string) => string(object(object(server.variables)[name]).default) ?? match).replace(/\/+$/, '');
  if (!/^https?:\/\//.test(filled)) converter.warn('servers', `server URL "${url}" is relative; replace baseUrl in httpi.yaml with the full address`);
  if (list(document.servers).length > 1) converter.warn('servers', `the document declares ${list(document.servers).length} servers; the first one became baseUrl`);
  return filled;
}

/**
 * Converts an OpenAPI 3.0/3.1 document: one test per operation, grouped in one file per tag.
 * Whatever cannot be converted is reported, never dropped quietly.
 */
export function importOpenApi(source: string): ImportedProject & { title: string } {
  const document = parseOpenApiSource(source);
  if (isObject(document) && typeof document.swagger === 'string') {
    throw new CurlImportError(`Swagger ${document.swagger} is not supported; convert the document to OpenAPI 3 first`);
  }
  if (!isObject(document) || !isOpenApiDocument(document)) throw new CurlImportError('this is not an OpenAPI 3 document: it needs "openapi" and "paths"');
  if (!/^3\./.test(document.openapi as string)) throw new CurlImportError(`OpenAPI ${String(document.openapi)} is not supported; only 3.0 and 3.1 are`);

  const converter = new Converter(document);
  const title = string(object(document.info).title) ?? 'API';
  const base = baseUrl(document, converter);

  const groups = new Map<string, TestCase[]>();
  for (const [path, rawItem] of Object.entries(object(document.paths))) {
    const pathItem = converter.resolve(path, rawItem);
    for (const method of METHODS) {
      if (!isObject(pathItem[method])) continue;
      const operation = pathItem[method];
      const test = converter.test(method, path, pathItem, operation);
      if (test === undefined) continue;
      const tags = list(operation.tags).filter((tag): tag is string => typeof tag === 'string' && tag !== '');
      const tag = tags[0] ?? title;
      groups.set(tag, [...(groups.get(tag) ?? []), test]);
    }
  }
  if (groups.size === 0) throw new CurlImportError('the OpenAPI document has no operations to import');

  const used = new Set<string>();
  const files: ImportedFile[] = [...groups].map(([name, tests]) => {
    const stem = slug(name, 'api');
    let path = `${stem}.yaml`;
    for (let suffix = 2; used.has(path); suffix++) path = `${stem}-${suffix}.yaml`;
    used.add(path);
    return { path, file: { version: 1, name, tests } };
  });
  return { title, files, auth: converter.auth, variables: base === undefined ? {} : { baseUrl: base }, warnings: converter.warnings };
}
