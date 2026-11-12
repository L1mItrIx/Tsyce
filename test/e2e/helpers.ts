import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));

export type CliResult = { code: number | null; stdout: string; stderr: string };

export function assertCliIsBuilt(): void {
  if (!existsSync(CLI)) throw new Error('dist/cli.js is missing: run `npm run build` before the e2e tests');
}

/**
 * Runs the built CLI, in `cwd` when given. `stdin`, when given, is written to the process and closed.
 * `onStderr` sees what the process has written to stderr so far, while it is still running.
 */
export function httpi(
  args: string[],
  options: { env?: NodeJS.ProcessEnv; stdin?: string; cwd?: string; onStderr?: (stderrSoFar: string) => void } = {},
): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env: { ...process.env, ...options.env },
      cwd: options.cwd,
      stdio: [options.stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk;
      options.onStderr?.(stderr);
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin?.end(options.stdin);
  });
}
