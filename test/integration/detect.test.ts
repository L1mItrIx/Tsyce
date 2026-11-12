import { expect, test } from 'vitest';
import { detectCurl, isVersionAtLeast, MIN_CURL_VERSION } from '../../src/core/runner/detect.js';
import { CurlUnavailableError } from '../../src/core/runner/exec.js';

const envWithoutOverride = { ...process.env, HTTPI_CURL: '' };

test('finds the system curl and it meets the minimum version', async () => {
  const info = await detectCurl(envWithoutOverride);
  expect(info.bin).toMatch(/^curl(\.exe)?$/);
  expect(isVersionAtLeast(info.version, MIN_CURL_VERSION)).toBe(true);
});

test('fails clearly when the binary does not exist', async () => {
  const promise = detectCurl({ ...process.env, HTTPI_CURL: 'httpi-no-such-curl-binary' });
  await expect(promise).rejects.toThrow(CurlUnavailableError);
  await expect(promise).rejects.toThrow(/cannot run curl binary "httpi-no-such-curl-binary"/);
});

test('fails clearly when the binary is not curl', async () => {
  const promise = detectCurl({ ...process.env, HTTPI_CURL: process.execPath });
  await expect(promise).rejects.toThrow(CurlUnavailableError);
  await expect(promise).rejects.toThrow(/does not look like curl/);
});
