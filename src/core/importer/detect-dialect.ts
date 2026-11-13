import { isPostmanCollection } from './postman.js';
import { tokenizeBash } from './tokenize-bash.js';
import { tokenizeCmd } from './tokenize-cmd.js';
import { tokenizePowerShell } from './tokenize-powershell.js';

export const DIALECTS = ['bash', 'cmd', 'powershell'] as const;

export type Dialect = (typeof DIALECTS)[number];

const TOKENIZERS: Record<Dialect, (input: string) => string[]> = {
  bash: tokenizeBash,
  cmd: tokenizeCmd,
  powershell: tokenizePowerShell,
};

function someLineEndsWith(text: string, char: string): boolean {
  return text.split('\n').some((line) => line.trimEnd().endsWith(char));
}

/**
 * Guesses which shell a pasted curl command was written for.
 * Signals, strongest first: the line-continuation character, then quoting that only one
 * shell uses, then the `curl.exe` name. Without any signal it is read as Bash.
 */
export function detectDialect(text: string): Dialect {
  if (someLineEndsWith(text, '^') || text.includes('^"')) return 'cmd';
  if (someLineEndsWith(text, '`') || text.includes('`"') || text.includes('$env:')) return 'powershell';
  if (someLineEndsWith(text, '\\')) return 'bash';
  if (text.trimStart().toLowerCase().startsWith('curl.exe')) {
    return text.includes("'") ? 'powershell' : 'cmd'; // cmd has no single-quote quoting
  }
  return 'bash';
}

/** Splits a pasted command into arguments, detecting the dialect unless one is forced. */
export function tokenizeCurl(text: string, forced?: Dialect): { dialect: Dialect; tokens: string[] } {
  const dialect = forced ?? detectDialect(text);
  return { dialect, tokens: TOKENIZERS[dialect](text) };
}

export const IMPORT_SOURCES = ['curl', 'postman'] as const;

export type ImportSource = (typeof IMPORT_SOURCES)[number];

/** What kind of document was given to `httpi import`: a JSON collection, or else a curl command. */
export function detectImportSource(text: string): ImportSource {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return 'curl';
  }
  return isPostmanCollection(data) ? 'postman' : 'curl';
}
