import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDeckFiles, parseDeckMarkdown, resolveDeck } from '../src/decks.js';
import { largeArtName } from '../scripts/download-large.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('duży obrazek ma adres Scryfalla large', () => {
  const got = largeArtName('/art/9cd2b567-0cf7-4441-b3ce-e31141dd91c8-front.jpg');
  assert.equal(got.file, '9cd2b567-0cf7-4441-b3ce-e31141dd91c8-front-large.jpg');
  assert.equal(got.url, 'https://cards.scryfall.io/large/front/9/c/9cd2b567-0cf7-4441-b3ce-e31141dd91c8.jpg');
});

test('parser liczy lądy podstawowe i sekcje', () => {
  const parsed = parseDeckMarkdown(`# Próba

Zdanie o talii.

Brakuje 1 Lasu.

## Dowódca

- Bear

## Lądy

- Evolving Wilds
- 2 Las
`);
  assert.equal(parsed.title, 'Próba');
  assert.match(parsed.blurb, /Zdanie o talii/);
  assert.match(parsed.blurb, /Brakuje 1 Lasu/);
  assert.equal(parsed.total, 4);
  const deck = resolveDeck(parsed, new Map([
    ['Bear', { name: 'Bear', type_line: 'Creature — Bear', oracle_text: 'Draw a card.', mana_cost: '{G}', colors: ['G'], image: '/art/bear.jpg' }],
    ['Forest', { name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '({T}: Add {G}.)', basic: true, pl_name: 'Las', colors: [], color_identity: ['G'], image: '/art/forest.jpg' }],
  ]));
  assert.equal(deck.sections[1].cards[1].name, 'Las');
  assert.equal(deck.sections[1].cards[1].count, 2);
  assert.equal(deck.sections[1].cards[1].image, '/art/forest.jpg');
  assert.equal(deck.sections[0].cards[0].missing, false);
  assert.equal(deck.sections[0].cards.length, 1);
});

test('osiem talii z plików ma po 100 kart i miniatury', async () => {
  const data = JSON.parse(await readFile(path.join(root, 'data', 'cards.json'), 'utf8'));
  const extras = JSON.parse(await readFile(path.join(root, 'data', 'deck-extras.json'), 'utf8')).cards;
  const decks = await loadDeckFiles(path.join(root, 'decki'), data, extras);
  assert.equal(decks.length, 8);
  assert.equal(decks[0].id, '00-dina-soul-steeper');
  const missing = [];
  for (const deck of decks) {
    assert.equal(deck.total, 100, deck.id);
    for (const section of deck.sections) {
      for (const card of section.cards) {
        if (card.missing || !card.image) missing.push(`${deck.id}: ${card.name}`);
      }
    }
  }
  assert.deepEqual(missing, []);
  const dina = decks[0];
  const commander = dina.sections[0].cards[0];
  assert.equal(commander.name, 'Dina, Soul Steeper');
  assert.match(commander.imageLarge || '', /-front-large\.jpg$/);
  assert.match(commander.oracle, /życie|life/i);
  const lands = dina.sections.find((section) => section.title === 'Lądy');
  const forest = lands.cards.find((card) => card.name === 'Las');
  assert.equal(forest.count, 15);
  const valentin = dina.sections.flatMap((section) => section.cards).find((card) => card.name.startsWith('Valentin'));
  assert.match(valentin.oracle, /Lisette/);
  assert.ok(valentin.imageBack);
});
