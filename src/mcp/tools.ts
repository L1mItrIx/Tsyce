import { existsSync } from 'node:fs';
import { readdir, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { authNamesUsed, checkAuthReferences, obtainTokens } from '../core/auth/oauth.js';
import { tokenStorePath } from '../core/auth/token-store.js';
import { readTestRows } from '../core/data.js';
import { ENV_FILE_NAME, prepareWizardFile, readEnvironment, readTestFile, writeTestFile } from '../core/file.js';
import { expandRun, LOCAL_FILE_NAME, loadProjectRun, PROJECT_FILE_NAME, type ProjectRunItem, projectEnvironment, readLocalValues, readProjectFile } from '../core/project.js';
import { exitCodeFor, outcomeStatus, plannedRequests, type RunItem, runTestFiles, type TestOutcome } from '../core/run.js';
import { detectCurl } from '../core/runner/detect.js';
import { type AuthConfig, type TestFile, testFileSchema } from '../core/schema.js';
import { resolveVars, type VarSources } from '../core/vars.js';

export type McpOptions = { root: string; allowRun?: boolean; allowWrite?: boolean; allowOrigin: string[]; allowEnv: string[] };
const fileArg = z.string().min(1);
export const toolSchemas = {
  list_tests: z.strictObject({}),
  inspect_test: z.strictObject({ file: fileArg }),
  create_test: z.strictObject({ file: fileArg, testFile: testFileSchema }),
  run_test: z.strictObject({ file: fileArg, env: z.string().min(1).optional(), variables: z.record(z.string(), z.string()).default({}) }),
};
const descriptions = {
  list_tests: 'List valid YAML/JSON httpi flows inside the configured root, and the httpi.yaml projects. Does not send requests.',
  inspect_test: 'Inspect request order, methods, header names, body kinds and assertion counts; for httpi.yaml, the files it runs, its environments and auth blocks. Omits credential values. Does not send requests.',
  create_test: 'Create a validated flow without overwriting. Requires --allow-write. Never executes the flow. Use variable references for credentials.',
  run_test: 'Execute a saved flow in order, or the whole project when file is an httpi.yaml, including fresh authentication captures and OAuth tokens. May modify remote data. Requires --allow-run, approved origins and environments. Returns status, timings and assertion booleans, never response bodies or headers. Obtain user authorization before invoking.',
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
    if (isAbsolute(file) || !/\.(yaml|yml|json)$/i.test(file) || [ENV_FILE_NAME, LOCAL_FILE_NAME].includes(basename(file).toLowerCase())) throw new Error('Use a relative YAML/JSON test path, not an environment or local values file');
    const path = resolve(root, file);
    if (!within(path) || !within(await realpath(writing ? dirname(path) : path))) throw new Error('Path must stay inside the configured root');
    // Exclusive writes reject an existing symlink too, without following its target.
    return path;
  }
  return async (name: keyof typeof toolSchemas, args: unknown): Promise<Record<string, unknown>> => {
    if (name === 'list_tests') {
      const files: string[] = []; const projects: string[] = []; let visited = 0;
      const walk = async (directory: string, depth: number) => {
        if (depth > 8) return;
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          if (++visited > 2000 || files.length >= 500) return;
          if (entry.name.startsWith('.') || ['node_modules', 'dist'].includes(entry.name)) continue;
          const path = join(directory, entry.name);
          if (entry.isDirectory()) await walk(path, depth + 1);
          else if (entry.isFile() && entry.name === PROJECT_FILE_NAME) {
            try { await readProjectFile(path); projects.push(relative(root, path).split(sep).join('/')); } catch { /* An invalid project is not offered. */ }
          }
          else if (entry.isFile() && /\.(yaml|yml|json)$/i.test(entry.name) && ![ENV_FILE_NAME, LOCAL_FILE_NAME].includes(entry.name.toLowerCase())) {
            try { await readTestFile(path); files.push(relative(root, path).split(sep).join('/')); } catch { /* Unrelated YAML/JSON is not a flow. */ }
          }
        }
      };
      await walk(root, 0); return { files: files.sort(), projects: projects.sort(), limited: visited > 2000 || files.length >= 500 };
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
    if (basename(path) === PROJECT_FILE_NAME) return name === 'inspect_test' ? inspectProject(input.file, path) : runProject(path, toolSchemas.run_test.parse(args));
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
    if (file.tests.some((test) => test.request.auth !== undefined)) throw new Error('Requests that use auth only run as part of their project: run its httpi.yaml instead');
    for (const test of file.tests) if (test.data !== undefined) await checkInside(resolve(dirname(path), test.data), 'Every data file');
    const item: RunItem = { file, baseDir: dirname(path), testRows: await readTestRows(file, path) };
    const sources = { cli: run.variables, system: process.env, file: run.env === undefined ? {} : await readEnvironment(path, run.env) };
    const planned = checkRequests([item], sources);
    const curl = await detectCurl();
    const [outcomes = []] = await runTestFiles([item], curl.bin, sources);
    return report(outcomes.map((outcome) => ({ outcome })), planned);
  };

  /** Structured results: statuses, timings and assertion booleans only, never bodies, headers or values. */
  function report(outcomes: Array<{ outcome: TestOutcome; file?: string }>, planned: number) {
    const counts = { executed: outcomes.length, passed: 0, failed: 0, errored: 0 };
    const tests = outcomes.map(({ outcome, file }, index) => {
      const status = outcomeStatus(outcome); counts[status]++;
      return { order: index + 1, ...(file !== undefined && { file }), status, httpStatus: outcome.result.status, timeMs: outcome.result.timeMs,
        assertions: outcome.asserts.map((assert, i) => ({ index: i + 1, passed: assert.ok })) };
    });
    return { exitCode: exitCodeFor(outcomes.map(({ outcome }) => outcome)), summary: counts, skipped: planned - outcomes.length, tests };
  }

  /**
   * Refuses a run before anything is sent unless every request it would make, row by row, goes to
   * an approved origin without redirects, uploads or captured values in the URL; caps timeouts.
   */
  function checkRequests(items: Array<TestFile | RunItem>, sources: VarSources): number {
    // A captured value is only known at run time, so it must not decide where a request goes.
    const captured = [...new Set(items.flatMap((item) => ('file' in item ? item.file : item).tests.flatMap((test) => Object.keys(test.capture ?? {}))))];
    const usesCapture = (text: string) => [...text.matchAll(/\{\{\s*([^{}\s]+)\s*\}\}/g)].some((match) => captured.includes(match[1]!));
    const planned = plannedRequests(items, sources, '[runtime-value]');
    for (const { template, request } of planned) {
      if (usesCapture(template.request.url)) throw new Error('In MCP flows use captured values in headers or bodies, not in the URL');
      checkOrigin(request.url);
      if (request.followRedirects) throw new Error('MCP flows cannot follow redirects; configure the final approved URL');
      if (request.body && 'form' in request.body) throw new Error('Multipart forms are not supported through MCP yet; use the CLI for uploads');
      template.request.timeoutMs = Math.min(template.request.timeoutMs ?? 30_000, 30_000);
    }
    return planned.length;
  }

  function checkOrigin(address: string): void {
    const url = new URL(address);
    if (!['http:', 'https:'].includes(url.protocol) || !allowedOrigins.has(url.origin) || url.username || url.password) throw new Error('Request origin is not allowed; configure --allow-origin at startup and use headers for credentials');
  }

  async function checkInside(path: string, what: string): Promise<void> {
    if (!within(await realpath(path))) throw new Error(`${what} must stay inside the configured root`);
  }

  async function inspectProject(file: string, path: string) {
    const project = await readProjectFile(path);
    const targets = await expandRun(project, path);
    for (const target of targets) await checkInside(target.file, 'Every file the project runs');
    const label = (target: string) => relative(root, target).split(sep).join('/');
    return {
      file, project: true, name: project.name ?? null,
      run: targets.map((target) => ({ file: label(target.file), ...(target.data !== undefined && { data: label(target.data) }) })),
      environments: Object.keys(project.env?.environments ?? {}), defaultEnvironment: project.env?.default ?? null,
      auth: Object.entries(project.auth ?? {}).map(([name, block]) => ({ name, flow: block.flow })),
    };
  }

  async function runProject(path: string, run: z.infer<typeof toolSchemas.run_test>) {
    if (!options.allowRun) throw new Error('Executing flows requires starting the server with --allow-run');
    const project = await readProjectFile(path);
    // The environment the project would use, chosen or default, must be one approved at startup.
    const envName = run.env ?? project.env?.default;
    if (envName !== undefined && !options.allowEnv.includes(envName)) throw new Error('Environment is not allowed; configure --allow-env at startup');
    if (project.env === undefined && run.env !== undefined) await checkInside(join(dirname(path), ENV_FILE_NAME), 'Environment file');
    if (existsSync(join(dirname(path), LOCAL_FILE_NAME))) await checkInside(join(dirname(path), LOCAL_FILE_NAME), 'Local values file');
    const environment = await projectEnvironment(project, path, run.env);
    const sources = { cli: run.variables, system: process.env, local: await readLocalValues(path), file: environment.variables };

    for (const target of await expandRun(project, path)) {
      await checkInside(target.file, 'Every file the project runs');
      if (target.data !== undefined) await checkInside(target.data, 'Every data file');
    }
    const items = await loadProjectRun(project, path, sources);
    for (const item of items) for (const test of item.file.tests) if (test.data !== undefined) await checkInside(resolve(item.baseDir as string, test.data), 'Every data file');
    const files = [...new Set(items.map((item) => item.file))];
    const authProblems = files.flatMap((file) => checkAuthReferences(file, project.auth));
    if (authProblems.length > 0) throw new Error(authProblems.join('\n'));
    const planned = checkRequests(items, sources);
    // Token endpoints are requests too.
    const authNames = authNamesUsed(files);
    for (const name of authNames) checkOrigin(resolveVars(project.auth?.[name] as AuthConfig, sources).tokenUrl);

    const curl = await detectCurl();
    const tokens = await obtainTokens(authNames, project.auth ?? {}, sources, curl.bin, tokenStorePath(path));
    const perItem = await runTestFiles(items, curl.bin, sources, tokens);
    const label = (item: ProjectRunItem) => relative(root, item.path).split(sep).join('/') + (item.row === undefined ? '' : item.title.slice(item.title.lastIndexOf(' [row ')));
    return report(perItem.flatMap((outcomes, index) => outcomes.map((outcome) => ({ outcome, file: label(items[index]!) }))), planned);
  }
}
