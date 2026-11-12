/** The pasted command cannot be split into arguments (e.g. a quote is never closed). */
export class ShellSyntaxError extends Error {
  override name = 'ShellSyntaxError';
}

const ANSI_C_SIMPLE: Record<string, string> = {
  a: '\u0007',
  b: '\b',
  e: '\u001B',
  E: '\u001B',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
  v: '\v',
  '\\': '\\',
  "'": "'",
  '"': '"',
  '?': '?',
};

function isHexDigit(char: string | undefined): boolean {
  return char !== undefined && '0123456789abcdefABCDEF'.includes(char);
}

function isOctalDigit(char: string | undefined): boolean {
  return char !== undefined && '01234567'.includes(char);
}

/** Reads up to `max` digits accepted by `accepts`, starting at `start`. */
function readDigits(input: string, start: number, max: number, accepts: (char: string | undefined) => boolean): string {
  let end = start;
  while (end - start < max && accepts(input[end])) end++;
  return input.slice(start, end);
}

/** Reads the body of $'...' starting right after the opening quote. */
function readAnsiC(input: string, start: number): { text: string; next: number } {
  let text = '';
  let i = start;
  while (i < input.length) {
    const char = input[i] as string;
    if (char === "'") return { text, next: i + 1 };
    if (char !== '\\') {
      text += char;
      i++;
      continue;
    }
    const escape = input[i + 1];
    if (escape === undefined) break;
    const simple = ANSI_C_SIMPLE[escape];
    if (simple !== undefined) {
      text += simple;
      i += 2;
    } else if (escape === 'x' || escape === 'u' || escape === 'U') {
      const digits = readDigits(input, i + 2, escape === 'x' ? 2 : escape === 'u' ? 4 : 8, isHexDigit);
      text += digits === '' ? `\\${escape}` : String.fromCodePoint(Number.parseInt(digits, 16));
      i += 2 + digits.length;
    } else if (isOctalDigit(escape)) {
      const digits = readDigits(input, i + 1, 3, isOctalDigit);
      text += String.fromCodePoint(Number.parseInt(digits, 8) & 0xff);
      i += 1 + digits.length;
    } else {
      text += `\\${escape}`;
      i += 2;
    }
  }
  throw new ShellSyntaxError("unterminated $'...' string");
}

/** Reads the body of "..." starting right after the opening quote. */
function readDoubleQuoted(input: string, start: number): { text: string; next: number } {
  let text = '';
  let i = start;
  while (i < input.length) {
    const char = input[i] as string;
    if (char === '"') return { text, next: i + 1 };
    if (char === '\\') {
      const escaped = input[i + 1];
      if (escaped === '\n') {
        i += 2; // line continuation
        continue;
      }
      if (escaped === '\r' && input[i + 2] === '\n') {
        i += 3;
        continue;
      }
      // Inside double quotes a backslash only escapes these; otherwise it stays.
      if (escaped === '"' || escaped === '\\' || escaped === '$' || escaped === '`') {
        text += escaped;
        i += 2;
        continue;
      }
    }
    text += char;
    i++;
  }
  throw new ShellSyntaxError('unterminated double quote (")');
}

/**
 * Splits a Bash command line into arguments, the way the shell would before running curl.
 * Variables ($VAR) and substitutions are not expanded: they stay in the text as written.
 */
export function tokenizeBash(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inToken = false; // tells an empty argument ('') apart from no argument
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
    } else if (char === '\\') {
      if (next === '\n') i += 2; // line continuation
      else if (next === '\r' && input[i + 2] === '\n') i += 3;
      else if (next === undefined) i++; // dangling backslash at the very end
      else {
        current += next;
        inToken = true;
        i += 2;
      }
    } else if (char === "'") {
      const end = input.indexOf("'", i + 1);
      if (end === -1) throw new ShellSyntaxError("unterminated single quote (')");
      current += input.slice(i + 1, end);
      inToken = true;
      i = end + 1;
    } else if (char === '"' || (char === '$' && next === '"')) {
      const quoted = readDoubleQuoted(input, i + (char === '$' ? 2 : 1));
      current += quoted.text;
      inToken = true;
      i = quoted.next;
    } else if (char === '$' && next === "'") {
      const quoted = readAnsiC(input, i + 2);
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
