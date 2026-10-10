/**
 * Pobiera karty AFR, STX i DSK.
 *
 * Strona Scryfalla z ?as=text zwraca listę nazw (format talii), bez tekstu zasad.
 * Silnik gry potrzebuje oracle text, więc właściwa baza to API /cards/search.
 * Miniatury biorą się z pola image_uris.small (oficjalny adres Scryfalla).
 * Zrzut samych nazw robi `npm run text`, nie widok HTML ?as=text.
 *
 * Limit Scryfalla: 2 żądania / s na /cards/search. Między żądaniami jest 600 ms.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'data');
const UA = 'mtg-winston-cube/1.0 (personal local play; educational)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, accept = 'application/json') {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: accept },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${url}\n${body.slice(0, 400)}`);
  }
  return res;
}

function smallImage(entity) {
  return entity?.image_uris?.small || null;
}

function faceOf(face) {
  if (!face) return null;
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
    color_indicator: face.color_indicator || null,
    flavor_name: face.flavor_name || null,
    image: smallImage(face),
  };
}

function compact(card) {
  const faces = (card.card_faces || []).map(faceOf);
  return {
    id: card.id,
    oracle_id: card.oracle_id,
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
    keywords: card.keywords || [],
    rarity: card.rarity,
    set: card.set,
    collector_number: card.collector_number,
    layout: card.layout,
    produced_mana: card.produced_mana || [],
    reserved: !!card.reserved,
    booster: card.booster ?? null,
    digital: !!card.digital,
    games: card.games || [],
    image: smallImage(card) || faces[0]?.image || null,
    image_back: faces[1]?.image || null,
    faces,
  };
}

async function searchAll(query, { extras = false } = {}) {
  const params = new URLSearchParams({
    q: query,
    unique: 'cards',
    order: 'set',
    dir: 'asc',
  });
  if (extras) params.set('include_extras', 'true');
  let url = `https://api.scryfall.com/cards/search?${params}`;
  const cards = [];
  while (url) {
    const res = await get(url);
    const json = await res.json();
    cards.push(...json.data.map(compact));
    url = json.has_more ? json.next_page : null;
    if (url) await sleep(600);
  }
  return cards;
}

async function searchOrEmpty(query, opts) {
  try {
    return await searchAll(query, opts);
  } catch (err) {
    if (String(err.message).startsWith('404')) {
      console.log(`brak wyników: ${query}`);
      return [];
    }
    throw err;
  }
}

async function main() {
  await mkdir(dataDir, { recursive: true });

  console.log('API: karty gry z set:afr OR set:stx OR set:dsk');
  const playable = await searchAll('(set:afr OR set:stx OR set:dsk) game:paper');
  await sleep(600);
  console.log('API: lochy i żetony');
  await sleep(600);
  const dungeons = await searchOrEmpty('type:dungeon', { extras: true });
  await sleep(600);
  const tokens = await searchOrEmpty('(set:afr OR set:stx OR set:dsk) is:token', { extras: true });
  const extras = [...dungeons, ...tokens];

  const basics = [
    ['Plains', 'W', 'Równina'],
    ['Island', 'U', 'Wyspa'],
    ['Swamp', 'B', 'Bagno'],
    ['Mountain', 'R', 'Góra'],
    ['Forest', 'G', 'Las'],
  ].map(([name, color, pl]) => ({
    id: `basic-${color}`,
    oracle_id: `basic-${color}`,
    name,
    mana_cost: '',
    cmc: 0,
    type_line: `Basic Land — ${name}`,
    oracle_text: `({T}: Add {${color}}.)`,
    power: null,
    toughness: null,
    loyalty: null,
    colors: [],
    color_identity: [color],
    keywords: [],
    rarity: 'common',
    set: 'basic',
    collector_number: color,
    layout: 'normal',
    produced_mana: [color],
    reserved: false,
    booster: false,
    digital: false,
    games: ['paper'],
    faces: [],
    image: null,
    image_back: null,
    basic: true,
    pl_name: pl,
  }));
  for (const basic of basics) {
    const printed = playable.find((card) => card.name === basic.name && /Basic/.test(card.type_line || '') && card.image);
    if (printed) basic.image = printed.image;
  }

  const payload = {
    source: 'https://api.scryfall.com/cards/search',
    sets: ['afr', 'stx', 'dsk'],
    fetched_at: new Date().toISOString(),
    note: 'Tekst kart © Wizards of the Coast. Dane i miniatury: Scryfall (image_uris.small). Do prywatnej gry lokalnej.',
    cards: playable,
    extras,
    basics,
  };

  const out = path.join(dataDir, 'cards.json');
  await writeFile(out, JSON.stringify(payload));
  console.log(`Zapisano ${playable.length} kart + ${extras.length} dodatków → ${out}`);

  const withImage = playable.filter((card) => card.image).length;
  console.log(`Miniatury: ${withImage}/${playable.length}. Zrzut tekstu: npm run text.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
