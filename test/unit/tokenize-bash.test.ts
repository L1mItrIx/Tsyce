import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { ShellSyntaxError, tokenizeBash } from '../../src/core/importer/tokenize-bash.js';

const fixture = (name: string) =>
  readFileSync(new URL(`../fixtures/curl/bash/${name}`, import.meta.url), 'utf8');

describe('tokenizeBash', () => {
  test.each<[name: string, input: string, tokens: string[]]>([
    ['words split on spaces, tabs and newlines', 'curl  -s\thttp://x\n', ['curl', '-s', 'http://x']],
    ['single quotes are literal', `curl 'a b' '$HOME \\n "q"'`, ['curl', 'a b', '$HOME \\n "q"']],
    ['double quotes keep spaces', 'curl "a b"', ['curl', 'a b']],
    ['double quotes: backslash escapes only " \\ $ `', 'curl "a\\"b\\\\c\\$d\\`e \\n \\x"', ['curl', 'a"b\\c$d`e \\n \\x']],
    ['double quotes keep $VAR unexpanded', 'curl -H "Authorization: Bearer $TOKEN"', ['curl', '-H', 'Authorization: Bearer $TOKEN']],
    ['backslash escapes one character outside quotes', 'curl a\\ b \\"x\\" \\$y', ['curl', 'a b', '"x"', '$y']],
    ['backslash-newline continues the line', 'curl \\\n  -s \\\n  http://x', ['curl', '-s', 'http://x']],
    ['continuation also with CRLF line endings', 'curl \\\r\n  -s \\\r\n  http://x\r\n', ['curl', '-s', 'http://x']],
    ['continuation inside a word joins it', 'curl http://exa\\\nmple.com', ['curl', 'http://example.com']],
    ['continuation inside double quotes', 'curl "a\\\nb"', ['curl', 'ab']],
    ['a newline inside quotes is kept', "curl -d 'a\nb'", ['curl', '-d', 'a\nb']],
    ['adjacent parts join into one argument', `curl 'a'"b"c$'d'\\ e`, ['curl', 'abcd e']],
    ["the '\\'' idiom embeds a single quote", `curl -d 'it'\\''s'`, ['curl', '-d', "it's"]],
    ['empty quotes are an empty argument', `curl -H '' ""`, ['curl', '-H', '', '']],
    ["$'...' decodes \\n \\t \\' \\\\", `curl $'a\\nb\\tc\\'d\\\\e'`, ['curl', "a\nb\tc'd\\e"]],
    ["$'...' decodes \\u, \\x and octal", `curl $'\\u0021 \\u00e9 \\x41 \\101 \\U0001F600'`, ['curl', '! é A A 😀']],
    ["$'...' keeps unknown escapes", `curl $'\\q \\x'`, ['curl', '\\q \\x']],
    ['$"..." reads as double quotes', 'curl $"a b"', ['curl', 'a b']],
    ['a lone $ is literal', 'curl a$ $b ${c}', ['curl', 'a$', '$b', '${c}']],
    ['# starts a comment only at the start of a word', 'curl http://x/#frag # trailing\n-s', ['curl', 'http://x/#frag', '-s']],
    ['a dangling backslash at the end is dropped', 'curl http://x \\', ['curl', 'http://x']],
    ['empty input', '  \n ', []],
  ])('%s', (_name, input, tokens) => {
    expect(tokenizeBash(input)).toEqual(tokens);
  });

  test.each<[name: string, input: string, message: string]>([
    ['single quote', "curl 'abc", "unterminated single quote (')"],
    ['double quote', 'curl "abc\\"', 'unterminated double quote (")'],
    ["$' quote", "curl $'abc\\'", "unterminated $'...' string"],
  ])('unterminated %s is an error', (_name, input, message) => {
    expect(() => tokenizeBash(input)).toThrow(ShellSyntaxError);
    expect(() => tokenizeBash(input)).toThrow(message);
  });
});

describe('tokenizeBash fixtures', () => {
  test.each<[file: string, tokens: string[]]>([
    [
      'chrome-get.txt',
      [
        'curl',
        'https://api.example.com/v1/users?page=2&sort=name',
        '-H', 'accept: application/json, text/plain, */*',
        '-H', 'accept-language: es-ES,es;q=0.9,en;q=0.8',
        '-H', 'authorization: Bearer FAKE_TOKEN_123',
        '-b', 'session=FAKE_SESSION; theme=dark',
        '-H', 'sec-ch-ua: "Chromium";v="130", "Not?A_Brand";v="99"',
        '-H', 'user-agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      ],
    ],
    [
      'chrome-post-json.txt',
      [
        'curl',
        'https://api.example.com/v1/users',
        '-H', 'content-type: application/json',
        '-H', 'origin: https://app.example.com',
        '--data-raw', '{"name":"Ana","note":"it\'s here!","lines":"a\\nb"}',
      ],
    ],
    [
      'docs-double-quotes.txt',
      [
        'curl',
        '-X', 'POST',
        'https://api.example.com/v1/users',
        '-H', 'Authorization: Bearer $API_TOKEN',
        '-H', 'Content-Type: application/json',
        '-d', '{"name": "Ana", "price": "$5"}',
      ],
    ],
  ])('%s', (file, tokens) => {
    expect(tokenizeBash(fixture(file))).toEqual(tokens);
  });
});
