'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8080;
const ROOT = '/workspaces/My_code';
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

const server = http.createServer((req, res) => {
  let pathname = '/';
  try { pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname); } catch {}
  if (pathname === '/' || pathname === '') pathname = '/index.html';
  const full = path.normalize(path.join(ROOT, pathname));
  if (!full.startsWith(ROOT + path.sep) && full !== ROOT) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }
  fs.stat(full, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream',
      'content-length': stat.size,
      'cache-control': 'no-cache',
    });
    fs.createReadStream(full).pipe(res);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(new Date().toISOString(), `preview server on http://127.0.0.1:${PORT}`);
});

process.on('uncaughtException', (e) => console.error(new Date().toISOString(), 'preview error:', e.message));
