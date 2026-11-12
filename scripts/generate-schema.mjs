import { mkdir, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { projectFileSchema, testFileSchema } from '../dist/core/schema.js';

const directory = new URL('../schema/', import.meta.url);
await mkdir(directory, { recursive: true });
const publish = (name, schema) =>
  writeFile(new URL(name, directory), `${JSON.stringify(z.toJSONSchema(schema, { io: 'input' }), null, 2)}\n`);
await publish('httpi.schema.json', testFileSchema);
await publish('httpi.project.schema.json', projectFileSchema);
