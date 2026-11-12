import type { RequestSpec } from '../schema.js';

function hasHeader(headers: RequestSpec['headers'], name: string): boolean {
  return Object.keys(headers).some((key) => key.toLowerCase() === name);
}

/** Request-specific curl arguments, without the output plumbing that exec.ts adds. */
export function buildCurlArgs(request: RequestSpec): string[] {
  const { method, headers, body } = request;
  const args: string[] = [];

  // Passing --request for the method curl already implies would force it across redirects.
  const impliedMethod = body === undefined ? 'GET' : 'POST';
  if (method === 'HEAD' && body === undefined) args.push('--head');
  else if (method !== impliedMethod) args.push('--request', method);

  for (const [name, value] of Object.entries(headers)) {
    // curl only sends a header with an empty value when written as "Name;".
    args.push('--header', value === '' ? `${name};` : `${name}: ${value}`);
  }

  if (body !== undefined) {
    if ('json' in body && !hasHeader(headers, 'content-type')) {
      args.push('--header', 'Content-Type: application/json');
    }
    if ('form' in body) for (const field of body.form) args.push('--form', field);
    else args.push('--data-raw', 'json' in body ? JSON.stringify(body.json) : body.text);
  }

  if (request.followRedirects) args.push('--location');
  if (request.insecure) args.push('--insecure');
  if (request.compressed) args.push('--compressed');
  if (request.timeoutMs !== undefined) args.push('--max-time', String(request.timeoutMs / 1000));

  // --globoff keeps []{} in the URL literal; --url keeps a leading "-" from being read as a flag.
  args.push('--globoff', '--url', request.url);
  return args;
}
