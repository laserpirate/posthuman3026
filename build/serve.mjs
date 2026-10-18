// Local static server for docs/ (offline shows: no internet, no dependencies).
//   node serve.mjs [--port 8080]   -> http://localhost:8080/
// localhost is a secure context, so the mic prompt is remembered (file:// may ask every launch).
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOCS = path.resolve(HERE, '..', 'docs');
const i = process.argv.indexOf('--port');
const PORT = i > -1 ? Number(process.argv[i + 1]) : 8080;

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.woff2': 'font/woff2', '.txt': 'text/plain' };
http.createServer((req, res) => {
  const p = path.join(DOCS, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html'));
  if (!p.startsWith(DOCS) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(p).pipe(res);
}).listen(PORT, '127.0.0.1', () => console.log(`serving docs/ at http://localhost:${PORT}/  (Ctrl+C to stop)`));
