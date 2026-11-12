import { dirname, extname, resolve } from 'node:path';
import { readTextFile, TestFileError } from './file.js';
import type { TestFile } from './schema.js';

/** One row of a data file: column name → value, always as text. */
export type DataRow = Record<string, string>;

const COLUMN_NAME = /^[A-Za-z_][\w.-]*$/;

function checkColumns(columns: string[], source: string): void {
  const seen = new Set<string>();
  for (const column of columns) {
    if (!COLUMN_NAME.test(column)) {
      throw new TestFileError(`${source}: column name ${JSON.stringify(column)} cannot be used as {{data.<name>}}; use letters, digits, "_", "-" or "."`);
    }
    if (seen.has(column)) throw new TestFileError(`${source}: column "${column}" appears more than once`);
    seen.add(column);
  }
}

/** Splits CSV text into records of fields (RFC 4180), remembering the line each record starts on. */
function splitCsv(text: string, source: string): Array<{ line: number; fields: string[] }> {
  const records: Array<{ line: number; fields: string[] }> = [];
  let fields: string[] = [];
  let field = '';
  let quoted = false; // the current field started with a quote
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;

  const endRecord = () => {
    fields.push(field);
    // A line with nothing on it is not a record.
    if (fields.length > 1 || field !== '' || quoted) records.push({ line: recordLine, fields });
    fields = [];
    field = '';
    quoted = false;
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i] as string;
    if (inQuotes) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        if (char === '\n') line++;
        field += char;
      }
    } else if (char === '"' && field === '' && !quoted) {
      inQuotes = true;
      quoted = true;
    } else if (char === '"') {
      throw new TestFileError(`${source}:${line}: a quote inside a field must be doubled ("") and the field enclosed in quotes`);
    } else if (char === ',') {
      fields.push(field);
      field = '';
      quoted = false;
    } else if (char === '\n' || (char === '\r' && text[i + 1] === '\n')) {
      if (char === '\r') i++;
      endRecord();
      line++;
      recordLine = line;
    } else {
      field += char;
    }
  }
  if (inQuotes) throw new TestFileError(`${source}:${recordLine}: a quoted field is never closed`);
  endRecord();
  return records;
}

/** CSV with a header row: every later row becomes `{ column: value }`. */
export function parseCsv(text: string, source: string): DataRow[] {
  const [header, ...records] = splitCsv(text.replace(/^﻿/, ''), source);
  if (header === undefined) throw new TestFileError(`${source}: the data file is empty`);
  checkColumns(header.fields, source);
  if (records.length === 0) throw new TestFileError(`${source}: the data file has a header but no rows`);
  return records.map(({ line, fields }) => {
    if (fields.length !== header.fields.length) {
      throw new TestFileError(`${source}:${line}: expected ${header.fields.length} fields like the header, found ${fields.length}`);
    }
    return Object.fromEntries(header.fields.map((column, index) => [column, fields[index] as string]));
  });
}

/** JSON data: a list of flat objects whose values are text, numbers or booleans. */
export function parseJsonRows(text: string, source: string): DataRow[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (cause) {
    throw new TestFileError(`${source}: invalid JSON: ${(cause as Error).message}`, { cause });
  }
  if (!Array.isArray(data)) throw new TestFileError(`${source}: the data file must be a list of objects`);
  if (data.length === 0) throw new TestFileError(`${source}: the data file is empty`);
  return data.map((item: unknown, index) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new TestFileError(`${source}: row ${index + 1} must be an object`);
    }
    checkColumns(Object.keys(item), `${source}: row ${index + 1}`);
    return Object.fromEntries(
      Object.entries(item).map(([column, value]: [string, unknown]) => {
        if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
          throw new TestFileError(`${source}: row ${index + 1}, "${column}" must be text, a number or a boolean`);
        }
        return [column, String(value)];
      }),
    );
  });
}

/** Reads the rows of a `.csv` or `.json` data file. */
export async function readDataFile(path: string): Promise<DataRow[]> {
  const extension = extname(path).toLowerCase();
  if (extension !== '.csv' && extension !== '.json') {
    throw new TestFileError(`${path}: data files must be .csv or .json`);
  }
  const text = await readTextFile(path);
  return extension === '.csv' ? parseCsv(text, path) : parseJsonRows(text, path);
}

/** The rows of each test that declares `data` (paths are relative to the test file); undefined for the others. */
export function readTestRows(file: TestFile, filePath: string): Promise<Array<DataRow[] | undefined>> {
  const root = dirname(resolve(filePath));
  return Promise.all(file.tests.map((test) => (test.data === undefined ? undefined : readDataFile(resolve(root, test.data)))));
}
