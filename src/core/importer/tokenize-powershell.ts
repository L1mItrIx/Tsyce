import { ShellSyntaxError } from './tokenize-bash.js';

const BACKTICK_ESCAPES: Record<string, string> = {
  '0': '\0',
  a: '\u0007',
  b: '\b',
  e: '\u001B',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
  v: '\v',
};

/** Decodes the escape that starts at the backtick in `input[start]`. */
function readBacktickEscape(input: string, start: number): { text: string; next: number } {
  const escaped = input[start + 1];
  if (escaped === undefined) return { text: '', next: start + 1 };
  if (escaped === 'u' && input[start + 2] === '{') {
    const close = input.indexOf('}', start + 3);
    const codePoint = close === -1 ? Number.NaN : Number.parseInt(input.slice(start + 3, close), 16);
    if (!Number.isNaN(codePoint) && codePoint <= 0x10ffff) {
      return { text: String.fromCodePoint(codePoint), next: close + 1 };
    }
  }
  return { text: BACKTICK_ESCAPES[escaped] ?? escaped, next: start + 2 };
}

/** Reads the body of '...' starting right after the opening quote. */
function readSingleQuoted(input: string, start: number): { text: string; next: number } {
  let text = '';
  let i = start;
  while (i < input.length) {
    const char = input[i] as string;
    if (char !== "'") {
      text += char;
      i++;
    } else if (input[i + 1] === "'") {
      text += "'"; // '' is one literal quote
      i += 2;
    } else {
      return { text, next: i + 1 };
    }
  }
  throw new ShellSyntaxError("unterminated single quote (')");
}

/** Reads the body of "..." starting right after the opening quote. */
function readDoubleQuoted(input: string, start: number): { text: string; next: number } {
  let text = '';
  let i = start;
  while (i < input.length) {
    const char = input[i] as string;
    if (char === '`') {
      const escape = readBacktickEscape(input, i);
      text += escape.text;
      i = escape.next;
    } else if (char !== '"') {
      text += char;
      i++;
    } else if (input[i + 1] === '"') {
      text += '"'; // "" is one literal quote
      i += 2;
    } else {
      return { text, next: i + 1 };
    }
  }
  throw new ShellSyntaxError('unterminated double quote (")');
}

/**
 * Splits a PowerShell command line into the arguments curl.exe would receive.
 * Variables ($var, $env:NAME) are not expanded: they stay in the text as written.
 */
export function tokenizePowerShell(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inToken = false;
  let i = 0;

  const endToken = () => {
    if (inToken) tokens.push(current);
    current = '';
    inToken = false;
  };

  while (i < input.length) {
    const char = input[i] as string;
    const next = input[i + 1];

    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      endToken();
      i++;
    } else if (char === '#' && !inToken) {
      while (i < input.length && input[i] !== '\n') i++; // comment until end of line
    } else if (char === '`' && next === '\n') {
      i += 2; // line continuation
    } else if (char === '`' && next === '\r' && input[i + 2] === '\n') {
      i += 3;
    } else if (char === '`') {
      const escape = readBacktickEscape(input, i);
      current += escape.text;
      inToken = inToken || next !== undefined;
      i = escape.next;
    } else if (char === "'" || char === '"') {
      const quoted = char === "'" ? readSingleQuoted(input, i + 1) : readDoubleQuoted(input, i + 1);
      current += quoted.text;
      inToken = true;
      i = quoted.next;
    } else {
      current += char;
      inToken = true;
      i++;
    }
  }
  endToken();
  return tokens;
}
