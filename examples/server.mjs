import { createServer } from 'node:http';

const server = createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'GET' && req.url === '/users') {
    res.end(JSON.stringify({ users: [{ id: 1, name: 'Ana' }] }));
  } else {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});
server.listen(Number(process.env.PORT ?? 3000), '127.0.0.1', () => {
  console.log(`Example API: http://127.0.0.1:${server.address().port}`);
});
