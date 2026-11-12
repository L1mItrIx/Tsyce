import { CurlUnavailableError, spawnCollect } from './exec.js';

export const MIN_CURL_VERSION = '7.83.0';

export type CurlInfo = { bin: string; version: string };

export function resolveCurlBin(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  return env.HTTPI_CURL || (platform === 'win32' ? 'curl.exe' : 'curl');
}

export function parseCurlVersion(output: string): string | null {
  return /^curl (\d+\.\d+\.\d+)/.exec(output)?.[1] ?? null;
}

export function isVersionAtLeast(version: string, min: string): boolean {
  const a = version.split('.').map(Number);
  const b = min.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return true;
}

export async function detectCurl(env: NodeJS.ProcessEnv = process.env): Promise<CurlInfo> {
  const bin = resolveCurlBin(env);
  const { stdout } = await spawnCollect(bin, ['--version']);
  const version = parseCurlVersion(stdout);
  if (version === null) {
    throw new CurlUnavailableError(`"${bin}" does not look like curl (unexpected --version output)`);
  }
  if (!isVersionAtLeast(version, MIN_CURL_VERSION)) {
    throw new CurlUnavailableError(
      `curl ${version} is too old; httpi needs curl >= ${MIN_CURL_VERSION}. Set HTTPI_CURL to a newer binary.`,
    );
  }
  return { bin, version };
}
