/**
 * Import kostki z CubeCobra. Wołamy tylko cubecobra.com, raz na wczytanie.
 * Miniatury, które już są w public/art, zostają lokalne.
 */
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const UA = 'mtg-winston-cube/1.0 (personal local draft; cube import)';

export function cubeIdFromInput(input) {
  const text = String(input || '').trim();
  if (!text) return null;
  const uuid = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (uuid) return uuid[0].toLowerCase();
  try {
    const url = new URL(text);
    const host = url.hostname.replace(/^www\./, '');
    if (host !== 'cubecobra.com') return null;
    const parts = url.pathname.split('/').filter(Boolean);
    const last = parts[parts.length - 1] || '';
    if (!/^[A-Za-z0-9_-]{2,80}$/.test(last)) return null;
    return last;
  } catch {
    if (/^[A-Za-z0-9_-]{2,80}$/.test(text)) return text;
    return null;
  }
}

function manaCost(details) {
  if (typeof details.mana_cost === 'string' && details.mana_cost) return details.mana_cost;
  const parsed = Array.isArray(details.parsed_cost) ? details.parsed_cost.map((sym) => String(sym)) : [];
  const generic = parsed.filter((sym) => /^[0-9x]+$/i.test(sym));
  const rest = parsed.filter((sym) => !/^[0-9x]+$/i.test(sym));
  return [...generic, ...rest].map((sym) => `{${sym.toUpperCase()}}`).join('');
}

export function compactCobraCard(entry, id) {
  const details = entry?.details || {};
  return {
    id,
    oracle_id: details.oracle_id || null,
    name: details.name || 'Nieznana karta',
    mana_cost: manaCost(details),
    cmc: details.cmc ?? 0,
    type_line: details.type || details.type_line || '',
    oracle_text: details.oracle_text || '',
    power: details.power ?? null,
    toughness: details.toughness ?? null,
    loyalty: details.loyalty ?? null,
    colors: details.colors || [],
    color_identity: details.color_identity || [],
    keywords: details.keywords || [],
    rarity: details.rarity || 'common',
    set: details.set || 'cube',
    collector_number: String(details.collector_number || ''),
    layout: details.layout || 'normal',
    produced_mana: details.produced_mana || [],
    image: null,
    image_back: null,
    faces: [],
    remote_image: details.image_small || details.image_normal || null,
    scryfall_id: details.scryfall_id || entry?.cardID || id,
  };
}

export function cardsFromCobra(payload) {
  const board = payload?.cards?.mainboard || payload?.cards || [];
  const list = Array.isArray(board) ? board : [];
  const seen = new Map();
  const cards = [];
  for (const entry of list) {
    const base = entry?.details?.scryfall_id || entry?.cardID;
    if (!base) continue;
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    const id = n === 1 ? base : `${base}#${n}`;
    cards.push(compactCobraCard(entry, id));
  }
  return {
    id: payload?.id || '',
    name: payload?.name || 'Kostka CubeCobra',
    cards,
  };
}

function looksLikeImage(buf) {
  if (!buf || buf.length < 32) return false;
  if (buf[0] === 0xff && buf[1] === 0xd8) return true;
  if (buf[0] === 0x89 && buf[1] === 0x50) return true;
  if (buf.slice(0, 4).toString() === 'RIFF') return true;
  return false;
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function fetchImage(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'image/*' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function localArt(artDir, scryfallId, remote) {
  const jpg = path.join(artDir, `${scryfallId}-front.jpg`);
  const webp = path.join(artDir, `${scryfallId}-front.webp`);
  if (await exists(jpg)) return `/art/${scryfallId}-front.jpg`;
  if (await exists(webp)) return `/art/${scryfallId}-front.webp`;
  if (!remote) return null;
  const buf = await fetchImage(remote);
  if (!looksLikeImage(buf)) throw new Error(`To nie jest obrazek: ${remote}`);
  const ext = buf[0] === 0xff ? 'jpg' : (buf.slice(0, 4).toString() === 'RIFF' ? 'webp' : 'png');
  const name = `${scryfallId}-front.${ext}`;
  await writeFile(path.join(artDir, name), buf);
  return `/art/${name}`;
}

export async function importCobraCube(input, root, { force = false } = {}) {
  const id = cubeIdFromInput(input);
  if (!id) throw new Error('Podaj link do kostki CubeCobra albo jej identyfikator.');
  const cachePath = path.join(root, 'data', 'imports', `${id}.json`);
  if (!force && await exists(cachePath)) {
    return JSON.parse(await readFile(cachePath, 'utf8'));
  }
  const res = await fetch(`https://cubecobra.com/cube/api/cubeJSON/${encodeURIComponent(id)}`, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`CubeCobra odpowiedział ${res.status}.`);
  const payload = await res.json();
  const cube = cardsFromCobra(payload);
  if (!cube.cards.length) throw new Error('Ta kostka nie ma kart na mainboardzie.');
  const artDir = path.join(root, 'public', 'art');
  await mkdir(artDir, { recursive: true });
  await mkdir(path.dirname(cachePath), { recursive: true });
  let cursor = 0;
  async function worker() {
    while (cursor < cube.cards.length) {
      const card = cube.cards[cursor];
      cursor += 1;
      const base = card.scryfall_id;
      try {
        card.image = await localArt(artDir, base, card.remote_image);
      } catch {
        card.image = null;
      }
      delete card.remote_image;
    }
  }
  await Promise.all(Array.from({ length: Math.min(6, cube.cards.length) }, worker));
  const saved = {
    id,
    name: cube.name,
    fetched_at: new Date().toISOString(),
    source: `https://cubecobra.com/cube/list/${id}`,
    cards: cube.cards,
  };
  await writeFile(cachePath, JSON.stringify(saved));
  return saved;
}
