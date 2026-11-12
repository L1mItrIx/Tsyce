import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { ShellSyntaxError } from '../../src/core/importer/tokenize-bash.js';
import { tokenizePowerShell } from '../../src/core/importer/tokenize-powershell.js';

const fixture = (name: string) =>
  readFileSync(new URL(`../fixtures/curl/powershell/${name}`, import.meta.url), 'utf8');

describe('tokenizePowerShell', () => {
  test.each<[name: string, input: string, tokens: string[]]>([
    ['words split on spaces, tabs and newlines', 'curl.exe  -s\thttp://x\r\n', ['curl.exe', '-s', 'http://x']],
    ['single quotes are literal', "curl.exe 'a b' '$x `n \"q\" \\'", ['curl.exe', 'a b', '$x `n "q" \\']],
    ["'' inside single quotes is a quote", "curl.exe -d 'it''s'", ['curl.exe', '-d', "it's"]],
    ['double quotes keep spaces', 'curl.exe "a b"', ['curl.exe', 'a b']],
    ['double quotes: backtick escapes', 'curl.exe "a`"b``c`$d`ne`tf"', ['curl.exe', 'a"b`c$d\ne\tf']],
    ['double quotes: "" is a quote', 'curl.exe "a""b"', ['curl.exe', 'a"b']],
    ['double quotes keep $var unexpanded', 'curl.exe -H "X: $env:TOKEN"', ['curl.exe', '-H', 'X: $env:TOKEN']],
    ['backslash is an ordinary character', 'curl.exe C:\\dir\\file "a\\nb" "{\\"', ['curl.exe', 'C:\\dir\\file', 'a\\nb', '{\\']],
    ['backtick escapes one character outside quotes', 'curl.exe a` b `"x`" `#y', ['curl.exe', 'a b', '"x"', '#y']],
    ['backtick-newline continues the line', 'curl.exe `\n  -s `\n  http://x', ['curl.exe', '-s', 'http://x']],
    ['continuation also with CRLF line endings', 'curl.exe `\r\n  -s `\r\n  http://x\r\n', ['curl.exe', '-s', 'http://x']],
    ['a newline inside quotes is kept', "curl.exe -d 'a\nb'", ['curl.exe', '-d', 'a\nb']],
    ['`u{...} is a Unicode escape', 'curl.exe "`u{48}`u{1F600}"', ['curl.exe', 'H😀']],
    ['adjacent parts join into one argument', `curl.exe 'a'"b"c`, ['curl.exe', 'abc']],
    ['empty quotes are an empty argument', `curl.exe -H '' ""`, ['curl.exe', '-H', '', '']],
    ['# starts a comment only at the start of a word', 'curl.exe http://x/#frag # trailing\n-s', ['curl.exe', 'http://x/#frag', '-s']],
    ['a dangling backtick at the end is dropped', 'curl.exe http://x `', ['curl.exe', 'http://x']],
    ['empty input', '  \r\n ', []],
  ])('%s', (_name, input, tokens) => {
    expect(tokenizePowerShell(input)).toEqual(tokens);
  });

  test.each<[name: string, input: string, message: string]>([
    ['single quote', "curl.exe 'abc''", "unterminated single quote (')"],
    ['double quote', 'curl.exe "abc`"', 'unterminated double quote (")'],
  ])('unterminated %s is an error', (_name, input, message) => {
    expect(() => tokenizePowerShell(input)).toThrow(ShellSyntaxError);
    expect(() => tokenizePowerShell(input)).toThrow(message);
  });
});

describe('tokenizePowerShell fixtures', () => {
  test.each<[file: string, tokens: string[]]>([
    [
      'docs-post-json.txt',
      [
        'curl.exe',
        '-X', 'POST',
        'https://api.example.com/v1/users',
        '-H', 'Authorization: Bearer $env:API_TOKEN',
        '-H', 'Content-Type: application/json',
        '-d', '{"name": "Ana", "price": "$5"}',
      ],
    ],
    [
      'get-escaped-quotes.txt',
      [
        'curl.exe',
        'https://api.example.com/v1/users?page=2&sort=name',
        '-H', 'accept: application/json, text/plain, */*',
        '-H', 'sec-ch-ua: "Chromium";v="130", "Not?A_Brand";v="99"',
        '-H', "x-note: it's here",
        '-b', 'session=FAKE_SESSION; theme=dark',
      ],
    ],
  ])('%s', (file, tokens) => {
    expect(tokenizePowerShell(fixture(file))).toEqual(tokens);
  });
});
