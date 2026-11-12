import { useEffect, useReducer, useRef } from 'react';
import { Box, render, Text, useInput } from 'ink';
import { type AuthConfig, authSchema } from '../core/schema.js';

export const AUTH_FLOWS = ['client_credentials', 'authorization_code', 'refresh_token'] as const;
type Flow = (typeof AUTH_FLOWS)[number];

const FLOW_HINTS: Record<Flow, string> = {
  client_credentials: 'for CI: the app logs in as itself with a client id and secret',
  authorization_code: 'for you at your machine: log in once in the browser (httpi auth login)',
  refresh_token: 'for CI on behalf of a user: a long-lived refresh token from a variable',
};

type Field = 'name' | 'flow' | 'tokenUrl' | 'authorizationUrl' | 'clientId' | 'secretVariable' | 'refreshVariable' | 'scopes' | 'redirectPort';

const FIELDS: Record<Field, { label: string; hint: string; fallback: string }> = {
  name: { label: 'Name of this auth block', hint: 'Tests use it as "auth: <name>".', fallback: 'main' },
  flow: { label: 'OAuth 2.0 flow', hint: 'Use ↑/↓ to choose.', fallback: '' },
  tokenUrl: { label: 'Token URL', hint: 'Variables are fine, e.g. {{baseUrl}}/oauth/token', fallback: '' },
  authorizationUrl: { label: 'Authorization URL', hint: 'The page where the person logs in.', fallback: '' },
  clientId: { label: 'Client id', hint: 'A literal id or a variable such as ${CLIENT_ID}.', fallback: '' },
  secretVariable: { label: 'Environment variable that holds the client secret', hint: 'Only its name is saved, as ${NAME}; never type the secret here.', fallback: 'CLIENT_SECRET' },
  refreshVariable: { label: 'Environment variable that holds the refresh token', hint: 'Only its name is saved, as ${NAME}.', fallback: 'REFRESH_TOKEN' },
  scopes: { label: 'Scopes (separated by spaces; empty for none)', hint: '', fallback: '' },
  redirectPort: { label: 'Local callback port', hint: 'Register http://127.0.0.1:<port>/callback with the provider.', fallback: '8787' },
};

/** The questions each flow needs, in order. */
export function fieldsFor(flow: Flow): Field[] {
  const common: Field[] = ['name', 'flow', 'tokenUrl'];
  if (flow === 'client_credentials') return [...common, 'clientId', 'secretVariable', 'scopes'];
  if (flow === 'refresh_token') return [...common, 'clientId', 'secretVariable', 'refreshVariable', 'scopes'];
  return [...common, 'authorizationUrl', 'clientId', 'secretVariable', 'scopes', 'redirectPort'];
}

export type AuthWizardResult = { name: string; block: AuthConfig };

export type AuthWizardState = {
  step: Field | 'review' | 'done' | 'cancelled';
  flow: Flow;
  values: Partial<Record<Field, string>>;
  input: string;
  error: string | null;
  /** Names already used in httpi.yaml. */
  taken: string[];
};

export type AuthWizardAction =
  | { type: 'input'; value: string }
  | { type: 'move'; direction: -1 | 1 }
  | { type: 'next' }
  | { type: 'back' }
  | { type: 'cancel' };

export function createAuthWizardState(taken: string[] = []): AuthWizardState {
  return { step: 'name', flow: 'client_credentials', values: {}, input: '', error: null, taken };
}

const VARIABLE_NAME = /^[A-Za-z_]\w*$/;

/** A public client is allowed everywhere except client_credentials, which is nothing without a secret. */
const secretOptional = (flow: Flow) => flow !== 'client_credentials';

/** What an empty answer means. An optional client secret has no default: empty is a public client. */
export function fallbackFor(field: Field, flow: Flow): string {
  return field === 'secretVariable' && secretOptional(flow) ? '' : FIELDS[field].fallback;
}

function validate(field: Field, value: string, state: AuthWizardState): string | null {
  if (field === 'name') {
    if (!/^[A-Za-z_][\w-]*$/.test(value)) return 'Use a simple name: letters, digits, "_" or "-".';
    if (state.taken.includes(value)) return `httpi.yaml already has an auth block named "${value}".`;
  }
  if ((field === 'tokenUrl' || field === 'authorizationUrl' || field === 'clientId') && value === '') return 'This value is required.';
  if (field === 'secretVariable' && value === '' && secretOptional(state.flow)) return null;
  if ((field === 'secretVariable' || field === 'refreshVariable') && !VARIABLE_NAME.test(value)) {
    return 'Type the NAME of an environment variable (letters, digits, "_"), not the secret itself.';
  }
  if (field === 'redirectPort' && !(/^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 65535)) return 'Type a port between 1 and 65535.';
  return null;
}

/** The auth block the answers describe. Secrets are always `${VARIABLE}` references. */
export function buildAuthBlock(state: AuthWizardState): AuthWizardResult {
  const value = (field: Field) => state.values[field] ?? '';
  const scopes = value('scopes').split(/\s+/).filter(Boolean);
  const block = authSchema.parse({
    type: 'oauth2',
    flow: state.flow,
    tokenUrl: value('tokenUrl'),
    ...(state.flow === 'authorization_code' && { authorizationUrl: value('authorizationUrl') }),
    clientId: value('clientId'),
    ...(value('secretVariable') !== '' && { clientSecret: `\${${value('secretVariable')}}` }),
    ...(state.flow === 'refresh_token' && { refreshToken: `\${${value('refreshVariable')}}` }),
    ...(scopes.length > 0 && { scopes }),
    ...(state.flow === 'authorization_code' && { redirectPort: Number(value('redirectPort')) }),
  });
  return { name: value('name'), block };
}

export function authWizardReducer(state: AuthWizardState, action: AuthWizardAction): AuthWizardState {
  if (action.type === 'cancel') return { ...state, step: 'cancelled' };
  if (state.step === 'done' || state.step === 'cancelled') return state;
  const fields = fieldsFor(state.flow);

  if (action.type === 'input') return state.step === 'review' || state.step === 'flow' ? state : { ...state, input: action.value, error: null };
  if (action.type === 'move') {
    if (state.step !== 'flow') return state;
    const index = (AUTH_FLOWS.indexOf(state.flow) + action.direction + AUTH_FLOWS.length) % AUTH_FLOWS.length;
    return { ...state, flow: AUTH_FLOWS[index] as Flow };
  }
  if (action.type === 'back') {
    const index = state.step === 'review' ? fields.length : fields.indexOf(state.step);
    if (index <= 0) return state;
    const previous = fields[index - 1] as Field;
    return { ...state, step: previous, input: state.values[previous] ?? '', error: null };
  }

  // next
  if (state.step === 'review') return { ...state, step: 'done' };
  const field = state.step;
  const value = field === 'flow' ? state.flow : state.input.trim() || fallbackFor(field, state.flow);
  const error = validate(field, value, state);
  if (error !== null) return { ...state, error };
  const values = { ...state.values, [field]: value };
  const next = fields[fields.indexOf(field) + 1];
  return { ...state, values, step: next ?? 'review', input: next === undefined ? '' : (values[next] ?? ''), error: null };
}

export type AuthWizardProps = { taken?: string[]; onComplete: (result: AuthWizardResult) => void; onCancel: () => void };

export function AuthWizard({ taken = [], onComplete, onCancel }: AuthWizardProps) {
  const [state, dispatch] = useReducer(authWizardReducer, taken, createAuthWizardState);
  const notified = useRef(false);
  useEffect(() => {
    if (notified.current) return;
    if (state.step === 'done') { notified.current = true; onComplete(buildAuthBlock(state)); }
    if (state.step === 'cancelled') { notified.current = true; onCancel(); }
  }, [state, onComplete, onCancel]);

  useInput((input, key) => {
    if (key.ctrl && input === 'c') dispatch({ type: 'cancel' });
    else if (key.escape || (key.tab && key.shift)) dispatch({ type: 'back' });
    else if (key.upArrow || key.downArrow) dispatch({ type: 'move', direction: key.upArrow ? -1 : 1 });
    else if (key.return || key.tab) dispatch({ type: 'next' });
    else if (key.backspace || key.delete) dispatch({ type: 'input', value: Array.from(state.input).slice(0, -1).join('') });
    else if (!key.ctrl && !key.meta && input !== '' && !key.leftArrow && !key.rightArrow) dispatch({ type: 'input', value: state.input + input });
  });

  if (state.step === 'cancelled') return <Text>Cancelled.</Text>;
  if (state.step === 'done') return <Text>Auth block confirmed.</Text>;

  if (state.step === 'review') {
    const { name, block } = buildAuthBlock(state);
    return <Box flexDirection="column">
      <Text bold>Add this auth block to httpi.yaml?</Text>
      <Text>{name}:</Text>
      {Object.entries(block).map(([key, value]) => <Text key={key}>  {key}: {Array.isArray(value) ? value.join(' ') : String(value)}</Text>)}
      <Text dimColor>Enter: add · Esc: back · Ctrl+C: cancel</Text>
    </Box>;
  }

  const field = FIELDS[state.step];
  const fields = fieldsFor(state.flow);
  const fallback = fallbackFor(state.step, state.flow);
  const optionalSecret = state.step === 'secretVariable' && secretOptional(state.flow);
  return <Box flexDirection="column">
    <Text bold>New OAuth 2.0 auth block <Text dimColor>({fields.indexOf(state.step) + 1}/{fields.length})</Text></Text>
    <Text>{field.label}{fallback !== '' ? ` (default ${fallback})` : optionalSecret ? ' (empty for a public client)' : ''}</Text>
    {state.step === 'flow'
      ? AUTH_FLOWS.map((flow) => <Text key={flow}>{flow === state.flow ? '>' : ' '} {flow} <Text dimColor>— {FLOW_HINTS[flow]}</Text></Text>)
      : <Text>{'> '}{state.input}<Text inverse> </Text></Text>}
    {field.hint !== '' && <Text dimColor>{field.hint}</Text>}
    {state.error !== null && <Text color="red">{state.error}</Text>}
    <Text dimColor>Enter: next · Esc: back · Ctrl+C: cancel</Text>
  </Box>;
}

/** Runs the wizard in the terminal; null when the person cancels. */
export async function launchAuthWizard(taken: string[]): Promise<AuthWizardResult | null> {
  let instance: ReturnType<typeof render> | undefined;
  try {
    return await new Promise<AuthWizardResult | null>((resolve) => {
      instance = render(<AuthWizard taken={taken} onComplete={resolve} onCancel={() => resolve(null)} />,
        { stdout: process.stderr, exitOnCtrlC: false, patchConsole: false });
    });
  } finally {
    instance?.unmount();
    await instance?.waitUntilExit();
  }
}
