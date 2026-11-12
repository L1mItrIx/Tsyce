import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parse } from 'yaml';
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

async function readText(path: string): Promise<string> {
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
  return parseTestFile(await readText(path), path);
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
  const environments = parseWith(envFileSchema, await readText(path), path, 'environment file');
  const variables = environments[envName];
  if (variables === undefined) {
    const available = Object.keys(environments).join(', ') || '(none)';
    throw new TestFileError(`${path}: no environment "${envName}"; available: ${available}`);
  }
  return variables;
}
