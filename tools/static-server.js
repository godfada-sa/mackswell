// Minimal static file server for local development and the e2e suite.
// Usage: node tools/static-server.js [port]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(join(fileURLToPath(new URL('.', import.meta.url)), '..'));
const port = Number(process.argv[2] || 4173);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.ico': 'image/x-icon'
};

const server = createServer(async (req, res) => {
  try {
    const requested = decodeURIComponent((req.url || '/').split('?')[0]);
    const filePath = normalize(join(root, requested === '/' ? 'Social.html' : requested));

    if (filePath !== root && !filePath.startsWith(root + sep)) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    const body = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(body);
  } catch (err) {
    res.writeHead(err.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain' });
    res.end(err.code === 'ENOENT' ? 'Not found' : 'Server error');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Serving ${root} at http://127.0.0.1:${port}`);
});
