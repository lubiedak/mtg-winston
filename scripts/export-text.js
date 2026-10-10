/**
 * Zrzut tekstowy kart. Strona Scryfalla z ?as=text to widok HTML,
 * nie baza do gry, więc teksty biorą się z data/cards.json (API, bez grafik).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(readFileSync(path.join(root, 'data', 'cards.json'), 'utf8'));
const notice = [
  'Tekst kart © Wizards of the Coast. Dane: Scryfall API (bez grafik).',
  'Parametr ?as=text na stronie zestawu nie zwraca pełnej bazy — to jest zrzut z API.',
  `Pobrano: ${data.fetched_at}`,
  '',
].join('\n');

function block(card) {
  if (card.faces?.length) {
    return card.faces.map((face) => [
      `== ${face.name} ==`,
      `${face.mana_cost || ''} ${face.type_line || ''}`.trim(),
      face.oracle_text || '',
    ].join('\n')).join('\n\n');
  }
  return `${card.mana_cost || ''} ${card.type_line}\n${card.oracle_text || ''}`.trim();
}

for (const code of ['afr', 'stx', 'dsk']) {
  const cards = data.cards.filter((card) => card.set === code);
  const oracle = cards.map((card) => `# ${card.name}\n${card.rarity} · ${card.set} · #${card.collector_number}\n${block(card)}\n`).join('\n');
  const names = cards.map((card) => `${card.name} | ${card.mana_cost || '—'} | ${card.type_line} | ${card.rarity}`).join('\n');
  writeFileSync(path.join(root, 'data', `${code}-oracle.txt`), notice + oracle, 'utf8');
  writeFileSync(path.join(root, 'data', `${code}-as-text.txt`), notice + names + '\n', 'utf8');
  console.log(`${code}: ${cards.length}`);
}
