import { describe, expect, test } from 'vitest';
import {
  isVersionAtLeast,
  MIN_CURL_VERSION,
  parseCurlVersion,
  resolveCurlBin,
} from '../../src/core/runner/detect.js';

describe('parseCurlVersion', () => {
  test.each([
    ['curl 8.5.0 (x86_64-pc-linux-gnu) libcurl/8.5.0 OpenSSL/3.0.13\nRelease-Date: 2023-12-06', '8.5.0'],
    ['curl 7.83.1 (Windows) libcurl/7.83.1 Schannel', '7.83.1'],
    ['curl 8.10.1 (x86_64-apple-darwin24.0) libcurl/8.10.1', '8.10.1'],
  ])('reads the version from %j', (output, expected) => {
    expect(parseCurlVersion(output)).toBe(expected);
  });

  test.each(['v22.11.0', '', 'wget 1.21', 'not curl 8.5.0'])('returns null for %j', (output) => {
    expect(parseCurlVersion(output)).toBeNull();
  });
});

describe('isVersionAtLeast', () => {
  test.each([
    ['7.83.0', true],
    ['7.83.1', true],
    ['7.100.0', true],
    ['8.0.0', true],
    ['7.82.9', false],
    ['7.9.0', false],
    ['6.99.99', false],
  ])(`%s >= ${MIN_CURL_VERSION} is %s`, (version, expected) => {
    expect(isVersionAtLeast(version, MIN_CURL_VERSION)).toBe(expected);
  });
});

describe('resolveCurlBin', () => {
  test('prefers HTTPI_CURL', () => {
    expect(resolveCurlBin({ HTTPI_CURL: '/opt/curl/bin/curl' }, 'linux')).toBe('/opt/curl/bin/curl');
  });

  test('uses curl.exe on Windows so PowerShell aliases never apply', () => {
    expect(resolveCurlBin({}, 'win32')).toBe('curl.exe');
  });

  test('uses curl elsewhere, also when HTTPI_CURL is empty', () => {
    expect(resolveCurlBin({ HTTPI_CURL: '' }, 'darwin')).toBe('curl');
  });
});
