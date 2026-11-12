import { z } from 'zod';
import { requestSchema, type RequestSpec } from '../core/schema.js';

const steps = ['method', 'url', 'headers', 'body', 'review', 'ready', 'cancelled'] as const;
export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
const wizardStateSchema = z.object({
  step: z.enum(steps), input: z.string(), error: z.string().nullable(),
  request: requestSchema.extend({ url: z.string() }),
});
export type WizardState = z.infer<typeof wizardStateSchema>;
export type WizardAction = { type: 'input'; value: string } | { type: 'next' | 'back' | 'cancel' }
  | { type: 'move-method'; direction: -1 | 1 } | { type: 'json-example' | 'use-captured-token' };

export function createWizardState(): WizardState {
  return { step: 'method', input: '', error: null, request: { method: 'GET', url: '', headers: {} } };
}

const headerName = /^[!#$%&'*+.^_`|~\w-]+$/;

function parseHeaders(input: string): Record<string, string> {
  const entries: [string, string][] = [];
  const names = new Set<string>();
  for (const line of input.split(/\r?\n/).filter((line) => line.trim() !== '')) {
    const colon = line.indexOf(':');
    const name = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (colon < 1 || !headerName.test(name) || /[\x00-\x08\x0a-\x1f\x7f]/.test(value)) {
      throw new Error('Use one valid Name: value header per line.');
    }
    if (names.has(name.toLowerCase())) throw new Error('Repeated header names are not supported.');
    names.add(name.toLowerCase());
    entries.push([name, value]);
  }
  return Object.fromEntries(entries);
}

function savedInput(step: WizardState['step'], request: RequestSpec): string {
  switch (step) {
    case 'method': return request.method;
    case 'url': return request.url;
    case 'headers': return Object.entries(request.headers).map(([name, value]) => `${name}: ${value}`).join('\n');
    case 'body': return request.body && 'text' in request.body ? request.body.text : '';
    default: return '';
  }
}

/** Pure request editor; network, rendering and file writes belong to its callers. */
export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  if (state.step === 'ready' || state.step === 'cancelled') return state;
  if (action.type === 'cancel') return { ...state, step: 'cancelled', error: null };
  if (action.type === 'input') return { ...state, input: action.value, error: null };
  if (action.type === 'use-captured-token') {
    if (state.step !== 'headers') return state;
    const lines = state.input.split(/\r?\n/).filter((line) => line.trim() !== '' && !/^\s*authorization\s*:/i.test(line));
    return { ...state, input: [...lines, 'Authorization: Bearer {{authToken}}'].join('\n'), error: null };
  }
  if (action.type === 'json-example') {
    if (state.step !== 'body') return state;
    const hasContentType = Object.keys(state.request.headers).some((name) => name.toLowerCase() === 'content-type');
    const headers = hasContentType ? state.request.headers : { ...state.request.headers, 'Content-Type': 'application/json' };
    return { ...state, input: '{\n  "name": "Ana"\n}', request: { ...state.request, headers }, error: null };
  }
  if (action.type === 'move-method') {
    if (state.step !== 'method') return state;
    const method = state.input.trim().toUpperCase() || state.request.method;
    const current = HTTP_METHODS.findIndex((item) => item === method);
    const index = current < 0 ? 0 : (current + action.direction + HTTP_METHODS.length) % HTTP_METHODS.length;
    return { ...state, input: HTTP_METHODS[index]!, error: null };
  }
  const index = steps.indexOf(state.step);
  if (action.type === 'back') {
    if (index === 0) return state;
    const step = steps[index - 1]!;
    return { ...state, step, input: savedInput(step, state.request), error: null };
  }
  try {
    let request = state.request;
    switch (state.step) {
      case 'method': {
        const method = state.input.trim().toUpperCase() || 'GET';
        if (!/^[A-Z]+$/.test(method)) throw new Error('Enter an HTTP method, for example GET or POST.');
        request = { ...request, method };
        break;
      }
      case 'url': {
        const url = state.input.trim();
        if (!URL.canParse(url) || !['http:', 'https:'].includes(new URL(url).protocol)) {
          throw new Error('Enter a complete http:// or https:// URL.');
        }
        request = { ...request, url };
        break;
      }
      case 'headers': request = { ...request, headers: parseHeaders(state.input) }; break;
      case 'body': {
        const { body: _body, ...rest } = request;
        request = state.input === '' ? rest : { ...rest, body: { text: state.input } };
        break;
      }
      case 'review': request = requestSchema.parse(request); break;
    }
    const step = steps[index + 1]!;
    return { step, request, input: savedInput(step, request), error: null };
  } catch (error) {
    return { ...state, error: (error as Error).message };
  }
}
