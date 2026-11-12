import { existsSync } from 'node:fs';
import { glob } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { ENV_FILE_NAME, parseWith, readEnvironment, readTextFile, TestFileError } from './file.js';
import { type ProjectFile, projectFileSchema } from './schema.js';

export const PROJECT_FILE_NAME = 'httpi.yaml';

/** The closest httpi.yaml, looking in `startDir` and then in each parent directory. */
export function findProjectFile(startDir: string): string | null {
  let dir = resolve(startDir);
  for (;;) {
    const candidate = join(dir, PROJECT_FILE_NAME);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export async function readProjectFile(path: string): Promise<ProjectFile> {
  return parseWith(projectFileSchema, await readTextFile(path), path, 'project file');
}

const isPattern = (path: string) => /[*?[\]{}]/.test(path);

/**
 * The test files of `run:` as absolute paths, in the order they must run: entries keep their
 * order, and the matches of a pattern are sorted by name. Paths are relative to the project file.
 */
export async function expandRun(project: ProjectFile, projectPath: string): Promise<string[]> {
  const root = dirname(resolve(projectPath));
  const files: string[] = [];
  for (const entry of project.run) {
    const file = typeof entry === 'string' ? entry : entry.file;
    if (!isPattern(file)) {
      const path = resolve(root, file);
      if (!existsSync(path)) throw new TestFileError(`${projectPath}: run entry "${file}" does not exist`);
      files.push(path);
      continue;
    }
    const matches: string[] = [];
    for await (const match of glob(file, { cwd: root })) matches.push(resolve(root, match));
    if (matches.length === 0) throw new TestFileError(`${projectPath}: run pattern "${file}" matches no files`);
    files.push(...matches.sort());
  }
  return files;
}

/**
 * Variables of the environment a project run uses: `--env`, or else `env.default`.
 * A project without an `env` block still reads the older httpi.env.yaml next to it.
 */
export async function projectEnvironment(
  project: ProjectFile,
  projectPath: string,
  envName: string | undefined,
): Promise<{ variables: Record<string, string>; warnings: string[] }> {
  if (project.env === undefined) {
    return { variables: envName === undefined ? {} : await readEnvironment(projectPath, envName), warnings: [] };
  }
  const warnings = existsSync(join(dirname(resolve(projectPath)), ENV_FILE_NAME))
    ? [`${ENV_FILE_NAME} is ignored: ${PROJECT_FILE_NAME} declares the environments`]
    : [];
  const name = envName ?? project.env.default;
  if (name === undefined) return { variables: {}, warnings };
  const variables = project.env.environments[name];
  if (variables === undefined) {
    const available = Object.keys(project.env.environments).join(', ') || '(none)';
    throw new TestFileError(`${projectPath}: no environment "${name}"; available: ${available}`);
  }
  return { variables, warnings };
}
