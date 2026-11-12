#!/usr/bin/env node
import { text } from 'node:stream/consumers';
import { existsSync } from 'node:fs';
import { Command, InvalidArgumentError, Option } from 'commander';
import { CurlExportError, exportCurl } from './core/exporter/curl.js';
import {
  defaultTestName,
  prepareWizardFile,
  readEnvironment,
  readTestFile,
  readTextFile,
  stringifyTestFile,
  TestFileError,
  writeTestFile,
} from './core/file.js';
import { type Dialect, DIALECTS, tokenizeCurl } from './core/importer/detect-dialect.js';
import { CurlImportError, extractSecrets, mapFlags } from './core/importer/map-flags.js';
import { ShellSyntaxError } from './core/importer/tokenize-bash.js';
import { formatPretty } from './core/reporter/pretty.js';
import { formatJUnit } from './core/reporter/junit.js';
import { EXIT, type ExitCode, exitCodeFor, runTestFile, validateRunVariables } from './core/run.js';
import { detectCurl } from './core/runner/detect.js';
import { CurlUnavailableError, runRequest } from './core/runner/exec.js';
import type { TestFile } from './core/schema.js';
import { resolveVars, UnresolvedVariableError } from './core/vars.js';

const say = (line: string) => process.stderr.write(`${line}\n`);

type VariableOptions = { env?: string; var: Record<string, string> };
type RunOptions = VariableOptions & { reporter: 'pretty' | 'junit'; showResponse?: true };

async function runCommand(path: string, options: RunOptions): Promise<ExitCode> {
  if (options.showResponse && options.reporter !== 'pretty') {
    throw new TestFileError('--show-response requires --reporter pretty; omit it when generating JUnit');
  }
  const file = await readTestFile(path);
  const sources = {
    cli: options.var,
    system: process.env,
    file: options.env === undefined ? {} : await readEnvironment(path, options.env),
  };
  validateRunVariables(file, sources);
  const title = resolveVars(file.name, sources);
  const curl = await detectCurl();
  const outcomes = await runTestFile(file, curl.bin, sources);
  const color = process.stdout.isTTY === true && !process.env.NO_COLOR;
  const report = options.reporter === 'junit' ? formatJUnit(title, outcomes) : formatPretty(title, outcomes, { color, showResponse: options.showResponse === true });
  process.stdout.write(`${report}\n`);
  return exitCodeFor(outcomes);
}

type ImportOptions = { dialect?: Dialect; output?: string; name?: string; keepSecrets?: true };

async function importCommand(curlFile: string | undefined, options: ImportOptions): Promise<ExitCode> {
  if (curlFile === undefined && process.stdin.isTTY) {
    say('Paste the curl command, then press Ctrl+D (on Windows: Ctrl+Z, then Enter).');
  }
  const pasted = curlFile === undefined ? await text(process.stdin) : await readTextFile(curlFile);

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

type ExportOptions = VariableOptions & { dialect: Dialect };

async function newCommand(path: string, options: { name?: string }): Promise<ExitCode> {
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    throw new TestFileError('httpi new requires an interactive terminal; use httpi import for piped input');
  }
  if (existsSync(path)) throw new TestFileError(`${path}: file already exists; choose a new destination`);
  const curl = await detectCurl();
  const { launchWizard } = await import('./tui/suite-wizard.js');
  const completed = await launchWizard((request, signal) => runRequest(curl.bin, request, signal));
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
    else if (error instanceof CurlUnavailableError) process.exitCode = EXIT.curl;
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
  .command('run')
  .description('run the tests in a file; exit 0 = pass, 1 = assert failed, 2 = invalid file or usage, 3 = curl or network error')
  .argument('<file>', 'test file (YAML or JSON)')
  .addOption(new Option('--reporter <format>', 'output format').choices(['pretty', 'junit']).default('pretty'))
  .option('--show-response', 'show response status, headers and body for each request (pretty reporter)')
  .option('--env <name>', 'environment from httpi.env.yaml')
  .option('--var <name=value>', 'set a variable; repeatable, wins over the environment', collectVar, {})
  .action((path: string, options: RunOptions) => finish(runCommand(path, options)));

program
  .command('import')
  .description('turn a pasted curl command (Bash, cmd or PowerShell) into a test file')
  .argument('[curl-file]', 'file with the curl command; without it the command is read from stdin')
  .addOption(new Option('--dialect <shell>', 'shell the command was written for (default: detected)').choices(DIALECTS))
  .option('-o, --output <file>', 'write the test file here instead of printing it')
  .option('--name <name>', 'name of the test (default: method and path)')
  .option('--keep-secrets', 'keep Authorization and Cookie values in the file instead of {{variables}}')
  .action((curlFile: string | undefined, options: ImportOptions) => finish(importCommand(curlFile, options)));

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
