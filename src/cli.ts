#!/usr/bin/env node
import { text } from 'node:stream/consumers';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { Command, InvalidArgumentError, Option } from 'commander';
import { spawn } from 'node:child_process';
import { loginWithBrowser } from './core/auth/login.js';
import { AuthError, authNamesUsed, checkAuthReferences, obtainTokens } from './core/auth/oauth.js';
import { isUsable, readStoredTokens, saveStoredToken, tokenStorePath } from './core/auth/token-store.js';
import { CurlExportError, exportCurl } from './core/exporter/curl.js';
import {
  defaultTestName,
  prepareWizardFile,
  readEnvironment,
  readTestFile,
  readTextFile,
  resolveFormPaths,
  stringifyTestFile,
  TestFileError,
  writeTestFile,
} from './core/file.js';
import { detectImportSource, type Dialect, DIALECTS, IMPORT_SOURCES, type ImportSource, tokenizeCurl } from './core/importer/detect-dialect.js';
import { importOpenApi } from './core/importer/openapi.js';
import { type ImportedProject, importPostman, importPostmanEnvironment } from './core/importer/postman.js';
import { CurlImportError, extractSecrets, mapFlags } from './core/importer/map-flags.js';
import { ShellSyntaxError } from './core/importer/tokenize-bash.js';
import { addAuthBlock, findProjectFile, initProject, loadProjectRun, mergeIntoProject, PROJECT_FILE_NAME, projectEnvironment, readLocalValues, readProjectFile } from './core/project.js';
import { formatPretty, formatPrettyProject } from './core/reporter/pretty.js';
import { formatJUnit, formatJUnitSuites } from './core/reporter/junit.js';
import { readTestRows } from './core/data.js';
import { EXIT, type ExitCode, exitCodeFor, runTestFiles, validateRunVariables } from './core/run.js';
import { detectCurl } from './core/runner/detect.js';
import { CurlUnavailableError, runRequest } from './core/runner/exec.js';
import type { TestFile } from './core/schema.js';
import { validateProject } from './core/validate.js';
import { resolveVars, UnresolvedVariableError } from './core/vars.js';

const say = (line: string) => process.stderr.write(`${line}\n`);

type VariableOptions = { env?: string; var: Record<string, string> };
type RunOptions = VariableOptions & { reporter: 'pretty' | 'junit'; showResponse?: true };

function checkRunOptions(options: RunOptions): void {
  if (options.showResponse && options.reporter !== 'pretty') {
    throw new TestFileError('--show-response requires --reporter pretty; omit it when generating JUnit');
  }
}

const prettyOptions = (options: RunOptions) => ({
  color: process.stdout.isTTY === true && !process.env.NO_COLOR,
  showResponse: options.showResponse === true,
});

async function runFileCommand(path: string, options: RunOptions): Promise<ExitCode> {
  const file = await readTestFile(path);
  const item = { file, baseDir: dirname(resolve(path)), testRows: await readTestRows(file, path) };
  const sources = {
    cli: options.var,
    system: process.env,
    file: options.env === undefined ? {} : await readEnvironment(path, options.env),
  };
  validateRunVariables([item], sources);
  const title = resolveVars(file.name, sources);
  const curl = await detectCurl();
  const [outcomes = []] = await runTestFiles([item], curl.bin, sources);
  const report = options.reporter === 'junit' ? formatJUnit(title, outcomes) : formatPretty(title, outcomes, prettyOptions(options));
  process.stdout.write(`${report}\n`);
  return exitCodeFor(outcomes);
}

/** Runs everything httpi.yaml lists, as one flow that shares variables and tokens. */
async function runProjectCommand(projectPath: string, options: RunOptions): Promise<ExitCode> {
  const project = await readProjectFile(projectPath);
  const environment = await projectEnvironment(project, projectPath, options.env);
  for (const warning of environment.warnings) say(`warning: ${warning}`);
  const sources = { cli: options.var, system: process.env, local: await readLocalValues(projectPath), file: environment.variables };

  const items = await loadProjectRun(project, projectPath, sources);
  validateRunVariables(items, sources);
  const files = [...new Set(items.map((item) => item.file))];
  const authProblems = files.flatMap((file) => checkAuthReferences(file, project.auth));
  if (authProblems.length > 0) throw new TestFileError(authProblems.join('\n'));
  const curl = await detectCurl();
  const tokens = await obtainTokens(authNamesUsed(files), project.auth ?? {}, sources, curl.bin, tokenStorePath(projectPath));
  const perFile = await runTestFiles(items, curl.bin, sources, tokens);
  const suites = items.map((item, index) => ({ name: item.title, outcomes: perFile[index]! }));
  const report = options.reporter === 'junit' ? formatJUnitSuites(suites) : formatPrettyProject(suites, prettyOptions(options));
  process.stdout.write(`${report}\n`);
  if (project.report?.junit !== undefined) {
    // A report is an output of the run: it replaces the one from the previous run.
    const junitPath = resolve(dirname(projectPath), project.report.junit);
    try {
      await mkdir(dirname(junitPath), { recursive: true });
      await writeFile(junitPath, `${formatJUnitSuites(suites)}\n`);
    } catch (cause) {
      throw new TestFileError(`${junitPath}: cannot write the JUnit report: ${(cause as Error).message}`, { cause });
    }
  }
  return exitCodeFor(perFile.flat());
}

async function runCommand(path: string | undefined, options: RunOptions): Promise<ExitCode> {
  checkRunOptions(options);
  if (path !== undefined && basename(path) !== PROJECT_FILE_NAME) return runFileCommand(path, options);
  return runProjectCommand(requireProject(path), options);
}

function requireProject(path: string | undefined): string {
  const projectPath = path ?? findProjectFile(process.cwd());
  if (projectPath === null) {
    throw new TestFileError(`no ${PROJECT_FILE_NAME} found in this directory or its parents; pass a test file: httpi run <file>`);
  }
  return resolve(projectPath);
}

async function validateCommand(options: VariableOptions): Promise<ExitCode> {
  const projectPath = requireProject(undefined);
  const { problems, files, tests } = await validateProject(projectPath, { cli: options.var, system: process.env, ...(options.env !== undefined && { env: options.env }) });
  for (const problem of problems) process.stdout.write(`${problem.file}: ${problem.message}\n`);
  const size = `${files} ${files === 1 ? 'file' : 'files'}, ${tests} ${tests === 1 ? 'test' : 'tests'}`;
  process.stdout.write(problems.length === 0 ? `valid: ${size}; no requests were sent\n` : `${problems.length} ${problems.length === 1 ? 'problem' : 'problems'} in ${size}\n`);
  return problems.length === 0 ? EXIT.ok : EXIT.invalid;
}

/** Opens the default browser; the URL is always printed too, for machines without one. */
function openBrowser(url: string): void {
  if (process.env.HTTPI_NO_BROWSER) return;
  const [command, args] =
    process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
    : ['xdg-open', [url]];
  spawn(command, args, { stdio: 'ignore', detached: true }).on('error', () => { /* the printed URL is the fallback */ }).unref();
}

async function projectSources(projectPath: string, options: VariableOptions) {
  const project = await readProjectFile(projectPath);
  const environment = await projectEnvironment(project, projectPath, options.env);
  return { project, sources: { cli: options.var, system: process.env, local: await readLocalValues(projectPath), file: environment.variables } };
}

async function authLoginCommand(name: string, options: VariableOptions): Promise<ExitCode> {
  const projectPath = requireProject(undefined);
  const { project, sources } = await projectSources(projectPath, options);
  const block = project.auth?.[name];
  if (block === undefined) {
    throw new TestFileError(`auth "${name}" is not declared in ${PROJECT_FILE_NAME}; available: ${Object.keys(project.auth ?? {}).join(', ') || '(none)'}`);
  }
  if (block.flow !== 'authorization_code') {
    throw new TestFileError(`auth "${name}" uses ${block.flow}: it needs no login, httpi run obtains its token by itself`);
  }
  const curl = await detectCurl();
  const token = await loginWithBrowser(name, resolveVars(block, sources), {
    curlBin: curl.bin,
    announce: (url) => {
      say(`Open this URL in a browser to log in:\n${url}`);
      openBrowser(url);
    },
  });
  await saveStoredToken(tokenStorePath(projectPath), name, token);
  say(`httpi: logged in as "${name}"; the token is stored in .httpi/tokens.json (keep that directory out of git)`);
  return EXIT.ok;
}

async function authAddCommand(): Promise<ExitCode> {
  const projectPath = requireProject(undefined);
  const project = await readProjectFile(projectPath);
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    throw new TestFileError(`httpi auth add requires an interactive terminal; without one, write the block under "auth" in ${PROJECT_FILE_NAME}`);
  }
  const { launchAuthWizard } = await import('./tui/auth-wizard.js');
  const result = await launchAuthWizard(Object.keys(project.auth ?? {}));
  if (result === null) { say('httpi: cancelled; httpi.yaml was not changed'); return EXIT.ok; }
  await addAuthBlock(projectPath, result.name, result.block);
  say(`httpi: added auth "${result.name}" to ${PROJECT_FILE_NAME}; use it in a test with "auth: ${result.name}" under request`);
  const variables = [...JSON.stringify(result.block).matchAll(/\$\{(\w+)\}/g)].map((match) => match[1]);
  if (variables.length > 0) say(`httpi: set ${variables.join(', ')} in the environment (in CI, as secrets)`);
  if (result.block.flow === 'authorization_code') {
    say(`httpi: register http://127.0.0.1:${result.block.redirectPort}/callback with the provider, then run "httpi auth login ${result.name}"`);
  }
  return EXIT.ok;
}

async function authStatusCommand(): Promise<ExitCode> {
  const projectPath = requireProject(undefined);
  const project = await readProjectFile(projectPath);
  const stored = await readStoredTokens(tokenStorePath(projectPath));
  const blocks = Object.entries(project.auth ?? {});
  if (blocks.length === 0) process.stdout.write(`no auth blocks in ${PROJECT_FILE_NAME}\n`);
  for (const [name, block] of blocks) {
    const token = stored[name];
    const state =
      block.flow !== 'authorization_code' ? 'token requested on every run'
      : token === undefined ? `not logged in; run "httpi auth login ${name}"`
      : isUsable(token) ? `logged in${token.expiresAt === undefined ? '' : ` until ${new Date(token.expiresAt).toISOString()}`}`
      : token.refreshToken !== undefined ? 'expired; it will be renewed on the next run'
      : `expired; run "httpi auth login ${name}"`;
    process.stdout.write(`${name}: ${block.flow}, ${state}\n`);
  }
  return EXIT.ok;
}

async function initCommand(directory: string): Promise<ExitCode> {
  for (const step of await initProject(directory)) say(`${step.action.padEnd(7)} ${step.path}`);
  say('httpi: project ready. Set baseUrl in httpi.yaml, add tests with "httpi new tests/<name>.yaml" or "httpi import", then run "httpi run".');
  return EXIT.ok;
}

type ImportOptions = { from?: ImportSource; dialect?: Dialect; output?: string; name?: string; keepSecrets?: true; environment?: string; pick?: true };

async function importCurl(pasted: string, options: ImportOptions): Promise<ExitCode> {
  const { dialect, tokens } = tokenizeCurl(pasted, options.dialect);
  if (options.dialect === undefined) say(`httpi: read as a ${dialect} command (use --dialect to change it)`);
  const imported = mapFlags(tokens);
  for (const warning of imported.warnings) say(`warning: ${warning}`);

  const { request, secrets } = options.keepSecrets ? { request: imported.request, secrets: [] } : extractSecrets(imported.request);
  for (const secret of secrets) {
    say(`secret: the ${secret.header} value was replaced by {{${secret.variable}}}; pass it with --var ${secret.variable}=... when you run the test`);
  }

  const file: TestFile = { version: 1, tests: [{ name: options.name ?? defaultTestName(request), request, expect: {} }] };
  if (options.output === undefined) {
    process.stdout.write(stringifyTestFile(file));
  } else {
    await writeTestFile(options.output, file);
    say(`httpi: wrote ${options.output}`);
  }
  say('httpi: the test has no asserts yet; add an "expect" block (status, headers, json)');
  return EXIT.ok;
}

/** Writes a multi-file import as a project: tests under <dir>/tests and the rest in <dir>/httpi.yaml. */
async function writeImportedProject(imported: ImportedProject, title: string, options: ImportOptions): Promise<ExitCode> {
  if (options.output === undefined) {
    throw new TestFileError('this import produces several files; pass the project directory with -o <directory>');
  }
  const testsDir = join(options.output, 'tests');
  const targets = imported.files.map((entry) => ({ path: join(testsDir, entry.path), entry }));
  const existing = targets.filter((target) => existsSync(target.path)).map((target) => target.path);
  if (existing.length > 0) throw new TestFileError(`these files already exist; nothing was written: ${existing.join(', ')}`);

  for (const warning of imported.warnings) say(`warning: ${warning}`);
  await mkdir(testsDir, { recursive: true });
  const moved = new Set<string>();
  for (const { path, entry } of targets) {
    // Literal credentials are replaced by variables, as when importing a curl command.
    const prepared = options.keepSecrets ? null : prepareWizardFile(entry.file.tests);
    const tests = prepared?.file.tests ?? entry.file.tests;
    for (const secret of prepared?.secrets ?? []) moved.add(`${secret.header} → {{${secret.variable}}}`);
    await writeTestFile(path, { ...entry.file, tests });
    say(`created ${relative(options.output, path).replaceAll('\\', '/')} (${tests.length} ${tests.length === 1 ? 'test' : 'tests'})`);
  }
  for (const secret of moved) say(`secret: a literal credential was replaced by a variable (${secret}); give it a value with --var or in httpi.local.yaml`);

  let environment: { name: string; variables: Record<string, string> } | undefined;
  if (options.environment !== undefined) {
    const extra = importPostmanEnvironment(await readTextFile(options.environment));
    environment = { name: extra.name, variables: { ...imported.variables, ...extra.variables } };
  } else if (Object.keys(imported.variables).length > 0) {
    environment = { name: 'imported', variables: imported.variables };
  }
  for (const note of await mergeIntoProject(options.output, { name: title, auth: imported.auth, ...(environment !== undefined && { environment }) })) say(note);
  const bare = imported.files.flatMap((entry) => entry.file.tests).filter((test) => Object.keys(test.expect).length === 0).length;
  say(`httpi: ${bare === 0 ? 'each test only checks the status' : `${bare} ${bare === 1 ? 'test has' : 'tests have'} no asserts yet`}; add "expect" blocks, then check the project with "httpi validate"`);
  return EXIT.ok;
}

async function importCommand(givenFile: string | undefined, options: ImportOptions): Promise<ExitCode> {
  let sourceFile = givenFile;
  if (options.pick) {
    if (sourceFile !== undefined) throw new TestFileError('pass either a source file or --pick, not both');
    if (!process.stdin.isTTY || !process.stderr.isTTY) throw new TestFileError('--pick requires an interactive terminal; pass the source file instead');
    const { launchFilePicker } = await import('./tui/file-picker.js');
    const picked = await launchFilePicker({ startDir: process.cwd(), title: 'Choose what to import', hint: 'A file with a curl command, a Postman collection (.json) or an OpenAPI document (.yaml, .json).' });
    if (picked === null) { say('httpi: cancelled; nothing was imported'); return EXIT.ok; }
    say(`httpi: importing ${relative(process.cwd(), picked) || picked}`);
    sourceFile = picked;
  }
  if (sourceFile === undefined && process.stdin.isTTY) {
    say('Paste the curl command or the collection, then press Ctrl+D (on Windows: Ctrl+Z, then Enter).');
  }
  const pasted = sourceFile === undefined ? await text(process.stdin) : await readTextFile(sourceFile);
  const from = options.from ?? detectImportSource(pasted);
  if (from === 'curl') {
    if (options.environment !== undefined) throw new TestFileError('--environment only applies to a Postman collection');
    return importCurl(pasted, options);
  }
  if (options.dialect !== undefined || options.name !== undefined) throw new TestFileError('--dialect and --name only apply to a curl command');
  if (options.from === undefined) say(`httpi: read as ${from === 'openapi' ? 'an OpenAPI document' : 'a Postman collection'} (use --from to change it)`);
  if (from === 'openapi') {
    if (options.environment !== undefined) throw new TestFileError('--environment only applies to a Postman collection');
    const imported = importOpenApi(pasted);
    return writeImportedProject(imported, imported.title, options);
  }
  const imported = importPostman(pasted);
  const title = (JSON.parse(pasted) as { info?: { name?: string } }).info?.name?.trim() || 'Imported API';
  return writeImportedProject(imported, title, options);
}

type ExportOptions = VariableOptions & { dialect: Dialect };

async function newCommand(path: string, options: { name?: string }): Promise<ExitCode> {
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    throw new TestFileError('httpi new requires an interactive terminal; use httpi import for piped input');
  }
  if (existsSync(path)) throw new TestFileError(`${path}: file already exists; choose a new destination`);
  const curl = await detectCurl();
  const { launchWizard } = await import('./tui/suite-wizard.js');
  // Uploads chosen in the wizard are relative to the new YAML, as they will be when it runs.
  const baseDir = dirname(resolve(path));
  const completed = await launchWizard((request, signal) => runRequest(curl.bin, resolveFormPaths(request, baseDir), signal), baseDir);
  if (completed === null) { say('httpi: cancelled; no file written'); return EXIT.ok; }
  const { file, secrets } = prepareWizardFile(completed, options.name);
  await writeTestFile(path, file);
  say(`httpi: wrote ${path} (${file.tests.length} ${file.tests.length === 1 ? 'request' : 'requests'})`);
  for (const secret of secrets) say(`secret: ${secret.header} replaced by {{${secret.variable}}}; run with --var ${secret.variable}=...`);
  return EXIT.ok;
}

async function exportCommand(path: string, options: ExportOptions): Promise<ExitCode> {
  const input = await readTestFile(path);
  if (input.tests.some((test) => test.capture)) throw new TestFileError('Authentication capture flows must be executed with httpi run; static curl export cannot reproduce token captures');
  if (input.tests.some((test) => test.request.auth !== undefined)) throw new TestFileError('Requests that use auth must be executed with httpi run; static curl export cannot obtain tokens');
  if (input.tests.some((test) => test.data !== undefined)) throw new TestFileError('Tests that repeat over a data file must be executed with httpi run; static curl export does not expand the rows');
  const file = resolveVars(input, {
    cli: options.var,
    system: process.env,
    file: options.env === undefined ? {} : await readEnvironment(path, options.env),
  });
  // Generate everything before writing: a bad request must not leave a partial script.
  const commands = file.tests.map(({ request }) => exportCurl(request, options.dialect));
  process.stdout.write(`${commands.join('\n\n')}\n`);
  return EXIT.ok;
}

const INPUT_ERRORS = [TestFileError, UnresolvedVariableError, ShellSyntaxError, CurlImportError, CurlExportError];

/** Runs a command and turns its outcome or its known errors into the process exit code. */
async function finish(command: Promise<ExitCode>): Promise<void> {
  try {
    process.exitCode = await command;
  } catch (error) {
    if (INPUT_ERRORS.some((type) => error instanceof type)) process.exitCode = EXIT.invalid;
    else if (error instanceof CurlUnavailableError || error instanceof AuthError) process.exitCode = EXIT.curl;
    else throw error;
    say(`httpi: ${(error as Error).message}`);
  }
}

function collectVar(pair: string, previous: Record<string, string>): Record<string, string> {
  const separator = pair.indexOf('=');
  if (separator <= 0) throw new InvalidArgumentError('Expected name=value.');
  return { ...previous, [pair.slice(0, separator)]: pair.slice(separator + 1) };
}

const program = new Command()
  .name('httpi')
  .description('Paste a curl or answer a few questions, and get an API test ready to run in CI.')
  // commander exits 1 on usage errors; httpi reserves 1 for failed asserts and uses 2 for usage.
  .exitOverride((error) => process.exit(error.exitCode === 0 ? EXIT.ok : EXIT.invalid));

program
  .command('mcp')
  .description('serve local MCP tools over stdio; execution and creation are disabled by default')
  .requiredOption('--root <directory>', 'restrict test files to this directory')
  .option('--allow-run', 'allow API requests, including methods that modify remote data')
  .option('--allow-write', 'allow creation of new test files (never overwrites)')
  .option('--allow-origin <origin>', 'approved HTTP(S) origin for execution; repeatable', (value: string, previous: string[]) => [...previous, value], [])
  .option('--allow-env <name>', 'approved environment name; repeatable', (value: string, previous: string[]) => [...previous, value], [])
  .action(async (options: import('./mcp/tools.js').McpOptions) => {
    try { const { serveMcp } = await import('./mcp/server.js'); await serveMcp(options); }
    catch { say('httpi: cannot start MCP; check --root and --allow-origin'); process.exitCode = EXIT.invalid; }
  });

program
  .command('run')
  .description('run a test file, or the whole project in httpi.yaml; exit 0 = pass, 1 = assert failed, 2 = invalid file or usage, 3 = curl or network error')
  .argument('[file]', 'test file (YAML or JSON); without it, runs the project in the closest httpi.yaml')
  .addOption(new Option('--reporter <format>', 'output format').choices(['pretty', 'junit']).default('pretty'))
  .option('--show-response', 'show response status, headers and body for each request (pretty reporter)')
  .option('--env <name>', 'environment from httpi.yaml or httpi.env.yaml')
  .option('--var <name=value>', 'set a variable; repeatable, wins over the environment', collectVar, {})
  .action((path: string | undefined, options: RunOptions) => finish(runCommand(path, options)));

program
  .command('init')
  .description('lay out a project: httpi.yaml, tests/, data/, a CI workflow and .gitignore entries (never replaces files)')
  .argument('[directory]', 'where to create the project', '.')
  .action((directory: string) => finish(initCommand(directory)));

program
  .command('validate')
  .description('check every file of the project without sending requests; exit 0 = valid, 2 = problems found')
  .option('--env <name>', 'environment to validate against (default: env.default)')
  .option('--var <name=value>', 'set a variable; repeatable', collectVar, {})
  .action((options: VariableOptions) => finish(validateCommand(options)));

const auth = program.command('auth').description('log in to the OAuth providers declared under "auth" in httpi.yaml');

auth
  .command('login')
  .description('authorization_code login in the browser (with PKCE); stores the token in .httpi/tokens.json')
  .argument('<name>', 'auth block of httpi.yaml')
  .option('--env <name>', 'environment used to resolve the variables of the auth block')
  .option('--var <name=value>', 'set a variable; repeatable', collectVar, {})
  .action((name: string, options: VariableOptions) => finish(authLoginCommand(name, options)));

auth
  .command('add')
  .description('answer a few questions and add an OAuth 2.0 block to httpi.yaml (secrets are saved as ${VARIABLE} names)')
  .action(() => finish(authAddCommand()));

auth
  .command('status')
  .description('show each auth block and whether its login is still valid (never prints tokens)')
  .action(() => finish(authStatusCommand()));

program
  .command('import')
  .description('turn a pasted curl command (Bash, cmd or PowerShell) into a test file, or a Postman collection or OpenAPI 3 document into a project')
  .argument('[source-file]', 'file with the curl command, the collection or the OpenAPI document; without it, read from stdin')
  .addOption(new Option('--from <format>', 'what the source is (default: detected)').choices(IMPORT_SOURCES))
  .addOption(new Option('--dialect <shell>', 'curl only: shell the command was written for (default: detected)').choices(DIALECTS))
  .option('-o, --output <path>', 'curl: write the test file here instead of printing it; Postman/OpenAPI: project directory (tests go in <path>/tests)')
  .option('--name <name>', 'curl only: name of the test (default: method and path)')
  .option('--environment <file>', 'Postman only: environment export whose variables become an environment of httpi.yaml')
  .option('--keep-secrets', 'keep Authorization and Cookie values in the files instead of {{variables}}')
  .option('--pick', 'choose the source file in a file browser (interactive terminal)')
  .action((sourceFile: string | undefined, options: ImportOptions) => finish(importCommand(sourceFile, options)));

program
  .command('export')
  .description('export requests as curl scripts (assertions are not exported; output includes resolved secrets)')
  .argument('<file>', 'test file (YAML or JSON); exports every request in order')
  .addOption(new Option('--dialect <shell>', 'bash command, cmd batch file, or PowerShell 7.3+ script').choices(DIALECTS).default('bash'))
  .option('--env <name>', 'environment from httpi.env.yaml')
  .option('--var <name=value>', 'set a variable; repeatable, wins over the environment', collectVar, {})
  .action((path: string, options: ExportOptions) => finish(exportCommand(path, options)));

program
  .command('new')
  .description('create a test file interactively: add requests in order, select assertions and save one YAML')
  .argument('[file]', 'new YAML destination (never overwrites an existing file)', 'httpi.test.yaml')
  .option('--name <name>', 'test name for one request, or file title for multiple requests')
  .action((path: string, options: { name?: string }) => finish(newCommand(path, options)));

await program.parseAsync();
