import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';
import { z } from 'zod';
import { testFileSchema } from '../../src/core/schema.js';

test('published JSON Schema stays in sync with the zod input model', async () => {
  const schema = JSON.parse(await readFile(new URL('../../schema/httpi.schema.json', import.meta.url), 'utf8'));
  expect(schema).toEqual(z.toJSONSchema(testFileSchema, { io: 'input' }));
  expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
  expect(schema.additionalProperties).toBe(false);
  expect(schema.properties.tests.minItems).toBe(1);
  const request = schema.properties.tests.items.properties.request;
  expect(request.required).toEqual(['url']);
});
