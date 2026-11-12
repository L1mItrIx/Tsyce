/** User values come from cli, system, local, file, in that order; reserved runtime captures take precedence. */
export type VarSources = {
  /** `--var name=value` */
  cli: Record<string, string>;
  /** System environment; the only source for `${NAME}`. */
  system: Record<string, string | undefined>;
  /** httpi.local.yaml: personal values, below the system and above the shared environment. */
  local?: Record<string, string>;
  /** The selected environment of httpi.yaml or httpi.env.yaml. */
  file: Record<string, string>;
  /** Captured values reserved by the current flow; undefined prevents stale fallback. */
  runtime?: Record<string, string | undefined>;
  /** The current row of a data file; the only source for `{{data.<column>}}`. */
  data?: Record<string, string>;
};

const DATA_PREFIX = 'data.';

function lookup(name: string, sources: VarSources): string | undefined {
  if (name.startsWith(DATA_PREFIX)) return sources.data?.[name.slice(DATA_PREFIX.length)];
  if (sources.runtime && Object.hasOwn(sources.runtime, name)) return sources.runtime[name];
  return sources.cli[name] ?? sources.system[name] ?? sources.local?.[name] ?? sources.file[name];
}

export class UnresolvedVariableError extends Error {
  override name = 'UnresolvedVariableError';

  constructor(readonly references: string[]) {
    super(`unresolved variable${references.length === 1 ? '' : 's'}: ${references.join(', ')}`);
  }
}

// {{ name }} or ${NAME}
const REFERENCE = /\{\{\s*([A-Za-z_][\w.-]*)\s*\}\}|\$\{([A-Za-z_]\w*)\}/g;

function substitute(text: string, sources: VarSources, unresolved: Set<string>): string {
  return text.replace(REFERENCE, (reference, name: string | undefined, systemName: string | undefined) => {
    const value = name !== undefined ? lookup(name, sources) : sources.system[systemName as string];
    if (value === undefined) unresolved.add(reference);
    return value ?? reference;
  });
}

function walk(value: unknown, sources: VarSources, unresolved: Set<string>): unknown {
  if (typeof value === 'string') return substitute(value, sources, unresolved);
  if (Array.isArray(value)) return value.map((item) => walk(item, sources, unresolved));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walk(item, sources, unresolved)]));
  }
  return value;
}

/**
 * Replaces `{{name}}` and `${NAME}` in every string value of `model` (object keys are left alone).
 * Throws one UnresolvedVariableError naming every reference that has no value.
 */
export function resolveVars<T>(model: T, sources: VarSources): T {
  const unresolved = new Set<string>();
  const resolved = walk(model, sources, unresolved) as T;
  if (unresolved.size > 0) throw new UnresolvedVariableError([...unresolved]);
  return resolved;
}
