import { z } from 'zod';
import { expectSchema, type Expect } from '../core/schema.js';
import type { RunResult } from '../core/runner/exec.js';
import { REDACTED } from '../core/capture.js';

const choiceSchema = z.object({ label: z.string(), expect: expectSchema });
export type AssertionChoice = z.infer<typeof choiceSchema>;
const show = (value: unknown) => {
  const text = JSON.stringify(value);
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
};

/** Bounded suggestions; values stay literal and JSON paths address individual nodes. */
export function assertionChoices(result: RunResult): AssertionChoice[] {
  if (result.error !== null) return [];
  const choices: AssertionChoice[] = [
    { label: `Status = ${result.status}`, expect: { status: result.status } },
    { label: `Time <= ${Math.max(100, Math.ceil(result.timeMs * 2 / 100) * 100)} ms`,
      expect: { maxTimeMs: Math.max(100, Math.ceil(result.timeMs * 2 / 100) * 100) } },
  ];
  for (const [name, values] of Object.entries(result.headers)) {
    if (choices.length >= 30) break;
    if (values[0] === undefined) continue;
    const value = name.toLowerCase() === 'content-type' ? values[0].split(';')[0]! : values[0];
    if (/authorization|cookie|token/i.test(name) || value.includes(REDACTED)) continue;
    choices.push({ label: `Header ${show(name)} contains ${show(value)}`, expect: { headers: { [name]: { contains: value } } } });
  }
  let body: z.infer<ReturnType<typeof z.json>>;
  try { body = JSON.parse(result.body) as typeof body; } catch { return choices; }
  const visit = (value: typeof body, path: string, depth: number) => {
    if (choices.length >= 190 || depth > 6) return;
    choices.push({ label: `${path} exists`, expect: { json: [{ path, exists: true }] } });
    const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value as 'string' | 'number' | 'boolean' | 'object';
    choices.push({ label: `${path} type ${type}`, expect: { json: [{ path, type }] } });
    if (value === null || typeof value !== 'object') {
      if (/token|authorization|password|secret/i.test(path) || (typeof value === 'string' && value.includes(REDACTED))) return;
      choices.push({ label: `${path} equals ${show(value)}`, expect: { json: [{ path, equals: value }] } });
      if (typeof value === 'string') {
        choices.push({ label: `${path} contains ${show(value)}`, expect: { json: [{ path, contains: value }] } });
        const pattern = `^${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`;
        choices.push({ label: `${path} matches ${show(pattern)}`, expect: { json: [{ path, matches: pattern }] } });
      }
    } else {
      for (const [key, child] of Object.entries(value)) {
        if (choices.length >= 190) break;
        visit(child, Array.isArray(value) ? `${path}[${key}]` : `${path}[${JSON.stringify(key)}]`, depth + 1);
      }
    }
  };
  visit(body, '$', 0);
  return choices;
}

export function selectedExpectations(choices: AssertionChoice[], selected: number[]): Expect {
  const result: Expect = {};
  for (const index of selected) {
    const value = choices[index]?.expect;
    if (value === undefined) continue;
    if (value.status !== undefined) result.status = value.status;
    if (value.maxTimeMs !== undefined) result.maxTimeMs = value.maxTimeMs;
    if (value.headers) result.headers = { ...result.headers, ...value.headers };
    if (value.json) result.json = [...(result.json ?? []), ...value.json];
  }
  return result;
}
