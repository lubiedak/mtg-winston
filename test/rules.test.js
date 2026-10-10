import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mulberry32 } from '../src/util.js';
import { parseCard } from '../src/parse.js';
import { spend, parseManaCost, addMana } from '../src/mana.js';
import { buildCube } from '../src/cube.js';
import { createDraft, applyDraft, pileKnown } from '../src/winston.js';
import { catalogFromData } from '../src/catalog.js';
import { apply, actor, chars, createGame, registerCatalog } from '../src/engine.js';

function card(partial) {
  return parseCard({
    id: partial.id,
    name: partial.name,
    mana_cost: partial.mana_cost || '',
    cmc: partial.cmc ?? 0,
    type_line: partial.type_line,
    oracle_text: partial.oracle_text || '',
    power: partial.power ?? null,
    toughness: partial.toughness ?? null,
    loyalty: null,
    colors: partial.colors || [],
    color_identity: partial.color_identity || partial.colors || [],
    keywords: partial.keywords || [],
    rarity: 'common',
    set: 'test',
    layout: 'normal',
    basic: !!partial.basic,
  });
}

function boot(defs, humanDeck, aiDeck, extra = {}) {
  const byId = new Map(defs.map((c) => [c.id, c]));
  const key = registerCatalog(byId, []);
  const state = createGame({
    catalogKey: key,
    humanDeck,
    aiDeck,
    starting: 'human',
    seed: 3,
    skipMulligan: true,
    ...extra,
  });
  return state;
}

function takeToHand(state, player, defId) {
  for (const zone of ['library', 'hand', 'graveyard', 'battlefield', 'exile']) {
    const list = state.players[player][zone];
    const idx = list.findIndex((id) => state.objects[id].defId === defId);
    if (idx < 0) continue;
    const id = list.splice(idx, 1)[0];
    const obj = state.objects[id];
    obj.zone = 'hand';
    obj.controller = player;
    state.players[player].hand.push(id);
    return id;
  }
  throw new Error(`brak ${defId} u ${player}`);
}

function toBoard(state, player, defId, opts = {}) {
  const id = takeToHand(state, player, defId);
  state.players[player].hand.splice(state.players[player].hand.indexOf(id), 1);
  const obj = state.objects[id];
  obj.zone = 'battlefield';
  obj.controller = player;
  obj.sick = !!opts.sick;
  obj.tapped = !!opts.tapped;
  state.players[player].battlefield.push(id);
  return id;
}

function freshAttack(state) {
  for (const p of ['human', 'ai']) {
    for (const id of state.players[p].battlefield) {
      const obj = state.objects[id];
      obj.attacking = null;
      obj.blockers = [];
      obj.blocking = null;
      obj.dealtFirst = false;
      obj.tapped = false;
    }
  }
  state.attackers = [];
  state.step = 'declareAttackers';
  state.awaiting = 'attackers';
  state.priority = 'human';
  state.active = 'human';
  state.passed = { human: false, ai: false };
  state.pending = null;
}

function passUntil(state, step) {
  let guard = 0;
  while (state.step !== step && !state.gameOver && !state.pending && guard++ < 40) {
    const who = actor(state);
    const res = apply(state, who, { type: 'pass' });
    if (!res.ok) throw new Error(`${res.error} @ ${state.step}/${state.awaiting}`);
  }
  return state;
}

test('mana: kolor, hybryda, phyrexian i ogólna', () => {
  const colored = spend(addMana(addMana([], 'W'), 'U'), parseManaCost('{W}{U}'));
  assert.equal(colored.ok, true);
  assert.equal(colored.pool.length, 0);
  const hybrid = spend(addMana([], 'U'), parseManaCost('{W/U}'));
  assert.equal(hybrid.ok, true);
  const phy = spend([], parseManaCost('{W/P}'), 20);
  assert.equal(phy.ok, true);
  assert.equal(phy.lifePaid, 2);
  const generic = spend(addMana(addMana([], 'R'), 'G'), parseManaCost('{2}'));
  assert.equal(generic.ok, true);
  assert.equal(spend(addMana([], 'R'), parseManaCost('{W}')).ok, false);
});

test('Winston: pełne spasowanie dokłada po karcie i daje kartę w ciemno', () => {
  const ids = Array.from({ length: 90 }, (_, i) => `c${i}`);
  const draft = createDraft(ids, 'human', mulberry32(1));
  assert.equal(draft.main.length, 87);
  assert.equal(draft.piles.every((p) => p.length === 1), true);
  assert.equal(pileKnown(draft, 'human', 0).every((c) => c.known), true);
  assert.equal(pileKnown(draft, 'ai', 0).some((c) => c.known), false);
  assert.equal(applyDraft(draft, 'pass').ok, true);
  assert.equal(applyDraft(draft, 'pass').ok, true);
  assert.equal(applyDraft(draft, 'pass').ok, true);
  assert.equal(draft.main.length, 83);
  assert.deepEqual(draft.piles.map((p) => p.length), [2, 2, 2]);
  assert.equal(draft.pools.human.length, 1);
  assert.equal(draft.active, 'ai');
});

test('Winston: koniec talii nie dokłada karty, której już nie ma', () => {
  const blind = createDraft(['a', 'b', 'c'], 'human', () => 0);
  blind.main = ['last'];
  blind.piles = [null, null, ['keep']];
  blind.looking = 2;
  blind.active = 'human';
  assert.equal(applyDraft(blind, 'pass').ok, true);
  assert.equal(blind.pools.human.includes('last'), true);
  assert.deepEqual(blind.piles[2], ['keep']);

  const forced = createDraft(['a', 'b', 'c'], 'human', () => 0);
  forced.main = [];
  forced.piles = [null, null, ['keep']];
  forced.looking = 2;
  forced.active = 'human';
  assert.equal(applyDraft(forced, 'pass').ok, true);
  assert.equal(forced.pools.human.includes('keep'), true);
  assert.equal(forced.piles[2], null);

  const draft = createDraft(['a', 'b', 'c', 'd'], 'human', mulberry32(2));
  let guard = 0;
  while (!draft.done && guard++ < 20) applyDraft(draft, 'pass');
  assert.equal(draft.done, true);
  assert.equal(draft.pools.human.length + draft.pools.ai.length, 4);
  assert.equal(draft.main.length, 0);
});

test('kostka ma 90 kart i nie jest jednokolorowa', () => {
  const data = JSON.parse(readFileSync(new URL('../data/cards.json', import.meta.url)));
  const { cards, dungeons } = catalogFromData(data);
  assert.equal(dungeons.length, 3);
  for (const d of dungeons) {
    assert.ok(d.rooms.length >= 4, d.name);
    assert.ok(d.rooms.some((r) => r.leads.length > 0), d.name);
  }
  assert.throws(() => buildCube(cards, mulberry32(1)), /jednego dodatku/);
  for (const set of ['afr', 'stx', 'dsk']) {
    const cube = buildCube(cards, mulberry32(7), set);
    assert.equal(cube.cards.length, 90, set);
    assert.equal(new Set(cube.cards.map((c) => c.id)).size, 90, set);
    assert.ok(cube.cards.every((c) => c.set === set), set);
    for (const color of ['W', 'U', 'B', 'R', 'G']) {
      assert.ok(cube.summary.color[color] >= 12, `${set} ${color} ${cube.summary.color[color]}`);
    }
    assert.equal(cube.summary.color.gold, 10, set);
    assert.equal(cube.summary.color.land, 4, set);
    const pictured = cube.cards.filter((c) => typeof c.image === 'string' && c.image.includes('scryfall.io'));
    assert.equal(pictured.length, 90, `${set} miniatury ${pictured.length}`);
  }
});

test('pierwszy gracz nie dobiera w pierwszej turze', () => {
  const forest = card({ id: 'basic-G', name: 'Forest', type_line: 'Basic Land — Forest', basic: true, color_identity: ['G'] });
  const deck = Array.from({ length: 12 }, () => 'basic-G');
  const state = boot([forest], deck, deck);
  assert.equal(state.players.human.hand.length, 7);
  passUntil(state, 'precombat');
  assert.match(state.log.join('\n'), /pomija krok dobierania/);
  assert.equal(state.players.human.hand.length, 7);
  assert.equal(state.turn, 1);
});

test('London mulligan odkłada tyle kart, ile było mulliganów', () => {
  const forest = card({ id: 'basic-G', name: 'Forest', type_line: 'Basic Land — Forest', basic: true, color_identity: ['G'] });
  const deck = Array.from({ length: 20 }, () => 'basic-G');
  const state = boot([forest], deck, deck, { skipMulligan: false });
  assert.equal(state.pending.kind, 'mulligan');
  assert.equal(apply(state, 'human', { type: 'answer', value: { keep: false } }).ok, true);
  assert.equal(apply(state, 'ai', { type: 'answer', value: { keep: true } }).ok, true);
  assert.equal(state.pending.kind, 'bottom');
  assert.equal(state.pending.player, 'human');
  assert.equal(state.pending.n, 1);
  const bottom = state.players.human.hand[0];
  assert.equal(apply(state, 'human', { type: 'answer', value: { ids: [bottom] } }).ok, true);
  assert.equal(state.players.human.hand.length, 6);
  assert.equal(state.players.ai.hand.length, 7);
  assert.equal(state.pending.kind, 'mulligan');
  assert.equal(state.pending.player, 'human');
  assert.equal(apply(state, 'human', { type: 'answer', value: { keep: true } }).ok, true);
  assert.equal(state.phase, 'play');
  assert.equal(state.players.human.library.includes(bottom), true);
  assert.equal(state.players.ai.locked, true);
});

test('drugi draftujący wybiera, kto zaczyna, zanim ktokolwiek dobierze', () => {
  const forest = card({ id: 'basic-G', name: 'Forest', type_line: 'Basic Land — Forest', basic: true, color_identity: ['G'] });
  const deck = Array.from({ length: 12 }, () => 'basic-G');
  const state = boot([forest], deck, deck, { skipMulligan: false, chooseStart: true, chooser: 'ai' });
  assert.equal(state.pending.kind, 'playDraw');
  assert.equal(state.players.human.hand.length, 0);
  assert.equal(apply(state, 'ai', { type: 'answer', value: { first: 'ai' } }).ok, true);
  assert.equal(state.pending.player, 'ai');
  assert.equal(state.pending.kind, 'mulligan');
  assert.equal(state.players.ai.hand.length, 7);
  apply(state, 'ai', { type: 'answer', value: { keep: true } });
  apply(state, 'human', { type: 'answer', value: { keep: true } });
  assert.equal(state.active, 'ai');
  passUntil(state, 'precombat');
  assert.match(state.log.join('\n'), /Komputer pomija krok dobierania/);
  assert.equal(state.active, 'ai');
  assert.equal(state.turn, 1);
});

test('walka: deptanie, pierwszy cios, latanie, groza, łącznik życia, choroba wejścia', () => {
  const forest = card({ id: 'basic-G', name: 'Forest', type_line: 'Basic Land — Forest', basic: true, color_identity: ['G'] });
  const trampler = card({
    id: 'trampler', name: 'Ram', mana_cost: '{2}{G}', cmc: 3, colors: ['G'],
    type_line: 'Creature — Beast', power: '3', toughness: '3', keywords: ['Trample'], oracle_text: 'Trample',
  });
  const bear = card({
    id: 'bear', name: 'Bear', mana_cost: '{1}{G}', cmc: 2, colors: ['G'],
    type_line: 'Creature — Bear', power: '2', toughness: '2',
  });
  const striker = card({
    id: 'striker', name: 'Duelist', mana_cost: '{W}', cmc: 1, colors: ['W'],
    type_line: 'Creature — Human', power: '2', toughness: '2', keywords: ['First strike'], oracle_text: 'First strike',
  });
  const flyer = card({
    id: 'flyer', name: 'Hawk', mana_cost: '{W}', cmc: 1, colors: ['W'],
    type_line: 'Creature — Bird', power: '1', toughness: '1', keywords: ['Flying'], oracle_text: 'Flying',
  });
  const menace = card({
    id: 'menace', name: 'Brute', mana_cost: '{2}{R}', cmc: 3, colors: ['R'],
    type_line: 'Creature — Ogre', power: '3', toughness: '3', keywords: ['Menace'], oracle_text: 'Menace',
  });
  const linker = card({
    id: 'linker', name: 'Healer', mana_cost: '{1}{W}', cmc: 2, colors: ['W'],
    type_line: 'Creature — Cleric', power: '2', toughness: '2', keywords: ['Lifelink'], oracle_text: 'Lifelink',
  });
  const deckH = ['trampler', 'bear', 'striker', 'flyer', 'menace', 'linker', ...Array(10).fill('basic-G')];
  const deckA = ['bear', 'bear', ...Array(10).fill('basic-G')];
  const state = boot([forest, trampler, bear, striker, flyer, menace, linker], deckH, deckA);
  const ram = toBoard(state, 'human', 'trampler');
  const wall = toBoard(state, 'ai', 'bear');
  passUntil(state, 'declareAttackers');
  assert.equal(apply(state, 'human', { type: 'attackers', ids: [ram] }).ok, true);
  passUntil(state, 'declareBlockers');
  assert.equal(apply(state, 'ai', { type: 'blockers', pairs: [{ blocker: wall, attacker: ram }] }).ok, true);
  passUntil(state, 'combat');
  assert.equal(state.players.ai.life, 19);
  assert.equal(state.objects[wall].zone, 'graveyard');
  assert.equal(state.objects[ram].zone, 'battlefield');

  freshAttack(state);
  const sick = toBoard(state, 'human', 'bear', { sick: true });
  assert.match(apply(state, 'human', { type: 'attackers', ids: [sick] }).error, /chorobę wejścia/);

  const duel = toBoard(state, 'human', 'striker');
  const victim = toBoard(state, 'ai', 'bear');
  freshAttack(state);
  state.objects[duel].sick = false;
  assert.equal(apply(state, 'human', { type: 'attackers', ids: [duel] }).ok, true);
  passUntil(state, 'declareBlockers');
  apply(state, 'ai', { type: 'blockers', pairs: [{ blocker: victim, attacker: duel }] });
  passUntil(state, 'combat');
  assert.equal(state.objects[victim].zone, 'graveyard');
  assert.equal(state.objects[duel].damage, 0);

  const hawk = toBoard(state, 'human', 'flyer');
  const ground = toBoard(state, 'ai', 'bear');
  freshAttack(state);
  state.objects[hawk].sick = false;
  apply(state, 'human', { type: 'attackers', ids: [hawk] });
  passUntil(state, 'declareBlockers');
  const blocked = apply(state, 'ai', { type: 'blockers', pairs: [{ blocker: ground, attacker: hawk }] });
  assert.match(blocked.error, /nie dosięga/);

  const ogre = toBoard(state, 'human', 'menace');
  freshAttack(state);
  state.objects[ogre].sick = false;
  apply(state, 'human', { type: 'attackers', ids: [ogre] });
  passUntil(state, 'declareBlockers');
  const oneBlock = apply(state, 'ai', { type: 'blockers', pairs: [{ blocker: ground, attacker: ogre }] });
  assert.match(oneBlock.error, /grozę/);

  const healer = toBoard(state, 'human', 'linker');
  freshAttack(state);
  state.objects[healer].sick = false;
  state.players.human.life = 10;
  state.players.ai.life = 20;
  apply(state, 'human', { type: 'attackers', ids: [healer] });
  passUntil(state, 'declareBlockers');
  apply(state, 'ai', { type: 'blockers', pairs: [] });
  passUntil(state, 'combat');
  assert.equal(state.players.ai.life, 18);
  assert.equal(state.players.human.life, 12);
});

test('obrażenia ze Shocka są śmiertelne, a kontra zdejmuje zaklęcie ze stosu', () => {
  const mountain = card({ id: 'basic-R', name: 'Mountain', type_line: 'Basic Land — Mountain', basic: true, color_identity: ['R'] });
  const island = card({ id: 'basic-U', name: 'Island', type_line: 'Basic Land — Island', basic: true, color_identity: ['U'] });
  const bear = card({ id: 'bear', name: 'Bear', mana_cost: '{1}{G}', cmc: 2, colors: ['G'], type_line: 'Creature — Bear', power: '2', toughness: '2' });
  const shock = card({ id: 'shock', name: 'Shock', mana_cost: '{R}', cmc: 1, colors: ['R'], type_line: 'Instant', oracle_text: 'Shock deals 2 damage to any target.' });
  const cancel = card({ id: 'cancel', name: 'Cancel', mana_cost: '{U}', cmc: 1, colors: ['U'], type_line: 'Instant', oracle_text: 'Counter target spell.' });
  const state = boot(
    [mountain, island, bear, shock, cancel],
    ['shock', 'basic-R', ...Array(8).fill('basic-R')],
    ['cancel', 'bear', 'basic-U', ...Array(8).fill('basic-U')],
  );
  const mt = toBoard(state, 'human', 'basic-R');
  const isle = toBoard(state, 'ai', 'basic-U');
  const body = toBoard(state, 'ai', 'bear');
  const bolt = takeToHand(state, 'human', 'shock');
  passUntil(state, 'precombat');
  assert.equal(apply(state, 'human', { type: 'cast', id: bolt, targets: [body] }).ok, true);
  assert.equal(state.objects[mt].tapped, true);
  apply(state, 'human', { type: 'pass' });
  const spell = state.stack.find((s) => s.objectId === bolt);
  const nope = takeToHand(state, 'ai', 'cancel');
  assert.equal(apply(state, 'ai', { type: 'cast', id: nope, targets: [spell.id] }).ok, true);
  assert.equal(state.objects[isle].tapped, true);
  apply(state, 'ai', { type: 'pass' });
  apply(state, 'human', { type: 'pass' });
  assert.equal(state.objects[bolt].zone, 'graveyard');
  assert.equal(state.objects[body].zone, 'battlefield');
  assert.equal(state.objects[body].damage, 0);
});

test('nielegalny cel zwraca manę i odtapa ląd', () => {
  const swamp = card({ id: 'basic-B', name: 'Swamp', type_line: 'Basic Land — Swamp', basic: true, color_identity: ['B'] });
  const kill = card({ id: 'kill', name: 'Doom', mana_cost: '{B}', cmc: 1, colors: ['B'], type_line: 'Instant', oracle_text: 'Destroy target creature.' });
  const state = boot([swamp, kill], ['kill', 'basic-B', ...Array(8).fill('basic-B')], Array(8).fill('basic-B'));
  const land = toBoard(state, 'human', 'basic-B');
  const spell = takeToHand(state, 'human', 'kill');
  passUntil(state, 'precombat');
  const res = apply(state, 'human', { type: 'cast', id: spell, targets: [] });
  assert.equal(res.ok, false);
  assert.equal(state.objects[land].tapped, false);
  assert.equal(state.objects[spell].zone, 'hand');
});

test('aura daje +2/+2 raz, a przejęcie kontroli wraca na koniec tury', () => {
  const plains = card({ id: 'basic-W', name: 'Plains', type_line: 'Basic Land — Plains', basic: true, color_identity: ['W'] });
  const bear = card({ id: 'bear', name: 'Bear', mana_cost: '{1}{G}', cmc: 2, colors: ['G'], type_line: 'Creature — Bear', power: '2', toughness: '2' });
  const aura = card({
    id: 'aura', name: 'Holy', mana_cost: '{W}', cmc: 1, colors: ['W'],
    type_line: 'Enchantment — Aura', oracle_text: 'Enchant creature\nEnchanted creature gets +2/+2.',
  });
  const theft = card({
    id: 'theft', name: 'Grab', mana_cost: '{W}', cmc: 1, colors: ['W'],
    type_line: 'Sorcery', oracle_text: 'Gain control of target creature until end of turn.',
  });
  const state = boot(
    [plains, bear, aura, theft],
    ['aura', 'theft', 'basic-W', 'basic-W', ...Array(8).fill('basic-W')],
    ['bear', ...Array(10).fill('basic-W')],
  );
  toBoard(state, 'human', 'basic-W');
  toBoard(state, 'human', 'basic-W');
  const body = toBoard(state, 'ai', 'bear');
  const holy = takeToHand(state, 'human', 'aura');
  passUntil(state, 'precombat');
  assert.equal(apply(state, 'human', { type: 'cast', id: holy, targets: [body] }).ok, true);
  apply(state, 'human', { type: 'pass' });
  apply(state, 'ai', { type: 'pass' });
  assert.equal(chars(state, state.objects[body]).power, 4);
  assert.equal(chars(state, state.objects[body]).toughness, 4);

  const grab = takeToHand(state, 'human', 'theft');
  assert.equal(apply(state, 'human', { type: 'cast', id: grab, targets: [body] }).ok, true);
  apply(state, 'human', { type: 'pass' });
  apply(state, 'ai', { type: 'pass' });
  assert.equal(state.objects[body].controller, 'human');
  let guard = 0;
  while (state.active === 'human' && !state.gameOver && guard++ < 30) {
    const who = actor(state);
    if (state.awaiting === 'attackers') apply(state, who, { type: 'attackers', ids: [] });
    else if (state.awaiting === 'blockers') apply(state, who, { type: 'blockers', pairs: [] });
    else apply(state, who, { type: 'pass' });
  }
  assert.equal(state.objects[body].controller, 'ai');
});

test('saga dostaje żeton wiedzy na początku pierwszej fazy głównej', () => {
  const tale = card({
    id: 'tale', name: 'Tale', mana_cost: '{1}{U}', cmc: 2, colors: ['U'],
    type_line: 'Enchantment — Saga',
    oracle_text: 'I — You gain 1 life.\nII — You gain 1 life.',
  });
  const island = card({ id: 'basic-U', name: 'Island', type_line: 'Basic Land — Island', basic: true, color_identity: ['U'] });
  const state = boot([tale, island], ['tale', ...Array(10).fill('basic-U')], Array(10).fill('basic-U'));
  const id = toBoard(state, 'human', 'tale');
  passUntil(state, 'precombat');
  assert.equal(state.objects[id].counters.lore, 1);
  assert.ok(state.stack.some((s) => String(s.description).startsWith('Saga')));
});

test('dwa legendy u człowieka czekają na wybór', () => {
  const hero = card({
    id: 'hero', name: 'Hero', mana_cost: '{W}', cmc: 1, colors: ['W'],
    type_line: 'Legendary Creature — Human', power: '2', toughness: '2',
  });
  const forest = card({ id: 'basic-G', name: 'Forest', type_line: 'Basic Land — Forest', basic: true, color_identity: ['G'] });
  const state = boot([hero, forest], ['hero', 'hero', ...Array(8).fill('basic-G')], Array(8).fill('basic-G'));
  toBoard(state, 'human', 'hero');
  toBoard(state, 'human', 'hero');
  passUntil(state, 'precombat');
  assert.equal(state.pending?.kind, 'legend');
});
