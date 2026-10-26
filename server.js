/**
 * Lokalny serwer gry. Uruchom: npm start
 * Potem otwórz http://127.0.0.1:8734/
 */
import { createServer } from 'node:http';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importCobraCube } from './src/cobra.js';
import { loadDeckFiles } from './src/decks.js';
import { isDraftId } from './src/session.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT) || 8734;

const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
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

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function draftFile(id) {
  return path.join(root, 'data', 'drafts', `${id}.json`);
}

let catalogPromise = null;
function catalogData() {
  if (!catalogPromise) {
    catalogPromise = readFile(path.join(root, 'data', 'cards.json'), 'utf8').then((raw) => JSON.parse(raw));
  }
  return catalogPromise;
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 8_000_000) throw new Error('Zapis jest za duży.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function serveDraft(req, res, id) {
  if (!isDraftId(id)) {
    sendJson(res, 400, { error: 'Zły identyfikator draftu.' });
    return;
  }
  const file = draftFile(id);
  if (req.method === 'GET') {
    try {
      sendJson(res, 200, JSON.parse(await readFile(file, 'utf8')));
    } catch {
      sendJson(res, 404, { error: 'Nie ma takiego zapisu.' });
    }
    return;
  }
  if (req.method === 'PUT' || req.method === 'POST') {
    let raw;
    try {
      raw = JSON.parse(await readBody(req));
    } catch (err) {
      sendJson(res, 400, { error: err.message === 'Zapis jest za duży.' ? err.message : 'Zapis nie jest poprawny.' });
      return;
    }
    if (!raw || raw.version !== 1 || !raw.cube) {
      sendJson(res, 400, { error: 'Zapis nie jest poprawny.' });
      return;
    }
    const dir = path.dirname(file);
    const tmp = `${file}.${process.pid}.tmp`;
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(tmp, JSON.stringify(raw));
      try { await unlink(file); } catch { /* pierwszy zapis */ }
      await rename(tmp, file);
    } catch {
      sendJson(res, 500, { error: 'Nie udało się zapisać draftu.' });
      return;
    }
    sendJson(res, 200, { ok: true });
    return;
  }
  res.writeHead(405, { Allow: 'GET, PUT' });
  res.end('method');
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const draftMatch = url.pathname.match(/^\/api\/draft\/([^/]+)$/);
    if (draftMatch) {
      await serveDraft(req, res, draftMatch[1]);
      return;
    }
    if (url.pathname === '/api/decks') {
      if (req.method !== 'GET') {
        res.writeHead(405, { Allow: 'GET' });
        res.end('method');
        return;
      }
      try {
        let extras = [];
        try {
          extras = JSON.parse(await readFile(path.join(root, 'data', 'deck-extras.json'), 'utf8')).cards || [];
        } catch {
          extras = [];
        }
        const decks = await loadDeckFiles(path.join(root, 'decki'), await catalogData(), extras);
        sendJson(res, 200, { decks });
      } catch (err) {
        console.error(err);
        sendJson(res, 500, { error: 'Nie udało się wczytać talii.' });
      }
      return;
    }
    if (url.pathname === '/api/cube') {
      try {
        const cube = await importCobraCube(url.searchParams.get('url') || '', root, {
          force: url.searchParams.get('refresh') === '1',
        });
        sendJson(res, 200, cube);
      } catch (err) {
        sendJson(res, 400, { error: err.message || 'Nie udało się wczytać kostki.' });
      }
      return;
    }
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
  console.log(`Talie: http://127.0.0.1:${port}/decki.html`);
});
