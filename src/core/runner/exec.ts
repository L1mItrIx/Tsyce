import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RequestSpec } from '../schema.js';
import { buildCurlArgs } from './curl-args.js';

export class CurlUnavailableError extends Error {
  override name = 'CurlUnavailableError';
}

export type SpawnOutput = { exitCode: number; stdout: string; stderr: string };

export function spawnCollect(bin: string, args: string[], signal?: AbortSignal): Promise<SpawnOutput> {
  if (signal?.aborted) return Promise.resolve({ exitCode: -1, stdout: '', stderr: 'request cancelled' });
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const abort = () => { child.kill(); };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.on('error', (cause) => {
      signal?.removeEventListener('abort', abort);
      reject(new CurlUnavailableError(`cannot run curl binary "${bin}": ${cause.message}`, { cause }));
    });
    child.on('close', (code) => {
      signal?.removeEventListener('abort', abort);
      resolve({ exitCode: code ?? -1, stdout, stderr });
    });
  });
}

export type RunResult = {
  /** HTTP status of the last response; 0 when curl got no response. */
  status: number;
  timeMs: number;
  /** Headers of the last response: lowercase names, one entry per occurrence. */
  headers: Record<string, string[]>;
  body: string;
  curlExitCode: number;
  /** curl's explanation when it failed (network error, timeout, bad usage); null on success. */
  error: string | null;
};

// First line: %{json} (curl >= 7.70). Rest: %{header_json} (curl >= 7.83).
const WRITE_OUT = '%{json}\\n%{header_json}';

type WriteOut = {
  meta: { http_code?: number; time_total?: number; errormsg?: string | null };
  headers: Record<string, string[]>;
};

function parseWriteOut(stdout: string): WriteOut | null {
  const newline = stdout.indexOf('\n');
  if (newline === -1) return null;
  try {
    return {
      meta: JSON.parse(stdout.slice(0, newline)) as WriteOut['meta'],
      headers: JSON.parse(stdout.slice(newline + 1)) as WriteOut['headers'],
    };
  } catch {
    return null;
  }
}

function describeFailure(exitCode: number, errormsg: string | null | undefined, stderr: string): string {
  const fromStderr = stderr.trim().replace(/^curl: (\(\d+\) )?/, '');
  return errormsg || fromStderr || `curl exited with code ${exitCode}`;
}

export async function runRequest(curlBin: string, request: RequestSpec, signal?: AbortSignal): Promise<RunResult> {
  const dir = await mkdtemp(join(tmpdir(), 'httpi-'));
  try {
    const bodyFile = join(dir, 'body');
    // -q must come first: it keeps the user's ~/.curlrc from changing the request.
    const args = ['-q', '-sS', '-o', bodyFile, '-w', WRITE_OUT, ...buildCurlArgs(request)];
    const { exitCode, stdout, stderr } = await spawnCollect(curlBin, args, signal);
    const out = parseWriteOut(stdout);
    // With --head curl writes the response headers to -o; a HEAD response has no body.
    const body = request.method === 'HEAD' ? '' : await readFile(bodyFile, 'utf8').catch(() => '');
    return {
      status: out?.meta.http_code ?? 0,
      timeMs: Math.round((out?.meta.time_total ?? 0) * 1000),
      headers: out?.headers ?? {},
      body,
      curlExitCode: exitCode,
      error: signal?.aborted ? 'request cancelled' : exitCode === 0 ? null : describeFailure(exitCode, out?.meta.errormsg, stderr),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
