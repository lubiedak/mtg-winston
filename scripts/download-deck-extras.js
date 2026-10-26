/**
 * Karty z talii Commandera, których nie ma w kostce AFR/STX/DSK
 * (głównie Mystical Archive). Zapisuje tekst i miniaturę lokalnie.
 * Uruchom: node scripts/download-deck-extras.js
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { artFileName } from './download-art.js';
import { BASIC_PL, indexCatalog, parseDeckMarkdown } from '../src/decks.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artDir = path.join(root, 'public', 'art');
const UA = 'mtg-winston-cube/1.0 (personal local play; caching card images)';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function faceOf(face) {
  return {
    name: face.name,
    mana_cost: face.mana_cost || '',
    cmc: face.cmc ?? null,
    type_line: face.type_line || '',
    oracle_text: face.oracle_text || '',
    power: face.power ?? null,
    toughness: face.toughness ?? null,
    loyalty: face.loyalty ?? null,
    colors: face.colors || [],
    image: face.image_uris?.small || null,
  };
}

function compact(card) {
  const faces = (card.card_faces || []).map(faceOf);
  return {
    id: card.id,
    name: card.name,
    mana_cost: card.mana_cost || '',
    cmc: card.cmc ?? 0,
    type_line: card.type_line || '',
    oracle_text: card.oracle_text || '',
    power: card.power ?? null,
    toughness: card.toughness ?? null,
    loyalty: card.loyalty ?? null,
    colors: card.colors || [],
    color_identity: card.color_identity || [],
    image: card.image_uris?.small || faces[0]?.image || null,
    image_back: faces[1]?.image || null,
    faces,
    set: card.set,
  };
}

async function scryfall(name) {
  const exact = new URL('https://api.scryfall.com/cards/named');
  exact.searchParams.set('exact', name);
  exact.searchParams.set('set', 'sta');
  let response = await fetch(exact, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (response.status === 404) {
    const any = new URL('https://api.scryfall.com/cards/named');
    any.searchParams.set('exact', name);
    response = await fetch(any, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  }
  if (!response.ok) throw new Error(`${response.status} ${name}`);
  return response.json();
}

async function fetchImage(url) {
  const response = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'image/*' } });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

async function missingNames() {
  const data = JSON.parse(await readFile(path.join(root, 'data', 'cards.json'), 'utf8'));
  const byName = indexCatalog(data);
  const names = new Set();
  const files = (await readdir(path.join(root, 'decki'))).filter((name) => name.endsWith('.md'));
  for (const file of files) {
    const parsed = parseDeckMarkdown(await readFile(path.join(root, 'decki', file), 'utf8'));
    for (const section of parsed.sections) {
      for (const entry of section.entries) {
        const english = BASIC_PL[entry.name] || entry.name;
        if (!byName.has(english) && !byName.has(entry.name)) names.add(entry.name);
      }
    }
  }
  return [...names].sort();
}

async function main() {
  const names = await missingNames();
  console.log(`Brakuje w katalogu kostki: ${names.length}`);
  const cards = [];
  for (const name of names) {
    const card = compact(await scryfall(name));
    cards.push(card);
    console.log(`${card.set} ${card.name}`);
    await sleep(120);
  }
  await mkdir(artDir, { recursive: true });
  for (const card of cards) {
    for (const key of ['image', 'image_back']) {
      const url = card[key];
      if (!url || url.startsWith('/art/')) continue;
      const file = artFileName(url);
      const dest = path.join(artDir, file);
      try {
        await readFile(dest);
      } catch {
        await writeFile(dest, await fetchImage(url));
        await sleep(80);
      }
      card[key] = `/art/${file}`;
    }
    for (const face of card.faces || []) {
      if (face.image && !face.image.startsWith('/art/')) {
        const file = artFileName(face.image);
        face.image = `/art/${file}`;
      }
    }
  }
  const out = path.join(root, 'data', 'deck-extras.json');
  await writeFile(out, JSON.stringify({
    note: 'Karty z talii Commandera spoza kostki AFR/STX/DSK. Tekst © Wizards of the Coast. Dane i miniatury: lokalna kopia Scryfall.',
    cards,
  }));
  console.log(`Zapisano ${cards.length} → ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
