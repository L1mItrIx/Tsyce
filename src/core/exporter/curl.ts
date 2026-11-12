import type { Dialect } from '../importer/detect-dialect.js';
import { buildCurlArgs } from '../runner/curl-args.js';
import type { RequestSpec } from '../schema.js';

export class CurlExportError extends Error {
  override name = 'CurlExportError';
}

function quoteBash(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function quotePowerShell(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function quoteBatch(value: string): string {
  if (/[\r\n]/.test(value)) {
    throw new CurlExportError('cmd batch export cannot represent literal line breaks; use Bash or PowerShell');
  }
  // First quote for the Windows C runtime, then protect all cmd metacharacters.
  // Escaped quotes never enter cmd's quoted mode, so every caret is effective.
  const argument = `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`;
  return argument.replaceAll('%', '%%').replace(/["^&|<>()]/g, '^$&');
}

/**
 * Exports literal arguments, including resolved credentials. Bash returns a command;
 * cmd returns a .cmd batch script; PowerShell requires 7.3+ (5.1 loses native quotes).
 * Variables must be resolved by the caller, just as they are before running a test.
 */
export function exportCurl(request: RequestSpec, dialect: Dialect = 'bash'): string {
  const args = ['-q', '-sS', ...buildCurlArgs(request)];
  if (args.some((arg) => arg.includes('\0'))) {
    throw new CurlExportError('curl arguments cannot contain NUL characters');
  }
  switch (dialect) {
    case 'bash':
      return `curl ${args.map(quoteBash).join(' ')}`;
    case 'cmd':
      return `@echo off\n@setlocal DisableDelayedExpansion\ncurl.exe ${args.map(quoteBatch).join(' ')}\n@endlocal`;
    case 'powershell':
      return `#requires -Version 7.3\n$PSNativeCommandArgumentPassing = 'Standard'\ncurl.exe ${args.map(quotePowerShell).join(' ')}`;
  }
}
