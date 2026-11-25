import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DIST_DIR = path.join(ROOT, 'dist');
const HEADERS_FILE = path.join(ROOT, 'public', '_headers');
const PORT = Number(process.env.PORT || 4173);
const HOST = '127.0.0.1';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};

function parseSecurityHeaders() {
  const headers = {};
  if (!fs.existsSync(HEADERS_FILE)) return headers;
  const lines = fs.readFileSync(HEADERS_FILE, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('/*') || trimmed.startsWith('#')) continue;
    const colon = trimmed.indexOf(':');
    if (colon > 0) {
      const name = trimmed.slice(0, colon).trim();
      const val = trimmed.slice(colon + 1).trim();
      headers[name] = val;
    }
  }
  return headers;
}

const securityHeaders = parseSecurityHeaders();

const server = http.createServer((req, res) => {
  const reqUrl = new URL(req.url || '/', `http://${HOST}:${PORT}`);
  let relPath = decodeURIComponent(reqUrl.pathname);
  if (relPath === '/') relPath = '/index.html';

  const safePath = path.normalize(path.join(DIST_DIR, relPath));
  if (!safePath.startsWith(DIST_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8', ...securityHeaders });
    res.end('Forbidden');
    return;
  }

  let target = safePath;
  if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
    target = path.join(DIST_DIR, 'index.html');
  }

  const ext = path.extname(target).toLowerCase();
  const mime = MIME_TYPES[ext] || 'application/octet-stream';

  res.writeHead(200, {
    'Content-Type': mime,
    'Cache-Control': 'no-store',
    ...securityHeaders
  });
  fs.createReadStream(target).pipe(res);
});

server.listen(PORT, HOST, () => {
  console.log(`Seelig PDF secure preview listening on http://${HOST}:${PORT}`);
});
