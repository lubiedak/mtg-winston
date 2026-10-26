import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../src/util.js';
import { createGrid, applyGrid } from '../src/grid.js';
import { isDraftId, newDraftId, packSession, unpackSession } from '../src/session.js';

test('zapis draftu wraca z talią, sideboardem i ręką', () => {
  assert.equal(isDraftId('../etc'), false);
  assert.equal(isDraftId(newDraftId()), true);
  const catalog = new Map([
    ['aaa', { id: 'aaa', name: 'Bear', cmc: 2, typeLine: 'Creature', manaCost: '{1}{G}', colorIdentity: ['G'] }],
  ]);
  const ids = Array.from({ length: 9 }, (_, i) => (i === 0 ? 'aaa' : `x${i}`));
  for (const id of ids) {
    if (!catalog.has(id)) catalog.set(id, { id, name: id, cmc: 1, typeLine: 'Creature', manaCost: '{R}', colorIdentity: ['R'] });
  }
  const draft = createGrid(ids, 'p1', mulberry32(2));
  applyGrid(draft, 'r0');
  const odd = { id: 'odd', name: 'Spoza katalogu', cmc: 4, typeLine: 'Sorcery', manaCost: '{3}{U}', oracle: 'Draw a card.', colorIdentity: ['U'], colors: ['U'] };
  const packed = packSession({
    catalogIds: new Set(['aaa']),
    screen: 'hand',
    format: 'grid',
    gridFirst: 'p2',
    first: 'human',
    diff: 'hard',
    setCode: 'stx',
    rngSeed: 9,
    status: '',
    seatOrder: ['p1', 'p2'],
    seatAt: 1,
    handSeat: 'p1',
    cube: {
      cards: [catalog.get('aaa'), odd],
      notes: [],
      summary: { total: 2 },
      set: 'stx',
      name: 'Próba',
      imported: true,
    },
    draft,
    decks: { p1: new Set(['aaa', 'odd']), p2: new Set() },
    landPicks: { p1: { W: 0, U: 0, B: 0, R: 0, G: 4 }, p2: { W: 0, U: 0, B: 0, R: 0, G: 0 } },
    hands: {
      p1: {
        library: ['c1:odd'],
        hand: ['c0:aaa'],
        mulligans: 1,
        mode: 'bottom',
        bottom: new Set(['c0:aaa']),
        byUid: new Map([['skip', true]]),
        plan: { deckSize: 40 },
      },
    },
  });
  const raw = JSON.parse(JSON.stringify(packed));
  assert.deepEqual(raw.cube.cards[0], { id: 'aaa' });
  assert.equal(raw.cube.cards[1].card.name, 'Spoza katalogu');
  assert.equal(raw.hands.p1.byUid, undefined);
  assert.deepEqual(raw.hands.p1.bottom, ['c0:aaa']);
  assert.equal(raw.draft.pools.p1.length, 3);

  const fresh = new Map(catalog);
  const state = unpackSession(raw, fresh);
  assert.equal(state.screen, 'hand');
  assert.equal(state.format, 'grid');
  assert.equal(state.draft.active, 'p2');
  assert.deepEqual([...state.decks.p1], ['aaa', 'odd']);
  assert.equal(state.landPicks.p1.G, 4);
  assert.equal(state.landPicks.p1.W, 0);
  assert.equal(state.cube.cards[0].name, 'Bear');
  assert.equal(state.cube.cards[1].name, 'Spoza katalogu');
  assert.equal(fresh.get('odd').oracle, 'Draw a card.');
  assert.equal(state.hands.p1.mode, 'bottom');
  assert.deepEqual(state.hands.p1.hand, ['c0:aaa']);
});
