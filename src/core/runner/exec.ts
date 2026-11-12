import { spawn } from 'node:child_process';

export class CurlUnavailableError extends Error {
  override name = 'CurlUnavailableError';
}

export type SpawnOutput = { exitCode: number; stdout: string; stderr: string };

export function spawnCollect(bin: string, args: string[]): Promise<SpawnOutput> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.on('error', (cause) => {
      reject(new CurlUnavailableError(`cannot run curl binary "${bin}": ${cause.message}`, { cause }));
    });
    child.on('close', (code) => resolve({ exitCode: code ?? -1, stdout, stderr }));
  });
}
