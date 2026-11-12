import { styleText } from 'node:util';
import { type OutcomeStatus, outcomeStatus, type Suite, type TestOutcome } from '../run.js';

export type PrettyOptions = { color: boolean; showResponse?: boolean };

type Paint = (format: 'green' | 'red' | 'yellow' | 'dim' | 'bold', text: string) => string;

const MARK: Record<OutcomeStatus, string> = { passed: '✓', failed: '✗', errored: '!' };
const TONE = { passed: 'green', failed: 'red', errored: 'yellow' } as const;

function visible(text: string): string {
  // A server response must not be able to send terminal commands to the user's shell.
  return text.replace(/\r\n/g, '\n').replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g,
    (char) => `\\x${char.charCodeAt(0).toString(16).padStart(2, '0')}`);
}

function formatResponse(outcome: TestOutcome): string[] {
  const { result } = outcome;
  if (outcome.responseHidden) return [`    Response: HTTP ${result.status}`, '      Authentication response hidden (token kept in memory only)'];
  const lines = [`    Response: HTTP ${result.status}`, '      Headers:'];
  const headers = Object.entries(result.headers).flatMap(([name, values]) => values.map((value) => `${name}: ${value}`));
  for (const header of headers.length > 0 ? headers : ['(none)']) {
    lines.push(...visible(header).split('\n').map((line) => `        ${line}`));
  }
  let body = result.body;
  if (body !== '') {
    try {
      body = JSON.stringify(JSON.parse(body), (_key, value: unknown) => {
        // Keep the original text when JavaScript cannot represent the server's number safely.
        if (typeof value === 'number' && (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))) {
          throw new Error('Number requires original response text');
        }
        return value;
      }, 2);
    } catch { /* Non-JSON or numbers outside JS precision stay as received. */ }
  }
  lines.push('      Body:', ...visible(body || '(empty)').split('\n').map((line) => `        ${line}`));
  return lines;
}

function formatOutcome(outcome: TestOutcome, paint: Paint, showResponse: boolean): string[] {
  const status = outcomeStatus(outcome);
  const head = `${paint(TONE[status], MARK[status])} ${outcome.name}`;
  if (status === 'errored') {
    return [head, `    ${paint('yellow', `curl error ${outcome.result.curlExitCode}: ${outcome.result.error}`)}`];
  }
  const lines = [`${head} ${paint('dim', `(${outcome.result.status}, ${outcome.result.timeMs} ms)`)}`];
  if (showResponse) lines.push(...formatResponse(outcome));
  for (const assert of outcome.asserts) {
    lines.push(
      assert.ok
        ? `    ${paint('green', '✓')} ${assert.label}`
        : `    ${paint('red', '✗')} ${assert.label}: ${paint('red', assert.message ?? 'failed')}`,
    );
  }
  return lines;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

type Painter = { paint: Paint; showResponse: boolean };

function painter(options: PrettyOptions): Painter {
  return {
    paint: (format, text) => (options.color ? styleText(format, text, { validateStream: false }) : text),
    showResponse: options.showResponse === true,
  };
}

function summary(outcomes: TestOutcome[], paint: Paint): string {
  const count = (status: OutcomeStatus) => outcomes.filter((o) => outcomeStatus(o) === status).length;
  const parts = [`${count('passed')} passed`];
  if (count('failed') > 0) parts.push(paint('red', `${count('failed')} failed`));
  if (count('errored') > 0) parts.push(paint('yellow', `${count('errored')} errored`));
  return `${plural(outcomes.length, 'test')}: ${parts.join(', ')}`;
}

function formatSuite(suite: Suite, { paint, showResponse }: Painter): string[] {
  const lines: string[] = [];
  if (suite.name !== undefined) lines.push(paint('bold', suite.name), '');
  for (const outcome of suite.outcomes) lines.push(...formatOutcome(outcome, paint, showResponse));
  return lines;
}

/** Human-readable report for a test file. Ends without a trailing newline. */
export function formatPretty(fileName: string | undefined, outcomes: TestOutcome[], options: PrettyOptions): string {
  const tools = painter(options);
  return [...formatSuite({ name: fileName, outcomes }, tools), '', summary(outcomes, tools.paint)].join('\n');
}

/** Report for a project run: every file in order, then one summary for the whole run. */
export function formatPrettyProject(suites: Suite[], options: PrettyOptions): string {
  const tools = painter(options);
  const lines: string[] = [];
  for (const suite of suites) {
    lines.push(...formatSuite(suite, tools));
    if (suite.outcomes.length === 0) lines.push(tools.paint('yellow', '- not run: the flow stopped before this file'));
    lines.push('');
  }
  const all = suites.flatMap((suite) => suite.outcomes);
  lines.push(`${plural(suites.length, 'file')}, ${summary(all, tools.paint)}`);
  return lines.join('\n');
}
