import { isDeepStrictEqual } from 'node:util';
import { type JSONValue, jsonpath } from 'json-p3';
import type { RunResult } from './runner/exec.js';
import type { Expect, HeaderExpect, JsonExpect } from './schema.js';

export type AssertResult = {
  ok: boolean;
  /** What was expected, e.g. `status is 201`. */
  label: string;
  /** Why it failed; absent when ok. */
  message?: string;
};

const pass = (label: string): AssertResult => ({ ok: true, label });
const fail = (label: string, message: string): AssertResult => ({ ok: false, label, message });

function show(value: unknown): string {
  const text = JSON.stringify(value) ?? String(value);
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

function checkStatus(expected: number | number[], status: number): AssertResult {
  const allowed = Array.isArray(expected) ? expected : [expected];
  const label = allowed.length === 1 ? `status is ${allowed[0]}` : `status is one of ${allowed.join(', ')}`;
  return allowed.includes(status) ? pass(label) : fail(label, `got ${status}`);
}

function checkMaxTime(maxTimeMs: number, timeMs: number): AssertResult {
  const label = `time is at most ${maxTimeMs} ms`;
  return timeMs <= maxTimeMs ? pass(label) : fail(label, `took ${timeMs} ms`);
}

function checkHeader(name: string, expected: HeaderExpect, headers: RunResult['headers']): AssertResult {
  const isEquals = 'equals' in expected;
  const wanted = isEquals ? expected.equals : expected.contains;
  const label = `header ${name} ${isEquals ? 'equals' : 'contains'} ${show(wanted)}`;
  const values = headers[name.toLowerCase()];
  if (values === undefined) return fail(label, 'header not present');
  const ok = values.some((value) => (isEquals ? value === wanted : value.includes(wanted)));
  return ok ? pass(label) : fail(label, `got ${values.map(show).join(', ')}`);
}

function jsonType(value: unknown): string {
  if (value === null) return 'null';
  return Array.isArray(value) ? 'array' : typeof value;
}

/** Returns why `value` does not satisfy the matcher, or null when it does. */
function mismatch(expected: JsonExpect, value: unknown): string | null {
  if ('equals' in expected) {
    return isDeepStrictEqual(value, expected.equals) ? null : `got ${show(value)}`;
  }
  if ('contains' in expected) {
    const { contains } = expected;
    if (typeof value === 'string') {
      return typeof contains === 'string' && value.includes(contains) ? null : `got ${show(value)}`;
    }
    if (Array.isArray(value)) {
      return value.some((item) => isDeepStrictEqual(item, contains)) ? null : `got ${show(value)}`;
    }
    return `contains needs a string or an array, got ${jsonType(value)}`;
  }
  if ('matches' in expected) {
    if (typeof value !== 'string') return `matches needs a string, got ${jsonType(value)}`;
    return new RegExp(expected.matches).test(value) ? null : `got ${show(value)}`;
  }
  if ('type' in expected) {
    return jsonType(value) === expected.type ? null : `got ${jsonType(value)}`;
  }
  return null;
}

function jsonLabel(expected: JsonExpect): string {
  if ('exists' in expected) return `${expected.path} ${expected.exists ? 'exists' : 'does not exist'}`;
  if ('equals' in expected) return `${expected.path} equals ${show(expected.equals)}`;
  if ('contains' in expected) return `${expected.path} contains ${show(expected.contains)}`;
  if ('matches' in expected) return `${expected.path} matches /${expected.matches}/`;
  return `${expected.path} has type ${expected.type}`;
}

type ParsedBody = { ok: true; data: JSONValue } | { ok: false };

function checkJson(expected: JsonExpect, body: ParsedBody): AssertResult {
  const label = jsonLabel(expected);
  if (!body.ok) return fail(label, 'response body is not valid JSON');
  const values: unknown[] = jsonpath.query(expected.path, body.data).map((node) => node.value);

  if ('exists' in expected) {
    if (expected.exists) return values.length > 0 ? pass(label) : fail(label, 'no match');
    return values.length === 0 ? pass(label) : fail(label, `found ${show(values[0])}`);
  }
  if (values.length === 0) return fail(label, 'no match');
  // A path can match several nodes ($.items[*].id): every one of them must satisfy the matcher.
  for (const value of values) {
    const reason = mismatch(expected, value);
    if (reason !== null) return fail(label, reason);
  }
  return pass(label);
}

function parseBody(body: string): ParsedBody {
  try {
    return { ok: true, data: JSON.parse(body) as JSONValue };
  } catch {
    return { ok: false };
  }
}

/** Checks a response against `expect`. Assumes curl got a response (`result.error` is null). */
export function checkExpectations(expected: Expect, result: RunResult): AssertResult[] {
  const results: AssertResult[] = [];
  if (expected.status !== undefined) results.push(checkStatus(expected.status, result.status));
  if (expected.maxTimeMs !== undefined) results.push(checkMaxTime(expected.maxTimeMs, result.timeMs));
  for (const [name, header] of Object.entries(expected.headers ?? {})) {
    results.push(checkHeader(name, header, result.headers));
  }
  if (expected.json !== undefined && expected.json.length > 0) {
    const body = parseBody(result.body);
    for (const json of expected.json) results.push(checkJson(json, body));
  }
  return results;
}
