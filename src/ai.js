/**
 * Heurystyka draftu, talii i gry. Jeden ply, bez przeszukiwania drzewa.
 * Komputer nie korzysta z ręcznego rozstrzygania nierozpoznanego tekstu.
 */
import { pipList } from './mana.js';
import { apply, chars, defOf, legalTargets, other } from './engine.js';

const COLORS = ['W', 'U', 'B', 'R', 'G'];

export function engineMark(card) {
  if (!card || card.understood === 'body') return 'ręcznie';
  if (card.understood === 'partial') return 'silnik, część ręcznie';
  return 'silnik';
}

function weights(ids, byId) {
  const w = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const id of ids) {
    const card = byId.get(id);
    for (const c of card?.colorIdentity || []) if (w[c] != null) w[c] += 1;
  }
  return w;
}

function scoreCard(card, colors, diff) {
  if (!card) return -2;
  let score = 0;
  const ci = card.colorIdentity || [];
  const committed = COLORS.filter((c) => colors[c] > 0);
  if (ci.length === 0) score += 0.35;
  else if (!committed.length || ci.every((c) => colors[c] > 0)) score += 1.15;
  else if (ci.some((c) => colors[c] > 0)) score += 0.15;
  else score -= diff === 'hard' ? 1.8 : 1.1;
  score += { common: 0, uncommon: 0.35, rare: 1, mythic: 1.45 }[card.rarity] || 0;
  const mv = card.cmc || 0;
  if (mv <= 2) score += 0.75;
  else if (mv === 3) score += 0.45;
  else if (mv >= 6) score -= 0.55;
  const type = card.typeLine || '';
  if (type.includes('Creature')) score += 0.65;
  if (type.includes('Land')) score += 0.5;
  if (/destroy target|exile target|deals? \d+ damage/i.test(card.oracle || '')) score += 1.25;
  if (card.understood === 'body') score -= diff === 'hard' ? 0.85 : 0.25;
  else if (card.understood === 'partial') score -= 0.12;
  return score;
}

export function chooseDraft(draft, byId, diff = 'medium') {
  const pile = draft.piles[draft.looking] || [];
  if (!pile.length) return 'pass';
  const colors = weights(draft.pools[draft.active], byId);
  const scores = pile.map((id) => scoreCard(byId.get(id), colors, diff));
  const total = scores.reduce((sum, n) => sum + n, 0);
  const best = scores.length ? Math.max(...scores) : 0;
  const thresholds = diff === 'easy' ? [0.15, -0.2, -0.8] : diff === 'hard' ? [1.45, 0.75, 0.05] : [0.85, 0.4, -0.15];
  const bar = thresholds[Math.min(draft.looking, 2)];
  if (pile.length >= 4 && total > 0) return 'take';
  if (best >= bar || total >= bar + 0.35) return 'take';
  if (diff === 'easy' && pile.length > 1 && best > -0.2) return 'take';
  return 'pass';
}

export function buildDeck(poolIds, byId, diff = 'medium') {
  const colors = weights(poolIds, byId);
  const order = COLORS.slice().sort((a, b) => colors[b] - colors[a]);
  const chosen = colors[order[1]] > 0 ? order.slice(0, 2) : order.slice(0, 1);
  const cards = poolIds.map((id) => byId.get(id)).filter(Boolean);
  const onColor = (card) => {
    const ci = card.colorIdentity || [];
    if (!ci.length) return true;
    if (/\bLand\b/.test(card.typeLine || '')) return ci.some((c) => chosen.includes(c));
    return ci.every((c) => chosen.includes(c));
  };
  const ranked = cards
    .filter((card) => !/\bLand\b/.test(card.typeLine || '') && onColor(card))
    .sort((a, b) => scoreCard(b, colors, diff) - scoreCard(a, colors, diff));
  let spells = ranked.slice(0, 23);
  if (spells.length < 18) {
    const extra = cards
      .filter((card) => !spells.includes(card) && !/\bLand\b/.test(card.typeLine || ''))
      .sort((a, b) => scoreCard(b, colors, diff) - scoreCard(a, colors, diff));
    spells = spells.concat(extra.slice(0, 23 - spells.length));
  }
  const lands = cards.filter((card) => /\bLand\b/.test(card.typeLine || '') && onColor(card)).slice(0, 6);
  const pips = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const card of spells) {
    for (const sym of pipList(card.manaCost)) if (pips[sym] != null) pips[sym] += 1;
  }
  for (const c of chosen) if (!pips[c]) pips[c] = 1;
  const basics = [];
  let slots = Math.max(16, 40 - spells.length - lands.length);
  const pipSum = COLORS.reduce((sum, c) => sum + pips[c], 0) || 1;
  for (const c of COLORS) {
    if (!pips[c]) continue;
    const n = Math.max(1, Math.round(slots * (pips[c] / pipSum)));
    for (let i = 0; i < n; i++) basics.push(`basic-${c}`);
  }
  while (spells.length + lands.length + basics.length < 40) basics.push(`basic-${chosen[0] || 'W'}`);
  while (spells.length + lands.length + basics.length > 40 && basics.length > chosen.length) basics.pop();
  const mainIds = new Set([...spells, ...lands].map((c) => c.id));
  return {
    deck: [...spells.map((c) => c.id), ...lands.map((c) => c.id), ...basics],
    side: poolIds.filter((id) => !mainIds.has(id)),
    colors: chosen,
  };
}

function faceOfCard(state, obj) {
  const def = defOf(state, obj?.defId);
  return def?.faces?.[obj.face || 0] || null;
}

function specsFrom(effects) {
  const specs = [];
  for (const effect of effects || []) {
    if (effect.target && effect.target.kind !== 'self') specs.push(effect.target);
    if (effect.targets) specs.push(...effect.targets.filter((t) => t.kind !== 'self'));
  }
  return specs;
}

function guessTargets(state, player, effects) {
  const targets = [];
  for (const spec of specsFrom(effects)) {
    const opts = legalTargets(state, spec, player);
    const enemy = opts.find((o) => typeof o === 'string' && !o.startsWith('player:') && state.objects[o]?.controller !== player);
    const foe = opts.find((o) => o === `player:${other(player)}`);
    targets.push(enemy || foe || opts[0] || null);
  }
  return targets;
}

function tryAction(state, player, action) {
  try {
    const copy = structuredClone(state);
    return apply(copy, player, action).ok;
  } catch {
    return false;
  }
}

function canBlock(state, blocker, attacker) {
  const bc = chars(state, blocker);
  const ac = chars(state, attacker);
  if (!bc.isCreature || blocker.tapped || bc.cantBlock) return false;
  if (ac.flying && !bc.flying && !bc.reach) return false;
  if (ac.unblockable) return false;
  if (blocker.flags?.includes('cantBlock')) return false;
  if (ac.unblockableAlone && (state.attackers || []).length === 1) return false;
  return true;
}

function discardRank(state, id) {
  const obj = state.objects[id];
  const c = chars(state, obj);
  const face = faceOfCard(state, obj);
  if (c.isLand) return 2;
  return (face?.cmc || 0) + 1;
}

function answerPending(state, player, diff) {
  const pending = state.pending;
  const hand = state.players[player].hand;
  if (pending.kind === 'mulligan') {
    const lands = hand.filter((id) => chars(state, state.objects[id]).isLand).length;
    const spells = hand.length - lands;
    const cap = diff === 'easy' ? 1 : 2;
    let keep = lands >= 2 && lands <= (diff === 'hard' ? 4 : 5) && spells >= 1;
    if (state.players[player].mulligans >= cap) keep = lands >= 1 && lands <= 6;
    return { type: 'answer', value: { keep } };
  }
  if (pending.kind === 'bottom') {
    const ids = hand.slice().sort((a, b) => discardRank(state, b) - discardRank(state, a));
    return { type: 'answer', value: { ids: ids.slice(0, pending.n || 1) } };
  }
  if (pending.kind === 'scry' || pending.kind === 'surveil') {
    const top = state.players[player].library.slice(0, pending.n || 1);
    const lands = hand.filter((id) => chars(state, state.objects[id]).isLand).length;
    const keep = top.filter((id) => {
      const land = chars(state, state.objects[id]).isLand;
      return pending.kind === 'surveil' ? (lands < 3 ? land : !land) : lands < 3;
    });
    return { type: 'answer', value: { top: keep } };
  }
  if (pending.kind === 'manifest') {
    const ids = pending.ids || [];
    let manifest = ids[0];
    for (const id of ids) {
      const type = defOf(state, state.objects[id].defId)?.typeLine || '';
      if (type.includes('Creature')) manifest = id;
    }
    return { type: 'answer', value: { manifest } };
  }
  if (pending.kind === 'dungeon') return { type: 'answer', value: { name: pending.dungeons?.[0] } };
  if (pending.kind === 'dungeonRoom') return { type: 'answer', value: { name: pending.rooms?.[0] } };
  if (pending.kind === 'discard' || pending.kind === 'discardHand' || pending.kind === 'rummage') {
    const n = pending.kind === 'rummage' ? (diff === 'hard' ? 0 : 1) : (pending.n || 1);
    const ids = hand.slice().sort((a, b) => discardRank(state, b) - discardRank(state, a)).slice(0, n);
    return { type: 'answer', value: { ids } };
  }
  if (pending.kind === 'learn') {
    const lesson = state.players[player].sideboard.find((id) => (defOf(state, state.objects[id].defId)?.typeLine || '').includes('Lesson'));
    if (lesson) return { type: 'answer', value: { lesson } };
    const worst = hand.slice().sort((a, b) => discardRank(state, b) - discardRank(state, a))[0];
    return { type: 'answer', value: { discard: worst } };
  }
  if (pending.kind === 'searchLand') {
    const need = { W: 0, U: 0, B: 0, R: 0, G: 0 };
    for (const id of hand.concat(state.players[player].battlefield)) {
      const obj = state.objects[id];
      for (const sym of pipList(faceOfCard(state, obj)?.manaCost || '')) if (need[sym] != null) need[sym] += 1;
    }
    const basic = COLORS.slice().sort((a, b) => need[b] - need[a])[0];
    return { type: 'answer', value: { basic } };
  }
  if (pending.kind === 'legend') {
    const keep = (pending.ids || []).slice().sort((a, b) => chars(state, state.objects[b]).power - chars(state, state.objects[a]).power)[0];
    return { type: 'answer', value: { keep } };
  }
  if (pending.kind === 'ward') return { type: 'answer', value: { pay: diff !== 'easy' } };
  if (pending.kind === 'stackTargets') {
    const item = state.stack.find((s) => s.id === pending.stackId);
    const effects = item?.effects || [];
    return { type: 'answer', value: { targets: guessTargets(state, player, effects) } };
  }
  if (pending.kind === 'playDraw') {
    const first = diff === 'easy' && (state.seed % 2 === 0) ? other(player) : player;
    return { type: 'answer', value: { first } };
  }
  return { type: 'answer', value: {} };
}

function castScore(state, player, face, diff) {
  const foe = other(player);
  const foes = state.players[foe].battlefield.filter((id) => chars(state, state.objects[id]).isCreature).length;
  const ops = (face.spellEffects || []).map((e) => e.op).join(' ');
  let score = 0;
  if (face.isCreature) {
    score += Number(face.power || 0) + Number(face.toughness || 0) * 0.55 - (face.cmc || 0) * 0.45;
    if ((face.keywords || []).some((k) => k === 'Flying' || k === 'Haste' || k === 'Menace')) score += 0.7;
  }
  if (/destroy|exile|damage/.test(ops)) score += foes ? 3.2 : -0.4;
  if (ops.includes('counter')) score += state.stack.some((s) => s.kind === 'spell' && s.controller !== player) ? 4 : -2;
  if (ops.includes('draw')) score += 1.3;
  if (ops.includes('pump')) score += state.attackers?.length ? 1.6 : -0.8;
  if (!ops && face.unparsed?.length && !face.isCreature) score -= diff === 'hard' ? 1.5 : 0.3;
  if (diff === 'easy' && (face.isCreature || foes)) score += 0.45;
  return score;
}

function castableIds(state, player) {
  return state.players[player].hand.concat(
    state.players[player].exile.filter((id) => state.objects[id]?.impulse),
  );
}

function considerCasts(state, player, diff, instantsOnly) {
  let best = null;
  let bestScore = 0.45;
  for (const id of castableIds(state, player)) {
    const obj = state.objects[id];
    const face = faceOfCard(state, obj);
    if (!face || (face.isLand && !face.isCreature)) continue;
    const instant = face.isInstant || face.flash || (face.keywords || []).includes('Flash');
    if (instantsOnly && !instant) continue;
    const effects = face.choose?.options?.[0]?.effects || face.spellEffects || [];
    const action = {
      type: 'cast',
      id,
      face: obj.face || 0,
      modes: face.choose ? [0] : [],
      targets: guessTargets(state, player, effects),
    };
    if (!tryAction(state, player, action)) continue;
    const score = castScore(state, player, face, diff);
    if (score > bestScore) {
      bestScore = score;
      best = action;
    }
  }
  return best;
}

function costly(ab) {
  if (!ab) return false;
  if (ab.kind === 'loyalty') return true;
  const cost = ab.cost || {};
  if (cost.tap || cost.sacrifice || cost.payLife) return true;
  const mana = cost.mana;
  return !!(mana && (mana.generic || mana.pips?.length || mana.c || mana.hybrid?.length || mana.phyrexian?.length));
}

function considerExtras(state, player) {
  if (state.stack.length || (state.step !== 'precombat' && state.step !== 'postcombat')) return null;
  for (const id of state.players[player].battlefield) {
    const obj = state.objects[id];
    const face = faceOfCard(state, obj);
    if (obj.room) {
      const closed = obj.room.findIndex((open) => !open);
      if (closed >= 0) {
        const action = { type: 'unlock', id, face: closed };
        if (tryAction(state, player, action)) return action;
      }
    }
    if (obj.faceDown && face?.isCreature) {
      const action = { type: 'turnUp', id };
      if (tryAction(state, player, action)) return action;
    }
    if (face?.crew && !chars(state, obj).isCreature) {
      const tappers = state.players[player].battlefield.filter((tid) => {
        const t = state.objects[tid];
        const c = chars(state, t);
        return tid !== id && c.isCreature && !t.tapped && c.power > 0;
      });
      let power = 0;
      const used = [];
      for (const tid of tappers) {
        used.push(tid);
        power += chars(state, state.objects[tid]).power;
        if (power >= face.crew) break;
      }
      if (power >= face.crew) {
        const action = { type: 'crew', id, tappers: used };
        if (tryAction(state, player, action)) return action;
      }
    }
  }
  for (const id of state.players[player].battlefield) {
    const obj = state.objects[id];
    const face = faceOfCard(state, obj);
    const abilities = (face?.abilities || []).filter((ab) => ab.kind === 'activated' || ab.kind === 'loyalty');
    for (let index = 0; index < abilities.length; index++) {
      const ab = abilities[index];
      if (!costly(ab)) continue;
      const action = { type: 'activate', id, index, targets: guessTargets(state, player, ab.effects || []) };
      if (tryAction(state, player, action)) return action;
    }
  }
  return null;
}

function chooseAttackers(state, player, diff) {
  const ids = [];
  const blockers = state.players[other(player)].battlefield
    .map((id) => state.objects[id])
    .filter((obj) => obj && chars(state, obj).isCreature && !obj.tapped);
  for (const id of state.players[player].battlefield) {
    const obj = state.objects[id];
    const c = chars(state, obj);
    if (!c.isCreature || c.defender || c.cantAttack || obj.tapped) continue;
    if (obj.sick && !c.haste) continue;
    if (diff === 'easy') {
      ids.push(id);
      continue;
    }
    const catchers = blockers.filter((b) => canBlock(state, b, obj));
    if (!catchers.length || c.trample || c.indestructible) {
      ids.push(id);
      continue;
    }
    const biggest = catchers.reduce((max, b) => Math.max(max, chars(state, b).power), 0);
    if (c.toughness > biggest) ids.push(id);
  }
  const action = { type: 'attackers', ids, targets: {} };
  return tryAction(state, player, action) ? action : { type: 'attackers', ids: [], targets: {} };
}

function chooseBlockers(state, player, diff) {
  const pairs = [];
  const used = new Set();
  const attackers = (state.attackers || []).map((id) => state.objects[id]).filter(Boolean);
  attackers.sort((a, b) => chars(state, b).power - chars(state, a).power);
  const mine = state.players[player].battlefield
    .map((id) => state.objects[id])
    .filter((obj) => obj && chars(state, obj).isCreature && !obj.tapped);
  for (const attacker of attackers) {
    const ac = chars(state, attacker);
    const need = ac.menace ? 2 : 1;
    const options = mine.filter((b) => !used.has(b.id) && canBlock(state, b, attacker));
    if (options.length < need) continue;
    const life = state.players[player].life;
    if (diff !== 'easy' && ac.power < 3 && ac.power < life) continue;
    options.sort((a, b) => chars(state, a).power + chars(state, a).toughness - (chars(state, b).power + chars(state, b).toughness));
    const picks = options.slice(0, need);
    const throws = picks.every((b) => chars(state, b).toughness <= ac.power && chars(state, b).power < ac.toughness);
    if (throws && diff === 'hard' && ac.power < life) continue;
    for (const b of picks) {
      used.add(b.id);
      pairs.push({ blocker: b.id, attacker: attacker.id });
    }
  }
  const action = { type: 'blockers', pairs };
  return tryAction(state, player, action) ? action : { type: 'blockers', pairs: [] };
}

function choosePriority(state, player, diff) {
  const mine = state.active === player;
  const main = mine && state.stack.length === 0 && (state.step === 'precombat' || state.step === 'postcombat');
  if (main && state.players[player].landsPlayed < 1) {
    const land = castableIds(state, player).find((id) => chars(state, state.objects[id]).isLand);
    if (land) {
      const action = { type: 'playLand', id: land };
      if (tryAction(state, player, action)) return action;
    }
  }
  if (main) {
    const cast = considerCasts(state, player, diff, false);
    if (cast) return cast;
    const extra = considerExtras(state, player);
    if (extra) return extra;
  } else if (state.priority === player) {
    const trick = considerCasts(state, player, diff, true);
    if (trick) return trick;
  }
  return { type: 'pass' };
}

export function chooseAction(state, player, diff = 'medium') {
  if (state.pending?.player === player) return answerPending(state, player, diff);
  if (state.awaiting === 'attackers' && state.active === player) return chooseAttackers(state, player, diff);
  if (state.awaiting === 'blockers' && other(state.active) === player) return chooseBlockers(state, player, diff);
  return choosePriority(state, player, diff);
}

export function fallback(state, player) {
  if (state.pending?.player === player) {
    const pending = state.pending;
    if (pending.kind === 'mulligan') return { type: 'answer', value: { keep: true } };
    if (pending.kind === 'bottom') return { type: 'answer', value: { ids: state.players[player].hand.slice(0, pending.n || 1) } };
    if (pending.kind === 'playDraw') return { type: 'answer', value: { first: player } };
    if (pending.kind === 'stackTargets') return { type: 'answer', value: { targets: [] } };
    if (pending.kind === 'manifest') return { type: 'answer', value: { manifest: pending.ids?.[0] } };
    if (pending.kind === 'dungeon') return { type: 'answer', value: { name: pending.dungeons?.[0] } };
    if (pending.kind === 'dungeonRoom') return { type: 'answer', value: { name: pending.rooms?.[0] } };
    if (pending.kind === 'discard' || pending.kind === 'discardHand') {
      return { type: 'answer', value: { ids: state.players[player].hand.slice(0, pending.n || 1) } };
    }
    if (pending.kind === 'scry' || pending.kind === 'surveil') return { type: 'answer', value: { top: [] } };
    if (pending.kind === 'ward') return { type: 'answer', value: { pay: false } };
    if (pending.kind === 'legend') return { type: 'answer', value: { keep: pending.ids?.[0] } };
    if (pending.kind === 'searchLand') return { type: 'answer', value: { basic: 'W' } };
    if (pending.kind === 'rummage') return { type: 'answer', value: { ids: [] } };
    return { type: 'answer', value: {} };
  }
  if (state.awaiting === 'attackers') return { type: 'attackers', ids: [], targets: {} };
  if (state.awaiting === 'blockers') return { type: 'blockers', pairs: [] };
  return { type: 'pass' };
}
