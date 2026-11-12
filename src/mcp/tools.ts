import { readdir, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { ENV_FILE_NAME, prepareWizardFile, readEnvironment, readTestFile, writeTestFile } from '../core/file.js';
import { exitCodeFor, outcomeStatus, runTestFile, validateRunVariables } from '../core/run.js';
import { detectCurl } from '../core/runner/detect.js';
import { testFileSchema } from '../core/schema.js';
import { resolveVars } from '../core/vars.js';

export type McpOptions = { root: string; allowRun?: boolean; allowWrite?: boolean; allowOrigin: string[]; allowEnv: string[] };
const fileArg = z.string().min(1);
export const toolSchemas = {
  list_tests: z.strictObject({}),
  inspect_test: z.strictObject({ file: fileArg }),
  create_test: z.strictObject({ file: fileArg, testFile: testFileSchema }),
  run_test: z.strictObject({ file: fileArg, env: z.string().min(1).optional(), variables: z.record(z.string(), z.string()).default({}) }),
};
const descriptions = {
  list_tests: 'List valid YAML/JSON httpi flows inside the configured root. Does not send requests.',
  inspect_test: 'Inspect request order, methods, header names, body kinds and assertion counts; omits credential values. Does not send requests.',
  create_test: 'Create a validated flow without overwriting. Requires --allow-write. Never executes the flow. Use variable references for credentials.',
  run_test: 'Execute a saved flow in order, including fresh authentication captures. May modify remote data. Requires --allow-run, approved origins and environments. Returns status, timings and assertion booleans, never response bodies or headers. Obtain user authorization before invoking.',
};
export const mcpTools = Object.entries(toolSchemas).map(([name, schema]) => ({
  name, description: descriptions[name as keyof typeof descriptions], inputSchema: z.toJSONSchema(schema, { io: 'input' }),
  annotations: { readOnlyHint: name === 'list_tests' || name === 'inspect_test', destructiveHint: name === 'run_test', idempotentHint: name === 'list_tests' || name === 'inspect_test', openWorldHint: name === 'run_test' },
}));

export async function createToolHandler(options: McpOptions) {
  const root = await realpath(options.root);
  const allowedOrigins = new Set(options.allowOrigin.map((value) => {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Each --allow-origin must be an HTTP(S) origin, without credentials, path, query or fragment');
    return url.origin;
  }));
  const within = (path: string) => { const rel = relative(root, path); return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)); };
  async function filePath(file: string, writing = false): Promise<string> {
    if (isAbsolute(file) || !/\.(yaml|yml|json)$/i.test(file) || basename(file).toLowerCase() === ENV_FILE_NAME) throw new Error('Use a relative YAML/JSON test path, not an environment file');
    const path = resolve(root, file);
    if (!within(path) || !within(await realpath(writing ? dirname(path) : path))) throw new Error('Path must stay inside the configured root');
    // Exclusive writes reject an existing symlink too, without following its target.
    return path;
  }
  return async (name: keyof typeof toolSchemas, args: unknown): Promise<Record<string, unknown>> => {
    if (name === 'list_tests') {
      const files: string[] = []; let visited = 0;
      const walk = async (directory: string, depth: number) => {
        if (depth > 8) return;
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          if (++visited > 2000 || files.length >= 500) return;
          if (entry.name.startsWith('.') || ['node_modules', 'dist'].includes(entry.name)) continue;
          const path = join(directory, entry.name);
          if (entry.isDirectory()) await walk(path, depth + 1);
          else if (entry.isFile() && /\.(yaml|yml|json)$/i.test(entry.name) && entry.name.toLowerCase() !== ENV_FILE_NAME) {
            try { await readTestFile(path); files.push(relative(root, path).split(sep).join('/')); } catch { /* Unrelated YAML/JSON is not a flow. */ }
          }
        }
      };
      await walk(root, 0); return { files: files.sort(), limited: visited > 2000 || files.length >= 500 };
    }
    if (name === 'create_test') {
      if (!options.allowWrite) throw new Error('Creating flows requires starting the server with --allow-write');
      const input = toolSchemas.create_test.parse(args);
      const path = await filePath(input.file, true);
      const prepared = prepareWizardFile(input.testFile.tests, input.testFile.name);
      await writeTestFile(path, prepared.file);
      return { file: input.file, requests: prepared.file.tests.length, requiredVariables: prepared.secrets.map((secret) => secret.variable) };
    }
    const input = name === 'run_test' ? toolSchemas.run_test.parse(args) : toolSchemas.inspect_test.parse(args);
    const path = await filePath(input.file);
    const file = await readTestFile(path);
    if (name === 'inspect_test') return {
      file: input.file, tests: file.tests.map((test, index) => ({
        order: index + 1, name: test.name, method: test.request.method,
        url: test.request.url.split(/[?#]/)[0]!.replace(/(\/\/)[^/@]*@/, '$1[REDACTED]@'),
        headerNames: Object.keys(test.request.headers), bodyKind: test.request.body ? Object.keys(test.request.body)[0] : 'none',
        assertionCount: (test.expect.status === undefined ? 0 : 1) + (test.expect.maxTimeMs === undefined ? 0 : 1) + Object.keys(test.expect.headers ?? {}).length + (test.expect.json?.length ?? 0),
        ...(test.capture ? { capture: test.capture } : {}),
      })),
    };
    if (!options.allowRun) throw new Error('Executing flows requires starting the server with --allow-run');
    const run = toolSchemas.run_test.parse(args);
    if (run.env !== undefined && !options.allowEnv.includes(run.env)) throw new Error('Environment is not allowed; configure --allow-env at startup');
    if (run.env !== undefined) {
      const environment = join(dirname(path), ENV_FILE_NAME);
      if (!within(await realpath(environment))) throw new Error('Environment file must stay inside the configured root');
    }
    if (file.tests.some((test) => test.data !== undefined)) throw new Error('Tests that repeat over a data file are not supported through MCP yet; use the CLI');
    const sources = { cli: run.variables, system: process.env, file: run.env === undefined ? {} : await readEnvironment(path, run.env) };
    validateRunVariables(file, sources);
    // A captured value is only known at run time, so it must not decide where a request goes.
    const captured = [...new Set(file.tests.flatMap((test) => Object.keys(test.capture ?? {})))];
    const usesCapture = (text: string) => [...text.matchAll(/\{\{\s*([^{}\s]+)\s*\}\}/g)].some((match) => captured.includes(match[1]!));
    for (const test of file.tests) {
      if (usesCapture(test.request.url)) throw new Error('In MCP flows use captured values in headers or bodies, not in the URL');
      const request = resolveVars(test.request, { ...sources, runtime: Object.fromEntries(captured.map((name) => [name, '[runtime-value]'])) });
      const url = new URL(request.url);
      if (!['http:', 'https:'].includes(url.protocol) || !allowedOrigins.has(url.origin) || url.username || url.password) throw new Error('Request origin is not allowed; configure --allow-origin at startup and use headers for credentials');
      if (request.followRedirects) throw new Error('MCP flows cannot follow redirects; configure the final approved URL');
      if (request.body && 'form' in request.body) throw new Error('Multipart forms are not supported through MCP yet; use the CLI for uploads');
      request.timeoutMs = Math.min(request.timeoutMs ?? 30_000, 30_000);
      test.request.timeoutMs = request.timeoutMs;
    }
    const curl = await detectCurl();
    const outcomes = await runTestFile(file, curl.bin, sources);
    const counts = { executed: outcomes.length, passed: 0, failed: 0, errored: 0 };
    const tests = outcomes.map((outcome, index) => {
      const status = outcomeStatus(outcome); counts[status]++;
      return { order: index + 1, status, httpStatus: outcome.result.status, timeMs: outcome.result.timeMs,
        assertions: outcome.asserts.map((assert, i) => ({ index: i + 1, passed: assert.ok })) };
    });
    return { exitCode: exitCodeFor(outcomes), summary: counts, skipped: file.tests.length - outcomes.length, tests };
  };
}
