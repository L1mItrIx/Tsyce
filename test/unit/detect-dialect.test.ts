import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { detectDialect, DIALECTS, type Dialect, tokenizeCurl } from '../../src/core/importer/detect-dialect.js';

const fixturesDir = new URL('../fixtures/curl/', import.meta.url);

const fixtures = DIALECTS.flatMap((dialect) =>
  readdirSync(new URL(`${dialect}/`, fixturesDir)).map((file): [string, Dialect] => [`${dialect}/${file}`, dialect]),
);

describe('detectDialect', () => {
  test.each(fixtures)('fixture %s is %s', (path, dialect) => {
    expect(detectDialect(readFileSync(new URL(path, fixturesDir), 'utf8'))).toBe(dialect);
  });

  test.each<[name: string, input: string, dialect: Dialect]>([
    ['backslash continuation', 'curl http://x \\\n  -s', 'bash'],
    ['caret continuation', 'curl http://x ^\n  -s', 'cmd'],
    ['caret continuation with CRLF and trailing spaces', 'curl http://x ^  \r\n  -s', 'cmd'],
    ['backtick continuation', 'curl http://x `\n  -s', 'powershell'],
    ['one line with ^" quoting', 'curl ^"http://x^" -H ^"a: b^"', 'cmd'],
    ['one line with `" escapes', 'curl "http://x" -H "a: `"b`""', 'powershell'],
    ['one line with $env:', 'curl -H "X: $env:TOKEN" http://x', 'powershell'],
    ['curl.exe with single quotes', "curl.exe -d '{\"a\":1}' http://x", 'powershell'],
    ['curl.exe without single quotes', 'curl.exe -d "{\\"a\\":1}" http://x', 'cmd'],
    ['one plain line', "curl -s 'http://x' -H 'a: b'", 'bash'],
    ['a caret inside the data is not a signal', "curl -d 'a^b' http://x", 'bash'],
    ['nothing to go on', 'curl http://x', 'bash'],
  ])('%s → %s', (_name, input, dialect) => {
    expect(detectDialect(input)).toBe(dialect);
  });
});

describe('tokenizeCurl', () => {
  test('uses the detected dialect', () => {
    expect(tokenizeCurl('curl ^"http://x?a=1^&b=2^"')).toEqual({ dialect: 'cmd', tokens: ['curl', 'http://x?a=1&b=2'] });
  });

  test('a forced dialect wins over detection', () => {
    const text = "curl 'http://x' ^";
    expect(tokenizeCurl(text).dialect).toBe('cmd');
    expect(tokenizeCurl(text, 'bash')).toEqual({ dialect: 'bash', tokens: ['curl', 'http://x', '^'] });
  });
});
