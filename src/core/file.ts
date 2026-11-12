import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { parse, stringify } from 'yaml';
import { z } from 'zod';
import { envFileSchema, type RequestSpec, type TestCase, type TestFile, testFileSchema } from './schema.js';
import { extractSecrets, type Secret } from './importer/map-flags.js';

export const ENV_FILE_NAME = 'httpi.env.yaml';

/** A file cannot be used: unreadable, not YAML/JSON, or it does not match its schema. */
export class TestFileError extends Error {
  override name = 'TestFileError';
}

export function defaultTestName(request: RequestSpec): string {
  const path = URL.canParse(request.url) ? new URL(request.url).pathname : request.url;
  return `${request.method} ${path}`;
}

/** Creates the wizard file without persisting credentials or conflating distinct auth values. */
export function prepareWizardFile(tests: TestCase[], name?: string): { file: TestFile; secrets: Pick<Secret, 'header' | 'variable'>[] } {
  if (tests.length === 0) throw new TestFileError('Add at least one request before saving.');
  if (name !== undefined && name.trim() === '') throw new TestFileError('The test name must not be empty.');
  const used = new Set([...JSON.stringify(tests).matchAll(/\{\{([^{}]+)\}\}/g)].map((match) => match[1]!.trim()));
  const bindings = new Map<string, string>();
  const secrets: Pick<Secret, 'header' | 'variable'>[] = [];
  const prepared = tests.map((test) => {
    const extracted = extractSecrets(test.request);
    for (const secret of extracted.secrets) {
      const key = JSON.stringify([secret.variable, secret.value]);
      let variable = bindings.get(key);
      if (variable === undefined) {
        variable = secret.variable;
        for (let suffix = 2; used.has(variable); suffix++) variable = `${secret.variable}${suffix}`;
        used.add(variable); bindings.set(key, variable);
        secrets.push({ header: secret.header, variable });
      }
      extracted.request.headers[secret.header] = extracted.request.headers[secret.header]!
        .replace(`{{${secret.variable}}}`, `{{${variable}}}`);
    }
    return { ...test, name: tests.length === 1 && name !== undefined ? name : test.name, request: extracted.request };
  });
  return { file: { version: 1, ...(name !== undefined && tests.length > 1 ? { name } : {}), tests: prepared }, secrets };
}

/** Makes one curl --form expression point at files relative to `baseDir` instead of the current directory. */
function resolveFormField(field: string, baseDir: string): string {
  const equals = field.indexOf('=');
  const marker = field[equals + 1];
  if (equals === -1 || (marker !== '@' && marker !== '<')) return field; // a plain value, not a file
  const rest = field.slice(equals + 2);
  // The file name ends at ";type=..." / ";filename=..."; "@a,b" uploads several files.
  const semicolon = rest.indexOf(';');
  const names = semicolon === -1 ? rest : rest.slice(0, semicolon);
  const options = semicolon === -1 ? '' : rest.slice(semicolon);
  const paths = names.split(',').map((name) => (name === '-' || name === '' || isAbsolute(name) ? name : resolve(baseDir, name)));
  return `${field.slice(0, equals + 2)}${paths.join(',')}${options}`;
}

/** Multipart file references (`name=@path`, `name=<path`) resolved against the directory of the file that declares them. */
export function resolveFormPaths(request: RequestSpec, baseDir: string): RequestSpec {
  if (request.body === undefined || !('form' in request.body)) return request;
  return { ...request, body: { form: request.body.form.map((field) => resolveFormField(field, baseDir)) } };
}

/** Parses YAML (JSON is valid YAML) against a schema; `kind` names the document in errors. */
export function parseWith<T>(schema: z.ZodType<T>, text: string, source: string, kind: string): T {
  let data: unknown;
  try {
    data = parse(text);
  } catch (cause) {
    throw new TestFileError(`${source}: invalid YAML: ${(cause as Error).message}`, { cause });
  }
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new TestFileError(`${source}: invalid ${kind}\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

export async function readTextFile(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (cause) {
    throw new TestFileError(`${path}: cannot read file: ${(cause as Error).message}`, { cause });
  }
}

/** Parses YAML (JSON is valid YAML) and validates it. `source` only labels error messages. */
export function parseTestFile(text: string, source: string): TestFile {
  return parseWith(testFileSchema, text, source, 'test file');
}

export async function readTestFile(path: string): Promise<TestFile> {
  return parseTestFile(await readTextFile(path), path);
}

/** YAML for a test file, leaving out what the schema fills in by default (no headers, no asserts). */
export function stringifyTestFile(file: TestFile): string {
  const tests = file.tests.map(({ name, request, expect, capture, data }) => {
    const { method, url, headers, ...rest } = request;
    return {
      name,
      request: { method, url, ...(Object.keys(headers).length > 0 && { headers }), ...rest },
      ...(Object.keys(expect).length > 0 && { expect }),
      ...(capture ? { capture } : {}),
      ...(data !== undefined ? { data } : {}),
    };
  });
  // Single quotes keep JSON bodies readable: '{"a":1}' instead of "{\"a\":1}".
  return stringify({ ...file, tests }, { lineWidth: 0, singleQuote: true });
}

/** Writes a new test file; refuses to replace an existing one. */
export async function writeTestFile(path: string, file: TestFile): Promise<void> {
  try {
    await writeFile(path, stringifyTestFile(file), { flag: 'wx' });
  } catch (cause) {
    const reason = (cause as NodeJS.ErrnoException).code === 'EEXIST' ? 'file already exists' : (cause as Error).message;
    throw new TestFileError(`${path}: cannot write file: ${reason}`, { cause });
  }
}

/**
 * Variables of environment `envName` from httpi.env.yaml, looked up next to the test file
 * and then in the current directory.
 */
export async function readEnvironment(testFilePath: string, envName: string): Promise<Record<string, string>> {
  const candidates = [join(dirname(resolve(testFilePath)), ENV_FILE_NAME), resolve(ENV_FILE_NAME)];
  const path = candidates.find((candidate) => existsSync(candidate));
  if (path === undefined) {
    throw new TestFileError(
      `environment "${envName}" requested but there is no ${ENV_FILE_NAME} next to the test file or in the current directory`,
    );
  }
  const environments = parseWith(envFileSchema, await readTextFile(path), path, 'environment file');
  const variables = environments[envName];
  if (variables === undefined) {
    const available = Object.keys(environments).join(', ') || '(none)';
    throw new TestFileError(`${path}: no environment "${envName}"; available: ${available}`);
  }
  return variables;
}
