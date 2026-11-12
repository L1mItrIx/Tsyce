import { ShellSyntaxError } from './tokenize-bash.js';

/**
 * What cmd.exe does to the line before starting curl: `^` escapes the next character
 * outside double quotes, and `^` at the end of a line continues on the next one.
 */
function applyCarets(input: string): string {
  let output = '';
  let inQuotes = false;
  let i = 0;
  while (i < input.length) {
    const char = input[i] as string;
    if (char === '^' && !inQuotes) {
      i++;
      // A caret before a line break drops the break; whatever follows is taken literally.
      if (input[i] === '\r' && input[i + 1] === '\n') i += 2;
      else if (input[i] === '\n') i++;
      if (i < input.length) output += input[i];
      i++;
      continue;
    }
    if (char === '"') inQuotes = !inQuotes;
    output += char;
    i++;
  }
  return output;
}

/** How a Windows program (the C runtime) splits its command line into arguments. */
function splitArguments(line: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inToken = false;
  let inQuotes = false;
  let i = 0;

  while (i < line.length) {
    const char = line[i] as string;
    if (char === '\\') {
      let run = 0;
      while (line[i + run] === '\\') run++;
      if (line[i + run] === '"') {
        // 2n backslashes + quote → n backslashes, the quote delimits; 2n+1 → n backslashes + a literal quote.
        current += '\\'.repeat(Math.floor(run / 2));
        i += run;
        if (run % 2 === 1) {
          current += '"';
          i++;
        }
      } else {
        current += '\\'.repeat(run);
        i += run;
      }
      inToken = true;
    } else if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'; // "" inside quotes is one literal quote
        i += 2;
      } else {
        inQuotes = !inQuotes;
        inToken = true;
        i++;
      }
    } else if (!inQuotes && (char === ' ' || char === '\t' || char === '\n' || char === '\r')) {
      if (inToken) tokens.push(current);
      current = '';
      inToken = false;
      i++;
    } else {
      current += char;
      inToken = true;
      i++;
    }
  }
  if (inQuotes) throw new ShellSyntaxError('unterminated double quote (")');
  if (inToken) tokens.push(current);
  return tokens;
}

/**
 * Splits a cmd.exe command line into the arguments curl.exe would receive.
 * %VAR% references are not expanded: they stay in the text as written.
 */
export function tokenizeCmd(input: string): string[] {
  return splitArguments(applyCarets(input));
}
