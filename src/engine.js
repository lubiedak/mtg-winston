/**
 * Silnik dwuosobowej partii Magic.
 * Tura, priorytet, stos, mana, walka i akcje stanu są rozgrywane według
 * Comprehensive Rules. Efekty biorą się z parsera oracle; nierozpoznany
 * fragment nie jest zgadywany.
 */
import { parseManaCost, spend, addMana, manaValueOf } from './mana.js';
import { shuffle } from './util.js';

const PLAYERS = ['human', 'ai'];
const STEPS = [
  'untap', 'upkeep', 'draw', 'precombat',
  'beginCombat', 'declareAttackers', 'declareBlockers', 'firstStrike', 'combat', 'endCombat',
  'postcombat', 'end', 'cleanup',
];

export const STEP_LABEL = {
  untap: 'odtapianie',
  upkeep: 'utrzymanie',
  draw: 'dobieranie',
  precombat: 'pierwsza główna',
  beginCombat: 'początek walki',
  declareAttackers: 'atakujący',
  declareBlockers: 'blokujący',
  firstStrike: 'obrażenia pierwszeństwa',
  combat: 'obrażenia walki',
  endCombat: 'koniec walki',
  postcombat: 'druga główna',
  end: 'koniec tury',
  cleanup: 'porządki',
};

const catalogs = new Map();
let catSeq = 1;

export function registerCatalog(byId, dungeons = []) {
  const key = `cat${catSeq++}`;
  catalogs.set(key, { byId, dungeons });
  return key;
}

export function catalogOf(state) {
  return catalogs.get(state.catalogKey);
}

export function other(player) {
  return player === 'human' ? 'ai' : 'human';
}

function rnd(state) {
  state.seed = (Math.imul(state.seed >>> 0, 1664525) + 1013904223) >>> 0;
  return state.seed / 4294967296;
}

function log(state, text) {
  state.log.push(text);
  if (state.log.length > 400) state.log.splice(0, state.log.length - 400);
}

export function defOf(state, defId) {
  return catalogOf(state).byId.get(defId) || null;
}

function faceOf(state, obj) {
  if (obj.tokenSpec) return null;
  const def = defOf(state, obj.defId);
  if (!def) return null;
  return def.faces[obj.face] || def.faces[0];
}

function baseTypes(state, obj) {
  if (obj.faceDown) return ['Creature'];
  if (obj.tokenSpec) return obj.tokenSpec.types.slice();
  const face = faceOf(state, obj);
  let types = face ? face.types.slice() : [];
  if (obj.enchantmentOnly) types = ['Enchantment'];
  if ((obj.counters.time || 0) > 0) types = types.filter((t) => t !== 'Creature');
  if (obj.crewed && !types.includes('Creature')) types.push('Creature');
  return types;
}

export function chars(state, obj) {
  const face = faceOf(state, obj);
  const types = baseTypes(state, obj);
  const isCreature = types.includes('Creature');
  const isLand = types.includes('Land');
  const isArtifact = types.includes('Artifact');
  const isEnchantment = types.includes('Enchantment');
  const isPlaneswalker = types.includes('Planeswalker');
  const isAura = !!(face && face.enchant) || (obj.tokenSpec && obj.tokenSpec.aura);
  let keywords = [];
  let power = 0;
  let toughness = 0;
  let loyalty = obj.counters.loyalty ?? null;
  let name = '';
  let manaCost = '';
  let cmc = 0;
  if (obj.faceDown) {
    name = '';
    power = 2;
    toughness = 2;
    cmc = 0;
  } else if (obj.tokenSpec) {
    const t = obj.tokenSpec;
    name = t.name;
    keywords = (t.keywords || []).slice();
    power = t.power === 'X' ? (t.xValue || 0) : (t.power || 0);
    toughness = t.toughness === 'X' ? (t.xValue || 0) : (t.toughness || 0);
    if (t.treasure) name = 'Treasure';
  } else if (face) {
    name = face.name;
    keywords = face.keywords.slice();
    power = Number(face.power ?? 0);
    toughness = Number(face.toughness ?? 0);
    manaCost = face.manaCost;
    cmc = face.cmc || 0;
    if (face.saga) name = face.name;
  }
  const plus = obj.counters['+1/+1'] || 0;
  const minus = obj.counters['-1/-1'] || 0;
  power += plus - minus;
  toughness += plus - minus;
  for (const mod of obj.mods) {
    if (mod.power) power += mod.power;
    if (mod.toughness) toughness += mod.toughness;
    if (mod.keywords) keywords.push(...mod.keywords);
  }
  for (const otherId of state.players[obj.controller]?.battlefield || []) {
    if (otherId === obj.id) continue;
    const source = state.objects[otherId];
    if (!source || source.zone !== 'battlefield') continue;
    for (const st of staticsOf(state, source)) {
      if (st.kind === 'anthem' && isCreature && source.controller === obj.controller) {
        power += st.power || 0;
        toughness += st.toughness || 0;
        keywords.push(...(st.keywords || []));
      }
      if (st.kind === 'basePtCount' && isCreature && source.controller === obj.controller) {
        const n = creatures(state, obj.controller).length;
        power = n + plus - minus;
        toughness = n + plus - minus;
        for (const mod of obj.mods) {
          power += mod.power || 0;
          toughness += mod.toughness || 0;
        }
      }
      if (st.kind === 'grant' && source.controller === obj.controller && (!st.other || source.id !== obj.id)) {
        keywords.push(...st.keywords);
      }
      if (st.kind === 'deliriumPt' && source.id === obj.id && delirium(state, obj.controller)) {
        power += st.power;
        toughness += st.toughness;
      }
    }
  }
  const attachedBonus = attachmentBonus(state, obj);
  power += attachedBonus.power;
  toughness += attachedBonus.toughness;
  keywords.push(...attachedBonus.keywords);
  keywords = [...new Set(keywords)];
  const sickTap = isCreature && obj.sick && !keywords.includes('Haste');
  return {
    name, types, keywords, power, toughness, loyalty, manaCost, cmc,
    isCreature, isLand, isArtifact, isEnchantment, isPlaneswalker, isAura,
    flying: keywords.includes('Flying'),
    reach: keywords.includes('Reach'),
    trample: keywords.includes('Trample'),
    vigilance: keywords.includes('Vigilance'),
    haste: keywords.includes('Haste'),
    menace: keywords.includes('Menace'),
    deathtouch: keywords.includes('Deathtouch'),
    lifelink: keywords.includes('Lifelink'),
    defender: keywords.includes('Defender'),
    firstStrike: keywords.includes('First strike'),
    doubleStrike: keywords.includes('Double strike'),
    hexproof: keywords.includes('Hexproof'),
    indestructible: keywords.includes('Indestructible'),
    flash: keywords.includes('Flash') || !!(face && face.flash),
    convoke: keywords.includes('Convoke') || !!(face && face.convoke),
    prowess: keywords.includes('Prowess'),
    ward: face?.ward || null,
    sickTap,
    unblockable: obj.flags.includes('unblockable') || staticFlag(state, obj, 'unblockable'),
    cantBlock: obj.flags.includes('cantBlock') || staticFlag(state, obj, 'cantBlock'),
    cantAttack: obj.flags.includes('cantAttack'),
  };
}

function attachmentBonus(state, obj) {
  let power = 0;
  let toughness = 0;
  const keywords = [];
  for (const aid of obj.attachments || []) {
    const att = state.objects[aid];
    if (!att) continue;
    for (const st of staticsOf(state, att)) {
      if (st.kind === 'attached') {
        power += st.power || 0;
        toughness += st.toughness || 0;
        keywords.push(...(st.keywords || []));
      }
    }
  }
  return { power, toughness, keywords };
}

function staticFlag(state, obj, flag) {
  for (const st of staticsOf(state, obj)) {
    if (st.kind === 'selfFlag' && st.flag === flag) return true;
  }
  return false;
}

function staticsOf(state, obj) {
  if (obj.faceDown) return [];
  if (obj.zone !== 'battlefield' && obj.zone !== 'stack') return [];
  const face = faceOf(state, obj);
  if (!face) return obj.tokenSpec ? [] : [];
  let list = face.statics.slice();
  if (face.levels) {
    list = [];
    for (const lv of face.levels) {
      if (lv.level <= (obj.classLevel || 1)) list.push(...lv.statics);
    }
  }
  if (face.room || obj.room) {
    list = [];
    const doors = obj.room || [false, false];
    const def = defOf(state, obj.defId);
    doors.forEach((open, i) => {
      if (open && def.faces[i]) list.push(...def.faces[i].statics);
    });
  }
  return list;
}

function triggersOf(state, obj) {
  if (obj.faceDown || obj.zone !== 'battlefield') return [];
  const face = faceOf(state, obj);
  if (!face) return [];
  if (obj.room) {
    const def = defOf(state, obj.defId);
    const list = [];
    obj.room.forEach((open, i) => {
      if (open && def.faces[i]) list.push(...def.faces[i].triggers);
    });
    return list;
  }
  if (face.levels) {
    return face.levels.filter((lv) => lv.level <= (obj.classLevel || 1)).flatMap((lv) => lv.triggers);
  }
  return face.triggers.slice();
}

function abilitiesOf(state, obj) {
  if (obj.faceDown) return [];
  const face = faceOf(state, obj);
  const list = [];
  if (obj.tokenSpec?.treasure) {
    list.push({
      kind: 'mana',
      cost: { tap: true, sacrifice: true, mana: parseManaCost(''), payLife: 0 },
      produce: { any: 1 },
      text: '{T}, Sacrifice: Add one mana of any color',
    });
  }
  if (!face) return list;
  if (obj.room) {
    const def = defOf(state, obj.defId);
    obj.room.forEach((open, i) => {
      if (open && def.faces[i]) list.push(...def.faces[i].abilities);
    });
  } else if (face.levels) {
    for (const lv of face.levels) {
      if (lv.level <= (obj.classLevel || 1)) list.push(...lv.abilities);
    }
    list.push(...face.abilities);
  } else {
    list.push(...face.abilities);
  }
  if (face.equip) {
    list.push({
      kind: 'activated',
      equip: true,
      sorcery: true,
      cost: { mana: face.equip.cost, tap: false, sacrifice: false, payLife: 0 },
      effects: [{ op: 'equip', target: { kind: 'creature', controller: 'you', count: 1 } }],
      unparsed: [],
      text: `Equip ${face.equip.cost.text}`,
    });
  }
  if (face.crew) {
    list.push({ kind: 'crew', crew: face.crew, sorcery: false, text: `Crew ${face.crew}` });
  }
  return list;
}

export function manaAbilities(state, obj) {
  return abilitiesOf(state, obj).filter((a) => a.kind === 'mana');
}

function creatures(state, player) {
  return state.players[player].battlefield
    .map((id) => state.objects[id])
    .filter((obj) => obj && chars(state, obj).isCreature);
}

function delirium(state, player) {
  const types = new Set();
  for (const id of state.players[player].graveyard) {
    const obj = state.objects[id];
    if (!obj || obj.token) continue;
    for (const t of baseTypes(state, obj)) types.add(t);
  }
  return types.size >= 4;
}

function removeFromZone(state, obj) {
  for (const p of PLAYERS) {
    const pl = state.players[p];
    for (const zone of ['library', 'hand', 'graveyard', 'exile', 'sideboard', 'battlefield']) {
      const i = pl[zone].indexOf(obj.id);
      if (i >= 0) pl[zone].splice(i, 1);
    }
  }
  state.stack = state.stack.filter((s) => s.objectId !== obj.id || obj.zone === 'stack');
}

function detach(state, obj) {
  if (obj.attachedTo) {
    const host = state.objects[obj.attachedTo];
    if (host) host.attachments = host.attachments.filter((id) => id !== obj.id);
    obj.attachedTo = null;
  }
  for (const aid of obj.attachments.slice()) {
    const att = state.objects[aid];
    if (!att) continue;
    att.attachedTo = null;
    if (chars(state, att).isAura) move(state, att.id, 'graveyard');
  }
  obj.attachments = [];
}

function move(state, id, zone, controller = null) {
  const obj = state.objects[id];
  if (!obj) return;
  const from = obj.zone;
  const wasCreature = from === 'battlefield' && chars(state, obj).isCreature;
  const diedController = obj.controller;
  const leavingTriggers = from === 'battlefield' ? triggersOf(state, obj).slice() : null;
  if (from === 'battlefield') detach(state, obj);
  removeFromZone(state, obj);
  obj.zone = zone;
  if (zone === 'battlefield') {
    obj.controller = controller || obj.controller || obj.owner;
    state.players[obj.controller].battlefield.push(id);
    obj.enteredThisTurn = true;
    obj.sick = true;
    obj.damage = 0;
    if (chars(state, obj).isCreature) {
      state.entered[obj.controller] = (state.entered[obj.controller] || 0) + 1;
    }
  } else if (zone === 'graveyard') {
    state.players[obj.owner].graveyard.push(id);
    obj.controller = obj.owner;
  } else if (zone === 'hand') {
    state.players[obj.owner].hand.push(id);
    obj.controller = obj.owner;
  } else if (zone === 'library') {
    state.players[obj.owner].library.unshift(id);
    obj.controller = obj.owner;
  } else if (zone === 'exile') {
    state.players[obj.owner].exile.push(id);
    obj.controller = obj.owner;
  } else if (zone === 'sideboard') {
    state.players[obj.owner].sideboard.push(id);
  } else if (zone === 'stack') {
    obj.controller = controller || obj.controller;
  }
  if (from === 'battlefield' && zone === 'graveyard') {
    obj.diedAsCreature = wasCreature;
    queueTriggerEvent(state, 'dies', { sourceId: id, controller: diedController, wasCreature, leavingTriggers });
    if (wasCreature) queueTriggerEvent(state, 'creatureDies', { sourceId: id, controller: diedController, wasCreature });
  }
  if (zone !== 'battlefield' && obj.token && zone !== 'stack') {
    obj.zone = 'ceased';
    removeFromZone(state, obj);
  }
}

function makeObject(state, defId, owner) {
  const id = `o${state.nextId++}`;
  const obj = {
    id, defId, owner, controller: owner, zone: 'library',
    face: 0, faceDown: false, manifested: false, tapped: false, sick: false,
    damage: 0, counters: {}, attachments: [], attachedTo: null, room: null,
    classLevel: 1, mods: [], flags: [], crewed: false, token: false, tokenSpec: null,
    loyaltyUsed: false, once: {}, diedAsCreature: false, cast: null,
    attacking: null, blockers: [], blocking: null, dealtFirst: false,
  };
  state.objects[id] = obj;
  return obj;
}

function queueTriggerEvent(state, event, ctx) {
  state.triggerQueue.push({ event, ctx });
}

function emit(state, event, ctx) {
  queueTriggerEvent(state, event, ctx);
}

function triggerMatches(tr, event, ctx, source) {
  if (tr.once && source.once[tr.event]) return false;
  if (tr.condition === 'delirium' && !delirium(stateOfTrigger, source.controller)) return false;
  if (event === 'enters' && tr.event === 'enters' && ctx.sourceId === source.id) return true;
  if (event === 'enters' && tr.event === 'entersOrAttacks' && ctx.sourceId === source.id) return true;
  if (event === 'attacks' && tr.event === 'entersOrAttacks' && ctx.sourceId === source.id) return true;
  if (event === 'dies' && tr.event === 'dies' && ctx.sourceId === source.id) {
    if (tr.condition === 'wasCreature' && !ctx.wasCreature) return false;
    return true;
  }
  if (event === 'attacks' && tr.event === 'attacks' && ctx.sourceId === source.id) return true;
  if (event === 'youAttack' && tr.event === 'youAttack' && ctx.controller === source.controller) return true;
  if (event === 'attackPlayer' && tr.event === 'attackPlayer' && ctx.controller === source.controller) return true;
  if (event === 'upkeep' && tr.event === 'upkeep' && ctx.player === source.controller) return true;
  if (event === 'end' && tr.event === 'end' && ctx.player === source.controller) return true;
  if (event === 'precombat' && tr.event === 'precombat' && ctx.player === source.controller) return true;
  if (event === 'postcombat' && tr.event === 'postcombat' && ctx.player === source.controller) return true;
  if (event === 'beginCombat' && tr.event === 'beginCombat' && ctx.player === source.controller) return true;
  if (event === 'castNoncreature' && tr.event === 'castNoncreature' && ctx.controller === source.controller) return true;
  if (event === 'magecraft' && (tr.event === 'magecraft' || sourceProwess(tr, source)) && ctx.controller === source.controller) return true;
  if (event === 'gainLife' && tr.event === 'gainLife' && ctx.player === source.controller) return true;
  if (event === 'creatureDies' && tr.event === 'creatureDies' && ctx.controller === source.controller && ctx.wasCreature) return true;
  if (event === 'combatDamagePlayer' && tr.event === 'combatDamagePlayer' && ctx.controller === source.controller) return true;
  if (event === 'combatDamageSelf' && tr.event === 'combatDamageSelf' && ctx.sourceId === source.id) return true;
  if (event === 'unlock' && tr.event === 'unlock' && ctx.sourceId === source.id && (tr.face == null || tr.face === ctx.face)) return true;
  if (event === 'eerie' && tr.event === 'eerie' && ctx.controller === source.controller) return true;
  if (event === 'enchantmentEnters' && tr.event === 'eerie' && ctx.controller === source.controller) return true;
  if (event === 'fullyUnlock' && tr.event === 'eerie' && ctx.controller === source.controller) return true;
  if (event === 'attacksAlone' && tr.event === 'attacksAlone' && ctx.sourceId === source.id) return true;
  if (event === 'becomeLevel' && tr.event === 'becomeLevel' && ctx.sourceId === source.id && ctx.level === tr.level) return true;
  if (event === 'leaveGraveyard' && tr.event === 'leaveGraveyard' && ctx.controller === source.controller) return true;
  return false;
}

let stateOfTrigger = null;

function sourceProwess(tr, source) {
  return false;
}

function flushTriggers(state) {
  stateOfTrigger = state;
  if (!state.triggerQueue.length) return;
  const batch = state.triggerQueue.splice(0, state.triggerQueue.length);
  const order = [state.active, other(state.active)];
  for (const player of order) {
    const mine = [];
    for (const item of batch) {
      for (const id of state.players[player].battlefield) {
        const obj = state.objects[id];
        if (!obj || obj.controller !== player) continue;
        for (const tr of triggersOf(state, obj)) {
          if (!triggerMatches(tr, item.event, item.ctx, obj)) continue;
          if (tr.condition === 'packTactics') {
            const total = (state.attackers || []).reduce((sum, aid) => sum + chars(state, state.objects[aid]).power, 0);
            if (total < 6) continue;
          }
          if (tr.condition === 'survival' && !(state.entered[player] > 0)) continue;
          if (tr.condition === 'delirium' && !delirium(state, player)) continue;
          if (tr.once) obj.once[tr.event] = true;
          mine.push({ obj, tr, ctx: item.ctx });
        }
        if (item.event === 'magecraft' && chars(state, obj).prowess && item.ctx.controller === player) {
          mine.push({
            obj,
            tr: { effects: [{ op: 'pump', power: 1, toughness: 1, keywords: [], until: 'eot', target: { kind: 'self' } }], text: 'Prowess', unparsed: [] },
            ctx: item.ctx,
          });
        }
      }
      if (item.ctx?.leavingTriggers && item.ctx.controller === player) {
        const gone = state.objects[item.ctx.sourceId];
        if (gone) {
          for (const tr of item.ctx.leavingTriggers) {
            if (!triggerMatches(tr, item.event, item.ctx, gone)) continue;
            mine.push({ obj: gone, tr, ctx: item.ctx });
          }
        }
      }
    }
    for (const entry of mine) {
      state.stack.push({
        id: `s${state.nextId++}`,
        kind: 'trigger',
        controller: player,
        sourceId: entry.obj.id,
        objectId: null,
        effects: entry.tr.effects || [],
        choose: entry.tr.choose || null,
        chosen: [],
        targets: [],
        unparsed: entry.tr.unparsed || [],
        description: entry.tr.text || 'zdolność wyzwalana',
        needsTargets: effectsNeedTarget(entry.tr.effects, entry.tr.choose),
      });
    }
  }
  if (state.stack.some((s) => s.needsTargets && !s.targets.length && s.controller)) {
    const item = state.stack.find((s) => s.needsTargets && !s.targets.length);
    if (item) askTargets(state, item);
  }
}

function effectsNeedTarget(effects, choose) {
  const pool = [...(effects || [])];
  if (choose) for (const opt of choose.options) pool.push(...(opt.effects || []));
  return pool.some((e) => (e.target && e.target.kind !== 'self') || (e.targets && e.targets.some((t) => t.kind !== 'self')));
}

function askTargets(state, item) {
  state.pending = {
    player: item.controller,
    kind: 'stackTargets',
    stackId: item.id,
    text: item.description,
  };
}

export function createGame(options) {
  const state = {
    catalogKey: options.catalogKey,
    seed: options.seed >>> 0 || 1,
    players: {},
    objects: {},
    nextId: 1,
    stack: [],
    triggerQueue: [],
    log: [],
    active: options.starting || 'human',
    priority: options.starting || 'human',
    startingPlayer: options.starting || 'human',
    turn: 1,
    step: 'untap',
    phase: 'mulligan',
    passed: { human: false, ai: false },
    awaiting: null,
    pending: null,
    gameOver: null,
    skipDraw: true,
    entered: { human: 0, ai: 0 },
    attackers: [],
    lifeGained: { human: 0, ai: 0 },
    spellsCast: { human: 0, ai: 0 },
    instantSorceryCast: { human: 0, ai: 0 },
    dungeonDone: { human: [], ai: [] },
  };
  for (const p of PLAYERS) {
    state.players[p] = {
      life: 20, library: [], hand: [], graveyard: [], exile: [], sideboard: [],
      battlefield: [], mana: [], landsPlayed: 0, maxHand: 7, mulligans: 0,
      kept: false, locked: false, dungeon: null, drewFromEmpty: false,
    };
  }
  const decks = { human: options.humanDeck || [], ai: options.aiDeck || [] };
  const sides = { human: options.humanSide || [], ai: options.aiSide || [] };
  for (const p of PLAYERS) {
    const ids = [];
    for (const defId of decks[p]) {
      const obj = makeObject(state, defId, p);
      ids.push(obj.id);
    }
    const order = shuffle(ids, () => rnd(state));
    for (const id of order) {
      state.objects[id].zone = 'library';
      state.players[p].library.push(id);
    }
    for (const defId of sides[p]) {
      const obj = makeObject(state, defId, p);
      obj.zone = 'sideboard';
      state.players[p].sideboard.push(obj.id);
    }
  }
  state.forceStart = !!options.forceStart;
  if (options.chooseStart) {
    state.phase = 'chooseStart';
    state.pending = {
      player: options.chooser || other(state.startingPlayer),
      kind: 'playDraw',
      text: 'Gracz, który draftował jako drugi, wybiera, kto zaczyna.',
    };
  } else if (options.skipMulligan) {
    dealOpening(state);
    for (const p of PLAYERS) state.players[p].kept = true;
    state.phase = 'play';
    state.skipDraw = true;
    beginTurn(state);
  } else {
    dealOpening(state);
    state.pending = { player: state.startingPlayer, kind: 'mulligan', text: 'Zatrzymać rękę czy wziąć mulligan?' };
  }
  return state;
}

function dealOpening(state) {
  if (state.dealt) return;
  state.dealt = true;
  for (const p of PLAYERS) drawCards(state, p, 7);
  log(state, 'Partia się zaczyna. Każdy dobiera siedem kart.');
}

function drawCards(state, player, n) {
  const drawn = [];
  for (let i = 0; i < n; i++) {
    const lib = state.players[player].library;
    if (!lib.length) {
      state.players[player].drewFromEmpty = true;
      log(state, `${who(player)} nie może dobrać karty — talia jest pusta.`);
      break;
    }
    const id = lib.shift();
    state.objects[id].zone = 'hand';
    state.players[player].hand.push(id);
    drawn.push(id);
  }
  return drawn;
}

function who(player) {
  return player === 'human' ? 'Ty' : 'Komputer';
}

function beginTurn(state) {
  state.entered = { human: 0, ai: 0 };
  state.lifeGained = { human: 0, ai: 0 };
  state.spellsCast = { human: 0, ai: 0 };
  state.instantSorceryCast = { human: 0, ai: 0 };
  state.players[state.active].landsPlayed = 0;
  for (const id of state.players[state.active].battlefield) {
    const obj = state.objects[id];
    obj.sick = false;
    obj.loyaltyUsed = false;
    obj.once = {};
  }
  for (const p of PLAYERS) {
    for (const id of state.players[p].battlefield) {
      const obj = state.objects[id];
      obj.attacking = null;
      obj.blockers = [];
      obj.blocking = null;
      obj.dealtFirst = false;
    }
  }
  state.attackers = [];
  state.step = 'untap';
  enterStep(state);
}

function enterStep(state) {
  state.passed = { human: false, ai: false };
  state.awaiting = null;
  const step = state.step;
  if (step === 'untap') {
    for (const id of state.players[state.active].battlefield.slice()) {
      const obj = state.objects[id];
      if ((obj.counters.stun || 0) > 0) {
        obj.counters.stun -= 1;
        log(state, `${nameOf(state, obj)} ma żeton ogłuszenia i nie odtapia się.`);
      } else if (!frozen(state, obj)) obj.tapped = false;
    }
    state.step = 'upkeep';
    enterStep(state);
    return;
  }
  if (step === 'upkeep') {
    emit(state, 'upkeep', { player: state.active });
    for (const id of battlefieldAll(state)) {
      const obj = state.objects[id];
      if ((obj.counters.time || 0) > 0 && obj.controller === state.active) {
        /* time counters leave at end step, not upkeep */
      }
    }
  }
  if (step === 'draw') {
    if (state.skipDraw && state.turn === 1 && state.active === state.startingPlayer) {
      state.skipDraw = false;
      log(state, `${who(state.active)} pomija krok dobierania w pierwszej turze.`);
      state.step = 'precombat';
      enterStep(state);
      return;
    }
    drawCards(state, state.active, 1);
    log(state, `${who(state.active)} dobiera kartę.`);
  }
  if (step === 'declareAttackers') state.awaiting = 'attackers';
  if (step === 'declareBlockers') state.awaiting = 'blockers';
  if (step === 'firstStrike') {
    if (!anyFirstStrike(state)) {
      state.step = 'combat';
      enterStep(state);
      return;
    }
    dealCombatDamage(state, true);
  }
  if (step === 'combat') dealCombatDamage(state, false);
  if (step === 'end') {
    emit(state, 'end', { player: state.active });
    for (const id of state.players[state.active].battlefield.slice()) {
      const obj = state.objects[id];
      if ((obj.counters.time || 0) > 0) {
        obj.counters.time -= 1;
        log(state, `${nameOf(state, obj)} traci żeton czasu (${obj.counters.time} zostało).`);
        if (obj.counters.time <= 0) log(state, `${nameOf(state, obj)} jest już stworzeniem.`);
      }
    }
  }
  if (step === 'postcombat') emit(state, 'postcombat', { player: state.active });
  if (step === 'precombat') {
    for (const id of state.players[state.active].battlefield.slice()) {
      const obj = state.objects[id];
      const face = faceOf(state, obj);
      if (!face?.saga?.chapters?.length) continue;
      obj.counters.lore = (obj.counters.lore || 0) + 1;
      log(state, `${nameOf(state, obj)} dostaje żeton wiedzy (${obj.counters.lore}).`);
      sagaChapter(state, obj);
    }
    const hanging = state.stack.find((s) => s.needsTargets && !(s.targets || []).length);
    if (hanging && !state.pending) askTargets(state, hanging);
    emit(state, 'precombat', { player: state.active });
  }
  if (step === 'beginCombat') emit(state, 'beginCombat', { player: state.active });
  if (step === 'cleanup') {
    cleanup(state);
    return;
  }
  state.priority = state.awaiting === 'blockers' ? other(state.active) : state.active;
  stabilize(state);
}

function frozen(state, obj) {
  for (const aid of obj.attachments) {
    const att = state.objects[aid];
    if (!att) continue;
    if (staticsOf(state, att).some((s) => s.kind === 'freezeAttached')) return true;
  }
  return false;
}

function battlefieldAll(state) {
  return PLAYERS.flatMap((p) => state.players[p].battlefield);
}

function anyFirstStrike(state) {
  for (const p of PLAYERS) {
    for (const id of state.players[p].battlefield) {
      const obj = state.objects[id];
      if (!obj.attacking && !obj.blocking) continue;
      const c = chars(state, obj);
      if (c.firstStrike || c.doubleStrike) return true;
    }
  }
  return false;
}

function handLimit(state, player) {
  for (const id of state.players[player].battlefield) {
    const obj = state.objects[id];
    if (obj && staticsOf(state, obj).some((s) => s.kind === 'noMaxHand')) return Infinity;
  }
  return state.players[player].maxHand;
}

function cleanup(state) {
  const p = state.active;
  const hand = state.players[p].hand;
  const limit = handLimit(state, p);
  const extra = Number.isFinite(limit) ? hand.length - limit : 0;
  if (extra > 0) {
    state.pending = { player: p, kind: 'discardHand', n: extra, text: `Odrzuć ${extra} kart na koniec tury.` };
    return;
  }
  finishCleanup(state);
}

function revertTemporaryControl(state) {
  const back = [];
  for (const id of battlefieldAll(state)) {
    const obj = state.objects[id];
    for (const mod of obj.mods) {
      if (mod.control && (mod.until === 'eot' || mod.until === 'eoc') && obj.controller !== mod.control) back.push([obj, mod.control]);
    }
  }
  for (const [obj, controller] of back) {
    removeFromZone(state, obj);
    obj.controller = controller;
    obj.zone = 'battlefield';
    obj.sick = true;
    state.players[controller].battlefield.push(obj.id);
  }
}

function finishCleanup(state) {
  revertTemporaryControl(state);
  for (const id of battlefieldAll(state)) {
    const obj = state.objects[id];
    obj.damage = 0;
    obj.mods = obj.mods.filter((m) => m.until === 'yourNextTurn');
    obj.flags = obj.flags.filter((f) => f === 'keep');
    obj.crewed = false;
  }
  emptyMana(state);
  for (const p of PLAYERS) {
    for (const id of state.players[p].exile) {
      if (state.objects[id]) state.objects[id].impulse = false;
    }
  }
  const queued = state.triggerQueue.length;
  stabilize(state);
  if (state.pending || state.gameOver) return;
  if (state.triggerQueue.length || state.stack.length || queued) {
    state.priority = state.active;
    return;
  }
  state.active = other(state.active);
  state.turn += 1;
  log(state, `— Tura ${state.turn}: ${who(state.active)}.`);
  beginTurn(state);
}

function emptyMana(state) {
  for (const p of PLAYERS) state.players[p].mana = [];
}

function advanceStep(state) {
  emptyMana(state);
  if (state.step === 'endCombat') {
    for (const id of battlefieldAll(state)) {
      state.objects[id].mods = state.objects[id].mods.filter((m) => m.until !== 'eoc');
    }
  }
  const i = STEPS.indexOf(state.step);
  state.step = STEPS[i + 1] || 'cleanup';
  enterStep(state);
}

function stabilize(state) {
  let guard = 0;
  while (guard++ < 12) {
    if (state.gameOver) return;
    const before = state.pending;
    stateBased(state);
    if (state.gameOver || state.pending) return;
    const q = state.triggerQueue.length;
    flushTriggers(state);
    if (state.pending) return;
    if (!q && state.triggerQueue.length === 0 && !before) return;
    if (state.triggerQueue.length === 0) return;
  }
}

function stateBased(state) {
  const losers = PLAYERS.filter((p) => state.players[p].life <= 0 || state.players[p].drewFromEmpty);
  if (losers.length === 2) {
    state.gameOver = { draw: true, reason: 'Obaj gracze przegrywają w tym samym momencie. Remis.' };
    return;
  }
  if (losers.length === 1) {
    const winner = other(losers[0]);
    const why = state.players[losers[0]].life <= 0 ? 'punkty życia spadły do zera' : 'nie można było dobrać karty';
    state.gameOver = { winner, reason: `${who(losers[0])}: ${why}.` };
    log(state, state.gameOver.reason);
    return;
  }
  for (const id of battlefieldAll(state).slice()) {
    const obj = state.objects[id];
    if (!obj || obj.zone !== 'battlefield') continue;
    const c = chars(state, obj);
    const plus = obj.counters['+1/+1'] || 0;
    const minus = obj.counters['-1/-1'] || 0;
    const cut = Math.min(plus, minus);
    if (cut) {
      obj.counters['+1/+1'] = plus - cut;
      obj.counters['-1/-1'] = minus - cut;
    }
    if (c.isCreature && (c.toughness <= 0 || obj.damage >= c.toughness) && !c.indestructible) {
      log(state, `${nameOf(state, obj)} trafia na cmentarz (obrażenia albo wytrzymałość).`);
      move(state, id, 'graveyard');
      continue;
    }
    if (c.isCreature && c.toughness <= 0 && c.indestructible) {
      log(state, `${nameOf(state, obj)} ma wytrzymałość 0 i ginie mimo niezniszczalności.`);
      move(state, id, 'graveyard');
      continue;
    }
    if (c.isPlaneswalker && (obj.counters.loyalty || 0) <= 0) {
      log(state, `${nameOf(state, obj)} ma 0 lojalności i trafia na cmentarz.`);
      move(state, id, 'graveyard');
      continue;
    }
    if (c.isAura && !obj.attachedTo) {
      move(state, id, 'graveyard');
      continue;
    }
    const saga = faceOf(state, obj)?.saga;
    if (!state.pending && saga?.chapters?.length && (obj.counters.lore || 0) >= saga.max) {
      const waiting = state.stack.some((s) => s.sourceId === obj.id && String(s.description || '').startsWith('Saga'));
      if (!waiting) {
        log(state, `${nameOf(state, obj)} kończy sagę i zostaje poświęcona.`);
        move(state, id, 'graveyard');
      }
    }
  }
  const groups = new Map();
  for (const id of battlefieldAll(state)) {
    const obj = state.objects[id];
    const c = chars(state, obj);
    const legendary = (faceOf(state, obj)?.supertypes || []).includes('Legendary') || (defOf(state, obj.defId)?.typeLine || '').includes('Legendary');
    if (!legendary || !c.name || obj.faceDown) continue;
    const key = `${obj.controller}|${c.name}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(id);
  }
  for (const ids of groups.values()) {
    if (ids.length < 2) continue;
    const owner = state.objects[ids[0]].controller;
    if (owner === 'ai') {
      const keep = ids.slice().sort((a, b) => chars(state, state.objects[b]).power - chars(state, state.objects[a]).power)[0];
      for (const id of ids) if (id !== keep) move(state, id, 'graveyard');
      log(state, 'Zasada legend: komputer zostawia jedną kopię.');
    } else {
      state.pending = { player: owner, kind: 'legend', ids, text: 'Zasada legend: zostaw jedną kartę, reszta idzie na cmentarz.' };
      return;
    }
  }
}

function nameOf(state, obj) {
  if (!obj) return 'karta';
  if (obj.faceDown) return 'zakryte stworzenie 2/2';
  return chars(state, obj).name || 'karta';
}

function dealCombatDamage(state, firstOnly) {
  const events = [];
  for (const p of PLAYERS) {
    for (const id of state.players[p].battlefield) {
      const obj = state.objects[id];
      if (!obj.attacking && !obj.blocking) continue;
      const c = chars(state, obj);
      const strikes = firstOnly ? (c.firstStrike || c.doubleStrike) : (c.doubleStrike || !c.firstStrike);
      if (!strikes || obj.damage < 0) continue;
      if (firstOnly && obj.dealtFirst && !c.doubleStrike) continue;
      if (obj.attacking) {
        const blockers = (obj.blockers || []).map((bid) => state.objects[bid]).filter((b) => b && b.zone === 'battlefield');
        assignAttackDamage(state, obj, c, blockers, events);
        if (firstOnly) obj.dealtFirst = true;
      }
    }
  }
  for (const p of PLAYERS) {
    for (const id of state.players[p].battlefield) {
      const obj = state.objects[id];
      if (!obj.blocking) continue;
      const c = chars(state, obj);
      const strikes = firstOnly ? (c.firstStrike || c.doubleStrike) : (c.doubleStrike || !c.firstStrike);
      if (!strikes) continue;
      const atk = state.objects[obj.blocking];
      if (atk && atk.zone === 'battlefield') hurt(state, atk, c.power, obj, events);
    }
  }
  const hitPlayers = new Set();
  for (const ev of events) {
    if (ev.player) hitPlayers.add(ev.attackerController + ':' + ev.player);
  }
  for (const key of hitPlayers) {
    const [controller, player] = key.split(':');
    emit(state, 'combatDamagePlayer', { controller, player });
  }
  stabilize(state);
}

function assignAttackDamage(state, attacker, c, blockers, events) {
  let power = Math.max(0, c.power);
  if (!blockers.length) {
    const tgt = attacker.attacking;
    if (tgt === 'player') {
      loseLife(state, other(attacker.controller), power, { lifelink: c.lifelink, source: attacker });
      events.push({ player: other(attacker.controller), attackerController: attacker.controller });
      emit(state, 'combatDamageSelf', { sourceId: attacker.id, controller: attacker.controller });
    } else {
      const pw = state.objects[tgt];
      if (pw) {
        pw.counters.loyalty = (pw.counters.loyalty || 0) - power;
        if (c.lifelink) gainLife(state, attacker.controller, power);
        log(state, `${nameOf(state, attacker)} zadaje ${power} obrażeń planeswalkerowi ${nameOf(state, pw)}.`);
      }
    }
    return;
  }
  const ordered = blockers.slice();
  for (let i = 0; i < ordered.length; i++) {
    const b = ordered[i];
    const bc = chars(state, b);
    const lethal = c.deathtouch ? 1 : Math.max(0, bc.toughness - b.damage);
    const last = i === ordered.length - 1;
    let dmg = power;
    if (!last) dmg = Math.min(power, lethal);
    else if (c.trample) dmg = Math.min(power, lethal);
    hurt(state, b, dmg, attacker, events);
    power -= dmg;
    if (last && c.trample && power > 0) {
      loseLife(state, other(attacker.controller), power, { lifelink: c.lifelink, source: attacker });
      events.push({ player: other(attacker.controller), attackerController: attacker.controller });
    }
  }
}

function hurt(state, target, amount, source, events) {
  if (amount <= 0 || !target || target.zone !== 'battlefield') return;
  const sc = chars(state, source);
  target.damage += amount;
  if (sc.deathtouch && amount > 0) target.damage = Math.max(target.damage, chars(state, target).toughness);
  if (sc.lifelink) gainLife(state, source.controller, amount);
  log(state, `${nameOf(state, source)} zadaje ${amount} obrażeń: ${nameOf(state, target)}.`);
  if (events && source.attacking) {
    emit(state, 'combatDamageSelf', { sourceId: source.id, controller: source.controller });
  }
}

function loseLife(state, player, n, via = {}) {
  if (n <= 0) return;
  state.players[player].life -= n;
  log(state, `${who(player)} traci ${n} życia (zostało ${state.players[player].life}).`);
  if (via.lifelink && via.source) gainLife(state, via.source.controller, n);
}

function gainLife(state, player, n) {
  if (n <= 0) return;
  let extra = 0;
  for (const id of state.players[player].battlefield) {
    for (const st of staticsOf(state, state.objects[id])) {
      if (st.kind === 'lifegainPlus') extra = Math.max(extra, st.n || 0);
    }
  }
  const total = n + extra;
  state.players[player].life += total;
  state.lifeGained[player] = (state.lifeGained[player] || 0) + total;
  log(state, `${who(player)} zyskuje ${total} życia (ma ${state.players[player].life}).`);
  emit(state, 'gainLife', { player, n: total });
}

function playerHexproof(state, player) {
  for (const id of state.players[player].battlefield) {
    if (staticsOf(state, state.objects[id]).some((s) => s.kind === 'playerHexproof')) return true;
  }
  return false;
}

export function isLegalTarget(state, spec, chosen, controller) {
  if (!spec || spec.kind === 'self' || spec.kind === 'that') return true;
  if (typeof chosen === 'string' && chosen.startsWith('player:')) {
    const p = chosen.slice(7);
    if (spec.kind !== 'player' && spec.kind !== 'any' && spec.kind !== 'opponent') return false;
    if (spec.controller === 'opponent' && p !== other(controller)) return false;
    if (playerHexproof(state, p) && p !== controller) return false;
    return true;
  }
  if (spec.kind === 'spell') return state.stack.some((s) => s.id === chosen || s.objectId === chosen);
  const obj = state.objects[chosen];
  if (!obj) return false;
  if (spec.kind === 'card') {
    const zone = state.players[spec.controller === 'you' ? controller : obj.owner].graveyard;
    if (!zone.includes(obj.id)) return false;
    if (spec.cardType && !baseTypes(state, obj).includes(spec.cardType)) return false;
    if (spec.mvMax != null && (faceOf(state, obj)?.cmc || 0) > spec.mvMax) return false;
    return true;
  }
  if (obj.zone !== 'battlefield') return false;
  const c = chars(state, obj);
  if (spec.controller === 'you' && obj.controller !== controller) return false;
  if (spec.controller === 'opponent' && obj.controller === controller) return false;
  if (spec.other && obj.id === spec.except) return false;
  if (c.hexproof && obj.controller !== controller) return false;
  if (spec.kind === 'creature' && !c.isCreature) return false;
  if (spec.kind === 'artifact' && !c.isArtifact) return false;
  if (spec.kind === 'enchantment' && !c.isEnchantment) return false;
  if (spec.kind === 'land' && !c.isLand) return false;
  if (spec.kind === 'planeswalker' && !c.isPlaneswalker) return false;
  if (spec.kind === 'creatureOrPlaneswalker' && !c.isCreature && !c.isPlaneswalker) return false;
  if (spec.kind === 'any' && !c.isCreature && !c.isPlaneswalker) return false;
  if (spec.tapped && !obj.tapped) return false;
  if (spec.attacking && !obj.attacking) return false;
  if (spec.nonland && c.isLand) return false;
  return spec.kind === 'permanent' || spec.kind === 'creature' || spec.kind === 'artifact' || spec.kind === 'enchantment' || spec.kind === 'land' || spec.kind === 'planeswalker' || spec.kind === 'creatureOrPlaneswalker' || spec.kind === 'any';
}

export function legalTargets(state, spec, controller) {
  return targetsFor(state, spec, controller);
}

function targetsFor(state, spec, controller) {
  const out = [];
  if (spec.kind === 'player' || spec.kind === 'any' || spec.kind === 'opponent') {
    for (const p of PLAYERS) if (isLegalTarget(state, spec, `player:${p}`, controller)) out.push(`player:${p}`);
  }
  if (spec.kind !== 'player' && spec.kind !== 'opponent') {
    for (const id of battlefieldAll(state)) {
      if (isLegalTarget(state, spec, id, controller)) out.push(id);
    }
  }
  if (spec.kind === 'card') {
    for (const p of PLAYERS) {
      for (const id of state.players[p].graveyard) {
        if (isLegalTarget(state, spec, id, controller)) out.push(id);
      }
    }
  }
  if (spec.kind === 'spell') {
    for (const s of state.stack) if (s.kind === 'spell') out.push(s.id);
  }
  return out;
}

export function apply(state, player, action) {
  if (state.gameOver) return { ok: false, error: 'Gra jest skończona.' };
  if (state.pending && action.type !== 'answer') return { ok: false, error: 'Najpierw dokończ wybór.' };
  if (!state.pending && player !== actorNow(state)) return { ok: false, error: 'Teraz nie twoja kolej.' };
  const result = perform(state, player, action);
  if (!result.ok) return result;
  stabilize(state);
  return { ok: true };
}

function actorNow(state) {
  if (state.pending) return state.pending.player;
  if (state.awaiting === 'attackers') return state.active;
  if (state.awaiting === 'blockers') return other(state.active);
  return state.priority;
}

function perform(state, player, action) {
  if (action.type === 'answer') return answer(state, player, action);
  if (action.type === 'pass') return pass(state, player);
  if (action.type === 'playLand') return playLand(state, player, action.id);
  if (action.type === 'cast') return castSpell(state, player, action);
  if (action.type === 'mana') return activateMana(state, player, action);
  if (action.type === 'activate') return activateAbility(state, player, action);
  if (action.type === 'attackers') return declareAttackers(state, player, action.ids || [], action.targets || {});
  if (action.type === 'blockers') return declareBlockers(state, player, action.pairs || []);
  if (action.type === 'unlock') return unlockDoor(state, player, action.id, action.face);
  if (action.type === 'turnUp') return turnFaceUp(state, player, action.id);
  if (action.type === 'cycle') return cycleCard(state, player, action.id);
  if (action.type === 'crew') return crewVehicle(state, player, action.id, action.tappers || []);
  return { ok: false, error: 'Nieznana akcja.' };
}

function pass(state, player) {
  if (state.awaiting) return { ok: false, error: 'Najpierw wskaż atakujących albo blokujących.' };
  state.passed[player] = true;
  const foe = other(player);
  if (!state.passed[foe]) {
    state.priority = foe;
    return { ok: true };
  }
  state.passed = { human: false, ai: false };
  if (state.stack.length) {
    resolveTop(state);
    state.priority = state.active;
    return { ok: true };
  }
  advanceStep(state);
  return { ok: true };
}

function sorcerySpeed(state, player) {
  return state.priority === player && state.active === player && state.stack.length === 0
    && (state.step === 'precombat' || state.step === 'postcombat') && !state.awaiting;
}

function playLand(state, player, id) {
  const obj = state.objects[id];
  const fromImpulse = obj?.zone === 'exile' && obj.impulse && obj.owner === player;
  if (!obj || obj.owner !== player || (obj.zone !== 'hand' && !fromImpulse)) return { ok: false, error: 'Tej karty nie ma w ręce.' };
  if (!sorcerySpeed(state, player)) return { ok: false, error: 'Ląd zagrywa się w swojej głównej fazie, przy pustym stosie.' };
  if (state.players[player].landsPlayed >= 1 && !extraLand(state, player)) return { ok: false, error: 'W tej turze ląd już wszedł.' };
  const c = chars(state, obj);
  if (!c.isLand) return { ok: false, error: 'To nie jest ląd.' };
  state.players[player].landsPlayed += 1;
  obj.impulse = false;
  move(state, id, 'battlefield', player);
  applyEntersTapped(state, obj);
  log(state, `${who(player)} zagrywa ląd: ${nameOf(state, obj)}.`);
  emit(state, 'enters', { sourceId: id, controller: player });
  if (c.isEnchantment) emit(state, 'enchantmentEnters', { controller: player, sourceId: id });
  state.passed = { human: false, ai: false };
  return { ok: true };
}

function extraLand(state, player) {
  return false;
}

function applyEntersTapped(state, obj) {
  for (const st of staticsOf(state, obj)) {
    if (st.kind !== 'entersTapped') continue;
    const lands = state.players[obj.controller].battlefield.filter((id) => id !== obj.id && chars(state, state.objects[id]).isLand).length;
    if (st.unlessLands && lands >= st.unlessLands) continue;
    if (st.ifLands && lands < st.ifLands) continue;
    if (st.unlessLifeAtMost) {
      const low = PLAYERS.some((p) => state.players[p].life <= st.unlessLifeAtMost);
      if (low) continue;
    }
    obj.tapped = true;
  }
}

function castSpell(state, player, action) {
  const obj = state.objects[action.id];
  const fromImpulse = obj?.zone === 'exile' && obj.impulse && obj.owner === player;
  if (!obj || ((obj.zone !== 'hand' && obj.zone !== 'graveyard') && !fromImpulse)) return { ok: false, error: 'Nie można rzucić tej karty.' };
  const def = defOf(state, obj.defId);
  const faceIndex = action.face || 0;
  const face = def.faces[faceIndex];
  if (!face) return { ok: false, error: 'Nie ma takiej strony karty.' };
  if (face.isLand && !face.isCreature) return { ok: false, error: 'Ląd się zagrywa, nie rzuca.' };
  const instant = face.isInstant || face.flash || (face.keywords || []).includes('Flash');
  if (!instant && !sorcerySpeed(state, player)) return { ok: false, error: 'To zaklęcie rzuca się jak sorcery.' };
  if (state.priority !== player) return { ok: false, error: 'Nie masz priorytetu.' };
  let cost = parseManaCost(face.manaCost);
  if (action.impending && face.impending) cost = face.impending.cost;
  if (action.kicker && face.kicker) {
    cost = mergeCost(cost, face.kicker);
  }
  const x = action.x || 0;
  if (cost.x) cost = { ...cost, generic: cost.generic + x, x: false };
  const tax = spellTax(state, player, face);
  cost = { ...cost, generic: Math.max(0, cost.generic + tax) };
  const paid = autoPay(state, player, cost);
  if (!paid) return { ok: false, error: 'Nie starcza many.' };
  commitPay(state, player, paid);
  obj.face = faceIndex;
  obj.impulse = false;
  obj.cast = { impending: !!action.impending, kicker: !!action.kicker, x, modes: action.modes || [] };
  obj.zone = 'stack';
  removeFromZone(state, obj);
  const effects = spellEffectsFor(face, action.modes || []);
  const item = {
    id: `s${state.nextId++}`,
    kind: 'spell',
    controller: player,
    sourceId: obj.id,
    objectId: obj.id,
    effects,
    choose: face.choose,
    chosen: action.modes || [],
    targets: action.targets || [],
    unparsed: face.unparsed || [],
    description: face.name,
    uncounterable: !!face.uncounterable,
    faceIndex,
  };
  if (!targetsOk(state, item, player)) {
    if (fromImpulse) {
      obj.zone = 'exile';
      obj.impulse = true;
      state.players[player].exile.push(obj.id);
    } else {
      obj.zone = 'hand';
      state.players[player].hand.push(obj.id);
    }
    refund(state, player, paid);
    return { ok: false, error: 'Nielegalne cele.' };
  }
  state.stack.push(item);
  state.spellsCast[player] += 1;
  if (face.isInstant || face.isSorcery) state.instantSorceryCast[player] += 1;
  log(state, `${who(player)} rzuca: ${face.name}.`);
  state.passed = { human: false, ai: false };
  if (!(face.isCreature) && (face.isInstant || face.isSorcery)) {
    emit(state, 'magecraft', { controller: player, sourceId: obj.id });
    emit(state, 'castNoncreature', { controller: player, sourceId: obj.id });
  } else if (!face.isCreature) {
    emit(state, 'castNoncreature', { controller: player, sourceId: obj.id });
  }
  wardTriggers(state, item);
  return { ok: true };
}

function spellEffectsFor(face, modes) {
  if (face.choose && modes.length) {
    return modes.flatMap((i) => face.choose.options[i]?.effects || []);
  }
  return face.spellEffects || [];
}

function spellTax(state, player, face) {
  let tax = 0;
  const foe = other(player);
  if (state.active === foe) {
    for (const id of state.players[foe].battlefield) {
      for (const st of staticsOf(state, state.objects[id])) {
        if (st.kind === 'tax') tax += st.generic || 0;
      }
    }
  }
  for (const id of state.players[player].battlefield) {
    for (const st of staticsOf(state, state.objects[id])) {
      if (st.kind === 'reduce' && (face.isInstant || face.isSorcery)) tax -= st.generic || 0;
    }
  }
  return tax;
}

function mergeCost(a, b) {
  return {
    ...a,
    generic: a.generic + b.generic,
    pips: [...a.pips, ...b.pips],
    hybrid: [...a.hybrid, ...b.hybrid],
    phyrexian: [...a.phyrexian, ...b.phyrexian],
    c: a.c + b.c,
    x: a.x || b.x,
  };
}

function targetsOk(state, item, controller) {
  const specs = collectSpecs(item.effects);
  if (!item.targets) item.targets = [];
  if (specs.length && item.targets.length < specs.filter((s) => !s.upTo && !s.optional).length) {
    if (!item.targets.length) return specs.every((s) => s.upTo || s.optional);
  }
  for (let i = 0; i < item.targets.length; i++) {
    const spec = specs[i] || specs[0];
    const chosen = item.targets[i];
    const list = Array.isArray(chosen) ? chosen : [chosen];
    for (const c of list) {
      if (c == null) continue;
      if (!isLegalTarget(state, spec, c, controller)) return false;
    }
  }
  return true;
}

function collectSpecs(effects) {
  const specs = [];
  for (const e of effects || []) {
    if (e.target && e.target.kind !== 'self') specs.push(e.target);
    if (e.targets) specs.push(...e.targets.filter((t) => t.kind !== 'self'));
  }
  return specs;
}

function wardTriggers(state, item) {
  const specs = collectSpecs(item.effects);
  item.targets.forEach((chosen, i) => {
    const list = Array.isArray(chosen) ? chosen : [chosen];
    for (const c of list) {
      if (typeof c !== 'string' || c.startsWith('player:')) continue;
      const obj = state.objects[c];
      if (!obj) continue;
      const w = chars(state, obj).ward;
      if (w && obj.controller !== item.controller) {
        state.stack.push({
          id: `s${state.nextId++}`,
          kind: 'trigger',
          controller: obj.controller,
          sourceId: obj.id,
          effects: [{ op: 'ward', cost: w, spellId: item.id }],
          targets: [],
          unparsed: [],
          description: `Ward ${nameOf(state, obj)}`,
          needsTargets: false,
        });
      }
    }
  });
}

function autoPay(state, player, cost) {
  const sources = [];
  for (const id of state.players[player].battlefield) {
    const obj = state.objects[id];
    const info = chars(state, obj);
    manaAbilities(state, obj).forEach((ab, index) => {
      if (ab.cost?.tap && obj.tapped) return;
      if (ab.cost?.tap && info.sickTap) return;
      sources.push({ id, index, ab });
    });
  }
  return payWithSources(state.players[player].mana.slice(), sources, cost, state.players[player].life);
}

function blankCost() {
  return { generic: 0, pips: [], hybrid: [], phyrexian: [], x: false, c: 0, text: '' };
}

function sourceFlexibility(src) {
  if (src.ab.produce?.any) return 6;
  if (src.ab.produce?.choice) return src.ab.produce.choice.length;
  return 1;
}

function dropsOfColor(src, color) {
  return produceDrops(src.ab.produce).find((drops) => drops.some((drop) => drop.color === color && !drop.restrict)) || null;
}

function genericDrops(src) {
  return produceDrops(src.ab.produce).find((drops) => drops.some((drop) => !drop.restrict)) || null;
}

/**
 * Płaci koszt istniejącą maną i zdolnościami lądów.
 * Najpierw symbole kolorów, najsztywniejszym źródłem. Bez wykładniczego szukania,
 * które zawieszało grę, gdy many nie starczało.
 */
function payWithSources(pool, sources, cost, life) {
  const have = pool.slice();
  const left = sources.slice();
  const used = [];
  let lifePaid = 0;
  let lifeLeft = life;
  const takeFloating = (partial, allowLife) => {
    const paid = spend(have, partial, allowLife ? lifeLeft : 0);
    if (!paid.ok) return false;
    have.splice(0, have.length, ...paid.pool);
    lifePaid += paid.lifePaid || 0;
    lifeLeft -= paid.lifePaid || 0;
    return true;
  };
  const use = (src, drops) => {
    const index = left.indexOf(src);
    if (index >= 0) left.splice(index, 1);
    used.push({ ...src, drops });
    have.push(...drops);
  };
  const payOne = (partial, color) => {
    if (takeFloating(partial, false)) return true;
    const ranked = left
      .map((src) => ({ src, drops: color ? dropsOfColor(src, color) : genericDrops(src) }))
      .filter((row) => row.drops)
      .sort((a, b) => sourceFlexibility(a.src) - sourceFlexibility(b.src));
    if (!ranked.length) return false;
    use(ranked[0].src, ranked[0].drops);
    return takeFloating(partial, false);
  };

  for (const color of cost.pips || []) {
    if (!payOne({ ...blankCost(), pips: [color] }, color)) return null;
  }
  for (let i = 0; i < (cost.c || 0); i += 1) {
    if (!payOne({ ...blankCost(), c: 1 }, 'C')) return null;
  }
  let generic = cost.generic || 0;
  for (const [a, b] of cost.hybrid || []) {
    const partial = { ...blankCost(), hybrid: [[a, b]] };
    if (takeFloating(partial, false)) continue;
    const colors = [a, b].filter((side) => !/^\d+$/.test(side));
    let paid = false;
    for (const color of colors) {
      if (payOne(partial, color)) { paid = true; break; }
    }
    if (paid) continue;
    const numbers = [a, b].filter((side) => /^\d+$/.test(side)).map(Number);
    if (!numbers.length) return null;
    generic += Math.min(...numbers);
  }
  for (const color of cost.phyrexian || []) {
    const partial = { ...blankCost(), phyrexian: [color] };
    if (payOne(partial, color)) continue;
    if (!takeFloating(partial, true)) return null;
  }
  while (generic > 0) {
    if (!payOne({ ...blankCost(), generic: 1 }, null)) return null;
    generic -= 1;
  }
  return { pool: have, lifePaid, used };
}

function produceDrops(produce) {
  if (!produce) return [[]];
  if (produce.any) {
    return ['W', 'U', 'B', 'R', 'G', 'C'].map((color) => [{ color, restrict: null }]);
  }
  if (produce.choice) return produce.choice.map((color) => [{ color, restrict: null }]);
  if (produce.colors) {
    const drops = [];
    for (const [color, n] of Object.entries(produce.colors)) {
      for (let i = 0; i < n; i++) drops.push({ color, restrict: produce.restrict || null });
    }
    return [drops];
  }
  return [[]];
}

function commitPay(state, player, paid) {
  for (const use of paid.used) {
    const obj = state.objects[use.id];
    if (use.ab.cost?.tap) obj.tapped = true;
    if (use.ab.cost?.sacrifice) move(state, obj.id, 'graveyard');
  }
  state.players[player].life -= paid.lifePaid || 0;
  state.players[player].mana = paid.pool;
}

function refund(state, player, paid) {
  if (!paid) return;
  state.players[player].life += paid.lifePaid || 0;
  for (const use of paid.used || []) {
    const obj = state.objects[use.id];
    if (!obj) continue;
    if (use.ab?.cost?.sacrifice && obj.zone !== 'battlefield') {
      removeFromZone(state, obj);
      obj.zone = 'battlefield';
      obj.controller = player;
      state.players[player].battlefield.push(obj.id);
    }
    if (use.ab?.cost?.tap) obj.tapped = false;
  }
  state.players[player].mana = [];
}

function activateMana(state, player, action) {
  const obj = state.objects[action.id];
  if (!obj || obj.zone !== 'battlefield' || obj.controller !== player) return { ok: false, error: 'Nie masz tego permanentu.' };
  const abs = manaAbilities(state, obj);
  const ab = abs[action.index || 0];
  if (!ab) return { ok: false, error: 'To nie jest zdolność many.' };
  const info = chars(state, obj);
  if (ab.cost?.tap && (obj.tapped || info.sickTap)) return { ok: false, error: 'Nie można tastować.' };
  if (ab.cost?.tap) obj.tapped = true;
  let color = action.color;
  const options = produceDrops(ab.produce);
  const drops = color ? [{ color, restrict: null }] : options[0];
  if (ab.produce?.any && color) {
    state.players[player].mana = state.players[player].mana.concat([{ color, restrict: null }]);
  } else if (ab.produce?.choice && color && ab.produce.choice.includes(color)) {
    state.players[player].mana = state.players[player].mana.concat([{ color, restrict: null }]);
  } else {
    state.players[player].mana = state.players[player].mana.concat(options[0]);
  }
  if (ab.cost?.sacrifice) move(state, obj.id, 'graveyard');
  log(state, `${who(player)} dodaje manę (${nameOf(state, obj)}).`);
  return { ok: true };
}

function activateAbility(state, player, action) {
  const obj = state.objects[action.id];
  if (!obj || obj.controller !== player || obj.zone !== 'battlefield') return { ok: false, error: 'Nie można aktywować.' };
  const abs = abilitiesOf(state, obj).filter((a) => a.kind === 'activated' || a.kind === 'loyalty');
  const ab = abs[action.index || 0];
  if (!ab) return { ok: false, error: 'Brak zdolności.' };
  if (ab.kind === 'loyalty') {
    if (!sorcerySpeed(state, player)) return { ok: false, error: 'Lojalność tylko w swojej głównej fazie.' };
    if (obj.loyaltyUsed) return { ok: false, error: 'Planeswalker już użył lojalności w tej turze.' };
    const current = obj.counters.loyalty || 0;
    if (ab.loyalty < 0 && current < -ab.loyalty) return { ok: false, error: 'Za mało lojalności.' };
    obj.counters.loyalty = current + ab.loyalty;
    obj.loyaltyUsed = true;
  } else {
    if (ab.sorcery && !sorcerySpeed(state, player)) return { ok: false, error: 'Tę zdolność aktywuje się jak sorcery.' };
    if (ab.requiresLevel && (obj.classLevel || 1) !== ab.requiresLevel) return { ok: false, error: 'To nie jest następny poziom.' };
    const info = chars(state, obj);
    if (ab.cost?.tap && (obj.tapped || info.sickTap)) return { ok: false, error: 'Nie można tastować.' };
    const paid = autoPay(state, player, ab.cost?.mana || parseManaCost(''));
    if (!paid) return { ok: false, error: 'Nie starcza many.' };
    commitPay(state, player, paid);
    if (ab.cost?.tap) obj.tapped = true;
    if (ab.cost?.sacrifice) move(state, obj.id, 'graveyard');
  }
  state.stack.push({
    id: `s${state.nextId++}`,
    kind: 'ability',
    controller: player,
    sourceId: obj.id,
    objectId: null,
    effects: ab.effects || [],
    choose: ab.choose || null,
    chosen: action.modes || [],
    targets: action.targets || [],
    unparsed: ab.unparsed || [],
    description: ab.text || 'zdolność',
    needsTargets: false,
  });
  log(state, `${who(player)} aktywuje: ${ab.text || nameOf(state, obj)}.`);
  state.passed = { human: false, ai: false };
  return { ok: true };
}

function declareAttackers(state, player, ids, targets) {
  if (state.awaiting !== 'attackers' || player !== state.active) return { ok: false, error: 'To nie jest krok ataku.' };
  for (const id of ids) {
    const obj = state.objects[id];
    const c = chars(state, obj);
    if (!obj || obj.controller !== player || !c.isCreature) return { ok: false, error: 'To nie może atakować.' };
    if (c.defender || c.cantAttack) return { ok: false, error: `${c.name} nie może atakować.` };
    if (obj.sick && !c.haste) return { ok: false, error: `${c.name} ma chorobę wejścia.` };
    if (obj.tapped) return { ok: false, error: `${c.name} jest tastowane.` };
  }
  for (const id of ids) {
    const obj = state.objects[id];
    const c = chars(state, obj);
    if (!c.vigilance) obj.tapped = true;
    obj.attacking = targets[id] || 'player';
    obj.blockers = [];
      emit(state, 'attacks', { sourceId: id, controller: player });
  }
  state.attackers = ids.slice();
  if (ids.length) {
    emit(state, 'youAttack', { controller: player });
    emit(state, 'attackPlayer', { controller: player });
    if (ids.length === 1) emit(state, 'attacksAlone', { sourceId: ids[0], controller: player });
  }
  log(state, ids.length ? `${who(player)} atakuje (${ids.length}).` : `${who(player)} nie atakuje.`);
  state.awaiting = null;
  state.priority = state.active;
  state.passed = { human: false, ai: false };
  return { ok: true };
}

function declareBlockers(state, player, pairs) {
  if (state.awaiting !== 'blockers' || player !== other(state.active)) return { ok: false, error: 'To nie jest krok blokowania.' };
  const used = new Set();
  const byAttacker = new Map();
  for (const pair of pairs) {
    const blocker = state.objects[pair.blocker];
    const attacker = state.objects[pair.attacker];
    if (!blocker || !attacker || blocker.controller !== player) return { ok: false, error: 'Zły bloker.' };
    if (used.has(blocker.id)) return { ok: false, error: 'Stworzenie blokuje tylko raz.' };
    const bc = chars(state, blocker);
    const ac = chars(state, attacker);
    if (!bc.isCreature || blocker.tapped || bc.cantBlock) return { ok: false, error: `${bc.name} nie może blokować.` };
    if (ac.flying && !bc.flying && !bc.reach) return { ok: false, error: `${bc.name} nie dosięga latającego.` };
    if (ac.unblockable) return { ok: false, error: `${ac.name} nie może być zablokowane.` };
    if (staticFlag(state, attacker, 'unblockableAlone') && state.attackers.length === 1) {
      return { ok: false, error: `${ac.name} atakuje samo i nie może być zablokowane.` };
    }
    used.add(blocker.id);
    if (!byAttacker.has(attacker.id)) byAttacker.set(attacker.id, []);
    byAttacker.get(attacker.id).push(blocker.id);
  }
  for (const [aid, bids] of byAttacker) {
    const ac = chars(state, state.objects[aid]);
    if (ac.menace && bids.length < 2) return { ok: false, error: `${ac.name} ma grozę i potrzebuje dwóch blokerów.` };
  }
  for (const id of state.attackers || []) {
    const atk = state.objects[id];
    atk.blockers = byAttacker.get(id) || [];
    for (const bid of atk.blockers) state.objects[bid].blocking = id;
  }
  log(state, pairs.length ? `${who(player)} blokuje (${pairs.length}).` : `${who(player)} nie blokuje.`);
  state.awaiting = null;
  state.priority = state.active;
  state.passed = { human: false, ai: false };
  return { ok: true };
}

function unlockDoor(state, player, id, faceIndex) {
  const obj = state.objects[id];
  if (!obj || obj.controller !== player || !obj.room) return { ok: false, error: 'To nie jest Pokój.' };
  if (!sorcerySpeed(state, player)) return { ok: false, error: 'Drzwi otwiera się jak sorcery.' };
  if (obj.room[faceIndex]) return { ok: false, error: 'Te drzwi są już otwarte.' };
  const face = defOf(state, obj.defId).faces[faceIndex];
  const paid = autoPay(state, player, parseManaCost(face.manaCost));
  if (!paid) return { ok: false, error: 'Nie starcza many, żeby otworzyć drzwi.' };
  commitPay(state, player, paid);
  obj.room[faceIndex] = true;
  log(state, `${who(player)} otwiera drzwi: ${face.name}.`);
  emit(state, 'unlock', { sourceId: id, controller: player, face: faceIndex });
  if (obj.room.every(Boolean)) emit(state, 'fullyUnlock', { sourceId: id, controller: player });
  return { ok: true };
}

function turnFaceUp(state, player, id) {
  const obj = state.objects[id];
  if (!obj || !obj.faceDown || obj.controller !== player) return { ok: false, error: 'Nie można odwrócić.' };
  const face = defOf(state, obj.defId).faces[0];
  if (!face.isCreature) return { ok: false, error: 'Odwrócić można tylko kartę stworzenia.' };
  const paid = autoPay(state, player, parseManaCost(face.manaCost));
  if (!paid) return { ok: false, error: 'Nie starcza many, żeby odwrócić kartę.' };
  commitPay(state, player, paid);
  obj.faceDown = false;
  log(state, `${who(player)} odwraca kartę: ${face.name}.`);
  return { ok: true };
}

function cycleCard(state, player, id) {
  const obj = state.objects[id];
  if (!obj || obj.zone !== 'hand' || obj.owner !== player) return { ok: false, error: 'Nie ma tej karty w ręce.' };
  const face = faceOf(state, obj);
  if (!face?.cycling) return { ok: false, error: 'Ta karta nie ma cycling.' };
  const paid = autoPay(state, player, face.cycling.cost);
  if (!paid) return { ok: false, error: 'Nie starcza many na cycling.' };
  commitPay(state, player, paid);
  move(state, id, 'graveyard');
  if (face.cycling.land || face.cycling.basic) {
    resolveEffects(state, [{ op: 'searchLand', to: 'hand', tapped: false, basic: face.cycling.basic }], { controller: player, sourceId: id });
  } else drawCards(state, player, 1);
  log(state, `${who(player)} używa cycling.`);
  return { ok: true };
}

function crewVehicle(state, player, id, tappers) {
  const obj = state.objects[id];
  const face = faceOf(state, obj);
  if (!obj || !face?.crew) return { ok: false, error: 'To nie jest pojazd.' };
  let power = 0;
  for (const tid of tappers) {
    const t = state.objects[tid];
    const c = chars(state, t);
    if (!t || t.controller !== player || !c.isCreature || t.tapped || t.id === id) return { ok: false, error: 'Zła załoga.' };
    power += c.power;
  }
  if (power < face.crew) return { ok: false, error: 'Za mało siły załogi.' };
  for (const tid of tappers) state.objects[tid].tapped = true;
  obj.crewed = true;
  log(state, `${nameOf(state, obj)} ma załogę do końca tury.`);
  return { ok: true };
}

function resolveTop(state) {
  const item = state.stack.pop();
  if (!item) return;
  if (item.kind === 'spell') {
    const obj = state.objects[item.objectId];
    const face = defOf(state, obj.defId).faces[item.faceIndex || 0];
    if (!targetsStillLegal(state, item)) {
      log(state, `${item.description} nie rozwiązuje się — cele są nielegalne.`);
      move(state, obj.id, 'graveyard');
      return;
    }
    if (face.isInstant || face.isSorcery || (!face.isCreature && !face.isEnchantment && !face.isArtifact && !face.isPlaneswalker && !face.isLand)) {
      resolveEffects(state, item.effects, { controller: item.controller, sourceId: obj.id, targets: item.targets, item });
      if (obj.zone === 'stack') move(state, obj.id, 'graveyard');
      noteUnparsed(state, item);
      return;
    }
    enterPermanent(state, obj, item);
    noteUnparsed(state, item);
    return;
  }
  if (!targetsStillLegal(state, item) && effectsNeedTarget(item.effects, item.choose)) {
    log(state, `${item.description} nie rozwiązuje się.`);
    return;
  }
  resolveEffects(state, item.chosen?.length && item.choose ? item.chosen.flatMap((i) => item.choose.options[i].effects) : item.effects, {
    controller: item.controller, sourceId: item.sourceId, targets: item.targets, item,
  });
  noteUnparsed(state, item);
}

function noteUnparsed(state, item) {
  const lines = (item.unparsed || []).filter(Boolean);
  if (!lines.length) return;
  log(state, `Silnik nie rozegrał fragmentu „${item.description}”: ${lines[0].slice(0, 180)}`);
  const didSomething = (item.effects || []).length > 0 || (item.chosen || []).length > 0;
  const entered = item.objectId && state.objects[item.objectId]?.zone === 'battlefield';
  if (didSomething || entered || item.controller !== 'human') return;
  state.pending = {
    player: 'human',
    kind: 'unparsed',
    text: lines.join(' '),
    sourceId: item.sourceId,
  };
}

function targetsStillLegal(state, item) {
  const specs = collectSpecs(item.effects);
  if (!specs.length) return true;
  let any = false;
  let allBad = true;
  item.targets.forEach((chosen, i) => {
    const spec = specs[i] || specs[0];
    const list = Array.isArray(chosen) ? chosen : [chosen];
    for (const c of list) {
      if (c == null) continue;
      any = true;
      if (isLegalTarget(state, spec, c, item.controller)) allBad = false;
    }
  });
  if (!any) return specs.every((s) => s.upTo || s.optional);
  return !allBad;
}

function enterPermanent(state, obj, item) {
  const face = defOf(state, obj.defId).faces[obj.face || 0];
  obj.zone = 'battlefield';
  obj.controller = item.controller;
  state.players[item.controller].battlefield.push(obj.id);
  obj.sick = true;
  obj.enteredThisTurn = true;
  obj.damage = 0;
  if (face.isPlaneswalker) obj.counters.loyalty = Number(face.loyalty || 0);
  if (defOf(state, obj.defId).room || face.isRoom) {
    obj.room = [false, false];
    if (obj.cast) obj.room[obj.face || 0] = true;
  }
  if (obj.cast?.impending && face.impending) obj.counters.time = face.impending.n;
  if (face.isClass) obj.classLevel = 1;
  applyEntersTapped(state, obj);
  if (face.enchant) {
    const target = item.targets?.[0];
    const hostId = Array.isArray(target) ? target[0] : target;
    if (hostId && state.objects[hostId]?.zone === 'battlefield') attach(state, obj.id, hostId);
    else {
      move(state, obj.id, 'graveyard');
      return;
    }
  }
  log(state, `${nameOf(state, obj)} wchodzi na pole bitwy.`);
  if (chars(state, obj).isCreature) state.entered[obj.controller] = (state.entered[obj.controller] || 0) + 1;
  emit(state, 'enters', { sourceId: obj.id, controller: obj.controller });
  if (chars(state, obj).isEnchantment) emit(state, 'enchantmentEnters', { controller: obj.controller, sourceId: obj.id });
  if (obj.room) emit(state, 'unlock', { sourceId: obj.id, controller: obj.controller, face: obj.face || 0 });
  if (face.saga) {
    obj.counters.lore = 1;
    sagaChapter(state, obj);
  }
  resolveEffects(state, item.effects, { controller: item.controller, sourceId: obj.id, targets: item.targets, item });
}

function attach(state, id, hostId) {
  const obj = state.objects[id];
  const host = state.objects[hostId];
  if (!obj || !host) return;
  if (obj.attachedTo) {
    const prev = state.objects[obj.attachedTo];
    if (prev) prev.attachments = prev.attachments.filter((x) => x !== id);
  }
  obj.attachedTo = hostId;
  host.attachments.push(id);
}

function sagaChapter(state, obj) {
  const face = faceOf(state, obj);
  const lore = obj.counters.lore || 1;
  if (!face?.saga) return;
  for (const ch of face.saga.chapters) {
    if (ch.nums.includes(lore)) {
      state.stack.push({
        id: `s${state.nextId++}`,
        kind: 'trigger',
        controller: obj.controller,
        sourceId: obj.id,
        effects: ch.effects,
        targets: [],
        unparsed: ch.unparsed,
        description: `Saga ${lore}`,
        needsTargets: effectsNeedTarget(ch.effects, null),
      });
    }
  }
  if (lore >= face.saga.max) obj.sagaDone = true;
}

function resolveEffects(state, effects, ctx) {
  for (let i = 0; i < (effects || []).length; i++) {
    const pause = applyEffect(state, effects[i], ctx);
    if (pause) {
      state.pending = { ...pause, rest: effects.slice(i + 1), ctx };
      return;
    }
  }
}

function applyEffect(state, effect, ctx) {
  if (!effect) return null;
  const player = ctx.controller;
  const nOf = (n) => (typeof n === 'number' ? n : n?.ref === 'hand' ? state.players[player].hand.length : n?.ref === 'power' ? chars(state, state.objects[ctx.sourceId]).power : 1);
  switch (effect.op) {
    case 'draw': {
      const who = effect.who === 'each' ? PLAYERS : [player];
      for (const p of who) drawCards(state, p, effect.n || 1);
      return null;
    }
    case 'gainLife':
      gainLife(state, player, effect.n || 0);
      return null;
    case 'loseLife': {
      const ps = effect.who === 'each' ? PLAYERS : effect.who === 'eachOpponent' ? [other(player)] : effect.who === 'you' ? [player] : [targetPlayer(ctx, 0) || other(player)];
      for (const p of ps) loseLife(state, p, effect.n || 0);
      return null;
    }
    case 'damage': {
      const amount = nOf(effect.n);
      const chosen = firstTarget(ctx);
      if (typeof chosen === 'string' && chosen.startsWith('player:')) loseLife(state, chosen.slice(7), amount);
      else if (chosen && state.objects[chosen]) {
        const obj = state.objects[chosen];
        if (chars(state, obj).isPlaneswalker && !chars(state, obj).isCreature) {
          obj.counters.loyalty = (obj.counters.loyalty || 0) - amount;
        } else hurt(state, obj, amount, state.objects[ctx.sourceId] || { controller: player, id: ctx.sourceId, mods: [], counters: {}, flags: [], attachments: [], zone: 'battlefield' }, null);
      }
      return null;
    }
    case 'damageEach': {
      if (effect.who === 'opponent') loseLife(state, other(player), effect.n);
      else {
        for (const id of battlefieldAll(state)) {
          const obj = state.objects[id];
          if (chars(state, obj).isCreature) hurt(state, obj, effect.n, fakeSource(state, ctx), null);
        }
      }
      return null;
    }
    case 'destroy':
    case 'exile':
    case 'bounce': {
      for (const id of targetList(ctx, 0)) {
        const obj = state.objects[id];
        if (!obj || obj.zone !== 'battlefield') continue;
        if (effect.op === 'destroy' && chars(state, obj).indestructible) {
          log(state, `${nameOf(state, obj)} jest niezniszczalne.`);
          continue;
        }
        move(state, id, effect.op === 'bounce' ? 'hand' : effect.op === 'exile' ? 'exile' : 'graveyard');
      }
      return null;
    }
    case 'destroyAll': {
      for (const id of battlefieldAll(state).slice()) {
        const obj = state.objects[id];
        const c = chars(state, obj);
        if (effect.filter?.types && !effect.filter.types.every((t) => c.types.includes(t))) continue;
        if (effect.filter?.powerGte != null && c.power < effect.filter.powerGte) continue;
        if (effect.filter?.tapped && !obj.tapped) continue;
        if (!c.indestructible) move(state, id, 'graveyard');
      }
      return null;
    }
    case 'tap':
    case 'untap': {
      for (const id of targetList(ctx, 0)) {
        const obj = state.objects[id];
        if (obj) obj.tapped = effect.op === 'tap';
      }
      return null;
    }
    case 'untapAll':
      for (const id of state.players[player].battlefield) {
        const obj = state.objects[id];
        if (chars(state, obj).isCreature) obj.tapped = false;
      }
      return null;
    case 'pump':
    case 'pumpAll': {
      const owner = effect.controller === 'opponent' ? other(player) : player;
      const list = effect.op === 'pumpAll'
        ? (state.players[owner]?.battlefield || []).filter((id) => {
          const o = state.objects[id];
          return o && chars(state, o).isCreature && (!effect.attacking || o.attacking);
        })
        : effect.target?.kind === 'self' ? [ctx.sourceId] : targetList(ctx, 0);
      for (const id of list) {
        const obj = state.objects[id];
        if (!obj) continue;
        obj.mods.push({ power: effect.power || 0, toughness: effect.toughness || 0, keywords: effect.keywords || [], until: effect.until || 'eot' });
      }
      return null;
    }
    case 'counters':
    case 'countersAll': {
      const list = effect.op === 'countersAll'
        ? creatures(state, player).map((o) => o.id)
        : effect.target?.kind === 'self' ? [ctx.sourceId] : targetList(ctx, 0);
      for (const id of list) {
        const obj = state.objects[id];
        if (!obj) continue;
        obj.counters[effect.kind] = (obj.counters[effect.kind] || 0) + (effect.n || 1);
      }
      return null;
    }
    case 'token': {
      for (let i = 0; i < (effect.n || 1); i++) makeToken(state, player, effect.spec);
      return null;
    }
    case 'scry':
      return { player, kind: 'scry', n: effect.n, text: `Scry ${effect.n}.` };
    case 'surveil':
      return { player, kind: 'surveil', n: effect.n, text: `Surveil ${effect.n}.` };
    case 'mill': {
      const p = effect.who === 'targetPlayer' ? (targetPlayer(ctx, 0) || other(player)) : player;
      mill(state, p, effect.n || 1);
      return null;
    }
    case 'counter': {
      const spell = state.stack.find((s) => s.id === firstTarget(ctx)) || state.stack[state.stack.length - 1];
      if (spell && !spell.uncounterable) {
        state.stack = state.stack.filter((s) => s !== spell);
        if (spell.objectId) move(state, spell.objectId, 'graveyard');
        log(state, `${spell.description} zostaje skontrowane.`);
      }
      return null;
    }
    case 'ward': {
      const spell = state.stack.find((s) => s.id === effect.spellId);
      if (!spell) return null;
      return { player: spell.controller, kind: 'ward', cost: effect.cost, spellId: spell.id, text: 'Zapłać koszt ward albo zaklęcie jest skontrowane.' };
    }
    case 'venture':
      return venture(state, player);
    case 'manifestDread':
      return manifestDread(state, player);
    case 'learn':
      return { player, kind: 'learn', text: 'Learn: odrzuć kartę i dobierz, albo weź Lesson z boku.' };
    case 'rummage':
      return { player, kind: 'rummage', text: 'Możesz odrzucić kartę. Jeśli to zrobisz, dobierasz.' };
    case 'discard':
      return { player, kind: 'discard', n: effect.n || 1, text: `Odrzuć ${effect.n || 1} kart.` };
    case 'fight': {
      const a = effect.targets?.[0]?.kind === 'self' ? ctx.sourceId : targetList(ctx, 0)[0];
      const b = targetList(ctx, effect.targets?.[0]?.kind === 'self' ? 0 : 1)[0];
      const A = state.objects[a];
      const B = state.objects[b];
      if (A && B) {
        hurt(state, B, chars(state, A).power, A, null);
        hurt(state, A, chars(state, B).power, B, null);
      }
      return null;
    }
    case 'searchLand':
      return { player, kind: 'searchLand', to: effect.to, tapped: effect.tapped, basic: effect.basic || null, text: 'Wyszukaj ląd podstawowy.' };
    case 'impulse': {
      const ex = [];
      for (let i = 0; i < (effect.n || 1); i++) {
        const id = state.players[player].library.shift();
        if (!id) break;
        state.objects[id].zone = 'exile';
        state.objects[id].impulse = true;
        state.players[player].exile.push(id);
        ex.push(id);
      }
      log(state, `${who(player)} wygania ${ex.length} kart i może je zagrać w tej turze.`);
      return null;
    }
    case 'gainControl': {
      const id = targetList(ctx, 0)[0];
      const obj = state.objects[id];
      if (obj && obj.zone === 'battlefield') {
        const prev = obj.controller;
        removeFromZone(state, obj);
        obj.controller = player;
        obj.sick = true;
        state.players[player].battlefield.push(id);
        if ((effect.until || 'eot') !== 'forever') obj.mods.push({ until: effect.until || 'eot', control: prev });
        log(state, `${who(player)} przejmuje kontrolę nad ${nameOf(state, obj)}.`);
      }
      return null;
    }
    case 'exileSelf':
      if (ctx.sourceId) move(state, ctx.sourceId, 'exile');
      return null;
    case 'shuffle':
      shuffleZone(state, player, 'library');
      return null;
    case 'win':
      state.gameOver = { winner: player, reason: `${who(player)} wygrywa dzięki efektowi karty.` };
      return null;
    case 'rollD20': {
      const roll = 1 + Math.floor(rnd(state) * 20);
      log(state, `${who(player)} rzuca k20: ${roll}.`);
      const row = (effect.rows || []).find((r) => roll >= r.min && roll <= r.max);
      if (row) {
        if (row.effects?.length) resolveEffects(state, row.effects, ctx);
        if (row.unparsed?.length) log(state, `Wynik kości, nierozpoznany tekst: ${row.text}`);
      }
      return null;
    }
    case 'enduringReturn': {
      const obj = state.objects[ctx.sourceId];
      if (obj && obj.zone === 'graveyard' && obj.diedAsCreature) {
        obj.enchantmentOnly = true;
        move(state, obj.id, 'battlefield', player);
        log(state, `${nameOf(state, obj)} wraca jako enchantment.`);
      }
      return null;
    }
    case 'setLevel': {
      const obj = state.objects[ctx.sourceId];
      if (obj) {
        obj.classLevel = effect.level;
        log(state, `${nameOf(state, obj)} osiąga poziom ${effect.level}.`);
        emit(state, 'becomeLevel', { sourceId: obj.id, level: effect.level });
      }
      return null;
    }
    case 'equip': {
      const host = targetList(ctx, 0)[0];
      if (host) attach(state, ctx.sourceId, host);
      return null;
    }
    case 'flag':
      for (const id of targetList(ctx, 0)) {
        const obj = state.objects[id];
        if (obj) obj.flags.push(effect.flag);
      }
      return null;
    case 'flagSpell':
      return null;
    case 'reanimate':
    case 'returnCard': {
      const id = targetList(ctx, 0)[0];
      if (id) move(state, id, effect.op === 'reanimate' ? 'battlefield' : 'hand', player);
      return null;
    }
    default:
      log(state, `Pominięty efekt: ${effect.op}.`);
      return null;
  }
}

function fakeSource(state, ctx) {
  return state.objects[ctx.sourceId] || { controller: ctx.controller, id: 'none', mods: [], counters: {}, flags: [], attachments: [], zone: 'battlefield', defId: null };
}

function firstTarget(ctx) {
  const t = ctx.targets?.[0];
  return Array.isArray(t) ? t[0] : t;
}

function targetList(ctx, index) {
  const t = ctx.targets?.[index];
  if (t == null) return [];
  return (Array.isArray(t) ? t : [t]).filter((x) => x && !String(x).startsWith('player:'));
}

function targetPlayer(ctx, index) {
  const t = ctx.targets?.[index];
  const v = Array.isArray(t) ? t[0] : t;
  if (typeof v === 'string' && v.startsWith('player:')) return v.slice(7);
  return null;
}

function makeToken(state, player, spec) {
  const obj = makeObject(state, null, player);
  obj.token = true;
  obj.tokenSpec = spec.treasure
    ? { ...spec, name: 'Treasure', types: ['Artifact'], subtypes: ['Treasure'], power: 0, toughness: 0, keywords: [] }
    : spec;
  obj.zone = 'battlefield';
  obj.controller = player;
  obj.sick = true;
  state.players[player].battlefield.push(obj.id);
  log(state, `${who(player)} tworzy żeton: ${obj.tokenSpec.name}.`);
  if (chars(state, obj).isCreature) state.entered[player] = (state.entered[player] || 0) + 1;
  emit(state, 'enters', { sourceId: obj.id, controller: player });
  return obj;
}

function mill(state, player, n) {
  for (let i = 0; i < n; i++) {
    const id = state.players[player].library.shift();
    if (!id) break;
    state.objects[id].zone = 'graveyard';
    state.players[player].graveyard.push(id);
  }
  log(state, `${who(player)} mieli ${n} kart.`);
}

function shuffleZone(state, player, zone) {
  const ids = state.players[player][zone].slice();
  const order = shuffle(ids, () => rnd(state));
  state.players[player][zone] = order;
}

function venture(state, player) {
  const dungeons = catalogOf(state).dungeons || [];
  const cur = state.players[player].dungeon;
  if (!cur) {
    return { player, kind: 'dungeon', text: 'Wybierz loch i wejdź do pierwszej komnaty.', dungeons: dungeons.map((d) => d.name) };
  }
  const d = dungeons.find((x) => x.name === cur.name);
  const room = d?.rooms[cur.index];
  if (!room || !room.leads.length) {
    state.dungeonDone[player].push(cur.name);
    state.players[player].dungeon = null;
    log(state, `${who(player)} kończy loch ${cur.name}.`);
    return venture(state, player);
  }
  if (room.leads.length === 1) {
    enterRoom(state, player, d, room.leads[0]);
    return null;
  }
  return { player, kind: 'dungeonRoom', text: 'Wybierz następną komnatę.', rooms: room.leads, dungeon: d.name };
}

function enterRoom(state, player, dungeon, roomName) {
  const index = dungeon.rooms.findIndex((r) => r.name === roomName);
  const room = dungeon.rooms[index];
  state.players[player].dungeon = { name: dungeon.name, index };
  log(state, `${who(player)} wchodzi do komnaty ${roomName}.`);
  if (room) resolveEffects(state, room.effects, { controller: player, sourceId: null, targets: [] });
  if (room?.unparsed?.length) log(state, `Komnata, nierozpoznany tekst: ${room.text}`);
}

function manifestDread(state, player) {
  const lib = state.players[player].library;
  if (!lib.length) {
    log(state, `${who(player)} manifestuje dread, ale talia jest pusta.`);
    return null;
  }
  if (lib.length === 1) {
    manifestOne(state, player, lib.shift(), null);
    return null;
  }
  const a = lib[0];
  const b = lib[1];
  return { player, kind: 'manifest', ids: [a, b], text: 'Manifest dread: jedna karta staje się 2/2, druga idzie na cmentarz.' };
}

function manifestOne(state, player, id, otherId) {
  const lib = state.players[player].library;
  state.players[player].library = lib.filter((x) => x !== id && x !== otherId);
  const obj = state.objects[id];
  obj.faceDown = true;
  obj.manifested = true;
  obj.zone = 'battlefield';
  obj.controller = player;
  obj.sick = true;
  state.players[player].battlefield.push(id);
  if (otherId) {
    const o = state.objects[otherId];
    o.zone = 'graveyard';
    state.players[player].graveyard.push(otherId);
  }
  log(state, `${who(player)} manifestuje zakryte 2/2.`);
  emit(state, 'enters', { sourceId: id, controller: player });
}

function answer(state, player, action) {
  const pending = state.pending;
  if (!pending || pending.player !== player) return { ok: false, error: 'To nie twój wybór.' };
  state.pending = null;
  const value = action.value || {};
  if (pending.kind === 'mulligan') return mulliganAnswer(state, player, !!value.keep);
  if (pending.kind === 'bottom') {
    for (const id of value.ids || []) {
      const hand = state.players[player].hand;
      const i = hand.indexOf(id);
      if (i >= 0) {
        hand.splice(i, 1);
        state.players[player].library.push(id);
        state.objects[id].zone = 'library';
      }
    }
    log(state, `${who(player)} odkłada ${value.ids?.length || 0} kart na spód.`);
    continueMulligan(state);
    return { ok: true };
  }
  if (pending.kind === 'scry' || pending.kind === 'surveil') {
    const n = pending.n;
    const topIds = state.players[player].library.slice(0, n);
    const keepTop = value.top || [];
    const rest = topIds.filter((id) => !keepTop.includes(id));
    state.players[player].library = state.players[player].library.slice(topIds.length);
    if (pending.kind === 'surveil') {
      for (const id of rest) {
        state.objects[id].zone = 'graveyard';
        state.players[player].graveyard.push(id);
      }
      state.players[player].library = [...keepTop, ...state.players[player].library];
    } else {
      state.players[player].library = [...keepTop, ...state.players[player].library];
      for (const id of rest) state.players[player].library.push(id);
    }
    resume(state, pending);
    return { ok: true };
  }
  if (pending.kind === 'manifest') {
    const manifest = value.manifest || pending.ids[0];
    const grave = pending.ids.find((id) => id !== manifest);
    manifestOne(state, player, manifest, grave);
    resume(state, pending);
    return { ok: true };
  }
  if (pending.kind === 'dungeon') {
    const dungeons = catalogOf(state).dungeons || [];
    const d = dungeons.find((x) => x.name === value.name) || dungeons[0];
    if (d?.rooms[0]) enterRoom(state, player, d, d.rooms[0].name);
    resume(state, pending);
    return { ok: true };
  }
  if (pending.kind === 'dungeonRoom') {
    const d = (catalogOf(state).dungeons || []).find((x) => x.name === pending.dungeon);
    enterRoom(state, player, d, value.name || pending.rooms[0]);
    resume(state, pending);
    return { ok: true };
  }
  if (pending.kind === 'discard' || pending.kind === 'discardHand' || pending.kind === 'rummage') {
    const ids = value.ids || [];
    for (const id of ids) {
      if (state.players[player].hand.includes(id)) move(state, id, 'graveyard');
    }
    if (pending.kind === 'rummage' && ids.length) drawCards(state, player, 1);
    if (pending.kind === 'discardHand') finishCleanup(state);
    else resume(state, pending);
    return { ok: true };
  }
  if (pending.kind === 'learn') {
    if (value.discard) {
      if (state.players[player].hand.includes(value.discard)) move(state, value.discard, 'graveyard');
      drawCards(state, player, 1);
    } else if (value.lesson && state.players[player].sideboard.includes(value.lesson)) {
      const obj = state.objects[value.lesson];
      state.players[player].sideboard = state.players[player].sideboard.filter((id) => id !== value.lesson);
      obj.zone = 'hand';
      state.players[player].hand.push(value.lesson);
      log(state, `${who(player)} bierze Lesson do ręki.`);
    }
    resume(state, pending);
    return { ok: true };
  }
  if (pending.kind === 'searchLand') {
    const basic = value.basic || pending.basic || 'W';
    const defId = `basic-${basicTypeColor(basic)}`;
    const obj = makeObject(state, defId, player);
    if (pending.to === 'battlefield') {
      obj.zone = 'battlefield';
      obj.controller = player;
      obj.tapped = !!pending.tapped;
      state.players[player].battlefield.push(obj.id);
    } else {
      obj.zone = 'hand';
      state.players[player].hand.push(obj.id);
    }
    shuffleZone(state, player, 'library');
    log(state, `${who(player)} wyszukuje ląd podstawowy.`);
    resume(state, pending);
    return { ok: true };
  }
  if (pending.kind === 'legend') {
    for (const id of pending.ids) if (id !== value.keep) move(state, id, 'graveyard');
    return { ok: true };
  }
  if (pending.kind === 'ward') {
    if (value.pay) {
      const paid = autoPay(state, player, pending.cost);
      if (!paid) {
        state.pending = pending;
        return { ok: false, error: 'Nie starcza many na ward.' };
      }
      commitPay(state, player, paid);
      log(state, `${who(player)} płaci ward.`);
    } else {
      const spell = state.stack.find((s) => s.id === pending.spellId);
      if (spell) {
        state.stack = state.stack.filter((s) => s !== spell);
        if (spell.objectId) move(state, spell.objectId, 'graveyard');
        log(state, 'Ward kontrowuje zaklęcie.');
      }
    }
    return { ok: true };
  }
  if (pending.kind === 'stackTargets') {
    const item = state.stack.find((s) => s.id === pending.stackId);
    if (item) item.targets = value.targets || [];
    return { ok: true };
  }
  if (pending.kind === 'unparsed') {
    if (value.manual === 'draw') drawCards(state, player, value.n || 1);
    if (value.manual === 'life') gainLife(state, player, value.n || 1);
    if (value.manual === 'token') makeToken(state, player, { name: 'Soldier', power: 1, toughness: 1, types: ['Creature'], subtypes: ['Soldier'], colors: ['W'], keywords: [] });
    log(state, value.manual ? `${who(player)} rozstrzyga ręcznie: ${value.manual}.` : 'Nierozpoznany fragment pominięty.');
    return { ok: true };
  }
  if (pending.kind === 'playDraw') {
    state.startingPlayer = value.first || player;
    state.active = state.startingPlayer;
    state.priority = state.startingPlayer;
    state.skipDraw = true;
    log(state, `Pierwszą turę zaczyna ${who(state.startingPlayer)}.`);
    if (!state.dealt) {
      dealOpening(state);
      state.phase = 'mulligan';
      for (const p of PLAYERS) {
        state.players[p].kept = false;
        state.players[p].mulligans = 0;
      }
      state.declared = null;
      state.pending = { player: state.startingPlayer, kind: 'mulligan', text: 'Zatrzymać rękę czy wziąć mulligan?' };
      return { ok: true };
    }
    state.phase = 'play';
    beginTurn(state);
    return { ok: true };
  }
  return { ok: false, error: 'Nieznany wybór.' };
}

function basicTypeColor(name) {
  return { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G', W: 'W', U: 'U', B: 'B', R: 'R', G: 'G' }[name] || 'W';
}

function resume(state, pending) {
  if (pending.rest?.length) resolveEffects(state, pending.rest, pending.ctx || { controller: pending.player, targets: [] });
}

function turnOrder(state) {
  return [state.startingPlayer, other(state.startingPlayer)];
}

function mulliganAnswer(state, player, keep) {
  if (!keep && state.players[player].mulligans >= 6) keep = true;
  state.players[player].kept = keep;
  state.declared = { ...(state.declared || {}), [player]: keep };
  const next = turnOrder(state).find((p) => !state.players[p].locked && state.declared[p] == null);
  if (next) {
    state.pending = { player: next, kind: 'mulligan', text: 'Zatrzymać rękę czy wziąć mulligan?' };
    return { ok: true };
  }
  const taking = turnOrder(state).filter((p) => state.declared[p] === false);
  for (const p of turnOrder(state)) {
    if (state.declared[p] === true) state.players[p].locked = true;
  }
  state.declared = {};
  if (!taking.length) {
    startAfterMulligan(state);
    return { ok: true };
  }
  for (const p of taking) {
    state.players[p].mulligans += 1;
    const back = state.players[p].hand.splice(0);
    for (const id of back) {
      state.objects[id].zone = 'library';
      state.players[p].library.push(id);
    }
    shuffleZone(state, p, 'library');
    drawCards(state, p, 7);
    log(state, `${who(p)} bierze mulligan (${state.players[p].mulligans}).`);
  }
  state.bottomQueue = taking.slice();
  const first = state.bottomQueue[0];
  state.pending = {
    player: first,
    kind: 'bottom',
    n: state.players[first].mulligans,
    text: `Odkładasz na spód ${state.players[first].mulligans} kart (London mulligan).`,
  };
  return { ok: true };
}

function continueMulligan(state) {
  state.bottomQueue.shift();
  const nextBottom = state.bottomQueue[0];
  if (nextBottom) {
    state.pending = {
      player: nextBottom,
      kind: 'bottom',
      n: state.players[nextBottom].mulligans,
      text: `Odkładasz na spód ${state.players[nextBottom].mulligans} kart.`,
    };
    return;
  }
  for (const p of turnOrder(state)) {
    if (state.players[p].hand.length === 0) state.players[p].locked = true;
  }
  const next = turnOrder(state).find((p) => !state.players[p].locked);
  if (!next) {
    startAfterMulligan(state);
    return;
  }
  state.declared = {};
  state.pending = { player: next, kind: 'mulligan', text: 'Zatrzymać rękę czy wziąć mulligan?' };
}

function startAfterMulligan(state) {
  state.phase = 'play';
  state.pending = null;
  state.active = state.startingPlayer;
  state.priority = state.startingPlayer;
  state.skipDraw = true;
  beginTurn(state);
}

export function actor(state) {
  if (state.gameOver) return null;
  return actorNow(state);
}

export function publicState(state, viewer) {
  const hide = (p, zone) => {
    if (p === viewer || zone === 'battlefield' || zone === 'graveyard' || zone === 'exile') {
      return state.players[p][zone].map((id) => cardView(state, id, viewer));
    }
    return state.players[p][zone].length;
  };
  return {
    turn: state.turn,
    step: state.step,
    stepLabel: STEP_LABEL[state.step] || state.step,
    active: state.active,
    priority: state.priority,
    actor: actor(state),
    phase: state.phase,
    awaiting: state.awaiting,
    pending: state.pending,
    gameOver: state.gameOver,
    stack: state.stack.map((s) => ({ id: s.id, description: s.description, controller: s.controller, kind: s.kind })),
    log: state.log.slice(-40),
    you: viewer,
    players: Object.fromEntries(PLAYERS.map((p) => [p, {
      life: state.players[p].life,
      hand: p === viewer ? state.players[p].hand.map((id) => cardView(state, id, viewer)) : state.players[p].hand.length,
      library: state.players[p].library.length,
      graveyard: state.players[p].graveyard.map((id) => cardView(state, id, viewer)),
      exile: state.players[p].exile.map((id) => cardView(state, id, viewer)),
      battlefield: state.players[p].battlefield.map((id) => cardView(state, id, viewer)),
      mana: state.players[p].mana,
      landsPlayed: state.players[p].landsPlayed,
      dungeon: state.players[p].dungeon,
      sideboard: p === viewer ? state.players[p].sideboard.map((id) => cardView(state, id, viewer)) : state.players[p].sideboard.length,
    }])),
  };
}

export function cardView(state, id, viewer) {
  const obj = state.objects[id];
  if (!obj) return null;
  const c = chars(state, obj);
  const face = faceOf(state, obj);
  const hidden = obj.faceDown && obj.controller !== viewer;
  return {
    id,
    name: hidden ? 'Zakryte 2/2' : c.name,
    manaCost: hidden ? '' : c.manaCost,
    typeLine: hidden ? 'Creature' : (face?.types || c.types).join(' '),
    oracle: hidden ? '' : (face?.unparsed ? '' : ''),
    text: hidden ? 'Manifest. 2/2.' : previewText(state, obj),
    power: c.isCreature ? c.power : null,
    toughness: c.isCreature ? c.toughness : null,
    loyalty: c.isPlaneswalker ? obj.counters.loyalty : null,
    tapped: obj.tapped,
    sick: obj.sick && c.isCreature,
    keywords: hidden ? [] : c.keywords,
    faceDown: obj.faceDown,
    room: obj.room,
    counters: obj.counters,
    attacking: !!obj.attacking,
    blocking: !!obj.blocking,
    understood: defOf(state, obj.defId)?.understood || 'full',
    defId: obj.defId,
  };
}

function previewText(state, obj) {
  const face = faceOf(state, obj);
  if (obj.tokenSpec?.treasure) return '{T}, Sacrifice: dodaj manę dowolnego koloru.';
  if (!face) return obj.tokenSpec ? tokenLine(obj.tokenSpec) : '';
  const def = defOf(state, obj.defId);
  return def?.oracle || face.name;
}

function tokenLine(spec) {
  return `${spec.power ?? ''}/${spec.toughness ?? ''} ${spec.name}`;
}

export { STEPS, PLAYERS };
