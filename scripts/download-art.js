/**
 * Zapisuje miniatury z data/cards.json do public/art i podmienia adresy na lokalne.
 * Nie woła api.scryfall.com. Pliki bierze z adresów już zapisanych w JSON
 * (CDN cards.scryfall.io). Przy kolejnym uruchomieniu pomija pliki, które już są.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artDir = path.join(root, 'public', 'art');
const jsonPath = path.join(root, 'data', 'cards.json');
const UA = 'mtg-winston-cube/1.0 (personal local play; caching card images)';
const NOTE = 'Tekst kart © Wizards of the Coast. Dane: Scryfall. Miniatury są lokalną kopią image_uris.small w public/art. Do prywatnej gry lokalnej.';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function artFileName(url) {
  if (typeof url !== 'string' || !url) return null;
  if (url.startsWith('/art/')) return url.slice('/art/'.length);
  const pathname = new URL(url).pathname;
  const match = pathname.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(jpg|jpeg|png|webp)$/i);
  if (!match) throw new Error(`Nieznany adres miniatury: ${url}`);
  const side = pathname.includes('/back/') ? 'back' : 'front';
  return `${match[1]}-${side}.${match[2].toLowerCase()}`;
}

function collect(node, urls) {
  if (Array.isArray(node)) {
    for (const item of node) collect(item, urls);
    return;
  }
  if (!node || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node)) {
    if ((key === 'image' || key === 'image_back') && typeof value === 'string' && value) urls.add(value);
    else if (value && typeof value === 'object') collect(value, urls);
  }
}

function rewrite(node, localOf) {
  if (Array.isArray(node)) {
    for (const item of node) rewrite(item, localOf);
    return;
  }
  if (!node || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node)) {
    if ((key === 'image' || key === 'image_back') && typeof value === 'string' && localOf.has(value)) {
      node[key] = localOf.get(value);
    } else if (value && typeof value === 'object') rewrite(value, localOf);
  }
}

function looksLikeImage(buf, ext) {
  if (!buf || buf.length < 500) return false;
  if (ext === 'jpg' || ext === 'jpeg') return buf[0] === 0xff && buf[1] === 0xd8;
  if (ext === 'png') return buf[0] === 0x89 && buf[1] === 0x50;
  if (ext === 'webp') return buf.slice(0, 4).toString() === 'RIFF';
  return false;
}

async function fetchImage(url) {
  let wait = 500;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'image/*' } });
    if (res.status === 429 || res.status === 503) {
      await sleep(wait);
      wait *= 2;
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return Buffer.from(await res.arrayBuffer());
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
      if (done % 100 === 0 || done === items.length) console.log(`Miniatury: ${done}/${items.length}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
}

export async function localizeArt() {
  const data = JSON.parse(await readFile(jsonPath, 'utf8'));
  const urls = new Set();
  collect(data, urls);
  const remote = [...urls].filter((url) => /^https?:\/\//i.test(url));
  const localOf = new Map();
  await mkdir(artDir, { recursive: true });

  let fetched = 0;
  let kept = 0;
  await pool(remote, 6, async (url) => {
    const name = artFileName(url);
    const ext = name.slice(name.lastIndexOf('.') + 1);
    const dest = path.join(artDir, name);
    let buf = null;
    try {
      buf = await readFile(dest);
    } catch {
      buf = null;
    }
    if (!looksLikeImage(buf, ext)) {
      buf = await fetchImage(url);
      if (!looksLikeImage(buf, ext)) throw new Error(`To nie jest obrazek: ${url}`);
      await writeFile(dest, buf);
      fetched += 1;
    } else {
      kept += 1;
    }
    localOf.set(url, `/art/${name}`);
  });

  rewrite(data, localOf);
  data.note = NOTE;
  await writeFile(jsonPath, JSON.stringify(data));

  const left = new Set();
  collect(data, left);
  const stillRemote = [...left].filter((url) => /^https?:\/\//i.test(url));
  if (stillRemote.length) throw new Error(`Zostały zdalne miniatury: ${stillRemote.length}`);
  console.log(`Zapisane lokalnie: pobrano ${fetched}, już było ${kept}, razem ${left.size}.`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  localizeArt().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
