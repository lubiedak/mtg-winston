import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mulberry32 } from '../src/util.js';
import { buildCube, scaledBuckets } from '../src/cube.js';
import { catalogFromData } from '../src/catalog.js';
import { sourcesFor, suggestBasics, recommendedLandCount, manualBasics } from '../src/lands.js';
import { applyGrid, createGrid, gridPackCount } from '../src/grid.js';
import { cardsFromCobra, cubeIdFromInput } from '../src/cobra.js';

const data = JSON.parse(readFileSync(new URL('../data/cards.json', import.meta.url)));
const { cards } = catalogFromData(data);

function spell(mana, cmc = 2) {
  return { manaCost: mana, cmc, typeLine: 'Creature', oracle: '' };
}

test('tabela Karstena dla talii 40 kart', () => {
  assert.equal(sourcesFor(1, 1), 9);
  assert.equal(sourcesFor(1, 2), 9);
  assert.equal(sourcesFor(1, 3), 8);
  assert.equal(sourcesFor(2, 2), 14);
  assert.equal(sourcesFor(2, 3), 12);
  assert.equal(sourcesFor(3, 3), 16);
  assert.equal(sourcesFor(4, 4), 17);
  assert.equal(sourcesFor(1, 8), 6);
  assert.equal(recommendedLandCount([spell('{R}', 2), spell('{R}', 3)]), 16);
  assert.equal(recommendedLandCount([spell('{R}', 2), spell('{R}', 5), spell('{R}', 6), spell('{R}', 6)]), 18);
});

test('lądy podstawowe pokrywają kolory i domykają talię do 40', () => {
  const spells = [
    ...Array.from({ length: 12 }, () => spell('{W}', 2)),
    ...Array.from({ length: 11 }, () => spell('{U}', 2)),
  ];
  const plan = suggestBasics(spells);
  assert.equal(plan.deckSize, 40);
  assert.equal(plan.actualLands, 17);
  assert.equal(plan.basics.W + plan.basics.U + plan.basics.B + plan.basics.R + plan.basics.G, 17);
  assert.ok(plan.basics.W >= 8 && plan.basics.U >= 8);
  assert.equal(plan.basics.B, 0);
  const withDual = suggestBasics([
    ...Array.from({ length: 22 }, () => spell('{G}{G}', 2)),
    { manaCost: '', cmc: 0, typeLine: 'Land — Forest Island', oracle: '' },
  ]);
  assert.equal(withDual.deckSize, 40);
  assert.ok(withDual.sources.G >= 14);
  assert.ok(withDual.sources.U >= 1);
});

test('wybrane lądy podstawowe startują od zera i nie dociągają talii do 40', () => {
  const spells = Array.from({ length: 23 }, () => spell('{R}', 2));
  const empty = manualBasics(spells, { W: 0, U: 0, B: 0, R: 0, G: 0 });
  assert.equal(empty.deckSize, 23);
  assert.equal(empty.actualLands, 0);
  assert.equal(empty.basics.R, 0);
  assert.ok(empty.suggested.R > 0);
  assert.ok(empty.recommended >= 16);
  const chosen = manualBasics(spells, { R: 17 });
  assert.equal(chosen.deckSize, 40);
  assert.equal(chosen.basics.R, 17);
  assert.equal(chosen.sources.R, 17);
  const messy = manualBasics(spells, { W: -3, U: 1.9 });
  assert.equal(messy.basics.W, 0);
  assert.equal(messy.basics.U, 1);
  assert.equal(messy.deckSize, 24);
});

test('grid draft bierze rząd, potem kolumnę, a reszta odpada', () => {
  assert.equal(gridPackCount(162), 18);
  assert.equal(gridPackCount(90), 10);
  assert.equal(gridPackCount(8), 0);
  const draft = createGrid(Array.from({ length: 18 }, (_, i) => `c${i}`), 'p1', mulberry32(3));
  assert.equal(draft.packCount, 2);
  assert.equal(draft.active, 'p1');
  assert.equal(applyGrid(draft, 'r0').ok, true);
  assert.equal(draft.pools.p1.length, 3);
  assert.equal(draft.active, 'p2');
  assert.equal(applyGrid(draft, 'c0').ok, true);
  assert.equal(draft.pools.p2.length, 2);
  assert.equal(draft.discarded.length, 4);
  assert.equal(draft.packIndex, 1);
  assert.equal(draft.active, 'p2');
  assert.equal(applyGrid(draft, 'c1').ok, true);
  assert.equal(applyGrid(draft, 'r2').ok, true);
  assert.equal(draft.done, true);
  assert.equal(draft.pools.p1.length + draft.pools.p2.length + draft.discarded.length, 18);
});

test('kostka grid ma 162 karty z jednego dodatku', () => {
  const buckets = scaledBuckets(162);
  assert.equal(buckets.reduce((sum, row) => sum + row[1], 0), 162);
  const cube = buildCube(cards, mulberry32(4), 'afr', { common: 52, uncommon: 31, rare: 10, mythic: 7 }, 162);
  assert.equal(cube.cards.length, 162);
  assert.ok(cube.cards.every((card) => card.set === 'afr'));
});

test('link CubeCobra daje identyfikator i listę mainboardu', () => {
  assert.equal(
    cubeIdFromInput('https://cubecobra.com/cube/list/7d9ad6cc-3373-44af-83b7-6b70800aeb30'),
    '7d9ad6cc-3373-44af-83b7-6b70800aeb30',
  );
  assert.equal(cubeIdFromInput('https://example.com/cube/list/abc'), null);
  const cube = cardsFromCobra({
    id: 'abc',
    name: 'Próba',
    cards: {
      mainboard: [
        { cardID: '11111111-1111-1111-1111-111111111111', details: { name: 'Bear', scryfall_id: '11111111-1111-1111-1111-111111111111', parsed_cost: ['g', '1'], cmc: 2, type: 'Creature — Bear', colors: ['G'], color_identity: ['G'], oracle_text: 'Bears.', rarity: 'common', set: 'stx' } },
        { cardID: '11111111-1111-1111-1111-111111111111', details: { name: 'Bear', scryfall_id: '11111111-1111-1111-1111-111111111111', parsed_cost: ['1', 'g'], cmc: 2, type: 'Creature — Bear' } },
      ],
    },
  });
  assert.equal(cube.cards.length, 2);
  assert.equal(cube.cards[0].id, '11111111-1111-1111-1111-111111111111');
  assert.equal(cube.cards[0].mana_cost, '{1}{G}');
  assert.equal(cube.cards[1].id, '11111111-1111-1111-1111-111111111111#2');
});
