import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { parseCsv, parseJsonRows, readDataFile } from '../../src/core/data.js';
import { TestFileError } from '../../src/core/file.js';

describe('parseCsv', () => {
  test.each<[name: string, text: string, rows: Array<Record<string, string>>]>([
    ['header and rows', 'name,age\nAna,30\nLuis,41\n', [{ name: 'Ana', age: '30' }, { name: 'Luis', age: '41' }]],
    ['no newline at the end', 'name,age\nAna,30', [{ name: 'Ana', age: '30' }]],
    ['CRLF line endings', 'name,age\r\nAna,30\r\n', [{ name: 'Ana', age: '30' }]],
    ['a UTF-8 byte order mark', '﻿name\nAna\n', [{ name: 'Ana' }]],
    ['quoted fields keep commas', 'name,city\n"Pérez, Ana","Bogotá, D.C."\n', [{ name: 'Pérez, Ana', city: 'Bogotá, D.C.' }]],
    ['"" inside quotes is one quote', 'q\n"say ""hi"""\n', [{ q: 'say "hi"' }]],
    ['a line break inside quotes stays in the value', 'note,id\n"line 1\nline 2",7\nplain,8\n', [{ note: 'line 1\nline 2', id: '7' }, { note: 'plain', id: '8' }]],
    ['empty fields and an empty quoted field', 'a,b,c\n,"",x\n', [{ a: '', b: '', c: 'x' }]],
    ['spaces are part of the value', 'a,b\n x , y\n', [{ a: ' x ', b: ' y' }]],
    ['blank lines are skipped', 'a\n\n1\n\n2\n\n', [{ a: '1' }, { a: '2' }]],
    ['a single column with an empty quoted value is a row', 'a\n""\n', [{ a: '' }]],
    ['quoted header names', '"user.name","api-key"\nana,k1\n', [{ 'user.name': 'ana', 'api-key': 'k1' }]],
  ])('%s', (_name, text, rows) => {
    expect(parseCsv(text, 'users.csv')).toEqual(rows);
  });

  test.each<[name: string, text: string, message: string]>([
    ['an empty file', '', 'users.csv: the data file is empty'],
    ['only blank lines', '\n\r\n', 'users.csv: the data file is empty'],
    ['a header without rows', 'name,age\n', 'users.csv: the data file has a header but no rows'],
    ['a duplicated column', 'id,name,id\n1,a,2\n', 'users.csv: column "id" appears more than once'],
    ['a column name that is not a variable name', 'first name\nAna\n', 'users.csv: column name "first name" cannot be used as {{data.<name>}}'],
    ['an empty column name', 'a,,c\n1,2,3\n', 'users.csv: column name "" cannot be used'],
    ['a row with fewer fields', 'a,b\n1,2\n3\n', 'users.csv:3: expected 2 fields like the header, found 1'],
    ['a row with more fields, after a multi-line value', 'a,b\n"x\ny",2\n1,2,3\n', 'users.csv:4: expected 2 fields like the header, found 3'],
    ['a quote that is never closed', 'a\n1\n"open\nmore\n', 'users.csv:3: a quoted field is never closed'],
    ['a stray quote inside a field', 'a\nsay "hi"\n', 'users.csv:2: a quote inside a field must be doubled'],
  ])('rejects %s', (_name, text, message) => {
    expect(() => parseCsv(text, 'users.csv')).toThrow(TestFileError);
    expect(() => parseCsv(text, 'users.csv')).toThrow(message);
  });
});

describe('parseJsonRows', () => {
  test('reads a list of flat objects; numbers and booleans become text', () => {
    expect(parseJsonRows('[{"name":"Ana","age":30,"admin":true},{"name":"Luis"}]', 'users.json')).toEqual([
      { name: 'Ana', age: '30', admin: 'true' },
      { name: 'Luis' },
    ]);
  });

  test.each<[name: string, text: string, message: string]>([
    ['invalid JSON', '[{', 'users.json: invalid JSON'],
    ['an object instead of a list', '{"name":"Ana"}', 'users.json: the data file must be a list of objects'],
    ['an empty list', '[]', 'users.json: the data file is empty'],
    ['a row that is not an object', '[{"a":1},[1]]', 'users.json: row 2 must be an object'],
    ['a nested value', '[{"a":{"b":1}}]', 'users.json: row 1, "a" must be text, a number or a boolean'],
    ['a null value', '[{"a":null}]', 'users.json: row 1, "a" must be text, a number or a boolean'],
    ['a key that is not a variable name', '[{"first name":"Ana"}]', 'users.json: row 1: column name "first name" cannot be used'],
  ])('rejects %s', (_name, text, message) => {
    expect(() => parseJsonRows(text, 'users.json')).toThrow(TestFileError);
    expect(() => parseJsonRows(text, 'users.json')).toThrow(message);
  });
});

test('readDataFile picks the parser by extension and reports unreadable or unsupported files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'data-test-'));
  try {
    await writeFile(join(dir, 'users.CSV'), 'name\nAna\n');
    await writeFile(join(dir, 'users.json'), '[{"name":"Luis"}]');
    await writeFile(join(dir, 'users.tsv'), 'name\nAna\n');
    expect(await readDataFile(join(dir, 'users.CSV'))).toEqual([{ name: 'Ana' }]);
    expect(await readDataFile(join(dir, 'users.json'))).toEqual([{ name: 'Luis' }]);
    await expect(readDataFile(join(dir, 'users.tsv'))).rejects.toThrow(/users\.tsv: data files must be \.csv or \.json/);
    await expect(readDataFile(join(dir, 'nope.csv'))).rejects.toThrow(/nope\.csv: cannot read file/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
