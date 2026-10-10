import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mulberry32 } from '../src/util.js';
import { catalogFromData } from '../src/catalog.js';
import { buildCube } from '../src/cube.js';
import { createDraft, applyDraft } from '../src/winston.js';
import { actor, apply, createGame, registerCatalog } from '../src/engine.js';
import { buildDeck, chooseAction, chooseDraft, fallback } from '../src/ai.js';

function drive(state, diff, cap = 4000) {
  let steps = 0;
  while (!state.gameOver && steps++ < cap) {
    const player = actor(state);
    if (!player) break;
    const action = chooseAction(state, player, diff);
    let res = apply(state, player, action);
    if (!res.ok) res = apply(state, player, fallback(state, player));
    if (!res.ok) throw new Error(`${res.error} po ${steps} akcjach, krok ${state.step}, pending ${state.pending?.kind}`);
  }
  return steps;
}

test('komputer kończy partię na małych taliach', () => {
  const data = JSON.parse(readFileSync(new URL('../data/cards.json', import.meta.url)));
  const cat = catalogFromData(data);
  const key = registerCatalog(cat.byId, cat.dungeons);
  const basics = ['W', 'U', 'B', 'R', 'G'].flatMap((c) => Array.from({ length: 8 }, () => `basic-${c}`));
  const creatures = cat.cards.filter((c) => c.typeLine.includes('Creature') && c.cmc <= 3 && c.understood !== 'body').slice(0, 12);
  const deck = [...creatures.map((c) => c.id), ...basics].slice(0, 40);
  const state = createGame({
    catalogKey: key,
    humanDeck: deck,
    aiDeck: deck.slice().reverse(),
    starting: 'human',
    seed: 11,
    skipMulligan: false,
  });
  const steps = drive(state, 'medium', 5000);
  assert.ok(state.gameOver, `partia nie skończyła się po ${steps} akcjach, tura ${state.turn}`);
  assert.ok(state.turn < 80);
});

test('draft i talia komputera mieszczą się w puli', () => {
  const data = JSON.parse(readFileSync(new URL('../data/cards.json', import.meta.url)));
  const cat = catalogFromData(data);
  const byId = cat.byId;
  const cube = buildCube(cat.cards, mulberry32(4), 'stx');
  const draft = createDraft(cube.cards.map((c) => c.id), 'ai', mulberry32(5));
  let guard = 0;
  while (!draft.done && guard++ < 200) {
    const choice = chooseDraft(draft, byId, 'hard');
    const res = applyDraft(draft, choice);
    assert.equal(res.ok, true);
  }
  assert.equal(draft.done, true);
  assert.equal(draft.pools.human.length + draft.pools.ai.length, 90);
  for (const diff of ['easy', 'medium', 'hard']) {
    const built = buildDeck(draft.pools.ai, byId, diff);
    assert.ok(built.deck.length >= 40, `${diff} ${built.deck.length}`);
    const basics = built.deck.filter((id) => String(id).startsWith('basic-')).length;
    assert.ok(basics >= 14, `${diff} basics ${basics}`);
  }
});
