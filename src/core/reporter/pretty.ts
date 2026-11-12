import { styleText } from 'node:util';
import { type OutcomeStatus, outcomeStatus, type TestOutcome } from '../run.js';

export type PrettyOptions = { color: boolean };

type Paint = (format: 'green' | 'red' | 'yellow' | 'dim' | 'bold', text: string) => string;

const MARK: Record<OutcomeStatus, string> = { passed: '✓', failed: '✗', errored: '!' };
const TONE = { passed: 'green', failed: 'red', errored: 'yellow' } as const;

function formatOutcome(outcome: TestOutcome, paint: Paint): string[] {
  const status = outcomeStatus(outcome);
  const head = `${paint(TONE[status], MARK[status])} ${outcome.name}`;
  if (status === 'errored') {
    return [head, `    ${paint('yellow', `curl error ${outcome.result.curlExitCode}: ${outcome.result.error}`)}`];
  }
  const lines = [`${head} ${paint('dim', `(${outcome.result.status}, ${outcome.result.timeMs} ms)`)}`];
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

/** Human-readable report for a test file. Ends without a trailing newline. */
export function formatPretty(fileName: string | undefined, outcomes: TestOutcome[], options: PrettyOptions): string {
  const paint: Paint = (format, text) =>
    options.color ? styleText(format, text, { validateStream: false }) : text;

  const lines: string[] = [];
  if (fileName !== undefined) lines.push(paint('bold', fileName), '');
  for (const outcome of outcomes) lines.push(...formatOutcome(outcome, paint));

  const count = (status: OutcomeStatus) => outcomes.filter((o) => outcomeStatus(o) === status).length;
  const parts = [`${count('passed')} passed`];
  if (count('failed') > 0) parts.push(paint('red', `${count('failed')} failed`));
  if (count('errored') > 0) parts.push(paint('yellow', `${count('errored')} errored`));
  lines.push('', `${plural(outcomes.length, 'test')}: ${parts.join(', ')}`);
  return lines.join('\n');
}
