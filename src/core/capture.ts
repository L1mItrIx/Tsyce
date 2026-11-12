import { jsonpath, type JSONValue } from 'json-p3';
import type { RunResult } from './runner/exec.js';

export class CaptureError extends Error { override name = 'CaptureError'; }
export const REDACTED = '[REDACTED]';
const tokenValue = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  const token = value.replace(/^Bearer\s+/i, '');
  return token !== '' && !/[\s\x00-\x1f\x7f]/.test(token);
};

export function captureAuthToken(result: RunResult, capture: { authToken: string }): string {
  if (result.error !== null || result.status < 200 || result.status >= 300) throw new CaptureError('Authentication must succeed before capturing a token.');
  try {
    const values = jsonpath.query(capture.authToken, JSON.parse(result.body) as JSONValue).map((node) => node.value);
    if (values.length !== 1 || !tokenValue(values[0])) throw new Error('invalid token');
    return values[0].replace(/^Bearer\s+/i, '');
  } catch { throw new CaptureError('Select exactly one non-empty token string from the JSON response.'); }
}

/** Reads the one text, number or boolean that `path` selects in the JSON response, as text. */
export function captureValue(result: RunResult, path: string): string {
  let body: JSONValue;
  try { body = JSON.parse(result.body) as JSONValue; } catch { throw new CaptureError('response body is not valid JSON'); }
  const values = jsonpath.query(path, body).map((node) => node.value);
  if (values.length === 0) throw new CaptureError('no match');
  if (values.length > 1) throw new CaptureError(`${values.length} matches; the path must select exactly one value`);
  const value = values[0];
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  throw new CaptureError(`selected ${value === null ? 'null' : Array.isArray(value) ? 'an array' : 'an object'}; only text, numbers and booleans can be captured`);
}

/** Lists paths only, never token values. Bound traversal to keep the picker responsive. */
export function responseTokenFields(result: RunResult): string[] {
  if (result.error !== null || result.status < 200 || result.status >= 300) return [];
  let body: unknown;
  try { body = JSON.parse(result.body); } catch { return []; }
  const paths: string[] = []; let visited = 0;
  const visit = (value: unknown, path: string, depth: number) => {
    if (++visited > 500 || paths.length >= 50 || depth > 8) return;
    if (tokenValue(value)) paths.push(path);
    else if (value !== null && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        if (visited >= 500 || paths.length >= 50) break;
        visit(child, Array.isArray(value) ? `${path}[${key}]` : `${path}[${JSON.stringify(key)}]`, depth + 1);
      }
    }
  };
  visit(body, '$', 0);
  return paths.sort((a, b) => Number(/access_token|["'.]token["'\]]/i.test(b)) - Number(/access_token|["'.]token["'\]]/i.test(a)));
}

/** Redacts raw and JSON-escaped forms without mutating the response or assertions. */
export function maskSecrets<T>(value: T, secrets: string[]): T {
  const patterns = [...new Set(secrets.filter(Boolean).flatMap((secret) => {
    const forms = [secret, JSON.stringify(secret).slice(1, -1)];
    try { forms.push(encodeURIComponent(secret)); } catch { /* Raw and JSON forms still cover malformed Unicode. */ }
    return forms;
  }))].sort((a, b) => b.length - a.length);
  const walk = (item: unknown): unknown => {
    if (typeof item === 'string') return patterns.reduce((text, secret) => text.replaceAll(secret, REDACTED), item);
    if (Array.isArray(item)) return item.map(walk);
    if (item !== null && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([key, data]) => [walk(key) as string, walk(data)]));
    return item;
  };
  return walk(value) as T;
}
