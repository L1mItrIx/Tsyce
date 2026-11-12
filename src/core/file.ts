import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parse, stringify } from 'yaml';
import { z } from 'zod';
import { envFileSchema, type TestFile, testFileSchema } from './schema.js';

export const ENV_FILE_NAME = 'httpi.env.yaml';

/** A file cannot be used: unreadable, not YAML/JSON, or it does not match its schema. */
export class TestFileError extends Error {
  override name = 'TestFileError';
}

function parseWith<T>(schema: z.ZodType<T>, text: string, source: string, kind: string): T {
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
  const tests = file.tests.map(({ name, request, expect }) => {
    const { method, url, headers, ...rest } = request;
    return {
      name,
      request: { method, url, ...(Object.keys(headers).length > 0 && { headers }), ...rest },
      ...(Object.keys(expect).length > 0 && { expect }),
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
