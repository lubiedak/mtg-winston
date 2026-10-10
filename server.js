/**
 * Lokalny serwer gry. Uruchom: npm start
 * Potem otwórz http://127.0.0.1:8734/
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT) || 8734;

const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const routes = [
  ['/src/', path.join(root, 'src')],
  ['/data/', path.join(root, 'data')],
  ['/', path.join(root, 'public')],
];

function resolve(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0]);
  if (clean.includes('..')) return null;
  for (const [prefix, dir] of routes) {
    if (!clean.startsWith(prefix)) continue;
    const rel = clean.slice(prefix.length);
    const file = rel === '' ? path.join(dir, 'index.html') : path.join(dir, rel);
    if (!file.startsWith(dir)) return null;
    return file;
  }
  return null;
}

const server = createServer(async (req, res) => {
  try {
    const file = resolve(req.url || '/');
    if (!file) {
      res.writeHead(400);
      res.end('bad path');
      return;
    }
    const data = await readFile(file);
    const ext = path.extname(file);
    res.writeHead(200, {
      'Content-Type': types[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('nie ma takiego pliku');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Winston Cube: http://127.0.0.1:${port}/`);
});
