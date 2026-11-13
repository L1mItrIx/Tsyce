import { createServer } from 'node:http';
let authToken = '';
let issued = 0;
let oauthToken = '';
let oauthIssued = 0;

// Demo OAuth client for examples/proyecto: client_credentials with HTTP Basic.
const DEMO_CLIENT = `Basic ${Buffer.from('demo-client:demo-secret').toString('base64')}`;

const server = createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const user = /^\/users\/(\d+)$/.exec(req.url ?? '');
  if (req.method === 'GET' && req.url === '/users') {
    res.end(JSON.stringify({ users: [{ id: 1, name: 'Ana' }] }));
  } else if (req.method === 'GET' && user) {
    res.end(JSON.stringify({ id: Number(user[1]), name: 'Ana' }));
  } else if (req.method === 'GET' && req.url === '/private/users') {
    if (!authToken || req.headers.authorization !== `Bearer ${authToken}`) {
      res.writeHead(401); res.end(JSON.stringify({ error: 'Log in first and send the captured Bearer token' }));
    } else res.end(JSON.stringify({ users: [{ id: 1, name: 'Ana' }] }));
  } else if (req.method === 'GET' && req.url === '/admin/stats') {
    if (!oauthToken || req.headers.authorization !== `Bearer ${oauthToken}`) {
      res.writeHead(401); res.end(JSON.stringify({ error: 'Send the OAuth access token from /oauth/token' }));
    } else res.end(JSON.stringify({ users: 1, tokensIssued: oauthIssued }));
  } else if (req.method === 'POST' && req.url === '/oauth/token') {
    req.resume();
    req.on('end', () => {
      if (req.headers.authorization !== DEMO_CLIENT) {
        res.writeHead(401); res.end(JSON.stringify({ error: 'invalid_client', error_description: 'Use demo-client / demo-secret' }));
      } else { oauthToken = `oauth_demo_${++oauthIssued}`; res.end(JSON.stringify({ access_token: oauthToken, token_type: 'Bearer', expires_in: 3600 })); }
    });
  } else if (req.method === 'POST' && (req.url === '/users' || req.url === '/auth/login')) {
    let body = '';
    req.setEncoding('utf8').on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const input = JSON.parse(body);
        if (req.url === '/auth/login') {
          if (input?.username !== 'demo' || input?.password !== 'demo') {
            res.writeHead(401); res.end(JSON.stringify({ error: 'Use demo / demo for the local example' }));
          } else { authToken = `demo_token_${++issued}`; res.end(JSON.stringify({ access_token: authToken, token_type: 'Bearer' })); }
          return;
        }
        if (typeof input?.name !== 'string' || input.name.trim() === '') throw new Error('name required');
        res.writeHead(201);
        res.end(JSON.stringify({ id: 2, name: input.name }));
      } catch {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Send a JSON body with a name' }));
      }
    });
  } else {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});
server.listen(Number(process.env.PORT ?? 3000), '127.0.0.1', () => {
  console.log(`Example API: http://127.0.0.1:${server.address().port}`);
});
