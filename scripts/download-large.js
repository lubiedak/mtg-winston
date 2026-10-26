/**
 * Większe obrazki do powiększenia po kliknięciu.
 * Miniatura small zostaje w siatce. Obok ląduje kopia image_uris.large.
 * Uruchom: node scripts/download-large.js
 */
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artDir = path.join(root, 'public', 'art');
const UA = 'mtg-winston-cube/1.0 (personal local play; caching card images)';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function largeArtName(localPath) {
  const file = String(localPath || '').replace(/^\/art\//, '');
  const match = file.match(/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-(front|back)\.[a-z0-9]+$/i);
  if (!match) return null;
  const uuid = match[1];
  const side = match[2].toLowerCase();
  return {
    file: `${uuid}-${side}-large.jpg`,
    url: `https://cards.scryfall.io/large/${side}/${uuid[0]}/${uuid[1]}/${uuid}.jpg`,
  };
}

function looksLikeJpeg(buf) {
  return buf && buf.length > 8000 && buf[0] === 0xff && buf[1] === 0xd8;
}

function collect(node, urls) {
  if (Array.isArray(node)) {
    for (const item of node) collect(item, urls);
    return;
  }
  if (!node || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node)) {
    if ((key === 'image' || key === 'image_back') && typeof value === 'string' && value.startsWith('/art/')) urls.add(value);
    else if (value && typeof value === 'object') collect(value, urls);
  }
}

function annotate(node, ready) {
  if (Array.isArray(node)) {
    for (const item of node) annotate(item, ready);
    return;
  }
  if (!node || typeof node !== 'object') return;
  if (typeof node.image === 'string' && ready.has(node.image)) node.image_large = ready.get(node.image);
  if (typeof node.image_back === 'string' && ready.has(node.image_back)) node.image_back_large = ready.get(node.image_back);
  for (const value of Object.values(node)) {
    if (value && typeof value === 'object') annotate(value, ready);
  }
}

async function fetchImage(url) {
  let wait = 400;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const response = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'image/jpeg' } });
    if (response.status === 429 || response.status === 503) {
      await sleep(wait);
      wait *= 2;
      continue;
    }
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`${response.status} ${url}`);
    return Buffer.from(await response.arrayBuffer());
  }
  throw new Error(`Za dużo prób: ${url}`);
}

async function pool(items, limit, worker) {
  let cursor = 0;
  let done = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
      done += 1;
      if (done % 100 === 0 || done === items.length) console.log(`Duże obrazki: ${done}/${items.length}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
}

async function replaceJson(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  const bak = `${file}.bak`;
  await writeFile(tmp, JSON.stringify(data));
  try { await unlink(bak); } catch { /* pierwszy zapis */ }
  await rename(file, bak);
  try {
    await rename(tmp, file);
  } catch (err) {
    await rename(bak, file);
    throw err;
  }
  await unlink(bak);
}

async function loadPairs() {
  const urls = new Set();
  for (const name of ['cards.json', 'deck-extras.json']) {
    const data = JSON.parse(await readFile(path.join(root, 'data', name), 'utf8'));
    collect(data, urls);
  }
  const pairs = [];
  for (const local of urls) {
    const large = largeArtName(local);
    if (!large) throw new Error(`Nieznana miniatura: ${local}`);
    pairs.push({ local, ...large });
  }
  return pairs;
}

async function saveCatalog(ready) {
  for (const name of ['cards.json', 'deck-extras.json']) {
    const file = path.join(root, 'data', name);
    const data = JSON.parse(await readFile(file, 'utf8'));
    annotate(data, ready);
    if (typeof data.note === 'string' && !data.note.includes('image_uris.large')) {
      data.note += ' Powiększenie używa lokalnej kopii image_uris.large.';
    }
    await replaceJson(file, data);
  }
}

export async function downloadLargeArt() {
  const pairs = await loadPairs();
  console.log(`Unikalne miniatury: ${pairs.length}`);
  await mkdir(artDir, { recursive: true });
  const ready = new Map();
  const missing = [];
  await pool(pairs, 4, async (pair) => {
    const dest = path.join(artDir, pair.file);
    let buf = null;
    try { buf = await readFile(dest); } catch { buf = null; }
    if (!looksLikeJpeg(buf)) {
      buf = await fetchImage(pair.url);
      if (!buf) {
        missing.push(pair.local);
        return;
      }
      if (!looksLikeJpeg(buf)) throw new Error(`To nie jest duży JPEG: ${pair.url}`);
      await writeFile(dest, buf);
    }
    ready.set(pair.local, `/art/${pair.file}`);
  });
  if (missing.length) console.log(`Brak dużego pliku: ${missing.length}\n${missing.slice(0, 20).join('\n')}`);
  if (ready.size === 0) throw new Error('Nie udało się zapisać żadnego dużego obrazka.');
  await saveCatalog(ready);
  console.log(`Zapisane duże obrazki: ${ready.size}. Brak: ${missing.length}.`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  downloadLargeArt().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
