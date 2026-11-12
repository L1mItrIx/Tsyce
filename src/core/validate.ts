import { existsSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { authNamesUsed, checkAuthReferences } from './auth/oauth.js';
import { type DataRow, readDataFile, readTestRows } from './data.js';
import { formFilePaths, readTestFile } from './file.js';
import { extractSecrets } from './importer/map-flags.js';
import { expandRun, projectEnvironment, readLocalValues, readProjectFile } from './project.js';
import { type RunItem, validateRunVariables } from './run.js';
import { resolveVars, UnresolvedVariableError, type VarSources } from './vars.js';

export type Problem = { file: string; message: string };

export type ValidationResult = { problems: Problem[]; files: number; tests: number };

export type ValidateOptions = { env?: string; cli: Record<string, string>; system: VarSources['system'] };

const hasVariable = (text: string) => text.includes('{{') || text.includes('${');

/**
 * Checks a whole project without sending any request, and reports every problem it finds
 * instead of stopping at the first one. Meant for pull requests.
 */
export async function validateProject(projectPath: string, options: ValidateOptions): Promise<ValidationResult> {
  const root = dirname(resolve(projectPath));
  const label = (path: string) => relative(root, path).replaceAll('\\', '/') || path;
  const problems: Problem[] = [];
  /** Adds a problem once, even when the same file is listed twice in `run:`. */
  const report = (file: string, message: string) => {
    const problem = { file: label(file), message };
    if (!problems.some((known) => known.file === problem.file && known.message === message)) problems.push(problem);
  };
  /** Runs one check; a failure becomes a problem of `file` and the check yields undefined. */
  const attempt = async <T>(file: string, check: () => T | Promise<T>): Promise<T | undefined> => {
    try {
      return await check();
    } catch (error) {
      // Errors start with the path of the file they are about; show every path relative to the project.
      report(file, (error as Error).message.replace(`${file}: `, '').replaceAll(`${root}${sep}`, ''));
      return undefined;
    }
  };

  const project = await attempt(projectPath, () => readProjectFile(projectPath));
  if (project === undefined) return { problems, files: 0, tests: 0 };
  const environment = await attempt(projectPath, () => projectEnvironment(project, projectPath, options.env));
  const local = await attempt(projectPath, () => readLocalValues(projectPath));
  const targets = (await attempt(projectPath, () => expandRun(project, projectPath))) ?? [];

  const items: RunItem[] = [];
  let tests = 0;
  for (const target of targets) {
    const file = await attempt(target.file, () => readTestFile(target.file));
    if (file === undefined) continue;
    tests += file.tests.length;
    const baseDir = dirname(target.file);

    for (const test of file.tests) {
      for (const path of formFilePaths(test.request, baseDir)) {
        if (!hasVariable(path) && !existsSync(path)) {
          report(target.file, `test "${test.name}": multipart file ${label(path)} does not exist`);
        }
      }
      for (const secret of extractSecrets(test.request).secrets) {
        report(target.file, `test "${test.name}": the ${secret.header} header holds a literal credential; use a variable such as {{${secret.variable}}}`);
      }
    }

    for (const problem of checkAuthReferences(file, project.auth)) report(target.file, problem);
    const testRows = await attempt(target.file, () => readTestRows(file, target.file));
    let rows: Array<DataRow | undefined> = [undefined];
    if (target.data !== undefined) {
      const data = target.data;
      rows = (await attempt(data, () => readDataFile(data))) ?? [];
    }
    if (testRows !== undefined) for (const row of rows) items.push({ file, testRows, ...(row !== undefined && { row }) });
  }

  if (environment !== undefined && local !== undefined) {
    try {
      validateRunVariables(items, { cli: options.cli, system: options.system, local, file: environment.variables });
    } catch (error) {
      if (!(error instanceof UnresolvedVariableError)) throw error;
      // ${NAME} comes from the system (CI secrets); validation cannot know the machine it will run on.
      const missing = error.references.filter((reference) => !reference.startsWith('${'));
      if (missing.length > 0) report(projectPath, new UnresolvedVariableError(missing).message);
    }
    // The auth blocks the tests use must resolve too (again, ${NAME} is left to the machine that runs them).
    const sources = { cli: options.cli, system: options.system, local, file: environment.variables };
    for (const name of authNamesUsed(items.map((item) => item.file))) {
      const config = project.auth?.[name];
      if (config === undefined) continue;
      try {
        resolveVars(config, sources);
      } catch (error) {
        if (!(error instanceof UnresolvedVariableError)) throw error;
        const missing = error.references.filter((reference) => !reference.startsWith('${'));
        if (missing.length > 0) report(projectPath, `auth "${name}": ${new UnresolvedVariableError(missing).message}`);
      }
    }
  }
  return { problems, files: targets.length, tests };
}
