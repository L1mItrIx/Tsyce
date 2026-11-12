import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { tokenizeCurl } from '../../src/core/importer/detect-dialect.js';
import { CurlImportError, extractSecrets, mapFlags } from '../../src/core/importer/map-flags.js';

const API = 'https://api.example.com/users';
const GET = { method: 'GET', url: API, headers: {} };

type Case = [name: string, args: string[], request: Record<string, unknown>, warnings?: string[]];

function table(cases: Case[]) {
  test.each(cases)('%s', (_name, args, request, warnings = []) => {
    expect(mapFlags(['curl', ...args])).toEqual({ request, warnings });
  });
}

describe('method and URL', () => {
  table([
    ['a bare URL is a GET', [API], GET],
    ['--url', ['--url', API], GET],
    ['-X', ['-X', 'DELETE', API], { ...GET, method: 'DELETE' }],
    ['--request, lowercase method is normalized', ['--request', 'patch', API], { ...GET, method: 'PATCH' }],
    ['the API can come before the flags', [API, '-X', 'PUT'], { ...GET, method: 'PUT' }],
    ['a second API is reported, not run', [API, 'https://other.example'], GET, ['extra argument "https://other.example" was ignored']],
  ]);
});

describe('headers', () => {
  table([
    ['-H, repeated', ['-H', 'Accept: text/plain', '--header', 'X-Trace:  a:b ', API], { ...GET, headers: { Accept: 'text/plain', 'X-Trace': 'a:b' } }],
    ['"Name;" is a header with an empty value', ['-H', 'X-Empty;', API], { ...GET, headers: { 'X-Empty': '' } }],
    ['-A and -e', ['-A', 'httpi/1', '-e', 'https://ref.example', API], { ...GET, headers: { 'User-Agent': 'httpi/1', Referer: 'https://ref.example' } }],
    ['-b becomes the Cookie header', ['-b', 'a=1; b=2', API], { ...GET, headers: { Cookie: 'a=1; b=2' } }],
    ['-u becomes Basic auth', ['-u', 'ana:s3cret', API], { ...GET, headers: { Authorization: 'Basic YW5hOnMzY3JldA==' } }],
    [
      'the same header twice keeps the last value and warns',
      ['-H', 'accept: a', '-H', 'Accept: b', API],
      { ...GET, headers: { Accept: 'b' } },
      ['header "Accept" is set more than once; only the last value was kept'],
    ],
    ['"Name:" (remove a header) is reported', ['-H', 'Accept:', API], GET, ['header "Accept:" removes a default curl header; not supported, ignored']],
    ['a header without colon is reported', ['-H', 'nonsense', API], GET, ['malformed header "nonsense" was ignored']],
    ['-b with a file name is reported', ['-b', 'cookies.txt', API], GET, ['-b reads cookies from a file (cookies.txt); not supported, ignored']],
    ['-u without password is reported', ['--user', 'ana', API], GET, ['--user without a password makes curl ask for it; add the Authorization header by hand']],
  ]);
});

describe('body', () => {
  const POST = { ...GET, method: 'POST' };
  table([
    ['-d implies POST', ['-d', 'a=1', API], { ...POST, body: { text: 'a=1' } }],
    ['the body is kept exactly as written', ['--data-raw', '{ "a" : 1,\n  "b":"x" }', API], { ...POST, body: { text: '{ "a" : 1,\n  "b":"x" }' } }],
    ['several -d are joined with &', ['-d', 'a=1', '--data', 'b=2', '--data-binary', 'c=3', API], { ...POST, body: { text: 'a=1&b=2&c=3' } }],
    ['--data-raw keeps a leading @', ['--data-raw', '@home', API], { ...POST, body: { text: '@home' } }],
    ['-X wins over the implied POST', ['-X', 'PUT', '-d', 'x', API], { ...GET, method: 'PUT', body: { text: 'x' } }],
    [
      '--data-urlencode encodes the value, not the name',
      ['--data-urlencode', 'q=a b&c/é!', '--data-urlencode', '=x y', '--data-urlencode', 'plain text', API],
      { ...POST, body: { text: 'q=a+b%26c%2F%C3%A9%21&x+y&plain+text' } },
    ],
    [
      '--json sets the JSON headers',
      ['--json', '{"a":1}', API],
      { ...POST, headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: { text: '{"a":1}' } },
    ],
    [
      '--json respects headers given by hand',
      ['--json', '{}', '-H', 'accept: */*', API],
      { ...POST, headers: { accept: '*/*', 'Content-Type': 'application/json' }, body: { text: '{}' } },
    ],
    ['-F builds a multipart form', ['-F', 'name=Ana', '--form', 'avatar=@a.png', API], { ...POST, body: { form: ['name=Ana', 'avatar=@a.png'] } }],
    ['-G moves the data to the query string', ['-G', '-d', 'a=1', '--data-urlencode', 'q=x y', API], { ...GET, url: `${API}?a=1&q=x+y` }],
    ['-G appends to an existing query', ['--get', '-d', 'a=1', `${API}?z=0`], { ...GET, url: `${API}?z=0&a=1` }],
    ['-d @file is reported', ['-d', '@body.json', API], GET, ['-d reads the body from a file (@body.json); not supported, ignored']],
    ['--data-urlencode name@file is reported', ['--data-urlencode', 'q@f.txt', API], GET, ['--data-urlencode reads the body from a file (q@f.txt); not supported, ignored']],
    [
      '-F together with -d keeps the form',
      ['-F', 'a=1', '-d', 'b=2', API],
      { ...POST, body: { form: ['a=1'] } },
      ['both --form and --data were given; kept the form and ignored the data'],
    ],
  ]);
});

describe('options', () => {
  table([
    ['--compressed -L -k', ['--compressed', '-L', '-k', API], { ...GET, compressed: true, followRedirects: true, insecure: true }],
    ['long names', ['--location', '--insecure', API], { ...GET, followRedirects: true, insecure: true }],
    ['-m in seconds becomes timeoutMs', ['-m', '2.5', API], { ...GET, timeoutMs: 2500 }],
    ['--max-time', ['--max-time', '30', API], { ...GET, timeoutMs: 30000 }],
    ['a bad --max-time is reported', ['--max-time', 'soon', API], GET, ['--max-time value "soon" is not a positive number of seconds; ignored']],
  ]);
});

describe('pasted forms', () => {
  table([
    ['-XPOST', ['-XPOST', API], { ...GET, method: 'POST' }],
    ["-H'value' glued to the flag", ['-HAccept: text/plain', API], { ...GET, headers: { Accept: 'text/plain' } }],
    [
      '--flag=value is read, with a note that curl would reject it',
      ['--request=PUT', '--header=A: b=c', `--url=${API}`],
      { method: 'PUT', url: API, headers: { A: 'b=c' } },
      [
        'curl does not accept "--request=value"; it was read as "--request value"',
        'curl does not accept "--header=value"; it was read as "--header value"',
        'curl does not accept "--url=value"; it was read as "--url value"',
      ],
    ],
    ['a cluster of short flags', ['-kL', API], { ...GET, insecure: true, followRedirects: true }],
    ['a cluster ending in a flag with value', ['-kLXPUT', API], { ...GET, method: 'PUT', insecure: true, followRedirects: true }],
    ['a cluster whose value is the next argument', ['-kd', 'a=1', API], { ...GET, method: 'POST', insecure: true, body: { text: 'a=1' } }],
    [
      '-sSL: unsupported flags inside a cluster are reported one by one',
      ['-sSL', API],
      { ...GET, followRedirects: true },
      ['unsupported flag -s was ignored', 'unsupported flag -S was ignored'],
    ],
  ]);

  test('"$ curl ..." with the prompt', () => {
    expect(mapFlags(['$', 'curl', API]).request).toEqual(GET);
  });

  test('curl.exe and full paths are curl too', () => {
    expect(mapFlags(['curl.exe', API]).request).toEqual(GET);
    expect(mapFlags(['C:\\Windows\\System32\\CURL.EXE', API]).request).toEqual(GET);
    expect(mapFlags(['/usr/bin/curl', API]).request).toEqual(GET);
  });
});

describe('flags outside the whitelist', () => {
  table([
    ['unknown boolean flag', ['--http2', '-v', API], GET, ['unsupported flag --http2 was ignored', 'unsupported flag -v was ignored']],
    [
      'known curl flag with a value: the value is not taken for the URL',
      ['-o', 'out.json', '--proxy', 'http://proxy:8080', '--connect-timeout=5', API],
      GET,
      [
        'unsupported flag -o (and its value) was ignored',
        'unsupported flag --proxy (and its value) was ignored',
        'curl does not accept "--connect-timeout=value"; it was read as "--connect-timeout value"',
        'unsupported flag --connect-timeout (and its value) was ignored',
      ],
    ],
    ['value glued to an unsupported short flag', ['-oout.json', API], GET, ['unsupported flag -o (and its value) was ignored']],
    ['a toggle given a value', ['--location=yes', API], { ...GET, followRedirects: true }, ['curl does not accept "--location=value"; it was read as "--location value"', 'flag --location does not take a value; "yes" was ignored']],
    ['a flag missing its value at the end', [API, '-H'], GET, ['flag -H expects a value but the command ends there; ignored']],
    ['shell leftovers are reported', [API, '|', 'jq', '.'], GET, ['extra argument "|" was ignored', 'extra argument "jq" was ignored', 'extra argument "." was ignored']],
  ]);
});

describe('errors', () => {
  test.each<[name: string, tokens: string[], message: string]>([
    ['empty input', [], 'nothing to import: the input is empty'],
    ['not curl', ['wget', API], 'expected a curl command, but it starts with "wget"'],
    ['no URL', ['curl', '-X', 'POST'], 'the curl command has no URL'],
    ['a method that is not a word', ['curl', '-X', 'GET /x', API], 'the curl command does not describe a valid request'],
  ])('%s', (_name, tokens, message) => {
    expect(() => mapFlags(tokens)).toThrow(CurlImportError);
    expect(() => mapFlags(tokens)).toThrow(message);
  });
});

describe('extractSecrets', () => {
  type SecretCase = [name: string, args: string[], headers: Record<string, string>, secrets: unknown[]];

  test.each<SecretCase>([
    [
      'Bearer token keeps its scheme',
      ['-H', 'authorization: Bearer FAKE_TOKEN_123'],
      { authorization: 'Bearer {{token}}' },
      [{ header: 'authorization', variable: 'token', value: 'FAKE_TOKEN_123' }],
    ],
    [
      '-u becomes Basic {{basicAuth}}',
      ['-u', 'ana:s3cret'],
      { Authorization: 'Basic {{basicAuth}}' },
      [{ header: 'Authorization', variable: 'basicAuth', value: 'YW5hOnMzY3JldA==' }],
    ],
    [
      'any other Authorization is replaced whole',
      ['-H', 'Authorization: AWS4-HMAC-SHA256 Credential=FAKE, Signature=abc'],
      { Authorization: '{{authorization}}' },
      [{ header: 'Authorization', variable: 'authorization', value: 'AWS4-HMAC-SHA256 Credential=FAKE, Signature=abc' }],
    ],
    [
      'an Authorization without scheme is replaced whole',
      ['-H', 'Authorization: FAKE_KEY'],
      { Authorization: '{{authorization}}' },
      [{ header: 'Authorization', variable: 'authorization', value: 'FAKE_KEY' }],
    ],
    [
      '-b cookies and other headers together',
      ['-b', 'session=FAKE; theme=dark', '-H', 'Accept: */*', '-H', 'Authorization: Bearer T'],
      { Cookie: '{{cookie}}', Accept: '*/*', Authorization: 'Bearer {{token}}' },
      [
        { header: 'Cookie', variable: 'cookie', value: 'session=FAKE; theme=dark' },
        { header: 'Authorization', variable: 'token', value: 'T' },
      ],
    ],
    ['a value that is already a variable is left alone', ['-H', 'Authorization: Bearer ${API_TOKEN}', '-b', 'sid={{sid}}'], { Authorization: 'Bearer ${API_TOKEN}', Cookie: 'sid={{sid}}' }, []],
    ['no credentials, nothing to do', ['-H', 'X-Trace: Bearer abc'], { 'X-Trace': 'Bearer abc' }, []],
  ])('%s', (_name, args, headers, secrets) => {
    const { request } = mapFlags(['curl', ...args, API]);
    expect(extractSecrets(request)).toEqual({ request: { ...request, headers }, secrets });
  });
});

describe('fixtures: the same request from every dialect', () => {
  const read = (path: string) => mapFlags(tokenizeCurl(readFileSync(new URL(`../fixtures/curl/${path}`, import.meta.url), 'utf8')).tokens);

  const chromeGet = {
    request: {
      method: 'GET',
      url: 'https://api.example.com/v1/users?page=2&sort=name',
      headers: {
        accept: 'application/json, text/plain, */*',
        'accept-language': 'es-ES,es;q=0.9,en;q=0.8',
        authorization: 'Bearer FAKE_TOKEN_123',
        Cookie: 'session=FAKE_SESSION; theme=dark',
        'sec-ch-ua': '"Chromium";v="130", "Not?A_Brand";v="99"',
        'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      },
    },
    warnings: [],
  };

  test.each(['bash/chrome-get.txt', 'cmd/chrome-get.txt'])('%s', (path) => {
    expect(read(path)).toEqual(chromeGet);
  });

  test.each([
    ['bash/docs-double-quotes.txt', 'Bearer $API_TOKEN'],
    ['cmd/docs-double-quotes.txt', 'Bearer %API_TOKEN%'],
    ['powershell/docs-post-json.txt', 'Bearer $env:API_TOKEN'],
  ])('%s', (path, authorization) => {
    expect(read(path)).toEqual({
      request: {
        method: 'POST',
        url: 'https://api.example.com/v1/users',
        headers: { Authorization: authorization, 'Content-Type': 'application/json' },
        body: { text: '{"name": "Ana", "price": "$5"}' },
      },
      warnings: [],
    });
  });

  test('bash/chrome-post-json.txt keeps the body byte for byte', () => {
    expect(read('bash/chrome-post-json.txt').request.body).toEqual({
      text: '{"name":"Ana","note":"it\'s here!","lines":"a\\nb"}',
    });
  });
});
