#!/usr/bin/env node
import { Command, InvalidArgumentError } from 'commander';
import { readEnvironment, readTestFile, TestFileError } from './core/file.js';
import { formatPretty } from './core/reporter/pretty.js';
import { EXIT, type ExitCode, exitCodeFor, runTestFile } from './core/run.js';
import { detectCurl } from './core/runner/detect.js';
import { CurlUnavailableError } from './core/runner/exec.js';
import { resolveVars, UnresolvedVariableError } from './core/vars.js';

type RunOptions = { env?: string; var: Record<string, string> };

async function runCommand(path: string, options: RunOptions): Promise<ExitCode> {
  const file = resolveVars(await readTestFile(path), {
    cli: options.var,
    system: process.env,
    file: options.env === undefined ? {} : await readEnvironment(path, options.env),
  });
  const curl = await detectCurl();
  const outcomes = await runTestFile(file, curl.bin);
  const color = process.stdout.isTTY === true && !process.env.NO_COLOR;
  process.stdout.write(`${formatPretty(file.name, outcomes, { color })}\n`);
  return exitCodeFor(outcomes);
}

function exitCodeForError(error: unknown): ExitCode {
  if (error instanceof TestFileError || error instanceof UnresolvedVariableError) return EXIT.invalid;
  if (error instanceof CurlUnavailableError) return EXIT.curl;
  throw error;
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
  .option('--env <name>', 'environment from httpi.env.yaml')
  .option('--var <name=value>', 'set a variable; repeatable, wins over the environment', collectVar, {})
  .action(async (path: string, options: RunOptions) => {
    try {
      process.exitCode = await runCommand(path, options);
    } catch (error) {
      process.exitCode = exitCodeForError(error);
      process.stderr.write(`httpi: ${(error as Error).message}\n`);
    }
  });

await program.parseAsync();
