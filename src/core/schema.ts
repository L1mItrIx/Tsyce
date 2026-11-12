import { jsonpath } from 'json-p3';
import { z } from 'zod';

export const bodySchema = z.union([
  z.strictObject({ json: z.json() }),
  z.strictObject({ text: z.string() }),
  // Multipart fields as curl --form expressions: "name=value", "file=@path".
  z.strictObject({ form: z.array(z.string().min(1)).min(1) }),
], { error: 'body must be exactly one of { json }, { text } or { form }' });

export const requestSchema = z.strictObject({
  method: z
    .string()
    .regex(/^[A-Z]+$/, 'method must be uppercase letters, e.g. GET')
    .default('GET'),
  url: z.string().min(1),
  headers: z.record(z.string(), z.string()).default({}),
  body: bodySchema.optional(),
  followRedirects: z.boolean().optional(),
  insecure: z.boolean().optional(),
  compressed: z.boolean().optional(),
  timeoutMs: z.number().positive().optional(),
});

export type RequestSpec = z.infer<typeof requestSchema>;

const statusCode = z.number().int().min(100).max(599);

export const headerExpectSchema = z.union([
  z.strictObject({ equals: z.string() }),
  z.strictObject({ contains: z.string() }),
], { error: 'header assert must be exactly one of { equals } or { contains }' });

const regexSource = z.string().refine(
  (source) => {
    try {
      new RegExp(source);
      return true;
    } catch {
      return false;
    }
  },
  { error: 'matches must be a valid regular expression' },
);

const jsonPath = z.string().superRefine((path, ctx) => {
  try {
    jsonpath.compile(path);
  } catch (cause) {
    ctx.addIssue({ code: 'custom', message: `invalid JSONPath: ${(cause as Error).message}` });
  }
});

export const jsonExpectSchema = z.union([
  z.strictObject({ path: jsonPath, equals: z.json() }),
  z.strictObject({ path: jsonPath, exists: z.boolean() }),
  z.strictObject({ path: jsonPath, contains: z.json() }),
  z.strictObject({ path: jsonPath, matches: regexSource }),
  z.strictObject({
    path: jsonPath,
    type: z.enum(['string', 'number', 'boolean', 'object', 'array', 'null']),
  }),
], { error: 'json assert must be { path, <exactly one of equals | exists | contains | matches | type> }' });

export const expectSchema = z.strictObject({
  status: z.union([statusCode, z.array(statusCode).min(1)]).optional(),
  maxTimeMs: z.number().positive().optional(),
  headers: z.record(z.string(), headerExpectSchema).optional(),
  json: z.array(jsonExpectSchema).optional(),
});

/**
 * Values taken from the response for later requests: variable name → JSONPath.
 * `authToken` is special: its response is hidden and its value is redacted from reports.
 */
export const captureSchema = z
  .record(z.string().regex(/^[A-Za-z_][\w.-]*$/, 'capture name must be a variable name, e.g. userId'), jsonPath)
  .refine((capture) => Object.keys(capture).length > 0, { error: 'capture needs at least one name: { name: <JSONPath> }' });
export type Capture = z.infer<typeof captureSchema>;

export const testSchema = z.strictObject({
  name: z.string().min(1),
  request: requestSchema,
  expect: expectSchema.default({}),
  capture: captureSchema.optional(),
});

export const testFileSchema = z.strictObject({
  version: z.literal(1),
  name: z.string().optional(),
  tests: z.array(testSchema).min(1),
});

export type HeaderExpect = z.infer<typeof headerExpectSchema>;
export type JsonExpect = z.infer<typeof jsonExpectSchema>;
export type Expect = z.infer<typeof expectSchema>;
export type TestCase = z.infer<typeof testSchema>;
export type TestFile = z.infer<typeof testFileSchema>;

/** httpi.env.yaml: environment name → variables. Scalars are read as text. */
export const envFileSchema = z.record(
  z.string(),
  z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]).transform(String)),
);

export type EnvFile = z.infer<typeof envFileSchema>;

const projectPath = z.string().min(1);

/** One entry of `run:` — a test file, or a pattern such as `tests/admin/*.yaml`. */
export const runEntrySchema = z.union([projectPath, z.strictObject({ file: projectPath })], {
  error: 'run entry must be a path, a pattern or { file }',
});

/** httpi.yaml: the whole project in one file, so that CI only needs `httpi run`. */
export const projectFileSchema = z.strictObject({
  version: z.literal(1),
  name: z.string().optional(),
  env: z
    .strictObject({
      /** Environment used when --env is not given. */
      default: z.string().min(1).optional(),
      environments: envFileSchema,
    })
    .optional(),
  run: z.array(runEntrySchema).min(1),
  report: z
    .strictObject({
      /** JUnit XML written after every project run, relative to httpi.yaml. */
      junit: projectPath.optional(),
    })
    .optional(),
});

export type RunEntry = z.infer<typeof runEntrySchema>;
export type ProjectFile = z.infer<typeof projectFileSchema>;
