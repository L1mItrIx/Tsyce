import { createServer } from 'node:http';

const server = createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'GET' && req.url === '/users') {
    res.end(JSON.stringify({ users: [{ id: 1, name: 'Ana' }] }));
  } else if (req.method === 'POST' && req.url === '/users') {
    let body = '';
    req.setEncoding('utf8').on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const input = JSON.parse(body);
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
