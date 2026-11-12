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
  /** Name of an `auth` block of httpi.yaml: its token is sent as `Authorization: Bearer`. */
  auth: z.string().min(1).optional(),
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
  /** CSV or JSON file, relative to this file: the test runs once per row, with `{{data.<column>}}`. */
  data: z.string().min(1).optional(),
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

/** httpi.local.yaml: personal values and secrets kept out of git, as `name: value`. */
export const localFileSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]).transform(String));

const projectPath = z.string().min(1);

const oauthCommon = {
  type: z.literal('oauth2'),
  tokenUrl: z.string().min(1),
  clientId: z.string().min(1),
  scopes: z.array(z.string().min(1)).optional(),
  /** How the client identifies itself to the token endpoint: HTTP Basic (default) or fields in the body. */
  clientAuth: z.enum(['basic', 'body']).optional(),
};

/** How to obtain an access token. Secrets belong in `${ENV}` references, never in the file. */
export const authSchema = z.discriminatedUnion('flow', [
  z.strictObject({ ...oauthCommon, flow: z.literal('client_credentials'), clientSecret: z.string().min(1) }),
  // For CI on behalf of a user: a long-lived refresh token is exchanged at the start of each run.
  z.strictObject({
    ...oauthCommon,
    flow: z.literal('refresh_token'),
    refreshToken: z.string().min(1),
    /** Omit for public clients, which identify themselves with the client id alone. */
    clientSecret: z.string().min(1).optional(),
  }),
]);

export type AuthConfig = z.infer<typeof authSchema>;

/** One entry of `run:` — a test file, or a pattern such as `tests/admin/*.yaml`. */
export const runEntrySchema = z.union(
  [
    projectPath,
    z.strictObject({
      file: projectPath,
      /** CSV or JSON file, relative to httpi.yaml: the whole file runs once per row. */
      data: projectPath.optional(),
    }),
  ],
  { error: 'run entry must be a path, a pattern or { file, data }' },
);

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
  /** Named ways to obtain a token; a request picks one with `auth: <name>`. */
  auth: z.record(z.string().regex(/^[A-Za-z_][\w-]*$/, 'auth name must be a simple name, e.g. main'), authSchema).optional(),
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
