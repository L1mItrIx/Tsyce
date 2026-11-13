import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { CurlImportError } from '../../src/core/importer/map-flags.js';
import { importOpenApi, isOpenApiDocument, parseOpenApiSource } from '../../src/core/importer/openapi.js';
import { testFileSchema } from '../../src/core/schema.js';

const fixture = (name: string) => readFileSync(new URL(`../fixtures/openapi/${name}`, import.meta.url), 'utf8');
const summary = (source: string) => importOpenApi(source).files.map((file) => [file.path, file.file.tests.map((test) => `${test.request.method} ${test.request.url} → ${test.expect.status ?? '-'}`)]);

describe('importOpenApi: the real Petstore documents', () => {
  test('petstore-expanded (OAI): untagged operations share one file named after the API', () => {
    const imported = importOpenApi(fixture('petstore-expanded.yaml'));
    expect(imported.title).toBe('Swagger Petstore');
    expect(imported.variables).toEqual({ baseUrl: 'https://petstore.swagger.io/v2' });
    expect(summary(fixture('petstore-expanded.yaml'))).toEqual([
      ['swagger-petstore.yaml', ['GET {{baseUrl}}/pets → 200', 'POST {{baseUrl}}/pets → 200', 'GET {{baseUrl}}/pets/{{id}} → 200', 'DELETE {{baseUrl}}/pets/{{id}} → 204']],
    ]);
    // NewPet is reached through $ref; it has no examples, so the body is a scaffold of its properties.
    expect(imported.files[0]!.file.tests[1]!.request).toEqual({
      method: 'POST',
      url: '{{baseUrl}}/pets',
      headers: { 'Content-Type': 'application/json' },
      body: { json: { name: 'string', tag: 'string' } },
    });
    expect(imported.files[0]!.file.tests.map((test) => test.name)).toEqual(['findPets', 'addPet', 'find pet by id', 'deletePet']);
    expect(imported.warnings).toEqual([]);
    expect(imported.auth).toEqual({});
  });

  test('petstore3 (Swagger): one file per tag, bodies from schema examples, security applied or reported', () => {
    const imported = importOpenApi(fixture('petstore3.yaml'));
    expect(imported.files.map((file) => [file.path, file.file.name, file.file.tests.length])).toEqual([
      ['pet.yaml', 'pet', 8],
      ['store.yaml', 'store', 4],
      ['user.yaml', 'user', 7],
    ]);
    for (const { file } of imported.files) expect(testFileSchema.parse(file)).toEqual(file);
    expect(imported.variables).toEqual({ baseUrl: 'https://petstore3.swagger.io/api/v3' });

    const byName = Object.fromEntries(imported.files.flatMap((file) => file.file.tests).map((test) => [test.name, test]));
    expect(byName['Add a new pet to the store.']).toEqual({
      name: 'Add a new pet to the store.',
      request: {
        method: 'POST',
        url: '{{baseUrl}}/pet',
        headers: { 'Content-Type': 'application/json' },
        body: { json: { id: 10, name: 'doggie', category: { id: 1, name: 'Dogs' }, photoUrls: ['string'], tags: [{ id: 0, name: 'string' }], status: 'available' } },
      },
      expect: { status: 200 },
    });
    // api_key is an apiKey scheme in a header; the path parameter is a variable.
    expect(byName['Find pet by ID.']!.request).toEqual({ method: 'GET', url: '{{baseUrl}}/pet/{{petId}}', headers: { api_key: '{{api_key}}' } });
    // A required query parameter takes the default the document gives; one without it is a variable.
    expect(byName['Finds Pets by status.']!.request.url).toBe('{{baseUrl}}/pet/findByStatus?status=available');
    expect(byName['Finds Pets by tags.']!.request.url).toBe('{{baseUrl}}/pet/findByTags?tags={{tags}}');
    expect(byName['Returns pet inventories by status.']!.request.headers).toEqual({ api_key: '{{api_key}}' });
    expect(byName['Delete user resource.']!.request).toEqual({ method: 'DELETE', url: '{{baseUrl}}/user/{{username}}', headers: {} });

    expect(imported.auth).toEqual({});
    expect(imported.warnings).toEqual([
      'security scheme "petstore_auth": it only offers the implicit OAuth 2.0 flow; only clientCredentials and authorizationCode are supported, so its operations were imported without credentials',
      'POST /pet/{petId}/uploadImage: request body of type application/octet-stream is not supported; the body was left out',
    ]);
  });
});

describe('importOpenApi: details', () => {
  const document = (extra: object) => JSON.stringify({ openapi: '3.1.0', info: { title: 'T' }, servers: [{ url: 'https://api.example/v1/' }], ...extra });
  const one = (operation: object, extra: object = {}, method = 'post') => {
    const imported = importOpenApi(document({ paths: { '/things/{thing-id}': { [method]: operation } }, ...extra }));
    return { test: imported.files[0]!.file.tests[0]!, ...imported };
  };

  test('JSON input, trailing slash of the server removed, path parameter names made into variable names', () => {
    const { test: created, variables } = one({ responses: { 201: {}, 400: {} } });
    expect(variables).toEqual({ baseUrl: 'https://api.example/v1' });
    expect(created).toEqual({ name: 'POST /things/{thing-id}', request: { method: 'POST', url: '{{baseUrl}}/things/{{thing-id}}', headers: {} }, expect: { status: 201 } });
  });

  test('parameters: path-level and operation-level merge, examples are used, optional ones are skipped', () => {
    const { test: found, warnings } = one(
      {
        parameters: [
          { name: 'thing-id', in: 'path', required: true, example: 42 },
          { name: 'q', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'page size', in: 'query', required: true, examples: { small: { value: 10 } } },
          { name: 'debug', in: 'query' },
          { name: 'X-Tenant', in: 'header', required: true },
          { name: 'sid', in: 'cookie', required: true },
          { $ref: '#/components/parameters/Trace' },
        ],
        responses: { default: {}, '2XX': {} },
      },
      { components: { parameters: { Trace: { name: 'X-Trace', in: 'header', required: true, schema: { enum: ['on', 'off'] } } } } },
      'get',
    );
    expect(found.request).toEqual({
      method: 'GET',
      url: '{{baseUrl}}/things/42?q={{q}}&page%20size=10',
      headers: { 'X-Tenant': '{{X-Tenant}}', 'X-Trace': 'on' },
    });
    expect(found.expect).toEqual({});
    expect(warnings).toEqual(['GET /things/{thing-id}: required cookie parameter "sid" is not supported; add it by hand']);
  });

  test.each<[name: string, requestBody: object, components: object, body: unknown, headers: Record<string, string>]>([
    ['the media type example wins', { content: { 'application/json': { example: { a: 1 }, schema: { example: { b: 2 } } } } }, {}, { json: { a: 1 } }, { 'Content-Type': 'application/json' }],
    ['the first named example, through $ref', { content: { 'application/vnd.api+json': { examples: { first: { $ref: '#/components/examples/E' } } } } }, { examples: { E: { value: [1, 2] } } }, { json: [1, 2] }, { 'Content-Type': 'application/vnd.api+json' }],
    [
      'allOf merges, readOnly is left out, a schema that contains itself stops',
      { $ref: '#/components/requestBodies/Node' },
      {
        requestBodies: { Node: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Node' } } } } },
        schemas: {
          Base: { type: 'object', properties: { id: { type: 'integer', readOnly: true }, kind: { const: 'node' } } },
          Node: { allOf: [{ $ref: '#/components/schemas/Base' }, { type: 'object', properties: { label: { type: 'string', example: 'root' }, when: { type: 'string', format: 'date' }, child: { $ref: '#/components/schemas/Node' } } }] },
        },
      },
      { json: { kind: 'node', label: 'root', when: '2026-01-01' } },
      { 'Content-Type': 'application/json' },
    ],
    ['a urlencoded form', { content: { 'application/x-www-form-urlencoded': { schema: { type: 'object', properties: { name: { example: 'Ana & co' }, n: { example: 3 } } } } } }, {}, { text: 'name=Ana%20%26%20co&n=3' }, {}],
    ['a multipart form with a file', { content: { 'multipart/form-data': { schema: { type: 'object', properties: { title: { type: 'string' }, file: { type: 'string', format: 'binary' } } } } } }, {}, { form: ['title=string', 'file=@<path>'] }, {}],
    ['plain text', { content: { 'text/plain': { example: 'hello' } } }, {}, { text: 'hello' }, { 'Content-Type': 'text/plain' }],
  ])('body: %s', (_name, requestBody, components, body, headers) => {
    const { test: created } = one({ requestBody, responses: { 200: {} } }, { components });
    expect(created.request.body).toEqual(body);
    expect(created.request.headers).toEqual(headers);
  });

  test('bodies that cannot be built are left out with a warning', () => {
    const where = 'POST /things/{thing-id}';
    expect(one({ requestBody: { content: { 'application/xml': {} } } }).warnings).toEqual([`${where}: request body of type application/xml is not supported; the body was left out`]);
    expect(one({ requestBody: { content: { 'application/json': { schema: {} } } } }).warnings).toEqual([`${where}: the request body has no example and none could be built from its schema; the body was left out`]);
    expect(one({ requestBody: { content: { 'application/json': { schema: { oneOf: [{ type: 'object', properties: { a: { type: 'boolean' } } }, { type: 'string' }] } } } } }).warnings).toEqual([
      `${where}: the body schema offers alternatives (oneOf/anyOf) without an example; the first one was used`,
    ]);
    expect(one({ requestBody: { content: { 'application/json': { schema: { $ref: 'https://other.example/schemas.json#/Pet' } } } } }).warnings).toEqual([
      `${where}: remote reference "https://other.example/schemas.json#/Pet" is not supported; it was ignored`,
      `${where}: the request body has no example and none could be built from its schema; the body was left out`,
    ]);
  });

  const schemes = {
    bearer: { type: 'http', scheme: 'bearer' },
    basic: { type: 'http', scheme: 'Basic' },
    'key in query': { type: 'apiKey', in: 'query', name: 'api key' },
    machine: { type: 'oauth2', flows: { clientCredentials: { tokenUrl: '/oauth/token', scopes: {} } } },
    person: { type: 'oauth2', flows: { authorizationCode: { authorizationUrl: 'https://id.example/auth', tokenUrl: 'https://id.example/token', scopes: {} } } },
    oidc: { type: 'openIdConnect', openIdConnectUrl: 'https://id.example/.well-known/openid-configuration' },
  };
  const secured = (security: unknown, global?: unknown) => one({ ...(security !== undefined && { security }) }, { components: { securitySchemes: schemes }, ...(global !== undefined && { security: global }) }, 'get');

  test.each<[name: string, security: unknown, global: unknown, request: object]>([
    ['http bearer', [{ bearer: [] }], undefined, { headers: { Authorization: 'Bearer {{token}}' } }],
    ['http basic', [{ basic: [] }], undefined, { headers: { Authorization: 'Basic {{basicAuth}}' } }],
    ['an API key in the query', [{ 'key in query': [] }], undefined, { url: '{{baseUrl}}/things/{{thing-id}}?api%20key={{key_in_query}}' }],
    ['the document-wide requirement applies when the operation has none', undefined, [{ bearer: [] }], { headers: { Authorization: 'Bearer {{token}}' } }],
    ['an empty requirement list makes the operation public', [], [{ bearer: [] }], { headers: {} }],
    ['an optional requirement ({}) is treated as public', [{}, { bearer: [] }], undefined, { headers: {} }],
    ['only the first alternative is used', [{ basic: [] }, { bearer: [] }], undefined, { headers: { Authorization: 'Basic {{basicAuth}}' } }],
  ])('security: %s', (_name, security, global, request) => {
    expect(secured(security, global).test.request).toEqual({ method: 'GET', url: '{{baseUrl}}/things/{{thing-id}}', headers: {}, ...request });
  });

  test('OAuth 2.0 schemes become auth blocks: client credentials from the environment, scopes collected', () => {
    const machine = secured([{ machine: ['things.read', 'things.write'] }]);
    expect(machine.test.request.auth).toBe('machine');
    expect(machine.auth).toEqual({
      machine: { type: 'oauth2', flow: 'client_credentials', tokenUrl: '{{baseUrl}}/oauth/token', clientId: '${CLIENT_ID}', clientSecret: '${CLIENT_SECRET}', scopes: ['things.read', 'things.write'] },
    });
    expect(secured([{ person: [] }]).auth).toEqual({
      person: { type: 'oauth2', flow: 'authorization_code', tokenUrl: 'https://id.example/token', authorizationUrl: 'https://id.example/auth', clientId: '${CLIENT_ID}', redirectPort: 8787 },
    });
    expect(secured([{ oidc: [] }]).warnings).toEqual(['GET /things/{thing-id}: security scheme "oidc" (openIdConnect) is not supported; add the credentials by hand']);
  });

  test('servers: variables take their defaults; missing, relative or several servers are reported', () => {
    const paths = { '/x': { get: {} } };
    const servers = (list: unknown) => importOpenApi(JSON.stringify({ openapi: '3.0.3', info: {}, ...(list !== undefined && { servers: list }), paths }));
    expect(servers([{ url: 'https://{region}.api.example:{port}/', variables: { region: { default: 'eu' }, port: { default: '8443' } } }]).variables).toEqual({ baseUrl: 'https://eu.api.example:8443' });
    expect(servers(undefined)).toMatchObject({ variables: {}, warnings: ['servers: the document declares no server; set baseUrl in httpi.yaml'] });
    expect(servers([{ url: '/api' }]).warnings).toEqual(['servers: server URL "/api" is relative; replace baseUrl in httpi.yaml with the full address']);
    expect(servers([{ url: 'https://a.example' }, { url: 'https://b.example' }]).warnings).toEqual(['servers: the document declares 2 servers; the first one became baseUrl']);
  });

  test('tags with the same file name get distinct files; the title names the untagged file', () => {
    const imported = importOpenApi(document({ paths: { '/a': { get: { tags: ['Users'] } }, '/b': { get: { tags: ['users', 'ignored'] } }, '/c': { get: {} } } }));
    expect(imported.files.map((file) => [file.path, file.file.name])).toEqual([['users.yaml', 'Users'], ['users-2.yaml', 'users'], ['t.yaml', 'T']]);
  });

  test.each<[name: string, source: string, message: string]>([
    ['Swagger 2', 'swagger: "2.0"\npaths: {}\n', 'Swagger 2.0 is not supported; convert the document to OpenAPI 3 first'],
    ['something that is not OpenAPI', '{"info":{"name":"x"},"item":[]}', 'this is not an OpenAPI 3 document: it needs "openapi" and "paths"'],
    ['a curl command', 'curl https://x.example', 'this is not an OpenAPI 3 document'],
    ['OpenAPI 4', 'openapi: "4.0.0"\npaths: {}\n', 'OpenAPI 4.0.0 is not supported; only 3.0 and 3.1 are'],
    ['a document without operations', 'openapi: "3.0.0"\npaths:\n  /x:\n    description: nothing here\n', 'the OpenAPI document has no operations to import'],
  ])('rejects %s', (_name, source, message) => {
    expect(() => importOpenApi(source)).toThrow(CurlImportError);
    expect(() => importOpenApi(source)).toThrow(message);
  });
});

test('isOpenApiDocument recognizes OpenAPI in YAML or JSON and nothing else', () => {
  expect(isOpenApiDocument(parseOpenApiSource(fixture('petstore3.yaml')))).toBe(true);
  expect(isOpenApiDocument(parseOpenApiSource('{"openapi":"3.1.0","paths":{}}'))).toBe(true);
  expect(isOpenApiDocument(parseOpenApiSource("curl -H 'a: b' https://x.example"))).toBe(false);
  expect(isOpenApiDocument(parseOpenApiSource('{"openapi":"3.1.0"}'))).toBe(false);
  expect(isOpenApiDocument(parseOpenApiSource('a: [unclosed'))).toBe(false);
});
