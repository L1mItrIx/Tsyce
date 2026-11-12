import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { CurlImportError } from '../../src/core/importer/map-flags.js';
import { importPostman, importPostmanEnvironment, isPostmanCollection, slug } from '../../src/core/importer/postman.js';
import { testFileSchema } from '../../src/core/schema.js';

const fixture = (name: string) => readFileSync(new URL(`../fixtures/postman/${name}`, import.meta.url), 'utf8');
const shop = () => importPostman(fixture('shop.postman_collection.json'));
const GET = { method: 'GET', headers: {} };

describe('importPostman: the Shop API fixture', () => {
  test('one file per top-level folder, plus one for the requests outside folders; empty folders give none', () => {
    const { files } = shop();
    expect(files.map((file) => [file.path, file.file.name, file.file.tests.map((test) => test.name)])).toEqual([
      ['shop-api.yaml', 'Shop API', ['Health']],
      ['users.yaml', 'Users', ['List users', 'Create user', 'Admin / Delete user', 'Admin / Get user']],
      ['orders-payments.yaml', 'Orders & Payments', ['Search orders', 'Upload receipt', 'Order graph', 'Signed', 'With API key']],
    ]);
    for (const { file } of files) expect(testFileSchema.parse(file)).toEqual(file);
  });

  test('requests: variables stay as written, disabled entries are skipped, auth is inherited or overridden', () => {
    const [root, users] = shop().files.map((file) => file.file.tests.map((test) => test.request));
    expect(root).toEqual([{ ...GET, url: '{{baseUrl}}/health' }]); // noauth turns the collection bearer off
    expect(users).toEqual([
      { ...GET, url: '{{baseUrl}}/users?page=1&limit=20', headers: { Accept: 'application/json', Authorization: 'Bearer {{token}}' } },
      {
        method: 'POST',
        url: '{{baseUrl}}/users',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer {{token}}' },
        body: { text: '{\n  "name": "{{userName}}"\n}' },
      },
      { method: 'DELETE', url: '{{baseUrl}}/users/{{id}}?force=true', headers: { Authorization: `Basic ${Buffer.from('admin:FAKE_PASSWORD').toString('base64')}` } },
      { ...GET, url: '{{baseUrl}}/users/7', headers: { Authorization: `Basic ${Buffer.from('admin:FAKE_PASSWORD').toString('base64')}` } },
    ]);
  });

  test('bodies: urlencoded is encoded around the variables, formdata becomes curl form fields', () => {
    const orders = shop().files[2]!.file.tests.map((test) => test.request);
    expect(orders[0]).toEqual({
      method: 'POST',
      url: '{{baseUrl}}/orders/search',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: { text: 'q=status%3Dopen%20%26%20paid&customer={{customerId}}' },
      auth: 'main',
    });
    expect(orders[1]).toEqual({ method: 'POST', url: '{{baseUrl}}/orders/1/receipt', headers: {}, body: { form: ['note=paid', 'receipt=@receipts/r1.pdf'] }, auth: 'main' });
    expect(orders[2]).toEqual({ method: 'POST', url: '{{baseUrl}}/graphql', headers: {}, auth: 'main' });
    expect(orders[3]).toEqual({ ...GET, url: '{{baseUrl}}/orders/signed' });
    expect(orders[4]).toEqual({ ...GET, url: '{{baseUrl}}/orders', headers: { 'X-Api-Key': '{{apiKey}}' } });
  });

  test('OAuth 2.0 settings become one auth block; the client secret and the stale token are never copied', () => {
    const imported = shop();
    expect(imported.auth).toEqual({
      main: { type: 'oauth2', flow: 'client_credentials', tokenUrl: '{{baseUrl}}/oauth/token', clientId: 'shop-ci', clientSecret: '${CLIENT_SECRET}', scopes: ['orders.read', 'orders.write'] },
    });
    expect(JSON.stringify(imported)).not.toMatch(/FAKE_CLIENT_SECRET|FAKE_STALE_ACCESS_TOKEN|FAKE_ACCESS_KEY/);
  });

  test('collection variables are returned for the environment; disabled ones are not', () => {
    expect(shop().variables).toEqual({ baseUrl: 'https://api.shop.example' });
  });

  test('everything that was not converted is reported with the request it belongs to', () => {
    expect(shop().warnings).toEqual([
      'Shop API: the collection-level pre-request script was not converted',
      'Users / List users: the test script was not converted',
      'Users / Admin / Delete user: path variable ":id" has no value; it became {{id}}',
      'Orders & Payments / Search orders: the OAuth client secret was not copied; auth "main" reads it from ${CLIENT_SECRET}',
      'Orders & Payments / Upload receipt: form file "photo" has no path; add it as "photo=@<path>"',
      'Orders & Payments / Order graph: GraphQL bodies are not supported; the body was left out',
      'Orders & Payments / Signed: auth type "awsv4" is not supported; add the credentials by hand',
    ]);
  });
});

describe('importPostman: other shapes', () => {
  const collection = (item: unknown[], extra: object = {}) =>
    JSON.stringify({ info: { name: 'C', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' }, item, ...extra });
  const requests = (item: unknown[], extra: object = {}) => importPostman(collection(item, extra));

  test('a request given as a plain URL is a GET', () => {
    expect(requests([{ name: 'ping', request: 'https://x.example/ping' }]).files[0]!.file.tests[0]!.request).toEqual({ ...GET, url: 'https://x.example/ping' });
  });

  test('v2.0 auth written as an object, basic auth with variables, API key in the query', () => {
    const imported = requests([
      { name: 'a', request: { url: 'https://x.example/a', auth: { type: 'bearer', bearer: { token: '{{t}}' } } } },
      { name: 'b', request: { url: 'https://x.example/b', auth: { type: 'basic', basic: [{ key: 'username', value: '{{user}}' }, { key: 'password', value: 'p' }] } } },
      { name: 'c', request: { url: 'https://x.example/c?x=1', auth: { type: 'apikey', apikey: [{ key: 'key', value: 'api key' }, { key: 'value', value: '{{k}}' }, { key: 'in', value: 'query' }] } } },
    ]);
    expect(imported.files[0]!.file.tests.map((test) => [test.request.url, test.request.headers])).toEqual([
      ['https://x.example/a', { Authorization: 'Bearer {{t}}' }],
      ['https://x.example/b', { Authorization: 'Basic {{basicAuth}}' }],
      ['https://x.example/c?x=1&api%20key={{k}}', {}],
    ]);
    expect(imported.warnings).toEqual(['b: basic auth uses variables; set basicAuth to the base64 of "user:password"']);
  });

  test('an explicit Authorization header wins over inherited auth', () => {
    const imported = requests([{ name: 'a', request: { url: 'https://x.example', header: [{ key: 'authorization', value: 'Custom {{x}}' }] } }], { auth: { type: 'bearer', bearer: [{ key: 'token', value: 'T' }] } });
    expect(imported.files[0]!.file.tests[0]!.request.headers).toEqual({ authorization: 'Custom {{x}}' });
  });

  test('authorization_code OAuth becomes that flow; other grants and incomplete settings are reported', () => {
    const oauth = (values: Record<string, string>) => ({ type: 'oauth2', oauth2: Object.entries(values).map(([key, value]) => ({ key, value })) });
    const imported = requests([
      { name: 'code', request: { url: 'https://x.example/1', auth: oauth({ grant_type: 'authorization_code_with_pkce', authUrl: 'https://id.example/auth', accessTokenUrl: 'https://id.example/token', clientId: 'app' }) } },
      { name: 'same', request: { url: 'https://x.example/2', auth: oauth({ grant_type: 'authorization_code_with_pkce', authUrl: 'https://id.example/auth', accessTokenUrl: 'https://id.example/token', clientId: 'app' }) } },
      { name: 'password', request: { url: 'https://x.example/3', auth: oauth({ grant_type: 'password_credentials', accessTokenUrl: 'https://id.example/token', clientId: 'app' }) } },
      { name: 'incomplete', request: { url: 'https://x.example/4', auth: oauth({ grant_type: 'client_credentials' }) } },
    ]);
    expect(imported.auth).toEqual({
      main: { type: 'oauth2', flow: 'authorization_code', tokenUrl: 'https://id.example/token', authorizationUrl: 'https://id.example/auth', clientId: 'app', redirectPort: 8787 },
    });
    expect(imported.files[0]!.file.tests.map((test) => test.request.auth)).toEqual(['main', 'main', undefined, undefined]);
    expect(imported.warnings).toEqual([
      'password: OAuth 2.0 grant "password_credentials" is not supported; only client_credentials and authorization_code are',
      'incomplete: the OAuth 2.0 settings are incomplete (token URL, client id); add the auth block by hand',
    ]);
  });

  test('requests that cannot be tests are left out with a warning; folders with the same name get distinct files', () => {
    const imported = requests([
      { name: 'no url', request: { method: 'GET' } },
      { name: 'odd method', request: { method: 'GET IT', url: 'https://x.example' } },
      { name: 'Reports', item: [{ name: 'a', request: 'https://x.example/a' }] },
      { name: 'reports', item: [{ request: 'https://x.example/b' }] },
      { name: '¡Más cosas!', item: [{ name: 'c', request: { url: 'https://x.example/c', body: { mode: 'file', file: { src: 'a.bin' } } } }] },
    ]);
    expect(imported.files.map((file) => [file.path, file.file.tests.map((test) => test.name)])).toEqual([
      ['reports.yaml', ['a']],
      ['reports-2.yaml', ['request 1']],
      ['mas-cosas.yaml', ['c']],
    ]);
    expect(imported.warnings).toEqual([
      'no url: the request has no URL; it was left out',
      'odd method: the request is not valid for httpi and was left out (method must be uppercase letters, e.g. GET)',
      '¡Más cosas! / c: body mode "file" is not supported; the body was left out',
    ]);
  });

  test.each<[name: string, source: string, message: string]>([
    ['text that is not JSON', 'curl http://x', 'Postman collection: not valid JSON'],
    ['JSON that is not a collection', '{"openapi":"3.0.0"}', 'this is not a Postman collection (v2.0 or v2.1)'],
    ['a v1 collection', '{"info":{"schema":"https://schema.getpostman.com/json/collection/v1.0.0/collection.json"},"item":[]}', 'Postman collection format v1.0 is not supported; export it as v2.1'],
    ['a collection without requests', collection([{ name: 'empty', item: [] }]), 'the Postman collection has no requests to import'],
  ])('rejects %s', (_name, source, message) => {
    expect(() => importPostman(source)).toThrow(CurlImportError);
    expect(() => importPostman(source)).toThrow(message);
  });
});

test('isPostmanCollection recognizes a collection and nothing else', () => {
  expect(isPostmanCollection(JSON.parse(fixture('shop.postman_collection.json')))).toBe(true);
  expect(isPostmanCollection(JSON.parse(fixture('staging.postman_environment.json')))).toBe(false);
  expect(isPostmanCollection({ info: { title: 'An OpenAPI document' }, paths: {} })).toBe(false);
  expect(isPostmanCollection('curl http://x')).toBe(false);
});

test('importPostmanEnvironment keeps the enabled values as text and names the environment', () => {
  expect(importPostmanEnvironment(fixture('staging.postman_environment.json'))).toEqual({
    name: 'shop-staging',
    variables: { baseUrl: 'https://staging.shop.example', customerId: '42' },
  });
  expect(() => importPostmanEnvironment('{"name":"x"}')).toThrow('this is not a Postman environment export');
});

test('slug makes a safe file name', () => {
  expect([slug('Orders & Payments', 'x'), slug('  ¡Más cosas!  ', 'x'), slug('***', 'requests')]).toEqual(['orders-payments', 'mas-cosas', 'requests']);
});
