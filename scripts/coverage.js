import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCard } from '../src/parse.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(readFileSync(path.join(root, 'data', 'cards.json'), 'utf8'));
const counts = { full: 0, partial: 0, body: 0 };
const unknown = new Map();
let crashed = 0;
for (const card of data.cards) {
  let rules;
  try {
    rules = parseCard(card);
  } catch (err) {
    crashed += 1;
    console.error('CRASH', card.name, err.message);
    continue;
  }
  counts[rules.understood] += 1;
  if (rules.understood !== 'full') {
    for (const face of rules.faces) {
      for (const line of face.unparsed || []) {
        const key = line.replace(/\s+/g, ' ').slice(0, 140);
        unknown.set(key, (unknown.get(key) || 0) + 1);
      }
    }
  }
}
const total = data.cards.length;
console.log(`kart: ${total}  pełne: ${counts.full}  częściowe: ${counts.partial}  tylko ciało: ${counts.body}  błędy: ${crashed}`);
console.log(`pokrycie pełne: ${((counts.full / total) * 100).toFixed(1)}%  pełne+częściowe: ${(((counts.full + counts.partial) / total) * 100).toFixed(1)}%`);
const top = [...unknown.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);
console.log('--- najczęstsze nierozpoznane fragmenty ---');
for (const [line, n] of top) console.log(`${n}\t${line}`);
