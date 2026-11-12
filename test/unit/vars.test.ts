import { describe, expect, test } from 'vitest';
import { resolveVars, UnresolvedVariableError, type VarSources } from '../../src/core/vars.js';

const sources = (partial: Partial<VarSources> = {}): VarSources => ({ cli: {}, system: {}, file: {}, ...partial });

test('runtime authentication values take precedence and an unavailable capture never falls back to a stale token', () => {
  expect(resolveVars('Bearer {{authToken}}', sources({ cli: { authToken: 'stale' }, runtime: { authToken: 'fresh' } }))).toBe('Bearer fresh');
  expect(() => resolveVars('{{authToken}}', sources({ system: { authToken: 'stale' }, runtime: { authToken: undefined } }))).toThrow(UnresolvedVariableError);
});

describe('substitution', () => {
  test.each([
    ['whole string', '{{token}}', 'abc'],
    ['inside text', 'Bearer {{token}}', 'Bearer abc'],
    ['several references', '{{baseUrl}}/users/{{id}}?t={{token}}', 'http://localhost:3000/users/7?t=abc'],
    ['spaces inside the braces', '{{ token }}', 'abc'],
    ['names with dots and dashes', '{{user.name}}-{{api-key}}', 'ana-k1'],
    ['system variable syntax', '${HOME_URL}/x', 'https://sys.example/x'],
    ['both syntaxes together', '${HOME_URL}/{{id}}', 'https://sys.example/7'],
    ['text without references', 'plain $ { } {single} $notvar', 'plain $ { } {single} $notvar'],
    ['an empty value is a value', '[{{empty}}]', '[]'],
  ])('%s', (_name, input, expected) => {
    const result = resolveVars(input, {
      cli: { token: 'abc', id: '7', empty: '' },
      system: { HOME_URL: 'https://sys.example' },
      file: { baseUrl: 'http://localhost:3000', 'user.name': 'ana', 'api-key': 'k1' },
    });
    expect(result).toBe(expected);
  });

  test('replaces every string value in a model, never keys or non-strings', () => {
    const model = {
      name: 'get {{id}}',
      request: {
        url: '{{baseUrl}}/users/{{id}}',
        headers: { 'X-{{id}}': 'Bearer {{token}}' },
        body: { json: { id: '{{id}}', nested: [{ t: '{{token}}' }, 5, true, null] } },
        timeoutMs: 500,
      },
      expect: { status: [200], json: [{ path: '$.id', equals: '{{id}}' }] },
    };
    expect(resolveVars(model, sources({ cli: { id: '7', token: 'abc', baseUrl: 'http://h' } }))).toEqual({
      name: 'get 7',
      request: {
        url: 'http://h/users/7',
        headers: { 'X-{{id}}': 'Bearer abc' },
        body: { json: { id: '7', nested: [{ t: 'abc' }, 5, true, null] } },
        timeoutMs: 500,
      },
      expect: { status: [200], json: [{ path: '$.id', equals: '7' }] },
    });
  });

  test('values are not expanded again', () => {
    expect(resolveVars('{{a}}', sources({ cli: { a: '{{b}}', b: 'x' } }))).toBe('{{b}}');
  });
});

describe('precedence', () => {
  const all = { cli: { v: 'cli' }, system: { v: 'system' }, file: { v: 'file' } };

  test('--var wins over the system environment and the env file', () => {
    expect(resolveVars('{{v}}', all)).toBe('cli');
  });

  test('the system environment wins over the env file', () => {
    expect(resolveVars('{{v}}', { ...all, cli: {} })).toBe('system');
  });

  test('the env file is the last resort', () => {
    expect(resolveVars('{{v}}', { ...all, cli: {}, system: {} })).toBe('file');
  });

  test('${NAME} only reads the system environment', () => {
    expect(resolveVars('${v}', all)).toBe('system');
    expect(() => resolveVars('${v}', { ...all, system: {} })).toThrow(UnresolvedVariableError);
  });
});

describe('unresolved variables', () => {
  test('one error lists every missing reference once, as written', () => {
    const model = { url: '{{baseUrl}}/x', headers: { a: '${API_KEY}', b: '{{baseUrl}} {{ token }}' } };
    const act = () => resolveVars(model, sources());
    expect(act).toThrow(UnresolvedVariableError);
    expect(act).toThrow('unresolved variables: {{baseUrl}}, ${API_KEY}, {{ token }}');
  });

  test('singular message for a single one', () => {
    expect(() => resolveVars('{{token}}', sources())).toThrow('unresolved variable: {{token}}');
  });
});

describe('data rows', () => {
  const row = { cli: { 'data.name': 'from --var' }, system: { 'data.name': 'from system' }, file: { name: 'from file' }, data: { name: 'Ana', 'user.id': '7' } };

  test('{{data.<column>}} reads the current row and nothing else', () => {
    expect(resolveVars('{{data.name}} / {{ data.user.id }} / {{name}}', row)).toBe('Ana / 7 / from file');
  });

  test('a column the row does not have is unresolved, even if another source defines that name', () => {
    expect(() => resolveVars('{{data.email}}', row)).toThrow('unresolved variable: {{data.email}}');
    expect(() => resolveVars('{{data.name}}', { ...row, data: {} })).toThrow(UnresolvedVariableError);
    expect(() => resolveVars('{{data.name}}', sources({ cli: { 'data.name': 'x' } }))).toThrow(UnresolvedVariableError);
  });
});
