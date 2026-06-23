import { createServer } from 'node:http';
const port = Number(process.env.STUB_PORT || '0');
const server = createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ status: 'ok', stub: true, path: req.url }));
});
server.listen(port, '127.0.0.1', () => {
  // Print the chosen port so the harness can read it.
  console.log(`STUB_PORT=${server.address().port}`);
});
