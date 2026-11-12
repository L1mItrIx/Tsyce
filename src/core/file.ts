import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { z } from 'zod';
import { type TestFile, testFileSchema } from './schema.js';

/** The test file cannot be used: unreadable, not YAML/JSON, or it does not match the schema. */
export class TestFileError extends Error {
  override name = 'TestFileError';
}

/** Parses YAML (JSON is valid YAML) and validates it. `source` only labels error messages. */
export function parseTestFile(text: string, source: string): TestFile {
  let data: unknown;
  try {
    data = parse(text);
  } catch (cause) {
    throw new TestFileError(`${source}: invalid YAML: ${(cause as Error).message}`, { cause });
  }
  const result = testFileSchema.safeParse(data);
  if (!result.success) {
    throw new TestFileError(`${source}: invalid test file\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

export async function readTestFile(path: string): Promise<TestFile> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (cause) {
    throw new TestFileError(`${path}: cannot read file: ${(cause as Error).message}`, { cause });
  }
  return parseTestFile(text, path);
}
