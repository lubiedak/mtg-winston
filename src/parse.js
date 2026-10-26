/**
 * Czyta oracle text (angielski, tak jak w zasadach) i zamienia go na strukturę,
 * którą silnik umie rozegrać. Nierozpoznany fragment zostaje w `unparsed`.
 */
import { stripReminders, wordNum, escapeReg } from './util.js';
import { parseManaCost, manaValueOf } from './mana.js';

const STATIC_KEYWORDS = [
  'Flying', 'Reach', 'Vigilance', 'Trample', 'Haste', 'Menace', 'Deathtouch',
  'Lifelink', 'Defender', 'First strike', 'Double strike', 'Hexproof',
  'Indestructible', 'Flash', 'Prowess', 'Convoke', 'Fear', 'Intimidate', 'Skulk',
];

const KW_LINE = new RegExp(
  `^(?:${STATIC_KEYWORDS.map((k) => k.toLowerCase().replace(' ', ' ')).join('|')}|ward(?:\\s+(?:\\{[^}]+\\})+)?)$`,
  'i',
);

const COLOR_WORD = {
  white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G', colorless: 'C',
};

const BASIC_MANA = {
  Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G',
};

const TYPE_WORDS = new Set(['creature', 'artifact', 'enchantment', 'land', 'planeswalker']);
const SUPER = new Set(['Basic', 'Legendary', 'World', 'Snow', 'Ongoing']);
const CARD_TYPES = new Set([
  'Creature', 'Instant', 'Sorcery', 'Enchantment', 'Artifact', 'Land',
  'Planeswalker', 'Battle', 'Kindred', 'Tribal', 'Dungeon',
]);

export function parseTypeLine(line) {
  const raw = line || '';
  const left = (raw.split(/—| - /)[0] || '').trim().split(/\s+/).filter(Boolean);
  const supertypes = left.filter((w) => SUPER.has(w));
  const types = left.filter((w) => CARD_TYPES.has(w));
  const subtypes = raw.includes('—')
    ? raw.split('—').slice(1).join(' ').split(/\s+/).filter(Boolean)
    : raw.includes(' - ')
      ? raw.split(' - ').slice(1).join(' ').split(/\s+/).filter(Boolean)
      : [];
  return { supertypes, types, subtypes, line: raw };
}

function blankFace(name) {
  return {
    name,
    manaCost: '',
    cmc: 0,
    types: [],
    subtypes: [],
    supertypes: [],
    power: null,
    toughness: null,
    loyalty: null,
    keywords: [],
    ward: null,
    impending: null,
    kicker: null,
    cycling: null,
    equip: null,
    enchant: null,
    flash: false,
    convoke: false,
    prowess: false,
    spellEffects: [],
    choose: null,
    abilities: [],
    triggers: [],
    statics: [],
    saga: null,
    levels: null,
    unparsed: [],
    isLand: false,
    isInstant: false,
    isSorcery: false,
    isCreature: false,
    isArtifact: false,
    isEnchantment: false,
    isPlaneswalker: false,
    isRoom: false,
    isLesson: false,
    isClass: false,
  };
}

function applyTypes(face, typeLine) {
  const t = parseTypeLine(typeLine);
  face.types = t.types;
  face.subtypes = t.subtypes;
  face.supertypes = t.supertypes;
  face.isLand = t.types.includes('Land');
  face.isInstant = t.types.includes('Instant');
  face.isSorcery = t.types.includes('Sorcery');
  face.isCreature = t.types.includes('Creature');
  face.isArtifact = t.types.includes('Artifact');
  face.isEnchantment = t.types.includes('Enchantment');
  face.isPlaneswalker = t.types.includes('Planeswalker');
  face.isRoom = t.subtypes.includes('Room');
  face.isLesson = t.subtypes.includes('Lesson');
  face.isClass = t.subtypes.includes('Class');
  face.flash = face.flash || face.isInstant;
}

function normalizeOracle(text, names) {
  let s = stripReminders(text || '');
  s = s.replaceAll('−', '-').replaceAll('–', '—');
  const ordered = [...names].filter(Boolean).sort((a, b) => b.length - a.length);
  for (const name of ordered) {
    s = s.replace(new RegExp(escapeReg(name), 'g'), 'THIS');
  }
  s = s.replace(/\bthis (creature|permanent|enchantment|artifact|land|Room|Class|Saga|Vehicle)\b/gi, 'THIS');
  return s.trim();
}

function stripFlavorLabel(line) {
  let s = line.trim();
  const bullet = s.startsWith('•');
  if (bullet) s = s.replace(/^•\s*/, '');
  const m = s.match(/^([A-Za-z][^—\n]{0,48}?)\s*—\s*([\s\S]+)$/);
  if (!m) return line.trim();
  const label = m[1].trim();
  if (/^(Magecraft|Delirium|Eerie|Survival|Landfall|Pack tactics)$/i.test(label)) return line.trim();
  if (/^[IVX, ]+$/.test(label)) return line.trim();
  if (/^\d/.test(label)) return line.trim();
  return (bullet ? '• ' : '') + m[2].trim();
}

function prepareBody(text) {
  const raw = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const lines = [];
  for (let i = 0; i < raw.length; i++) {
    let line = stripFlavorLabel(raw[i]);
    if (/choose (?:one or both|one or more|one|two) —\s*$/i.test(line)) {
      const bits = [line];
      while (i + 1 < raw.length && raw[i + 1].trim().startsWith('•')) {
        i += 1;
        bits.push(stripFlavorLabel(raw[i]));
      }
      lines.push(bits.join('\n'));
      continue;
    }
    if (/roll a d20/i.test(line)) {
      const bits = [line];
      while (i + 1 < raw.length && /^\d/.test(raw[i + 1]) && raw[i + 1].includes('|')) {
        i += 1;
        bits.push(raw[i]);
      }
      lines.push(bits.join('\n'));
      continue;
    }
    lines.push(line);
  }
  return lines;
}

function parseD20Block(line) {
  const parts = line.split('\n').map((s) => s.trim()).filter(Boolean);
  const intro = parts[0].replace(/\.$/, '');
  const rows = [];
  for (const row of parts.slice(1)) {
    const m = row.match(/^(\d+)(?:—(\d+))?\s*\|\s*(.+)$/);
    if (!m) return null;
    const parsed = parseEffects(m[3].replace(/\.$/, ''));
    rows.push({
      min: Number(m[1]),
      max: m[2] ? Number(m[2]) : Number(m[1]),
      effects: parsed.effects,
      unparsed: parsed.unparsed,
      text: m[3],
    });
  }
  if (!rows.length) return null;
  const before = intro
    .replace(/,?\s*then roll a d20$/i, '')
    .replace(/roll a d20$/i, '')
    .trim()
    .replace(/,\s*$/, '');
  const lead = before ? parseEffects(before) : { effects: [], unparsed: [], choose: null };
  return {
    effects: [...lead.effects, { op: 'rollD20', rows }],
    unparsed: [...(lead.unparsed || []), ...rows.flatMap((r) => r.unparsed)],
    choose: lead.choose,
  };
}

function keywordOnly(line) {
  const parts = line.split(',').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return false;
  return parts.every((p) => KW_LINE.test(p) || /^impending\b/i.test(p));
}

function grabKeywords(text, listed) {
  const keywords = [];
  const add = (k) => {
    if (k && !keywords.includes(k)) keywords.push(k);
  };
  for (const k of STATIC_KEYWORDS) {
    if ((listed || []).includes(k)) add(k);
  }
  const lines = text.split('\n');
  for (const line of lines) {
    if (!keywordOnly(line)) continue;
    for (const part of line.split(',').map((p) => p.trim())) {
      const found = STATIC_KEYWORDS.find((k) => k.toLowerCase() === part.toLowerCase());
      if (found) add(found);
    }
  }
  return keywords;
}

function parseTokenSpec(phrase) {
  let s = phrase.trim().replace(/\.$/, '').replace(/^(?:a |an )/i, '');
  if (/^treasure tokens?$/i.test(s)) {
    return { treasure: true, name: 'Treasure', types: ['Artifact'], subtypes: ['Treasure'], colors: [], power: null, toughness: null, keywords: [] };
  }
  if (/^clue tokens?$/i.test(s)) {
    return { name: 'Clue', types: ['Artifact'], subtypes: ['Clue'], colors: [], keywords: [], clue: true };
  }
  if (/^food tokens?$/i.test(s)) {
    return { name: 'Food', types: ['Artifact'], subtypes: ['Food'], colors: [], keywords: [], food: true };
  }
  let xIs = null;
  const where = s.match(/, where X is (.+)$/i);
  if (where) {
    xIs = where[1];
    s = s.slice(0, where.index);
  }
  const pt = s.match(/^(\d+|X)\/(\d+|X)\s+/i);
  if (!pt) return null;
  const power = pt[1].toUpperCase() === 'X' ? 'X' : Number(pt[1]);
  const toughness = pt[2].toUpperCase() === 'X' ? 'X' : Number(pt[2]);
  s = s.slice(pt[0].length);
  let keywords = [];
  const withM = s.match(/\s+with\s+(.+?)(?:\s+tokens?)?$/i);
  if (withM) {
    keywords = keywordPhrase(withM[1]);
    s = s.slice(0, withM.index);
  }
  s = s.replace(/\s*tokens?$/i, '').trim();
  const words = s.split(/\s+/);
  const colors = [];
  const types = [];
  const subtypes = [];
  for (const w of words) {
    const low = w.toLowerCase().replace(/,/g, '');
    if (low === 'and' || low === 'token' || low === 'tokens') continue;
    if (COLOR_WORD[low]) {
      colors.push(COLOR_WORD[low]);
      continue;
    }
    if (TYPE_WORDS.has(low)) {
      types.push(low[0].toUpperCase() + low.slice(1));
      continue;
    }
    if (w) subtypes.push(w.replace(/,/g, ''));
  }
  if (!types.length) types.push('Creature');
  return { name: subtypes[0] || 'Token', power, toughness, colors, types, subtypes, keywords, xIs, treasure: false };
}

function keywordPhrase(text) {
  const found = [];
  const low = text.toLowerCase();
  for (const k of STATIC_KEYWORDS) {
    if (low.includes(k.toLowerCase())) found.push(k);
  }
  return found;
}

function tgt(kind, extra = {}) {
  return { kind, count: 1, upTo: false, controller: 'any', ...extra };
}

export function parseEffects(text) {
  const clean = text.replace(/\s+/g, ' ').trim().replace(/\.$/, '');
  if (!clean) return { effects: [], unparsed: [], choose: null };
  const choose = parseChoose(clean);
  if (choose) return { effects: [], unparsed: choose.unparsed, choose };

  const whole = matchClause(clean);
  if (whole) return { effects: whole, unparsed: [], choose: null };

  const clauses = splitClauses(clean);
  if (clauses.length <= 1) return { effects: [], unparsed: [text.trim()], choose: null };
  const effects = [];
  const unparsed = [];
  for (const clause of clauses) {
    const hit = matchClause(clause.replace(/\.$/, ''));
    if (hit) effects.push(...hit);
    else unparsed.push(clause);
  }
  return { effects, unparsed, choose: null };
}

function splitClauses(text) {
  return text
    .split(/\s*,\s*then\s+|\s*;\s*|(?<=\.)\s+(?=[A-Z])|\s+and\s+(?=you |each |target |THIS |draw |scry |surveil |mill |create |destroy |exile |return |tap |untap |put |counter |venture |manifest |learn )/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseChoose(text) {
  const m = text.match(/^Choose (one or both|one or more|one|two) —\s*([\s\S]+)$/i);
  if (!m || !m[2].includes('•')) return null;
  const bullets = m[2].split(/\s*•\s*/).map((s) => s.trim()).filter(Boolean);
  if (bullets.length < 2) return null;
  const options = bullets.map((b) => {
    const body = b.replace(/\.$/, '');
    const parsed = parseEffects(body);
    return { text: b, effects: parsed.effects, unparsed: parsed.unparsed, choose: parsed.choose };
  });
  const mode = m[1].toLowerCase();
  let min = 1;
  let max = 1;
  if (mode === 'two') { min = 2; max = 2; }
  if (mode === 'one or both') { min = 1; max = Math.min(2, options.length); }
  if (mode === 'one or more') { min = 1; max = options.length; }
  const unparsed = options.flatMap((o) => o.unparsed);
  return { min, max, options, unparsed };
}

function matchClause(clause) {
  const c = clause.trim().replace(/\.$/, '');
  if (!c) return null;
  const tryAll = [
    effectsDraw,
    effectsLife,
    effectsDamage,
    effectsRemoval,
    effectsPump,
    effectsCounters,
    effectsToken,
    effectsLibrary,
    effectsKeywordActions,
    effectsCombatTrick,
    effectsSearch,
    effectsMisc,
  ];
  for (const fn of tryAll) {
    const hit = fn(c);
    if (hit) return hit;
  }
  return null;
}

function effectsDraw(c) {
  let m;
  if ((m = c.match(/^(?:you )?draw (a|an|one|two|three|four|five|six|seven|\d+) cards?$/i))) {
    return [{ op: 'draw', n: wordNum(m[1]), who: 'you' }];
  }
  if ((m = c.match(/^each player draws (a|an|one|two|three|\d+) cards?$/i))) {
    return [{ op: 'draw', n: wordNum(m[1]), who: 'each' }];
  }
  if ((m = c.match(/^target player draws (a|an|one|two|three|\d+) cards?$/i))) {
    return [{ op: 'draw', n: wordNum(m[1]), who: 'targetPlayer', target: tgt('player') }];
  }
  if ((m = c.match(/^draw (a|an|one|two|three|\d+) cards?, then discard (a|an|one|two|\d+) cards?$/i))) {
    return [
      { op: 'draw', n: wordNum(m[1]), who: 'you' },
      { op: 'discard', n: wordNum(m[2]), who: 'you', random: false },
    ];
  }
  return null;
}

function effectsLife(c) {
  let m;
  if ((m = c.match(/^you gain (a|an|one|two|three|four|five|six|seven|\d+) life$/i))) {
    return [{ op: 'gainLife', n: wordNum(m[1]), who: 'you' }];
  }
  if ((m = c.match(/^you lose (\d+) life$/i))) return [{ op: 'loseLife', n: Number(m[1]), who: 'you' }];
  if ((m = c.match(/^each opponent loses (\d+) life and you gain (\d+) life$/i))) {
    return [
      { op: 'loseLife', n: Number(m[1]), who: 'eachOpponent' },
      { op: 'gainLife', n: Number(m[2]), who: 'you' },
    ];
  }
  if ((m = c.match(/^each opponent loses (\d+) life$/i))) {
    return [{ op: 'loseLife', n: Number(m[1]), who: 'eachOpponent' }];
  }
  if ((m = c.match(/^each player loses (\d+) life$/i))) {
    return [{ op: 'loseLife', n: Number(m[1]), who: 'each' }];
  }
  if ((m = c.match(/^target (player|opponent) loses (\d+) life$/i))) {
    return [{ op: 'loseLife', n: Number(m[2]), who: 'targetPlayer', target: tgt('player', { controller: m[1] === 'opponent' ? 'opponent' : 'any' }) }];
  }
  if ((m = c.match(/^you gain (\d+) life and draw (a|an|one|\d+) cards?$/i))) {
    return [
      { op: 'gainLife', n: Number(m[1]), who: 'you' },
      { op: 'draw', n: wordNum(m[2]), who: 'you' },
    ];
  }
  return null;
}

function effectsDamage(c) {
  let m;
  if ((m = c.match(/^(?:THIS|it) deals (\d+) damage to any target$/i))) {
    return [{ op: 'damage', n: Number(m[1]), target: tgt('any') }];
  }
  if ((m = c.match(/^(?:THIS|it) deals (\d+) damage to target (creature or planeswalker|creature|player|opponent|planeswalker)$/i))) {
    return [{ op: 'damage', n: Number(m[1]), target: targetFromPhrase(m[2]) }];
  }
  if ((m = c.match(/^(?:THIS|it) deals (\d+) damage to each (opponent|creature|creature and each planeswalker)$/i))) {
    return [{ op: 'damageEach', n: Number(m[1]), who: m[2].startsWith('opponent') ? 'opponent' : m[2].includes('planeswalker') ? 'creatureAndPw' : 'creature' }];
  }
  if ((m = c.match(/^(?:THIS|it) deals (\d+) damage to target creature an opponent controls$/i))) {
    return [{ op: 'damage', n: Number(m[1]), target: tgt('creature', { controller: 'opponent' }) }];
  }
  if ((m = c.match(/^(?:THIS|it) deals damage equal to the number of cards in your hand to target creature an opponent controls$/i))) {
    return [{ op: 'damage', n: { ref: 'hand' }, target: tgt('creature', { controller: 'opponent' }) }];
  }
  if ((m = c.match(/^(?:THIS|it) deals damage equal to (?:THIS|its) power to target (creature|any target|player)$/i))) {
    return [{ op: 'damage', n: { ref: 'power' }, target: m[1] === 'any target' ? tgt('any') : targetFromPhrase(m[1]) }];
  }
  if ((m = c.match(/^deal (\d+) damage to any target$/i))) {
    return [{ op: 'damage', n: Number(m[1]), target: tgt('any') }];
  }
  if ((m = c.match(/^deal (\d+) damage to target (creature or planeswalker|creature|player|opponent)$/i))) {
    return [{ op: 'damage', n: Number(m[1]), target: targetFromPhrase(m[2]) }];
  }
  return null;
}

function targetFromPhrase(phrase) {
  const p = phrase.toLowerCase();
  if (p === 'any target' || p.includes('any')) return tgt('any');
  if (p.includes('creature or planeswalker')) return tgt('creatureOrPlaneswalker');
  if (p.includes('planeswalker')) return tgt('planeswalker');
  if (p.includes('opponent')) return tgt('player', { controller: 'opponent' });
  if (p.includes('player')) return tgt('player');
  if (p.includes('creature')) return tgt('creature');
  return tgt('permanent');
}

function effectsRemoval(c) {
  let m;
  if ((m = c.match(/^destroy target ([^.]+)$/i))) {
    return [{ op: 'destroy', target: permanentTarget(m[1]) }];
  }
  if ((m = c.match(/^destroy all creatures with power (\d+) or greater$/i))) {
    return [{ op: 'destroyAll', filter: { types: ['Creature'], powerGte: Number(m[1]) } }];
  }
  if (/^destroy all creatures$/i.test(c)) return [{ op: 'destroyAll', filter: { types: ['Creature'] } }];
  if (/^destroy all tapped creatures$/i.test(c)) return [{ op: 'destroyAll', filter: { types: ['Creature'], tapped: true } }];
  if ((m = c.match(/^exile target ([^.]+)$/i))) {
    return [{ op: 'exile', target: permanentTarget(m[1]) }];
  }
  if ((m = c.match(/^return (up to one )?target ([^.]+) to its owner's hand$/i))) {
    const spec = permanentTarget(m[2]);
    if (m[1]) { spec.upTo = true; spec.optional = true; }
    return [{ op: 'bounce', target: spec }];
  }
  if ((m = c.match(/^counter target ([^.]+?) spell(?: unless its controller pays (\{[^}]+\})+)?$/i))) {
    const kind = m[1].toLowerCase();
    return [{
      op: 'counter',
      spell: kind === 'target' || kind === '' ? 'any' : kind,
      unless: m[2] ? parseManaCost(m[2]) : null,
      target: tgt('spell'),
    }];
  }
  if (/^counter target spell$/i.test(c)) {
    return [{ op: 'counter', spell: 'any', unless: null, target: tgt('spell') }];
  }
  if ((m = c.match(/^tap up to (one|two|three|\d+) target creatures$/i))) {
    return [{ op: 'tap', target: tgt('creature', { count: wordNum(m[1]), upTo: true }) }];
  }
  if ((m = c.match(/^tap (up to one )?target creature$/i))) {
    return [{ op: 'tap', target: tgt('creature', m[1] ? { upTo: true, optional: true } : {}) }];
  }
  if ((m = c.match(/^untap (up to one )?target creature$/i))) {
    return [{ op: 'untap', target: tgt('creature', m[1] ? { upTo: true, optional: true } : {}) }];
  }
  if (/^untap each creature you control$/i.test(c) || /^untap all creatures you control$/i.test(c)) {
    return [{ op: 'untapAll', controller: 'you' }];
  }
  return null;
}

function permanentTarget(phrase) {
  const p = phrase.toLowerCase();
  const spec = tgt('permanent');
  if (p.includes('creature card')) {
    spec.kind = 'card';
    spec.cardType = 'Creature';
    spec.zone = 'graveyard';
    if (p.includes('your graveyard')) spec.controller = 'you';
    const mv = p.match(/mana value (\d+) or less/);
    if (mv) spec.mvMax = Number(mv[1]);
    return spec;
  }
  if (p.includes('nonland')) spec.nonland = true;
  if (p.includes('creature or planeswalker')) spec.kind = 'creatureOrPlaneswalker';
  else if (p.includes('creature')) spec.kind = 'creature';
  else if (p.includes('artifact')) spec.kind = 'artifact';
  else if (p.includes('enchantment')) spec.kind = 'enchantment';
  else if (p.includes('land')) spec.kind = 'land';
  else if (p.includes('planeswalker')) spec.kind = 'planeswalker';
  else if (p.includes('permanent')) spec.kind = 'permanent';
  if (p.includes('you control') && !p.includes("don't control") && !p.includes('an opponent')) spec.controller = 'you';
  if (p.includes('an opponent controls') || p.includes("you don't control")) spec.controller = 'opponent';
  if (p.includes('tapped')) spec.tapped = true;
  if (p.includes('another')) spec.other = true;
  return spec;
}

function effectsPump(c) {
  let m;
  const kw = '(flying|trample|haste|vigilance|lifelink|deathtouch|menace|indestructible|hexproof|reach|first strike|double strike|skulk)';
  if ((m = c.match(new RegExp(`^target creature(?: you control)? gets ([+-]\\d+)\\/([+-]\\d+) and gains ${kw} until end of turn$`, 'i')))) {
    return [{
      op: 'pump',
      power: Number(m[1]),
      toughness: Number(m[2]),
      keywords: [titleKw(m[3])],
      until: 'eot',
      target: tgt('creature', /you control/i.test(c) ? { controller: 'you' } : {}),
    }];
  }
  if ((m = c.match(/^target creature an opponent controls gets ([+-]\d+)\/([+-]\d+) until end of turn$/i))) {
    return [{ op: 'pump', power: Number(m[1]), toughness: Number(m[2]), keywords: [], until: 'eot', target: tgt('creature', { controller: 'opponent' }) }];
  }
  if ((m = c.match(/^target creature(?: you control)? gets ([+-]\d+)\/([+-]\d+) until end of turn$/i))) {
    return [{
      op: 'pump',
      power: Number(m[1]),
      toughness: Number(m[2]),
      keywords: [],
      until: 'eot',
      target: tgt('creature', /you control/i.test(c) ? { controller: 'you' } : {}),
    }];
  }
  if ((m = c.match(/^target creature gets ([+-]\d+)\/([+-]\d+) and gains ([a-z ]+?) until end of turn$/i))) {
    return [{
      op: 'pump',
      power: Number(m[1]),
      toughness: Number(m[2]),
      keywords: keywordPhrase(m[3]),
      until: 'eot',
      target: tgt('creature'),
    }];
  }
  if ((m = c.match(/^(?:THIS|it) gets ([+-]\d+)\/([+-]\d+) until end of turn$/i))) {
    return [{ op: 'pump', power: Number(m[1]), toughness: Number(m[2]), keywords: [], until: 'eot', target: { kind: 'self' } }];
  }
  if ((m = c.match(/^creatures you control get ([+-]\d+)\/([+-]\d+) and gain ([^.]+) until end of turn$/i))) {
    return [{ op: 'pumpAll', power: Number(m[1]), toughness: Number(m[2]), keywords: keywordPhrase(m[3]), until: 'eot', controller: 'you' }];
  }
  if ((m = c.match(/^creatures you control get ([+-]\d+)\/([+-]\d+) until end of turn$/i))) {
    return [{ op: 'pumpAll', power: Number(m[1]), toughness: Number(m[2]), keywords: [], until: 'eot', controller: 'you' }];
  }
  if ((m = c.match(/^attacking creatures you control get ([+-]\d+)\/([+-]\d+) until end of turn$/i))) {
    return [{ op: 'pumpAll', power: Number(m[1]), toughness: Number(m[2]), keywords: [], until: 'eot', controller: 'you', attacking: true }];
  }
  if ((m = c.match(/^target attacking creature gains ([a-z ]+) until end of turn$/i))) {
    return [{ op: 'pump', power: 0, toughness: 0, keywords: keywordPhrase(m[1]), until: 'eot', target: tgt('creature', { attacking: true }) }];
  }
  return null;
}

function titleKw(word) {
  const found = STATIC_KEYWORDS.find((k) => k.toLowerCase() === word.toLowerCase());
  return found || word;
}

function effectsCounters(c) {
  let m;
  if ((m = c.match(/^put (a|an|one|two|three|four|\d+) \+1\/\+1 counters? on (each of up to (\d+|two|three) target creatures|target attacking creature|target creature you control|target creature|THIS|each creature you control)$/i))) {
    const n = wordNum(m[1]);
    const dest = m[2].toLowerCase();
    if (dest.startsWith('each of up to')) {
      return [{ op: 'counters', n, kind: '+1/+1', target: tgt('creature', { count: wordNum(m[3]), upTo: true }) }];
    }
    if (dest === 'each creature you control') return [{ op: 'countersAll', n, kind: '+1/+1', controller: 'you' }];
    if (dest.startsWith('target attacking')) {
      return [{ op: 'counters', n, kind: '+1/+1', target: tgt('creature', { attacking: true }) }];
    }
    if (dest === 'this') return [{ op: 'counters', n, kind: '+1/+1', target: { kind: 'self' } }];
    return [{ op: 'counters', n, kind: '+1/+1', target: tgt('creature', dest.includes('you control') ? { controller: 'you' } : {}) }];
  }
  if ((m = c.match(/^put (two|three|\d+) stun counters on it$/i))) {
    return [{ op: 'counters', n: wordNum(m[1]), kind: 'stun', target: { kind: 'self' } }];
  }
  return null;
}

function effectsToken(c) {
  let m;
  if ((m = c.match(/^create (a|an|one|two|three|four|five|\d+) (.+)$/i))) {
    const spec = parseTokenSpec(m[2]);
    if (!spec) return null;
    return [{ op: 'token', n: wordNum(m[1]), spec }];
  }
  return null;
}

function effectsLibrary(c) {
  let m;
  if ((m = c.match(/^scry (\d+)$/i))) return [{ op: 'scry', n: Number(m[1]) }];
  if ((m = c.match(/^surveil (\d+)$/i))) return [{ op: 'surveil', n: Number(m[1]) }];
  if ((m = c.match(/^(?:you |target player )?mills? (\d+|a|two|three|four) cards?$/i))) {
    const who = /^target player/i.test(c) ? 'targetPlayer' : 'you';
    return [{ op: 'mill', n: wordNum(m[1]), who, target: who === 'targetPlayer' ? tgt('player') : null }];
  }
  if ((m = c.match(/^target player mills (\d+|two|three|four) cards?$/i))) {
    return [{ op: 'mill', n: wordNum(m[1]), who: 'targetPlayer', target: tgt('player') }];
  }
  if ((m = c.match(/^exile the top (card|two cards|three cards|\d+ cards) of your library\.? you may play (?:it|them) this turn$/i))) {
    const n = m[1] === 'card' ? 1 : wordNum(m[1]);
    return [{ op: 'impulse', n }];
  }
  if ((m = c.match(/^draw (a|one|two|three|\d+) cards?, then scry (\d+)$/i))) {
    return [{ op: 'draw', n: wordNum(m[1]), who: 'you' }, { op: 'scry', n: Number(m[2]) }];
  }
  return null;
}

function effectsKeywordActions(c) {
  if (/^venture into the dungeon$/i.test(c)) return [{ op: 'venture' }];
  if (/^manifest dread$/i.test(c)) return [{ op: 'manifestDread' }];
  if (/^learn$/i.test(c)) return [{ op: 'learn' }];
  return null;
}

function effectsCombatTrick(c) {
  if (/^target creature can't block this turn$/i.test(c)) {
    return [{ op: 'flag', flag: 'cantBlock', until: 'eot', target: tgt('creature') }];
  }
  if (/^target creature can't attack this turn$/i.test(c)) {
    return [{ op: 'flag', flag: 'cantAttack', until: 'eot', target: tgt('creature') }];
  }
  if (/^target creature can't attack until your next turn$/i.test(c)) {
    return [{ op: 'flag', flag: 'cantAttack', until: 'yourNextTurn', target: tgt('creature') }];
  }
  let m;
  if ((m = c.match(/^target creature gets -(\d+)\/-0 until your next turn$/i))) {
    return [{ op: 'pump', power: -Number(m[1]), toughness: 0, keywords: [], until: 'yourNextTurn', target: tgt('creature') }];
  }
  if (/^target creature you control fights target creature you don't control$/i.test(c)) {
    return [{ op: 'fight', targets: [tgt('creature', { controller: 'you' }), tgt('creature', { controller: 'opponent' })] }];
  }
  if (/^(?:THIS|it) fights target creature$/i.test(c)) {
    return [{ op: 'fight', targets: [{ kind: 'self' }, tgt('creature')] }];
  }
  if ((m = c.match(/^target attacking creature gets \+1\/\+0 for each other attacking creature and gains double strike$/i))) {
    return [{ op: 'pumpScale', scale: 'otherAttackers', keywords: ['Double strike'], until: 'eot', target: tgt('creature', { attacking: true }) }];
  }
  return null;
}

function effectsSearch(c) {
  if (/^search your library for a basic land card, put it onto the battlefield tapped(?:, then shuffle)?$/i.test(c)) {
    return [{ op: 'searchLand', to: 'battlefield', tapped: true }];
  }
  if (/^search your library for a basic land card, reveal it, put it into your hand(?:, then shuffle)?$/i.test(c)) {
    return [{ op: 'searchLand', to: 'hand', tapped: false }];
  }
  if (/^search your library for a basic (Plains|Island|Swamp|Mountain|Forest) card, reveal it, put it into your hand(?:, then shuffle)?$/i.test(c)) {
    const m = c.match(/basic (Plains|Island|Swamp|Mountain|Forest)/i);
    return [{ op: 'searchLand', to: 'hand', tapped: false, basic: m[1] }];
  }
  return null;
}

function effectsMisc(c) {
  if (/^you may discard a card\. if you do, draw a card$/i.test(c)) return [{ op: 'rummage' }];
  if (/^discard a card$/i.test(c)) return [{ op: 'discard', n: 1, who: 'you' }];
  if (/^target player discards a card$/i.test(c)) {
    return [{ op: 'discard', n: 1, who: 'targetPlayer', target: tgt('player') }];
  }
  let m;
  if ((m = c.match(/^return target creature card(?: with mana value (\d+) or less)? from your graveyard to (?:your hand|the battlefield)$/i))) {
    const to = /battlefield/i.test(c) ? 'battlefield' : 'hand';
    return [{
      op: to === 'battlefield' ? 'reanimate' : 'returnCard',
      target: tgt('card', { cardType: 'Creature', zone: 'graveyard', controller: 'you', mvMax: m[1] ? Number(m[1]) : null }),
    }];
  }
  if (/^you win the game$/i.test(c)) return [{ op: 'win' }];
  if (/^gain control of target creature until end of turn$/i.test(c)) {
    return [{ op: 'gainControl', until: 'eot', target: tgt('creature') }];
  }
  if (/^gain control of target creature for as long as you control THIS$/i.test(c)) {
    return [{ op: 'gainControl', until: 'controlSource', target: tgt('creature') }];
  }
  if (/^exile THIS$/i.test(c)) return [{ op: 'exileSelf' }];
  if (/^shuffle$/i.test(c)) return [{ op: 'shuffle' }];
  if ((m = c.match(/^it gains ([a-z ]+?) until end of turn$/i))) {
    return [{ op: 'pump', power: 0, toughness: 0, keywords: keywordPhrase(m[1]), until: 'eot', target: { kind: 'that' } }];
  }
  if (/^this spell can't be countered$/i.test(c)) return [{ op: 'flagSpell', flag: 'uncounterable' }];
  return null;
}

function parseStatic(line) {
  const c = line.trim().replace(/\.$/, '');
  let m;
  if (/^THIS enters tapped$/i.test(c)) return { kind: 'entersTapped' };
  if (/^THIS enters tapped unless you control (two|three|\d+) or more other lands$/i.test(c)) {
    m = c.match(/(two|three|\d+)/i);
    return { kind: 'entersTapped', unlessLands: wordNum(m[1]) };
  }
  if ((m = c.match(/^enchanted creature gets ([+-]\d+)\/([+-]\d+)(?: and has ([^.]+))?$/i))) {
    return { kind: 'attached', power: Number(m[1]), toughness: Number(m[2]), keywords: m[3] ? keywordPhrase(m[3]) : [] };
  }
  if ((m = c.match(/^enchanted creature (?:has|gains) ([^.]+)$/i))) {
    return { kind: 'attached', power: 0, toughness: 0, keywords: keywordPhrase(m[1]) };
  }
  if ((m = c.match(/^equipped creature gets ([+-]\d+)\/([+-]\d+)(?: and has ([^.]+))?$/i))) {
    return { kind: 'attached', power: Number(m[1]), toughness: Number(m[2]), keywords: m[3] ? keywordPhrase(m[3]) : [] };
  }
  if ((m = c.match(/^equipped creature has ([^.]+)$/i))) {
    return { kind: 'attached', power: 0, toughness: 0, keywords: keywordPhrase(m[1]) };
  }
  if ((m = c.match(/^creatures you control get ([+-]\d+)\/([+-]\d+)$/i))) {
    return { kind: 'anthem', power: Number(m[1]), toughness: Number(m[2]), keywords: [] };
  }
  if ((m = c.match(/^creatures you control have ([^.]+)$/i))) {
    return { kind: 'anthem', power: 0, toughness: 0, keywords: keywordPhrase(m[1]) };
  }
  if ((m = c.match(/^THIS gets ([+-]\d+)\/([+-]\d+) as long as there are four or more card types among cards in your graveyard$/i))) {
    return { kind: 'deliriumPt', power: Number(m[1]), toughness: Number(m[2]) };
  }
  if (/^other permanents you control have hexproof$/i.test(c)) return { kind: 'grant', keywords: ['Hexproof'], other: true };
  if (/^you have no maximum hand size$/i.test(c)) return { kind: 'noMaxHand' };
  if (/^you may play lands from your graveyard$/i.test(c)) return { kind: 'landsFromGraveyard' };
  if (/^lands you control have "\{T\}: Add one mana of any color\."$/i.test(c)) return { kind: 'landsAnyMana' };
  if (/^creature spells you cast have convoke$/i.test(c)) return { kind: 'convokeSpells' };
  if (/^spells your opponents cast during your turn cost \{1\} more to cast$/i.test(c)) {
    return { kind: 'tax', generic: 1, who: 'opponents', during: 'yourTurn' };
  }
  if (/^instant and sorcery spells you cast cost \{1\} less to cast$/i.test(c)) {
    return { kind: 'reduce', generic: 1, spells: 'instantSorcery' };
  }
  if (/^you have hexproof$/i.test(c)) return { kind: 'playerHexproof' };
  if (/^enchanted creature doesn't untap during its controller's untap step$/i.test(c)) {
    return { kind: 'freezeAttached' };
  }
  if (/^THIS enters tapped unless a player has 13 or less life$/i.test(c)) {
    return { kind: 'entersTapped', unlessLifeAtMost: 13 };
  }
  if (/^if you control two or more other lands, THIS enters tapped$/i.test(c)) {
    return { kind: 'entersTapped', ifLands: 2 };
  }
  if (/^if this card is in your opening hand, you may begin the game with it on the battlefield$/i.test(c)) {
    return { kind: 'openingHand' };
  }
  if (/^THIS can't be blocked as long as it's attacking alone$/i.test(c)) {
    return { kind: 'selfFlag', flag: 'unblockableAlone' };
  }
  if (/^THIS can't block$/i.test(c)) return { kind: 'selfFlag', flag: 'cantBlock' };
  if (/^THIS can't be blocked$/i.test(c)) return { kind: 'selfFlag', flag: 'unblockable' };
  if ((m = c.match(/^whenever you gain life, you gain that much life plus (\d+) instead$/i)) || /if you would gain life, you gain that much life plus 1 instead/i.test(c)) {
    return { kind: 'lifegainPlus', n: m ? Number(m[1]) : 1 };
  }
  if (/^creatures you control have base power and toughness each equal to the number of creatures you control$/i.test(c)) {
    return { kind: 'basePtCount', count: 'creatures' };
  }
  return null;
}

function parseTrigger(line) {
  let s = line.trim().replace(/\.$/, '');
  if (!s) return null;
  const modal = s.match(/^(when THIS enters|whenever THIS enters|when you unlock this door|whenever you attack),\s*choose (one or both|one or more|one|two) —([\s\S]+)$/i);
  if (modal) {
    const choose = parseChoose(`Choose ${modal[2]} —${modal[3]}`);
    const event = /unlock/i.test(modal[1]) ? 'unlock' : /attack/i.test(modal[1]) ? 'youAttack' : 'enters';
    if (choose) {
      return {
        event, effects: [], choose, unparsed: choose.unparsed, condition: null,
        once: false, optional: false, text: line, level: null,
      };
    }
  }
  if (/^when THIS dies, if it was a creature, return it to the battlefield under its owner's control/i.test(s)) {
    return {
      event: 'dies', effects: [{ op: 'enduringReturn' }], unparsed: [], condition: 'wasCreature',
      once: false, optional: false, text: line, level: null, choose: null,
    };
  }

  let once = false;
  if (/this ability triggers only once each turn/i.test(s)) {
    once = true;
    s = s.replace(/\.?\s*this ability triggers only once each turn/i, '').trim();
  }
  let abilityWord = null;
  const aw = s.match(/^(Magecraft|Delirium|Eerie|Survival|Landfall|Pack tactics)\s*—\s*/i);
  if (aw) {
    abilityWord = aw[1].toLowerCase();
    s = s.slice(aw[0].length);
  }
  const patterns = [
    { re: /^when THIS enters(?:,? if [^,]+)?, (.+)$/i, event: 'enters' },
    { re: /^whenever THIS enters(?:,? if [^,]+)?, (.+)$/i, event: 'enters' },
    { re: /^whenever this permanent enters or attacks, (.+)$/i, event: 'entersOrAttacks' },
    { re: /^when THIS dies, (.+)$/i, event: 'dies' },
    { re: /^whenever THIS dies, (.+)$/i, event: 'dies' },
    { re: /^whenever THIS attacks, (.+)$/i, event: 'attacks' },
    { re: /^whenever THIS deals combat damage to a player, (.+)$/i, event: 'combatDamageSelf' },
    { re: /^whenever you attack, (.+)$/i, event: 'youAttack' },
    { re: /^at the beginning of your upkeep, (.+)$/i, event: 'upkeep' },
    { re: /^at the beginning of your end step, (.+)$/i, event: 'end' },
    { re: /^at the beginning of your first main phase, (.+)$/i, event: 'precombat' },
    { re: /^at the beginning of your second main phase, (.+)$/i, event: 'postcombat' },
    { re: /^at the beginning of combat on your turn, (.+)$/i, event: 'beginCombat' },
    { re: /^whenever you cast a noncreature spell, (.+)$/i, event: 'castNoncreature' },
    { re: /^whenever you cast or copy an instant or sorcery spell, (.+)$/i, event: 'magecraft' },
    { re: /^whenever you gain life, (.+)$/i, event: 'gainLife' },
    { re: /^whenever a creature you control dies, (.+)$/i, event: 'creatureDies' },
    { re: /^whenever one or more creatures you control deal combat damage to a player, (.+)$/i, event: 'combatDamagePlayer' },
    { re: /^whenever one or more creatures you control attack a player, (.+)$/i, event: 'attackPlayer' },
    { re: /^when you unlock this door, (.+)$/i, event: 'unlock' },
    { re: /^whenever an enchantment you control enters and whenever you fully unlock a Room, (.+)$/i, event: 'eerie' },
    { re: /^whenever a creature you control attacks alone, (.+)$/i, event: 'attacksAlone' },
    { re: /^when THIS becomes level (\d+), (.+)$/i, event: 'becomeLevel' },
    { re: /^whenever one or more cards leave your graveyard, (.+)$/i, event: 'leaveGraveyard' },
  ];
  for (const p of patterns) {
    const m = s.match(p.re);
    if (!m) continue;
    const effectText = p.event === 'becomeLevel' ? m[2] : m[1];
    const parsed = parseEffects(effectText);
    let condition = null;
    if (abilityWord === 'pack tactics' || /total power 6 or greater/i.test(line)) condition = 'packTactics';
    if (abilityWord === 'delirium' || /four or more card types/i.test(line)) condition = 'delirium';
    if (abilityWord === 'survival' || /if a creature entered the battlefield under your control this turn/i.test(line)) condition = 'survival';
    if (/if you control a Demon/i.test(line)) condition = 'controlDemon';
    return {
      event: p.event,
      level: p.event === 'becomeLevel' ? Number(m[1]) : null,
      effects: parsed.effects,
      choose: parsed.choose,
      unparsed: parsed.unparsed,
      condition,
      once,
      optional: /^you may\b/i.test(effectText),
      text: line.trim(),
    };
  }
  return null;
}

function parseActivated(line) {
  const loyalty = line.match(/^([+-]?\d+):\s*(.+)$/);
  if (loyalty && /[+-]/.test(loyalty[1][0]) || (loyalty && loyalty[1] === '0')) {
    const delta = Number(loyalty[1].replace('+', ''));
    const parsed = parseEffects(loyalty[2]);
    return {
      kind: 'loyalty',
      loyalty: delta,
      sorcery: true,
      effects: parsed.effects,
      choose: parsed.choose,
      unparsed: parsed.unparsed,
      text: line,
    };
  }
  const m = line.match(/^(.+?):\s*(.+)$/);
  if (!m) return null;
  if (/^when|^whenever|^at the beginning/i.test(line)) return null;
  const costText = m[1];
  const effectText = m[2];
  if (/^level \d+$/i.test(effectText.trim())) {
    const level = Number(effectText.match(/\d+/)[0]);
    return {
      kind: 'activated',
      costText,
      cost: parseCostSide(costText),
      sorcery: true,
      effects: [{ op: 'setLevel', level }],
      requiresLevel: level - 1,
      unparsed: [],
      text: line,
    };
  }
  const peeled = effectText.replace(/\.?\s*activate only as a sorcery\.?/i, '').trim();
  const sorceryRider = peeled.length !== effectText.trim().replace(/\.$/, '').length || /activate only as a sorcery/i.test(effectText);
  const mana = parseManaProduction(peeled);
  const cost = parseCostSide(costText);
  if (mana && !cost.targets && !/target/i.test(costText)) {
    return { kind: 'mana', cost, produce: mana, text: line };
  }
  const parsed = parseEffects(peeled);
  return {
    kind: 'activated',
    costText,
    cost,
    sorcery: sorceryRider || /only as a sorcery|activate only as a sorcery/i.test(line),
    effects: parsed.effects,
    choose: parsed.choose,
    unparsed: parsed.unparsed,
    text: line,
  };
}

function parseCostSide(text) {
  const cost = {
    mana: parseManaCost(''),
    tap: false,
    sacrifice: false,
    discard: false,
    payLife: 0,
    raw: text,
  };
  const mana = text.match(/(\{(?:[^}]+)\})+/);
  if (mana) cost.mana = parseManaCost(mana[0]);
  if (/\{T\}/.test(text)) cost.tap = true;
  if (/sacrifice THIS/i.test(text) || /sacrifice this/i.test(text)) cost.sacrifice = true;
  if (/discard this card/i.test(text)) cost.discard = true;
  const life = text.match(/pay (\d+) life/i);
  if (life) cost.payLife = Number(life[1]);
  return cost;
}

function parseManaProduction(text) {
  const t = text.trim().replace(/\.$/, '');
  if (/^add one mana of any color$/i.test(t)) return { any: 1 };
  let m;
  if ((m = t.match(/^add ((?:\{[WUBRGC]\})+)$/i))) {
    const colors = {};
    for (const p of m[1].matchAll(/\{([WUBRGC])\}/g)) colors[p[1]] = (colors[p[1]] || 0) + 1;
    return { colors };
  }
  if ((m = t.match(/^add \{([WUBRG])\} or \{([WUBRG])\}$/i))) return { choice: [m[1], m[2]] };
  if ((m = t.match(/^add \{([WUBRG])\}\{([WUBRG])\}$/i))) {
    return { colors: { [m[1]]: 1, [m[2]]: m[1] === m[2] ? 2 : 1 } };
  }
  return null;
}

function intrinsicMana(subtypes) {
  const abilities = [];
  for (const sub of subtypes) {
    const color = BASIC_MANA[sub];
    if (!color) continue;
    abilities.push({
      kind: 'mana',
      intrinsic: true,
      cost: { mana: parseManaCost(''), tap: true, sacrifice: false, discard: false, payLife: 0, raw: '{T}' },
      produce: { colors: { [color]: 1 } },
      text: `{T}: Add {${color}}`,
    });
  }
  return abilities;
}

function parseLines(face, oracle, names, listedKeywords) {
  const text = normalizeOracle(oracle, names);
  face.keywords = grabKeywords(text, listedKeywords);
  face.flash = face.keywords.includes('Flash') || face.isInstant;
  face.convoke = face.keywords.includes('Convoke');
  face.prowess = face.keywords.includes('Prowess');

  const ward = text.match(/Ward\s+((?:\{[^}]+\})+)/i);
  if (ward) face.ward = parseManaCost(ward[1]);
  const imp = text.match(/Impending\s+(\d+)\s*—\s*((?:\{[^}]+\})+)/i);
  if (imp) face.impending = { n: Number(imp[1]), cost: parseManaCost(imp[2]) };
  const kick = text.match(/^Kicker\s+((?:\{[^}]+\})+)/im);
  if (kick) face.kicker = parseManaCost(kick[1]);
  const cyc = text.match(/^(Plainscycling|Islandcycling|Swampcycling|Mountaincycling|Forestcycling|Landcycling|Cycling)\s+((?:\{[^}]+\})+)/im);
  if (cyc) {
    const basicMap = {
      Plainscycling: 'Plains', Islandcycling: 'Island', Swampcycling: 'Swamp',
      Mountaincycling: 'Mountain', Forestcycling: 'Forest',
    };
    face.cycling = { cost: parseManaCost(cyc[2]), basic: basicMap[cyc[1]] || null, land: cyc[1] !== 'Cycling' };
  }
  const equip = text.match(/^Equip\s+((?:\{[^}]+\})+)/im);
  if (equip) face.equip = { cost: parseManaCost(equip[1]) };
  const ench = text.match(/^Enchant\s+(.+)$/im);
  if (ench) {
    const phrase = ench[1].trim();
    face.enchant = {
      opponent: /opponent/i.test(phrase),
      you: /you control/i.test(phrase),
      kind: /creature/i.test(phrase) ? 'creature'
        : /land/i.test(phrase) ? 'land'
          : /artifact/i.test(phrase) ? 'artifact'
            : /enchantment/i.test(phrase) ? 'enchantment'
              : /permanent/i.test(phrase) ? 'permanent'
                : 'permanent',
    };
  }

  const lines = prepareBody(text);
  const leftovers = [];
  for (const line of lines) {
    if (keywordOnly(line)) continue;
    if (/^ward\b/i.test(line) || /^impending\b/i.test(line) || /^kicker\b/i.test(line)) continue;
    if (/^(Plainscycling|Islandcycling|Swampcycling|Mountaincycling|Forestcycling|Landcycling|Cycling)\b/i.test(line)) continue;
    if (/^equip\b/i.test(line) || /^enchant\b/i.test(line)) continue;
    leftovers.push(line);
  }

  if (face.isInstant || face.isSorcery) {
    for (const line of leftovers) {
      if (/^this spell can't be countered$/i.test(line.trim())) {
        face.uncounterable = true;
        continue;
      }
      if (/roll a d20/i.test(line) && line.includes('|')) {
        const d20 = parseD20Block(line);
        if (d20) {
          face.spellEffects.push(...d20.effects);
          face.unparsed.push(...d20.unparsed);
          continue;
        }
      }
      const parsed = parseEffects(line.replace(/\n/g, ' '));
      if (parsed.choose && !face.choose) face.choose = parsed.choose;
      face.spellEffects.push(...parsed.effects);
      face.unparsed.push(...parsed.unparsed);
    }
    for (const ab of intrinsicMana(face.subtypes)) face.abilities.push(ab);
    return;
  }

  for (const line of leftovers) {
    if (/^activate only as a sorcery$/i.test(line)) {
      const last = face.abilities[face.abilities.length - 1];
      if (last) last.sorcery = true;
      continue;
    }
    const crew = line.match(/^Crew (\d+)$/i);
    if (crew) {
      face.crew = Number(crew[1]);
      continue;
    }
    if (/roll a d20/i.test(line) && line.includes('|')) {
      const d20 = parseD20Block(line);
      const head = line.split('\n')[0];
      if (d20 && /^(when|whenever|at the beginning)\b/i.test(head)) {
        const event = /attack/i.test(head) ? 'attacks' : /upkeep/i.test(head) ? 'upkeep' : /end step/i.test(head) ? 'end' : /dies/i.test(head) ? 'dies' : 'enters';
        face.triggers.push({
          event, effects: d20.effects, unparsed: d20.unparsed, choose: null,
          condition: null, once: false, text: line, level: null,
        });
        face.unparsed.push(...d20.unparsed);
        continue;
      }
      if (d20) {
        const costMatch = head.match(/^(.+?):\s*/);
        if (costMatch) {
          face.abilities.push({
            kind: 'activated',
            cost: parseCostSide(costMatch[1]),
            sorcery: /sorcery/i.test(head),
            effects: d20.effects,
            unparsed: d20.unparsed,
            choose: null,
            text: line,
          });
          face.unparsed.push(...d20.unparsed);
          continue;
        }
      }
    }
    if (/^(when|whenever|at the beginning)\b/i.test(line) || /^(Magecraft|Eerie|Survival|Pack tactics|Landfall|Delirium)\s*—/i.test(line)) {
      const trig = parseTrigger(line);
      if (trig && (trig.effects.length || trig.choose) && trig.unparsed.length === 0) {
        face.triggers.push(trig);
        continue;
      }
      if (trig && (trig.effects.length || trig.choose)) {
        face.triggers.push(trig);
        face.unparsed.push(...trig.unparsed.map((u) => `${line} :: ${u}`));
        continue;
      }
    }
    const activated = parseActivated(line);
    if (activated && line.includes(':')) {
      if (activated.kind === 'mana') {
        face.abilities.push(activated);
        continue;
      }
      if ((activated.effects.length || activated.choose) && (!activated.unparsed || activated.unparsed.length === 0)) {
        face.abilities.push(activated);
        continue;
      }
      if (activated.effects?.length) {
        face.abilities.push(activated);
        face.unparsed.push(...(activated.unparsed || []));
        continue;
      }
    }
    const st = parseStatic(line);
    if (st) {
      face.statics.push(st);
      continue;
    }
    const asEffect = parseEffects(line);
    if (asEffect.effects.length && asEffect.unparsed.length === 0 && !asEffect.choose) {
      face.spellEffects.push(...asEffect.effects);
      continue;
    }
    face.unparsed.push(line);
  }

  for (const ab of intrinsicMana(face.subtypes)) {
    const color = Object.keys(ab.produce.colors || {})[0];
    const dup = face.abilities.some((a) => a.kind === 'mana' && a.intrinsic && a.produce.colors?.[color]);
    if (!dup) face.abilities.push(ab);
  }
}

function parseClass(card) {
  const face = blankFace(card.name);
  applyTypes(face, card.type_line);
  face.power = card.power;
  face.toughness = card.toughness;
  face.manaCost = card.mana_cost || '';
  face.cmc = card.cmc || manaValueOf(face.manaCost);
  const text = normalizeOracle(card.oracle_text, [card.name]);
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const levels = [{ level: 1, lines: [] }];
  const levelAbilities = [];
  for (const line of lines) {
    const lvl = line.match(/^((?:\{[^}]+\})+):\s*Level\s+(\d+)/i);
    if (lvl) {
      levelAbilities.push({
        kind: 'activated',
        cost: parseCostSide(lvl[1]),
        sorcery: true,
        effects: [{ op: 'setLevel', level: Number(lvl[2]) }],
        requiresLevel: Number(lvl[2]) - 1,
        unparsed: [],
        text: line,
      });
      levels.push({ level: Number(lvl[2]), lines: [] });
      continue;
    }
    levels[levels.length - 1].lines.push(line);
  }
  face.levels = levels.map((lv) => {
    const dummy = blankFace(card.name);
    applyTypes(dummy, card.type_line);
    parseLines(dummy, lv.lines.join('\n'), [card.name], card.keywords || []);
    return {
      level: lv.level,
      triggers: dummy.triggers,
      statics: dummy.statics,
      abilities: dummy.abilities,
      spellEffects: dummy.spellEffects,
      unparsed: dummy.unparsed,
    };
  });
  face.abilities = levelAbilities;
  face.unparsed = face.levels.flatMap((lv) => lv.unparsed);
  const level1 = face.levels.find((lv) => lv.level === 1);
  if (level1) {
    face.triggers = level1.triggers;
    face.statics = level1.statics;
  }
  return face;
}

function parseSagaChapters(text) {
  const chapters = [];
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const unparsed = [];
  for (const line of lines) {
    const m = line.match(/^([IVX, ]+?)—\s*(.+)$/);
    if (!m) {
      if (line && !/^saga$/i.test(line)) unparsed.push(line);
      continue;
    }
    const nums = m[1].split(',').map((s) => roman(s.trim())).filter(Boolean);
    const parsed = parseEffects(m[2]);
    chapters.push({ nums, effects: parsed.effects, unparsed: parsed.unparsed, text: m[2] });
    unparsed.push(...parsed.unparsed);
  }
  const max = chapters.reduce((n, ch) => Math.max(n, ...ch.nums), 0);
  return { chapters, max, unparsed };
}

function roman(s) {
  const map = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7 };
  return map[s] || null;
}

function faceFrom(source, card, index) {
  const face = blankFace(source.name);
  applyTypes(face, source.type_line || card.type_line || '');
  face.manaCost = source.mana_cost || '';
  face.cmc = source.cmc ?? manaValueOf(face.manaCost);
  face.power = source.power ?? null;
  face.toughness = source.toughness ?? null;
  face.loyalty = source.loyalty ?? null;
  const names = [source.name, card.name, ...(card.faces || []).map((f) => f.name)];
  if (face.isClass || (source.type_line || '').includes('Class')) {
    return parseClass({ ...card, name: source.name, oracle_text: source.oracle_text, type_line: source.type_line, mana_cost: source.mana_cost, cmc: face.cmc });
  }
  parseLines(face, source.oracle_text || '', names, card.keywords || []);
  if ((source.type_line || card.type_line || '').includes('Saga') || card.layout === 'saga') {
    const saga = parseSagaChapters(normalizeOracle(source.oracle_text || '', names));
    face.saga = saga;
    face.unparsed = face.unparsed.filter((u) => !/^[IVX, ]+—/.test(u));
    for (const ch of saga.chapters) {
      if (ch.unparsed.length === 0) {
        face.unparsed = face.unparsed.filter((u) => !ch.unparsed.includes(u) && u !== ch.text);
      }
    }
    face.unparsed.push(...saga.unparsed);
  }
  face.index = index;
  return face;
}

function understoodOf(faces) {
  const unparsed = faces.flatMap((f) => f.unparsed || []);
  const has = faces.some((f) =>
    (f.keywords && f.keywords.length)
    || (f.abilities && f.abilities.length)
    || (f.triggers && f.triggers.length)
    || (f.statics && f.statics.length)
    || (f.spellEffects && f.spellEffects.length)
    || f.choose
    || f.equip
    || f.enchant
    || f.cycling
    || (f.levels && f.levels.length));
  if (unparsed.length === 0) return 'full';
  if (has) return 'partial';
  return 'body';
}

export function parseCard(card) {
  let faces;
  if (card.layout === 'split' || card.layout === 'modal_dfc') {
    faces = (card.faces || []).map((f, i) => faceFrom(f, card, i));
  } else if (card.layout === 'class' || (card.type_line || '').includes(' Class')) {
    faces = [parseClass(card)];
  } else {
    faces = [faceFrom(card, card, 0)];
  }
  const main = faces[0];
  return {
    id: card.id,
    oracleId: card.oracle_id || null,
    name: card.name,
    layout: card.layout || 'normal',
    rarity: card.rarity,
    set: card.set,
    colors: card.colors || [],
    colorIdentity: card.color_identity || [],
    cmc: card.cmc ?? main?.cmc ?? 0,
    manaCost: card.mana_cost || main?.manaCost || '',
    typeLine: card.type_line || '',
    oracle: card.oracle_text || '',
    power: card.power ?? main?.power ?? null,
    toughness: card.toughness ?? main?.toughness ?? null,
    loyalty: card.loyalty ?? main?.loyalty ?? null,
    room: card.layout === 'split' && (card.type_line || '').includes('Room'),
    mdfc: card.layout === 'modal_dfc',
    faces,
    understood: understoodOf(faces),
    basic: !!card.basic,
    plName: card.pl_name || null,
    image: card.image || null,
    imageBack: card.image_back || null,
    imageLarge: card.image_large || null,
    imageBackLarge: card.image_back_large || null,
  };
}

export function effectsNeedTargets(effects, choose) {
  const list = [];
  const walk = (effs) => {
    for (const e of effs || []) {
      if (e.target && e.target.kind && e.target.kind !== 'self') list.push(e.target);
      if (e.targets) list.push(...e.targets.filter((t) => t.kind !== 'self'));
    }
  };
  walk(effects);
  if (choose) {
    for (const opt of choose.options) walk(opt.effects);
  }
  return list;
}
