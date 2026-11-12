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
