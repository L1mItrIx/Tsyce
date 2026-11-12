#!/usr/bin/env node
// Hook PreToolUse(Bash): bloquea `git push` si `npm run check` falla.
// Sale 0 = permitir, 2 = bloquear (stderr se le muestra al agente).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

let input = {};
try {
  input = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  process.exit(0);
}

const command = input?.tool_input?.command ?? '';
if (!/\bgit\b[^|;&\n]*\bpush\b/.test(command)) process.exit(0);

const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
const pkgPath = join(root, 'package.json');
if (!existsSync(pkgPath)) process.exit(0); // aún no hay proyecto Node

let scripts = {};
try {
  scripts = JSON.parse(readFileSync(pkgPath, 'utf8')).scripts ?? {};
} catch {
  console.error('pre-push: package.json no es JSON válido; arréglalo antes de subir.');
  process.exit(2);
}
if (!scripts.check) {
  console.error('pre-push: falta el script "check" en package.json (typecheck + test + build). Créalo antes de subir.');
  process.exit(2);
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const res = spawnSync(npm, ['run', 'check'], {
  cwd: root,
  encoding: 'utf8',
  shell: process.platform === 'win32',
});
if (res.status === 0) process.exit(0);

const out = `${res.stdout ?? ''}\n${res.stderr ?? ''}`.trim().split('\n').slice(-60).join('\n');
console.error(`pre-push: \`npm run check\` falló; push bloqueado. Corrige y vuelve a intentar.\n\n${out}`);
process.exit(2);
