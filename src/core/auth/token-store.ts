import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { TestFileError } from '../file.js';

const storedTokenSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1).optional(),
  /** Epoch milliseconds; absent when the provider did not say when the token expires. */
  expiresAt: z.number().optional(),
});

const storeSchema = z.record(z.string(), storedTokenSchema);

export type StoredToken = z.infer<typeof storedTokenSchema>;

/** Where the logins of a project live: next to httpi.yaml, in a directory `httpi init` keeps out of git. */
export function tokenStorePath(projectPath: string): string {
  return join(dirname(resolve(projectPath)), '.httpi', 'tokens.json');
}

/** A token is used until 30 seconds before it expires, so it does not die in the middle of a run. */
export function isUsable(token: StoredToken, now: number = Date.now()): boolean {
  return token.expiresAt === undefined || token.expiresAt - 30_000 > now;
}

export async function readStoredTokens(path: string): Promise<Record<string, StoredToken>> {
  if (!existsSync(path)) return {};
  try {
    return storeSchema.parse(JSON.parse(await readFile(path, 'utf8')));
  } catch {
    // Never quote the content: it holds tokens.
    throw new TestFileError(`${path}: the token store is damaged; delete it and log in again with "httpi auth login <name>"`);
  }
}

/** Saves the login of one auth block, readable only by the current user where the system allows it. */
export async function saveStoredToken(path: string, name: string, token: StoredToken): Promise<void> {
  const tokens = { ...(await readStoredTokens(path)), [name]: token };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(tokens, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600); // the mode above only applies when the file is created
}
