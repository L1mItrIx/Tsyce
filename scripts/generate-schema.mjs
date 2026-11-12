import { mkdir, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { testFileSchema } from '../dist/core/schema.js';

const directory = new URL('../schema/', import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(new URL('httpi.schema.json', directory), `${JSON.stringify(z.toJSONSchema(testFileSchema, { io: 'input' }), null, 2)}\n`);
