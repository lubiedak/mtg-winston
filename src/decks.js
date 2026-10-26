import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { polishCard, polishOracle, polishTypeLine } from './pltext.js';

export const BASIC_PL = {
  Równina: 'Plains',
  Wyspa: 'Island',
  Bagno: 'Swamp',
  Góra: 'Mountain',
  Las: 'Forest',
};

export function parseDeckMarkdown(text) {
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/);
  let title = '';
  const blurb = [];
  const sections = [];
  let section = null;
  for (const line of lines) {
    const heading = line.match(/^# (.+)$/);
    if (heading && !title && !line.startsWith('## ')) {
      title = heading[1].trim();
      continue;
    }
    const sub = line.match(/^## (.+)$/);
    if (sub) {
      section = { title: sub[1].trim(), entries: [] };
      sections.push(section);
      continue;
    }
    const item = line.match(/^- (.+)$/);
    if (item && section) {
      const raw = item[1].trim();
      const qty = raw.match(/^(\d+)\s+(.+)$/);
      if (qty) section.entries.push({ name: qty[2].trim(), count: Number(qty[1]) });
      else section.entries.push({ name: raw, count: 1 });
      continue;
    }
    if (!section && line.trim()) blurb.push(line.trim());
  }
  const total = sections.reduce(
    (sum, part) => sum + part.entries.reduce((inner, entry) => inner + entry.count, 0),
    0,
  );
  return { title, blurb: blurb.join('\n\n'), sections, total };
}

export function indexCatalog(data, extras = []) {
  const byName = new Map();
  const put = (card) => {
    if (!card?.name) return;
    const prev = byName.get(card.name);
    if (!prev || (!prev.image && card.image)) byName.set(card.name, card);
  };
  for (const card of data?.cards || []) put(card);
  for (const card of data?.basics || []) put(card);
  for (const card of extras) put(card);
  return byName;
}

function borderColors(card) {
  if (card.colors?.length) return card.colors;
  return card.color_identity || [];
}

function readingOf(card) {
  const faces = (card.faces || []).filter((face) => face && (face.oracle_text || face.type_line || face.name));
  if (faces.length > 1) {
    const oracle = faces.map((face) => {
      const type = polishTypeLine(face.type_line || '');
      const text = polishOracle(face.oracle_text || '');
      return [face.name, type, text].filter(Boolean).join('\n');
    }).join('\n\n');
    return { typeLine: polishTypeLine(card.type_line || ''), oracle };
  }
  const gloss = polishCard({
    name: card.name,
    typeLine: card.type_line || '',
    oracle: card.oracle_text || '',
  });
  return { typeLine: gloss.typeLine, oracle: gloss.oracle };
}

function ptOf(card) {
  if (card.loyalty != null && card.loyalty !== '') return String(card.loyalty);
  if (card.power != null && card.power !== '') return `${card.power}/${card.toughness ?? ''}`;
  return '';
}

export function resolveDeck(parsed, byName) {
  const sections = parsed.sections.map((section) => ({
    title: section.title,
    cards: section.entries.map((entry) => {
      const english = BASIC_PL[entry.name] || entry.name;
      const card = byName.get(english) || byName.get(entry.name);
      if (!card) return { name: entry.name, count: entry.count, missing: true };
      const reading = readingOf(card);
      const polishBasic = BASIC_PL[entry.name] ? entry.name : '';
      return {
        name: polishBasic || (card.basic && card.pl_name) || card.name,
        count: entry.count,
        manaCost: card.mana_cost || '',
        typeLine: reading.typeLine,
        oracle: reading.oracle,
        pt: ptOf(card),
        image: card.image || null,
        imageBack: card.image_back || null,
        imageLarge: card.image_large || null,
        imageBackLarge: card.image_back_large || null,
        colors: borderColors(card),
        missing: false,
      };
    }),
  }));
  return { title: parsed.title, blurb: parsed.blurb, total: parsed.total, sections };
}

export async function loadDeckFiles(dir, data, extras = []) {
  const byName = indexCatalog(data, extras);
  const names = (await readdir(dir)).filter((name) => name.endsWith('.md')).sort();
  const decks = [];
  for (const name of names) {
    const text = await readFile(path.join(dir, name), 'utf8');
    const deck = resolveDeck(parseDeckMarkdown(text), byName);
    deck.id = name.slice(0, -3);
    decks.push(deck);
  }
  return decks;
}
