import { existsSync } from 'node:fs';
import { glob, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { readDataFile, readTestRows } from './data.js';
import { ENV_FILE_NAME, parseWith, readEnvironment, readTestFile, readTextFile, TestFileError } from './file.js';
import type { RunItem } from './run.js';
import { resolveVars, type VarSources } from './vars.js';
import { type AuthConfig, localFileSchema, type ProjectFile, projectFileSchema } from './schema.js';
import { parseDocument, stringify } from 'yaml';

export const PROJECT_FILE_NAME = 'httpi.yaml';
export const LOCAL_FILE_NAME = 'httpi.local.yaml';

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

/** A test file to run and, when its `run:` entry has `data`, the data file to repeat it over. */
export type RunTarget = { file: string; data?: string };

/**
 * The test files of `run:` as absolute paths, in the order they must run: entries keep their
 * order, and the matches of a pattern are sorted by name. Paths are relative to the project file.
 */
export async function expandRun(project: ProjectFile, projectPath: string): Promise<RunTarget[]> {
  const root = dirname(resolve(projectPath));
  const targets: RunTarget[] = [];
  for (const entry of project.run) {
    const { file, data } = typeof entry === 'string' ? { file: entry } : entry;
    const withData = (path: string): RunTarget => ({ file: path, ...(data !== undefined && { data: resolve(root, data) }) });
    if (!isPattern(file)) {
      const path = resolve(root, file);
      if (!existsSync(path)) throw new TestFileError(`${projectPath}: run entry "${file}" does not exist`);
      targets.push(withData(path));
      continue;
    }
    const matches: string[] = [];
    for await (const match of glob(file, { cwd: root })) matches.push(resolve(root, match));
    if (matches.length === 0) throw new TestFileError(`${projectPath}: run pattern "${file}" matches no files`);
    targets.push(...matches.sort().map(withData));
  }
  return targets;
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

/** Personal values from httpi.local.yaml next to the project file; none when the file does not exist. */
export async function readLocalValues(projectPath: string): Promise<Record<string, string>> {
  const path = join(dirname(resolve(projectPath)), LOCAL_FILE_NAME);
  if (!existsSync(path)) return {};
  // An empty file is a valid YAML document without content.
  return parseWith(localFileSchema.nullable(), await readTextFile(path), path, 'local values file') ?? {};
}

/** Paths `httpi init` keeps out of git: local tokens, personal values and generated reports. */
const IGNORED = ['.httpi/', LOCAL_FILE_NAME, 'reports/'];

const WORKFLOW = `name: API tests
on:
  pull_request:
  workflow_dispatch:
permissions:
  contents: read
jobs:
  api:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      # Secrets reach the tests as environment variables: use them as \${NAME} in httpi.yaml.
      - run: npx --yes httpi-cli run
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: api-test-results
          path: reports/junit.xml
`;

const EXAMPLE_TEST = `version: 1
name: Example
tests:
  - name: the API answers
    request:
      url: '{{baseUrl}}/'
    expect:
      status: 200
`;

export type InitStep = { path: string; action: 'created' | 'updated' | 'kept' };

/**
 * Lays out a project in `dir`: httpi.yaml, a first test, tests/ and data/, a CI workflow and the
 * .gitignore entries. Existing files are never replaced; an existing httpi.yaml is an error.
 */
export async function initProject(dir: string): Promise<InitStep[]> {
  const root = resolve(dir);
  if (existsSync(join(root, PROJECT_FILE_NAME))) {
    throw new TestFileError(`${join(root, PROJECT_FILE_NAME)}: the project already exists; nothing was changed`);
  }
  const project: ProjectFile = {
    version: 1,
    name: basename(root),
    env: { default: 'dev', environments: { dev: { baseUrl: 'http://localhost:3000' } } },
    run: ['tests/*.yaml'],
    report: { junit: 'reports/junit.xml' },
  };
  const files: Array<[path: string, content: string]> = [
    [PROJECT_FILE_NAME, stringify(project, { lineWidth: 0 })],
    ['tests/example.yaml', EXAMPLE_TEST],
    ['data/.gitkeep', ''],
    ['.github/workflows/httpi.yml', WORKFLOW],
  ];
  const steps: InitStep[] = [];
  for (const [path, content] of files) {
    const full = join(root, path);
    if (existsSync(full)) { steps.push({ path, action: 'kept' }); continue; }
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content, { flag: 'wx' });
    steps.push({ path, action: 'created' });
  }

  const gitignore = join(root, '.gitignore');
  const current = existsSync(gitignore) ? await readFile(gitignore, 'utf8') : null;
  const present = new Set((current ?? '').split(/\r?\n/).map((line) => line.trim()));
  const missing = IGNORED.filter((entry) => !present.has(entry));
  if (missing.length > 0) {
    const separator = current === null || current === '' || current.endsWith('\n') ? '' : '\n';
    await writeFile(gitignore, `${current ?? ''}${separator}${missing.join('\n')}\n`);
  }
  steps.push({ path: '.gitignore', action: current === null ? 'created' : missing.length > 0 ? 'updated' : 'kept' });
  return steps;
}

/** What an importer found besides the tests: goes into httpi.yaml. */
export type ProjectAdditions = { name: string; auth: Record<string, AuthConfig>; environment?: { name: string; variables: Record<string, string> } };

/**
 * Puts the auth blocks and the environment of an import into `<dir>/httpi.yaml`: creates the
 * file when there is none, otherwise adds only what is not there yet (comments are kept).
 * Returns one line per thing it did or left alone.
 */
export async function mergeIntoProject(dir: string, additions: ProjectAdditions): Promise<string[]> {
  const projectPath = join(resolve(dir), PROJECT_FILE_NAME);
  const { auth, environment } = additions;
  if (!existsSync(projectPath)) {
    const project: ProjectFile = {
      version: 1,
      name: additions.name,
      ...(environment !== undefined && { env: { default: environment.name, environments: { [environment.name]: environment.variables } } }),
      ...(Object.keys(auth).length > 0 && { auth }),
      run: ['tests/*.yaml'],
    };
    await mkdir(dirname(projectPath), { recursive: true });
    await writeFile(projectPath, stringify(project, { lineWidth: 0 }), { flag: 'wx' });
    return [`created ${PROJECT_FILE_NAME}`];
  }

  const project = await readProjectFile(projectPath);
  const document = parseDocument(await readTextFile(projectPath));
  const notes: string[] = [];
  for (const [name, block] of Object.entries(auth)) {
    if (project.auth?.[name] !== undefined) notes.push(`${PROJECT_FILE_NAME} already has auth "${name}"; it was not changed`);
    else {
      document.setIn(['auth', name], document.createNode(block));
      notes.push(`added auth "${name}" to ${PROJECT_FILE_NAME}`);
    }
  }
  if (environment !== undefined) {
    if (project.env?.environments[environment.name] !== undefined) notes.push(`${PROJECT_FILE_NAME} already has environment "${environment.name}"; it was not changed`);
    else {
      document.setIn(['env', 'environments', environment.name], document.createNode(environment.variables));
      notes.push(`added environment "${environment.name}" to ${PROJECT_FILE_NAME}`);
    }
  }
  if (notes.some((note) => note.startsWith('added'))) await writeFile(projectPath, document.toString({ lineWidth: 0 }));
  return notes;
}

/** Adds an auth block to httpi.yaml, keeping the rest of the file (comments included) as it is. */
export async function addAuthBlock(projectPath: string, name: string, block: AuthConfig): Promise<void> {
  const project = await readProjectFile(projectPath);
  if (project.auth?.[name] !== undefined) throw new TestFileError(`${projectPath}: there is already an auth block named "${name}"`);
  const document = parseDocument(await readTextFile(projectPath));
  document.setIn(['auth', name], document.createNode(block));
  await writeFile(projectPath, document.toString({ lineWidth: 0 }));
}

/** One item of a project run, with the title it gets in reports. */
export type ProjectRunItem = RunItem & { title: string; path: string };

/**
 * Reads every file `run:` lists, as the items of one run: a file per item, or one item per row
 * when its run entry repeats it over a data file. Titles are the file's name, or its path.
 */
export async function loadProjectRun(project: ProjectFile, projectPath: string, sources: VarSources): Promise<ProjectRunItem[]> {
  const items: ProjectRunItem[] = [];
  for (const target of await expandRun(project, projectPath)) {
    const file = await readTestFile(target.file);
    const testRows = await readTestRows(file, target.file);
    const title = resolveVars(file.name, sources) ?? relative(dirname(projectPath), target.file).replaceAll('\\', '/');
    const base = { file, baseDir: dirname(target.file), testRows, path: target.file };
    if (target.data === undefined) items.push({ ...base, title });
    else for (const [index, row] of (await readDataFile(target.data)).entries()) items.push({ ...base, row, title: `${title} [row ${index + 1}]` });
  }
  return items;
}
