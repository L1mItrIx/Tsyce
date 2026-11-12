#!/usr/bin/env node
import { Command } from 'commander';
import { readTestFile, TestFileError } from './core/file.js';
import { formatPretty } from './core/reporter/pretty.js';
import { EXIT, type ExitCode, exitCodeFor, runTestFile } from './core/run.js';
import { detectCurl } from './core/runner/detect.js';
import { CurlUnavailableError } from './core/runner/exec.js';

async function runCommand(path: string): Promise<ExitCode> {
  const file = await readTestFile(path);
  const curl = await detectCurl();
  const outcomes = await runTestFile(file, curl.bin);
  const color = process.stdout.isTTY === true && !process.env.NO_COLOR;
  process.stdout.write(`${formatPretty(file.name, outcomes, { color })}\n`);
  return exitCodeFor(outcomes);
}

function exitCodeForError(error: unknown): ExitCode {
  if (error instanceof TestFileError) return EXIT.invalid;
  if (error instanceof CurlUnavailableError) return EXIT.curl;
  throw error;
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
  .action(async (path: string) => {
    try {
      process.exitCode = await runCommand(path);
    } catch (error) {
      process.exitCode = exitCodeForError(error);
      process.stderr.write(`httpi: ${(error as Error).message}\n`);
    }
  });

await program.parseAsync();
