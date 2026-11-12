import { spawnSync } from 'node:child_process';
import { expect, test } from 'vitest';
import { exportCurl } from '../../src/core/exporter/curl.js';
import { tokenizeCurl } from '../../src/core/importer/detect-dialect.js';
import { buildCurlArgs } from '../../src/core/runner/curl-args.js';
import { requestSchema } from '../../src/core/schema.js';

const request = requestSchema.parse({
  method: 'PATCH', url: 'https://example.test/a?q=a&b=(x)',
  headers: { 'X-Empty': '', 'X-Text': 'quotes " and \' with $HOME `whoami` & | < > ^ ( )' },
  body: { text: 'JSON: {"path":"C:\\tmp\\", "name":"it\'s"}' },
  followRedirects: true, insecure: true, compressed: true, timeoutMs: 1500,
});

test.each(['bash', 'cmd', 'powershell'] as const)('%s preserves every curl argument', (dialect) => {
  const script = exportCurl(request, dialect);
  const command = script.split('\n').find((line) => line.startsWith('curl'))!;
  expect(tokenizeCurl(command, dialect).tokens).toEqual([
    dialect === 'bash' ? 'curl' : 'curl.exe', '-q', '-sS', ...buildCurlArgs(request),
  ]);
});

test.runIf(process.platform !== 'win32')('Bash really passes literals without command or variable expansion', () => {
  const literal = requestSchema.parse({
    url: 'http://example.test/%PATH%?x=!bang!',
    body: { text: 'line one\nline two\r\n\t$(exit 91) `exit 92` $HOME \' " \\' },
  });
  const script = `curl() { printf '%s\\0' "$@"; };\n${exportCurl(literal, 'bash')}`;
  const result = spawnSync('bash', ['--noprofile', '--norc', '-c', script], { encoding: 'utf8' });
  expect(result.status).toBe(0);
  expect(result.stdout.split('\0').slice(0, -1)).toEqual(['-q', '-sS', ...buildCurlArgs(literal)]);
});

test('cmd emits a batch script with percent escaping and delayed expansion disabled', () => {
  const script = exportCurl(requestSchema.parse({ url: 'https://example.test/%20%PATH%!', body: { text: '%1 %% !TOKEN!' } }), 'cmd');
  expect(script).toContain('setlocal DisableDelayedExpansion\n');
  expect(script).toContain('%%20%%PATH%%!');
  expect(script).toContain('%%1 %%%% !TOKEN!');
  expect(script).toMatch(/\n@endlocal$/);
});

test.each(['\n', '\r', '\0'])('cmd refuses an argument containing %j instead of corrupting it', (char) => {
  expect(() => exportCurl(requestSchema.parse({ url: 'http://example.test', body: { text: `a${char}b` } }), 'cmd'))
    .toThrow(/cmd.*line breaks|NUL/);
});

test.each(['bash', 'powershell'] as const)('%s refuses NUL arguments', (dialect) => {
  expect(() => exportCurl(requestSchema.parse({ url: 'http://example.test/\0' }), dialect)).toThrow('NUL');
});

test('PowerShell uses curl.exe and explicitly requires native argument handling', () => {
  const script = exportCurl(request, 'powershell');
  expect(script).toContain('#requires -Version 7.3');
  expect(script).toContain("$PSNativeCommandArgumentPassing = 'Standard'");
  expect(script).toContain('curl.exe ');
});

test.each([
  { method: 'HEAD', url: 'http://example.test' },
  { method: 'POST', url: 'http://example.test', body: { json: { name: 'Ana' } } },
  { method: 'POST', url: 'http://example.test', body: { form: ['name=Ana', 'file=@C:\\my files\\file.txt'] } },
])('reuses runner semantics for $method and body', (input) => {
  const value = requestSchema.parse(input);
  expect(tokenizeCurl(exportCurl(value, 'bash'), 'bash').tokens.slice(1)).toEqual(['-q', '-sS', ...buildCurlArgs(value)]);
});
