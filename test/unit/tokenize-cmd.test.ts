import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { ShellSyntaxError } from '../../src/core/importer/tokenize-bash.js';
import { tokenizeCmd } from '../../src/core/importer/tokenize-cmd.js';

const fixture = (name: string) =>
  readFileSync(new URL(`../fixtures/curl/cmd/${name}`, import.meta.url), 'utf8');

describe('tokenizeCmd', () => {
  test.each<[name: string, input: string, tokens: string[]]>([
    ['words split on spaces, tabs and newlines', 'curl  -s\thttp://x\r\n', ['curl', '-s', 'http://x']],
    ['double quotes keep spaces', 'curl "a b"', ['curl', 'a b']],
    ['single quotes are ordinary characters', "curl 'a b'", ['curl', "'a", "b'"]],
    ['caret escapes one character outside quotes', 'curl a^&b ^^ ^%x^%', ['curl', 'a&b', '^', '%x%']],
    ['caret is literal inside quotes', 'curl "a^b"', ['curl', 'a^b']],
    ['caret-newline continues the line', 'curl ^\n  -s ^\n  http://x', ['curl', '-s', 'http://x']],
    ['continuation also with CRLF line endings', 'curl ^\r\n  -s ^\r\n  http://x\r\n', ['curl', '-s', 'http://x']],
    ['continuation inside a word joins it', 'curl http://exa^\nmple.com', ['curl', 'http://example.com']],
    ['DevTools style: ^" delimits and ^\\^" is a quote inside', 'curl ^"a ^\\^"b^\\^" c^"', ['curl', 'a "b" c']],
    ['DevTools style: caret + blank line is a newline in the data', 'curl -d ^"a^\n\nb^"', ['curl', '-d', 'a\nb']],
    ['backslash-quote is a literal quote', 'curl -d "{\\"a\\": 1}"', ['curl', '-d', '{"a": 1}']],
    ['doubled quote inside quotes is a literal quote', 'curl "a""b"', ['curl', 'a"b']],
    ['backslashes are literal unless before a quote', 'curl C:\\dir\\file "a\\nb" "C:\\dir\\" x"', ['curl', 'C:\\dir\\file', 'a\\nb', 'C:\\dir" x']],
    ['2n backslashes before a quote halve and close it', 'curl "C:\\dir\\\\" x', ['curl', 'C:\\dir\\', 'x']],
    ['adjacent parts join into one argument', 'curl a"b c"d', ['curl', 'ab cd']],
    ['empty quotes are an empty argument', 'curl -H "" x', ['curl', '-H', '', 'x']],
    ['%VAR% stays unexpanded', 'curl -H "X: %TOKEN%"', ['curl', '-H', 'X: %TOKEN%']],
    ['a dangling caret at the end is dropped', 'curl http://x ^', ['curl', 'http://x']],
    ['empty input', '  \r\n ', []],
  ])('%s', (_name, input, tokens) => {
    expect(tokenizeCmd(input)).toEqual(tokens);
  });

  test('unterminated double quote is an error', () => {
    expect(() => tokenizeCmd('curl "abc')).toThrow(ShellSyntaxError);
    expect(() => tokenizeCmd('curl "abc')).toThrow('unterminated double quote (")');
  });
});

describe('tokenizeCmd fixtures', () => {
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
        '--data-raw', '{"name":"Ana","note":"it\'s here!"}',
      ],
    ],
    [
      'docs-double-quotes.txt',
      [
        'curl',
        '-X', 'POST',
        'https://api.example.com/v1/users',
        '-H', 'Authorization: Bearer %API_TOKEN%',
        '-H', 'Content-Type: application/json',
        '-d', '{"name": "Ana", "price": "$5"}',
      ],
    ],
  ])('%s', (file, tokens) => {
    expect(tokenizeCmd(fixture(file))).toEqual(tokens);
  });
});
