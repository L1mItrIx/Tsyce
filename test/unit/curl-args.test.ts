import { expect, test } from 'vitest';
import { buildCurlArgs } from '../../src/core/runner/curl-args.js';
import { requestSchema } from '../../src/core/schema.js';

const URL_ARGS = ['--globoff', '--url', 'http://localhost/x'];

const cases: Array<[name: string, input: Record<string, unknown>, expected: string[]]> = [
  ['plain GET needs no method flag', {}, []],
  ['explicit GET is the same', { method: 'GET' }, []],
  ['DELETE uses --request', { method: 'DELETE' }, ['--request', 'DELETE']],
  ['HEAD uses --head so curl does not wait for a body', { method: 'HEAD' }, ['--head']],
  [
    'headers keep their order and casing',
    { headers: { Accept: 'text/plain', 'X-Trace': 'a b' } },
    ['--header', 'Accept: text/plain', '--header', 'X-Trace: a b'],
  ],
  ['empty header value uses the "Name;" form', { headers: { 'X-Empty': '' } }, ['--header', 'X-Empty;']],
  [
    'JSON body implies POST and adds Content-Type',
    { method: 'POST', body: { json: { name: 'Ana' } } },
    ['--header', 'Content-Type: application/json', '--data-raw', '{"name":"Ana"}'],
  ],
  [
    'JSON body respects a Content-Type set by the user (any casing)',
    { method: 'POST', headers: { 'content-type': 'application/vnd.api+json' }, body: { json: [1] } },
    ['--header', 'content-type: application/vnd.api+json', '--data-raw', '[1]'],
  ],
  [
    'text body is sent verbatim, even when it starts with @',
    { method: 'POST', body: { text: '@not-a-file&a=1' } },
    ['--data-raw', '@not-a-file&a=1'],
  ],
  [
    'PUT with body keeps --request',
    { method: 'PUT', body: { text: 'x' } },
    ['--request', 'PUT', '--data-raw', 'x'],
  ],
  [
    'GET with body must say so explicitly',
    { method: 'GET', body: { text: 'x' } },
    ['--request', 'GET', '--data-raw', 'x'],
  ],
  [
    'options map to long flags',
    { followRedirects: true, insecure: true, compressed: true, timeoutMs: 1500 },
    ['--location', '--insecure', '--compressed', '--max-time', '1.5'],
  ],
  ['false options add nothing', { followRedirects: false, insecure: false, compressed: false }, []],
];

test.each(cases)('%s', (_name, input, expected) => {
  const request = requestSchema.parse({ url: 'http://localhost/x', ...input });
  expect(buildCurlArgs(request)).toEqual([...expected, ...URL_ARGS]);
});

test('a URL that looks like a flag stays a URL', () => {
  const request = requestSchema.parse({ url: '--output=/tmp/x' });
  expect(buildCurlArgs(request)).toEqual(['--globoff', '--url', '--output=/tmp/x']);
});

test('request schema rejects a lowercase method and unknown keys', () => {
  expect(requestSchema.safeParse({ url: 'http://x', method: 'get' }).success).toBe(false);
  expect(requestSchema.safeParse({ url: 'http://x', retries: 3 }).success).toBe(false);
});
