import { parseCard, parseEffects } from './parse.js';

export function parseDungeonCard(card) {
  const rooms = [];
  const text = card.oracle_text || '';
  const chunks = text.split(/\n|(?<=\)) (?=[A-Z])/);
  for (const chunk of chunks) {
    const line = chunk.trim();
    if (!line || line.startsWith('You can')) continue;
    const m = line.match(/^(.+?) — (.+)$/);
    if (!m) continue;
    const leads = [];
    const lead = m[2].match(/\(Leads to: ([^)]+)\)/);
    if (lead) {
      for (const name of lead[1].split(',')) leads.push(name.trim());
    }
    const effectText = m[2].replace(/\(Leads to:[^)]+\)/, '').replace(/\.\s*$/, '').trim();
    const parsed = parseEffects(effectText);
    rooms.push({
      name: m[1].trim(),
      text: effectText,
      leads,
      effects: parsed.effects,
      unparsed: parsed.unparsed,
    });
  }
  return { id: card.id, name: card.name, rooms };
}

export function catalogFromData(data) {
  const cards = data.cards.map(parseCard);
  const basics = (data.basics || []).map(parseCard);
  const byId = new Map();
  for (const card of [...cards, ...basics]) byId.set(card.id, card);
  const dungeons = (data.extras || [])
    .filter((card) => card.set === 'tafr' && (card.type_line || '').includes('Dungeon'))
    .map(parseDungeonCard);
  return { cards, basics, byId, dungeons };
}
