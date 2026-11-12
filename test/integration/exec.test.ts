import { readdirSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { detectCurl } from '../../src/core/runner/detect.js';
import { runRequest } from '../../src/core/runner/exec.js';
import { requestSchema } from '../../src/core/schema.js';

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.setEncoding('utf8').on('data', (chunk: string) => (data += chunk));
    req.on('end', () => resolve(data));
  });
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.url === '/echo') {
    const body = await readBody(req);
    res.writeHead(200, { 'Content-Type': 'application/json', 'X-Multi': ['a', 'b'] });
    res.end(JSON.stringify({ method: req.method, contentType: req.headers['content-type'], trace: req.headers['x-trace'], body }));
    return;
  }
  if (req.url === '/redirect') {
    res.writeHead(302, { Location: '/landed', 'X-Hop': 'first' });
    res.end();
    return;
  }
  if (req.url === '/landed') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('landed');
    return;
  }
  if (req.url === '/slow') {
    return; // never answers; the test relies on curl's own timeout
  }
  if (req.url === '/head') {
    res.writeHead(200, { 'X-Probe': 'yes', 'Content-Length': '5' });
    res.end(req.method === 'HEAD' ? undefined : 'hello');
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
}

let server: Server;
let baseUrl: string;
let curlBin: string;

beforeAll(async () => {
  curlBin = (await detectCurl()).bin;
  server = createServer((req, res) => void handle(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

const run = (input: Record<string, unknown>) => runRequest(curlBin, requestSchema.parse(input));
const httpiTempDirs = () => readdirSync(tmpdir()).filter((name) => name.startsWith('httpi-'));

test('200 with JSON: status, headers, body and timing come back', async () => {
  const before = httpiTempDirs();
  const result = await run({
    method: 'POST',
    url: `${baseUrl}/echo`,
    headers: { 'X-Trace': 'abc 123' },
    body: { json: { name: 'Ana', tags: ['a', "it's"] } },
  });

  expect(result.error).toBeNull();
  expect(result.curlExitCode).toBe(0);
  expect(result.status).toBe(200);
  expect(result.timeMs).toBeGreaterThanOrEqual(0);
  expect(result.headers['content-type']).toEqual(['application/json']);
  expect(result.headers['x-multi']).toEqual(['a', 'b']);
  expect(JSON.parse(result.body)).toEqual({
    method: 'POST',
    contentType: 'application/json',
    trace: 'abc 123',
    body: '{"name":"Ana","tags":["a","it\'s"]}',
  });
  expect(httpiTempDirs()).toEqual(before);
});

test('404 is a response, not a curl error', async () => {
  const result = await run({ url: `${baseUrl}/missing` });
  expect(result).toMatchObject({ status: 404, body: 'not found', curlExitCode: 0, error: null });
});

test('closed port: status 0, curl exit code 7 and a readable error', async () => {
  const closed = createServer();
  await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
  const { port } = closed.address() as AddressInfo;
  await new Promise((resolve) => closed.close(resolve));

  const result = await run({ url: `http://127.0.0.1:${port}/` });
  expect(result).toMatchObject({ status: 0, body: '', headers: {}, curlExitCode: 7 });
  expect(result.error).toMatch(/connect/i);
});

test('timeout: timeoutMs stops curl with exit code 28', async () => {
  const result = await run({ url: `${baseUrl}/slow`, timeoutMs: 300 });
  expect(result).toMatchObject({ status: 0, curlExitCode: 28 });
  expect(result.error).toMatch(/timed out/i);
  expect(result.timeMs).toBeGreaterThanOrEqual(250);
  expect(result.timeMs).toBeLessThan(5000);
});

test('redirect is not followed by default', async () => {
  const result = await run({ url: `${baseUrl}/redirect` });
  expect(result.status).toBe(302);
  expect(result.headers['location']).toEqual(['/landed']);
});

test('followRedirects reports the final response only', async () => {
  const result = await run({ url: `${baseUrl}/redirect`, followRedirects: true });
  expect(result).toMatchObject({ status: 200, body: 'landed', error: null });
  expect(result.headers['x-hop']).toBeUndefined();
});

test('HEAD returns headers and an empty body without hanging', async () => {
  const result = await run({ method: 'HEAD', url: `${baseUrl}/head`, timeoutMs: 5000 });
  expect(result).toMatchObject({ status: 200, body: '', curlExitCode: 0, error: null });
  expect(result.headers['x-probe']).toEqual(['yes']);
});
