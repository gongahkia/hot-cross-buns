import http from 'node:http';
import fs from 'node:fs';
const log = process.argv[2];
const events = [];
const server = http.createServer((req, res) => {
  events.push({method:req.method, path:req.url});
  fs.writeFileSync(log, JSON.stringify(events));
  res.setHeader('Content-Type','application/json');
  if (req.method !== 'GET') { res.writeHead(405); res.end('{}'); return; }
  if (req.url === '/api/version') res.end(JSON.stringify({version:'l2a-fixture'}));
  else if (req.url === '/api/tags') res.end(JSON.stringify({models:[{name:'qwen3:4b',size:2500000000,digest:'sha256:inert-fixture'}]}));
  else if (req.url === '/api/ps') res.end(JSON.stringify({models:[]}));
  else { res.writeHead(404); res.end('{}'); }
});
server.listen(0,'127.0.0.1',() => console.log(`http://127.0.0.1:${server.address().port}`));
