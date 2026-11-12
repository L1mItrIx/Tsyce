import { readdirSync, readFileSync } from 'node:fs';
import * as curlconverter from 'curlconverter';
import { expect, test } from 'vitest';
import { mapFlags } from '../../src/core/importer/map-flags.js';
import { tokenizeBash } from '../../src/core/importer/tokenize-bash.js';

// curlconverter is only an oracle for the Bash importer (PLAN §3): both parsers must agree on
// what request a command describes. Its JSON loses the original body, so bodies are compared
// only by presence; the exact text is covered by the tokenizer and map-flags tables.

type Comparable = {
  method: string;
  url: string;
  headers: Record<string, string>;
  hasBody: boolean;
  followRedirects: boolean;
  compressed: boolean;
  timeoutSeconds: number | null;
};

type OracleJson = {
  raw_url: string;
  method: string;
  headers?: Record<string, string>;
  data?: unknown;
  files?: unknown;
  auth?: { user: string; password: string };
  follow_redirects?: boolean;
  compressed?: boolean;
  timeout?: number;
};

const lowerKeys = (headers: Record<string, string>) =>
  Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));

function fromHttpi(command: string): Comparable {
  const { request } = mapFlags(tokenizeBash(command));
  return {
    method: request.method,
    url: request.url,
    headers: lowerKeys(request.headers),
    hasBody: request.body !== undefined,
    followRedirects: request.followRedirects === true,
    compressed: request.compressed === true,
    timeoutSeconds: request.timeoutMs === undefined ? null : request.timeoutMs / 1000,
  };
}

function fromOracle(command: string): Comparable {
  const json = JSON.parse(curlconverter.toJsonString(command)) as OracleJson;
  const headers = lowerKeys(json.headers ?? {});
  // curlconverter reports the Content-Type curl adds by itself for -d; httpi leaves that to curl.
  if (headers['content-type'] === 'application/x-www-form-urlencoded') delete headers['content-type'];
  // curlconverter keeps -u apart; httpi turns it into the header curl would send.
  if (json.auth !== undefined) {
    headers['authorization'] = `Basic ${Buffer.from(`${json.auth.user}:${json.auth.password}`).toString('base64')}`;
  }
  return {
    method: json.method.toUpperCase(),
    url: json.raw_url,
    headers,
    hasBody: json.data !== undefined || json.files !== undefined,
    followRedirects: json.follow_redirects === true,
    compressed: json.compressed === true,
    timeoutSeconds: json.timeout ?? null,
  };
}

// Not compared: "--request=POST". curlconverter rejects it and so does curl 8.5 ("option
// --request=POST: is unknown"); httpi reads it with a warning because PLAN §3 asks for it.

const fixturesDir = new URL('../fixtures/curl/bash/', import.meta.url);
const fixtures = readdirSync(fixturesDir).map((file) => readFileSync(new URL(file, fixturesDir), 'utf8'));

const commands = [
  ...fixtures,
  'curl https://api.example.com/users',
  'curl -X DELETE https://api.example.com/users/7',
  'curl -XPUT https://api.example.com/users/7 -d name=Ana',
  "curl 'https://api.example.com/search?q=a%20b&page=2' -H 'Accept: application/json'",
  `curl -H "X-Trace: a b" -H 'X-Other: "quoted"' https://api.example.com/users`,
  "curl https://api.example.com/users -d 'a=1' -d 'b=2'",
  `curl https://api.example.com/users --data-raw '{"name":"Ana"}' -H 'Content-Type: application/json'`,
  `curl --json '{"name":"Ana"}' https://api.example.com/users`,
  'curl -u ana:s3cret https://api.example.com/me',
  "curl -b 'session=abc; theme=dark' https://api.example.com/me",
  "curl -A 'httpi/1.0' -e 'https://ref.example.com' https://api.example.com/users",
  'curl -L --compressed -m 5 https://api.example.com/users',
  'curl --location --max-time 2.5 https://api.example.com/users',
  'curl -G https://api.example.com/search -d q=ana -d page=2',
  "curl -G 'https://api.example.com/search?z=0' --data-urlencode 'q=x y&z'",
  "curl -F 'name=Ana' -F 'avatar=@a.png' https://api.example.com/upload",
  'curl --request PATCH --header "Accept: */*" --url https://api.example.com/users/7 --data "a=1"',
  'curl -kL https://api.example.com/users',
  "curl \\\n  -X POST \\\n  'https://api.example.com/users' \\\n  -H 'Accept: */*'",
  `curl $'https://api.example.com/users?name=it\\'s' -H $'X-Note: line\\u0021'`,
  'curl https://api.example.com/users -H "Authorization: Bearer abc.def-ghi"',
  `curl 'https://api.example.com/a'"b"c -H 'X-Joined: a'"b"`,
];

test.each(commands)('agrees with curlconverter: %s', (command) => {
  expect(fromHttpi(command)).toEqual(fromOracle(command));
});
