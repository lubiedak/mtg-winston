import { catalogFromData } from './src/catalog.js';
import { buildCube, CUBE_SETS, rarityTargets } from './src/cube.js';
import { createDraft, applyDraft, pileKnown, knownInPool } from './src/winston.js';
import { applyGrid, createGrid, gridLines, gridPackCount } from './src/grid.js';
import { choiceNote, manualBasics } from './src/lands.js';
import { parseCard } from './src/parse.js';
import { actor, apply, cardView, legalTargets, STEP_LABEL, STEPS } from './src/engine.js';
import { chooseDraft, engineMark } from './src/ai.js';
import { COLOR_NAME, mulberry32, RARITY_NAME, shuffle } from './src/util.js';
import { getLang, setLang, t } from './src/i18n.js';
import { polishCard } from './src/pltext.js';
import { isDraftId, newDraftId, packSession, unpackSession } from './src/session.js';

const APP_ROOT = new URL('./', import.meta.url);

function appUrl(path) {
  if (!path) return path;
  if (/^(https?:|data:)/i.test(path)) return path;
  return new URL(String(path).replace(/^\//, ''), APP_ROOT).href;
}

const app = document.querySelector('#app');
const DIFFS = [
  ['easy', 'Łatwy'],
  ['medium', 'Średni'],
  ['hard', 'Trudny'],
];
const BASIC_NAME = { W: 'Równina', U: 'Wyspa', B: 'Bagno', R: 'Góra', G: 'Las' };

let cat;
let byId;
let catalogIds = new Set();
let catalogKey;
let draftId = null;
let saveTimer = null;
let diff = 'medium';
let first = 'human';
let format = 'winston';
let gridFirst = 'p1';
let cobraUrl = '';
try { cobraUrl = localStorage.getItem('mtg-cobra-url') || ''; } catch { /* podgląd bez zapisu */ }
let importing = false;
let setCode = 'afr';
let decks = null;
let seatOrder = ['human'];
let seatAt = 0;
let hands = null;
let handSeat = 'human';
let cube;
let draft;
let game;
let screen = 'menu';
let status = '';
let selected = new Set();
let landPicks = {};
let aim = null;
let fast = false;
let scratchKey = '';
let scratch = { attackers: new Set(), pairs: [], blocker: null, bottom: new Set(), scry: null };
let zoom = null;
let pumping = false;
let rngSeed = (Math.random() * 0x100000000) >>> 0;
let plCards = {};
const RARITY_KEYS = ['common', 'uncommon', 'rare', 'mythic'];
const DEFAULT_RARITY_PCT = { common: 52, uncommon: 31, rare: 10, mythic: 7 };

function loadRarityPct() {
  try {
    const raw = JSON.parse(localStorage.getItem('mtg-rarity-pct') || '');
    const out = {};
    for (const key of RARITY_KEYS) {
      const n = Number(raw?.[key]);
      out[key] = Number.isFinite(n) && n >= 0 ? n : DEFAULT_RARITY_PCT[key];
    }
    return out;
  } catch {
    return { ...DEFAULT_RARITY_PCT };
  }
}

let rarityPct = loadRarityPct();

const h = (tag, attrs = {}, kids = []) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value != null && value !== false) node.setAttribute(key, value);
  }
  for (const kid of [].concat(kids)) {
    if (kid == null || kid === false) continue;
    node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return node;
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function other(player) {
  return player === 'human' ? 'ai' : 'human';
}

function pipNodes(cost) {
  const wrap = h('span');
  if (!cost) return wrap;
  for (const sym of cost.match(/\{[^}]+\}/g) || []) {
    const raw = sym.slice(1, -1);
    const color = raw.length === 1 ? raw : 'C';
    wrap.append(h('span', { class: `pip ${color}` }, raw));
  }
  return wrap;
}

function shown(def) {
  if (!def) return { name: '', typeLine: '', oracle: '' };
  const english = { name: def.name || '', typeLine: def.typeLine || '', oracle: def.oracle || '' };
  if (getLang() !== 'pl') return english;
  const gloss = polishCard(english);
  if (def.basic && def.plName) return { ...gloss, name: def.plName };
  const tr = def.oracleId ? plCards[def.oracleId] : null;
  if (tr?.name && tr.name !== english.name) {
    return {
      name: tr.name,
      typeLine: tr.type_line || gloss.typeLine,
      oracle: tr.text || gloss.oracle,
    };
  }
  return { ...gloss, name: english.name };
}

function faceLabel(def, index) {
  const tr = getLang() === 'pl' && def?.oracleId ? plCards[def.oracleId] : null;
  return tr?.faces?.[index]?.name || def?.faces?.[index]?.name || String(index + 1);
}

function basicLabel(color) {
  if (getLang() === 'en') return { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' }[color];
  return BASIC_NAME[color];
}

function langBar() {
  return h('header', { class: 'titlebar' }, [
    h('strong', {}, 'MTGO · Winston Cube'),
    h('div', { class: 'lang' }, [
      h('button', {
        class: getLang() === 'pl' ? 'on' : 'ghost',
        onclick: () => { setLang('pl'); document.documentElement.lang = 'pl'; render(); },
      }, 'Polski'),
      h('button', {
        class: getLang() === 'en' ? 'on' : 'ghost',
        onclick: () => { setLang('en'); document.documentElement.lang = 'en'; render(); },
      }, 'English'),
    ]),
  ]);
}

function colorOf(def) {
  const ci = def?.colorIdentity || [];
  if (ci.length > 1) return 'gold';
  if (ci.length === 1) return ci[0];
  const type = def?.typeLine || '';
  if (type.includes('Plains')) return 'W';
  if (type.includes('Island')) return 'U';
  if (type.includes('Swamp')) return 'B';
  if (type.includes('Mountain')) return 'R';
  if (type.includes('Forest')) return 'G';
  return 'C';
}

function miniImage(url, name, extraClass = '') {
  if (!url) return null;
  return h('img', {
    class: `mini${extraClass ? ` ${extraClass}` : ''}`,
    src: appUrl(url),
    alt: name || 'karta',
    loading: 'lazy',
    referrerpolicy: 'no-referrer',
    onerror: (event) => event.currentTarget.remove(),
  });
}

function artNodes(def, faceIndex = 0) {
  if (!def) return [];
  const front = faceIndex === 1 && def.imageBack ? def.imageBack : def.image;
  const nodes = [miniImage(front, def.name)];
  if (faceIndex === 0 && def.imageBack) nodes.push(miniImage(def.imageBack, def.name, 'backface'));
  return nodes.filter(Boolean);
}

const PIP_ORDER = { W: 0, U: 1, B: 2, R: 3, G: 4 };

function colorRank(def) {
  const letters = ['W', 'U', 'B', 'R', 'G'].filter((color) => (def?.colorIdentity || []).includes(color));
  if (letters.length === 0) return [2, 0, ''];
  if (letters.length === 1) return [0, PIP_ORDER[letters[0]], ''];
  return [1, letters.length, letters.join('')];
}

function comparePoolCards(a, b) {
  const ka = colorRank(a);
  const kb = colorRank(b);
  if (ka[0] !== kb[0]) return ka[0] - kb[0];
  if (ka[1] !== kb[1]) return ka[1] - kb[1];
  const len = Math.max(ka[2].length, kb[2].length);
  for (let i = 0; i < len; i += 1) {
    const da = PIP_ORDER[ka[2][i]] ?? 9;
    const db = PIP_ORDER[kb[2][i]] ?? 9;
    if (da !== db) return da - db;
  }
  return (a?.name || '').localeCompare(b?.name || '', 'en');
}

function curveBoard(ids, extraFor) {
  const byCost = new Map();
  for (const id of ids) {
    const def = byId.get(id);
    const cost = Math.max(0, Math.round(Number(def?.cmc) || 0));
    if (!byCost.has(cost)) byCost.set(cost, []);
    byCost.get(cost).push(id);
  }
  const costs = [...byCost.keys()].sort((a, b) => a - b);
  return h('div', { class: 'curve' }, costs.map((cost) => {
    const col = byCost.get(cost).sort((a, b) => comparePoolCards(byId.get(a), byId.get(b)));
    return h('div', { class: 'curve-col', 'data-cost': String(cost) }, [
      h('div', { class: 'cost' }, String(cost)),
      h('div', { class: 'curve-stack' }, col.map((id) => cardNode(byId.get(id), extraFor ? extraFor(id) : {}))),
    ]);
  }));
}

function stackCurve() {
  for (const stack of document.querySelectorAll('.curve-stack')) {
    const cards = [...stack.children].filter((node) => node.classList.contains('card'));
    for (let i = 1; i < cards.length; i += 1) {
      const prev = cards[i - 1];
      const head = prev.querySelector('header');
      const keep = Math.ceil((head?.offsetHeight || 22) + 8);
      cards[i].style.marginTop = `-${Math.max(0, prev.offsetHeight - keep)}px`;
    }
  }
}

function onZoom(info) {
  return (event) => {
    event.preventDefault();
    event.stopPropagation();
    zoom = info;
    render();
  };
}

function cardNode(def, extra = {}) {
  if (!def || extra.hidden) {
    return h('article', {
      class: 'card back',
      oncontextmenu: onZoom({ name: 'Zakryta karta', oracle: 'Tej karty jeszcze nie widziałeś.' }),
    }, [
      h('header', {}, t('Zakryta karta')),
    ]);
  }
  const text = shown(def);
  const art = artNodes(def);
  const node = h('article', {
    class: `card ${colorOf(def)}${art.length ? ' has-art' : ''}${extra.on ? ' on' : ''}${extra.tapped ? ' tapped' : ''}`,
    onclick: extra.onclick,
    oncontextmenu: onZoom({
      defId: def.id,
      pt: def.power != null ? `${def.power}/${def.toughness}` : (def.loyalty || ''),
    }),
  }, [
    ...art,
    h('header', {}, [h('span', {}, text.name), pipNodes(def.manaCost)]),
  ]);
  if (extra.tapped) node.append(h('b', { class: 'stamp' }, 'TAP'));
  return node;
}

function viewNode(view, onclick, extra = {}) {
  if (!view) return h('article', { class: 'card back' }, '—');
  const def = byId.get(view.defId);
  const marked = extra.on || (aim && legalAim(view.id)) || isNextTarget(view.id);
  const pt = view.power != null ? `${view.power}/${view.toughness}` : (view.loyalty != null ? String(view.loyalty) : '');
  if (view.faceDown && view.name.startsWith('Zakryte')) {
    return h('article', {
      class: `card back${marked ? ' on' : ''}`,
      onclick,
      oncontextmenu: onZoom({ name: view.name, typeLine: view.typeLine || '', oracle: view.text || '', pt, hidden: true }),
    }, [
      h('header', {}, t(view.name)),
    ]);
  }
  const text = shown(def);
  const faceIndex = game?.objects?.[view.id]?.face || 0;
  const art = artNodes(def, faceIndex);
  const node = h('article', {
    class: `card ${colorOf(def)} ${view.tapped ? 'tapped' : ''} ${marked ? 'on' : ''} ${art.length ? 'has-art' : ''}`,
    onclick,
    oncontextmenu: onZoom({ defId: view.defId, faceIndex, pt, oracle: view.text || '' }),
  }, [
    ...art,
    h('header', {}, [h('span', {}, text.name || view.name), pipNodes(view.manaCost)]),
  ]);
  if (view.tapped) node.append(h('b', { class: 'stamp' }, 'TAP'));
  if (view.attacking) node.append(h('div', { class: 'flag' }, t('atakuje')));
  return node;
}

function legalAim(id) {
  if (!aim || !game) return false;
  const spec = aim.specs[aim.targets.length];
  if (!spec) return false;
  return legalTargets(game, spec, 'human').includes(id);
}

function stackItem() {
  const p = game?.pending;
  if (!p || p.kind !== 'stackTargets') return null;
  return game.stack.find((s) => s.id === p.stackId) || null;
}

function stackSpecs() {
  const item = stackItem();
  return item ? specsOf(item.effects) : [];
}

function stackBag() {
  const bag = remember(`stk-${game.pending.stackId}`);
  if (!bag.targets) bag.targets = [];
  return bag;
}

function isNextTarget(id) {
  if (!game || game.pending?.kind !== 'stackTargets' || game.pending.player !== 'human') return false;
  const spec = stackSpecs()[stackBag().targets.length];
  if (!spec) return false;
  return legalTargets(game, spec, 'human').includes(id);
}

function pickStackTarget(id) {
  const specs = stackSpecs();
  const bag = stackBag();
  const spec = specs[bag.targets.length];
  if (!spec) return;
  if (id != null && !legalTargets(game, spec, 'human').includes(id)) {
    status = 'To nie jest legalny cel.';
    render();
    return;
  }
  bag.targets.push(id);
  status = '';
  if (bag.targets.length >= specs.length) act({ type: 'answer', value: { targets: bag.targets.slice() } });
  else render();
}

function newMatch() {
  clearTimeout(saveTimer);
  saveTimer = null;
  saveNow();
  draftId = null;
  rememberLink();
  game = null;
  draft = null;
  cube = null;
  decks = null;
  hands = null;
  seatOrder = ['human'];
  seatAt = 0;
  screen = 'menu';
  aim = null;
  fast = false;
  status = '';
  selected = new Set();
  landPicks = {};
  render();
}

function sessionLink() {
  const url = new URL(location.href);
  url.searchParams.set('d', draftId);
  url.hash = '';
  return `${url.origin}${url.pathname}${url.search}`;
}

function rememberLink() {
  const url = new URL(location.href);
  if (draftId) url.searchParams.set('d', draftId);
  else url.searchParams.delete('d');
  const next = `${url.pathname}${url.search}`;
  if (next !== `${location.pathname}${location.search}`) history.replaceState(null, '', next);
}

function ensureDraftId() {
  if (draftId) return;
  draftId = newDraftId();
  rememberLink();
}

function currentSession() {
  return {
    catalogIds,
    screen,
    format,
    gridFirst,
    first,
    diff,
    setCode,
    rngSeed,
    status,
    seatOrder,
    seatAt,
    handSeat,
    cube,
    draft,
    decks,
    hands,
    landPicks,
  };
}

function saveNow() {
  if (!draftId || !cube) return;
  const id = draftId;
  const body = JSON.stringify(packSession(currentSession()));
  fetch(appUrl(`api/draft/${id}`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => { /* kolejna zmiana zapisze jeszcze raz */ });
}

function scheduleSave() {
  if (!draftId || !cube) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveNow();
  }, 200);
}

function linkBox() {
  if (!draftId) return null;
  const href = sessionLink();
  return h('div', { class: 'draft-link' }, [
    h('span', {}, t('Link do tego draftu. Odświeżenie strony wraca w to samo miejsce.')),
    h('input', {
      id: 'draft-link',
      type: 'text',
      readonly: true,
      value: href,
      onclick: (event) => event.target.select(),
    }),
    h('button', { class: 'ghost', onclick: async () => {
      const input = document.querySelector('#draft-link');
      input?.select();
      try { await navigator.clipboard.writeText(href); } catch { /* adres zostaje zaznaczony */ }
    } }, t('Kopiuj')),
  ]);
}

function restoreHands(saved) {
  if (!saved) {
    hands = null;
    return;
  }
  if (!decks) decks = {};
  hands = {};
  for (const [seat, bag] of Object.entries(saved)) {
    if (!decks[seat]) decks[seat] = new Set();
    const built = buildInstances(seat);
    hands[seat] = {
      library: bag.library || [],
      hand: bag.hand || [],
      mulligans: bag.mulligans || 0,
      mode: bag.mode === 'bottom' ? 'bottom' : 'keep',
      bottom: new Set(bag.bottom || []),
      byUid: new Map(built.instances.map((item) => [item.uid, item])),
      plan: built.plan,
    };
  }
}

function applySnapshot(state) {
  screen = state.screen;
  format = state.format;
  gridFirst = state.gridFirst;
  first = state.first;
  diff = state.diff;
  setCode = state.setCode;
  rngSeed = state.rngSeed;
  status = state.status || '';
  cube = state.cube;
  draft = state.draft;
  seatOrder = state.seatOrder;
  seatAt = state.seatAt;
  handSeat = state.handSeat;
  decks = state.decks;
  if ((screen === 'deck' || screen === 'hand') && !decks) {
    decks = {};
    for (const seat of seatOrder) decks[seat] = new Set();
  }
  if (decks?.[seatOrder[seatAt]]) selected = decks[seatOrder[seatAt]];
  else selected = new Set();
  landPicks = mergeLandPicks(state.landPicks, state.hands);
  restoreHands(state.hands);
  zoom = null;
  aim = null;
  game = null;
}

function generatedSize() {
  return format === 'grid' ? 162 : 90;
}

function rarityPreviewText() {
  const size = generatedSize();
  try {
    const targets = rarityTargets(rarityPct, size);
    return `Z ${size} kart: pospolita ${targets.common}, niepospolita ${targets.uncommon}, rzadka ${targets.rare}, mityczna ${targets.mythic}.`;
  } catch {
    return 'Podaj proporcję większą od zera.';
  }
}

function rememberRarityPct() {
  try { localStorage.setItem('mtg-rarity-pct', JSON.stringify(rarityPct)); } catch { /* podgląd bez zapisu */ }
}

function rarityControls() {
  return h('div', { class: 'rarity-pct' }, [
    h('span', { class: 'label' }, t('Proporcje rzadkości')),
    ...RARITY_KEYS.map((key) => h('label', {}, [
      t(RARITY_NAME[key]),
      h('input', {
        type: 'number',
        min: '0',
        step: '1',
        value: String(rarityPct[key]),
        'aria-label': t(RARITY_NAME[key]),
        oninput: (event) => {
          const n = Number(event.target.value);
          rarityPct[key] = Number.isFinite(n) && n >= 0 ? n : 0;
          rememberRarityPct();
          const node = document.querySelector('#rarity-preview');
          if (node) node.textContent = t(rarityPreviewText());
        },
      }),
    ])),
    h('span', { id: 'rarity-preview', class: 'preview' }, t(rarityPreviewText())),
  ]);
}

function optionList(pairs, current) {
  return pairs.map(([id, name]) => {
    const opt = h('option', { value: id }, t(name));
    if (id === current) opt.selected = true;
    return opt;
  });
}

function formatNote(count) {
  if (format !== 'grid') return `Winston draftuje całą kostkę: ${count} kart.`;
  const packs = gridPackCount(count);
  if (packs < 1) return 'Grid potrzebuje co najmniej 9 kart.';
  if (packs < 18) return `Kostka ma ${count} kart, więc grid ma ${packs} siatek po 9, nie 18.`;
  if (count > 162) return 'Grid weźmie 18 siatek, czyli 162 karty. Reszta kostki nie wchodzi do tego losowania.';
  return 'Grid: 18 siatek po 9 kart.';
}

function weightHelp() {
  if (format === 'grid') {
    return 'Wagi procentowe. Nie muszą sumować się do 100. Przy 162 kartach udziały kolorów są przeskalowane z kostki 90: 14 na kolor, 10 wielokolorowych, 6 bezbarwnych, 4 lądy. Gdy w dodatku brakuje kart tej rzadkości, kostka uzupełnia brak i pisze o tym.';
  }
  return 'Wagi procentowe. Nie muszą sumować się do 100. Kolory zostają: 14 na kolor, 10 wielokolorowych, 6 bezbarwnych, 4 lądy. Gdy w dodatku brakuje kart tej rzadkości, kostka uzupełnia brak i pisze o tym.';
}

function cubeBlurb() {
  if (cube?.imported) return 'Ta kostka pochodzi z CubeCobra. Lądy podstawowe dobierasz przy składaniu talii. Na starcie każdy kolor ma zero.';
  if (format === 'grid') return 'Grid z jednego dodatku: 18 siatek po 9 kart. Udział kolorów jest taki jak w sprawiedliwej kostce 90 kart, tylko przeskalowany. Lądy podstawowe dobierasz przy składaniu talii. Na starcie każdy kolor ma zero.';
  return 'Winston: trzy kupki. Kwoty: 14 na każdy kolor, 10 wielokolorowych, 6 bezbarwnych, 4 lądy inne niż podstawowe. Lądy podstawowe dobierasz przy składaniu talii. Na starcie każdy kolor ma zero.';
}

function freshSeed() {
  rngSeed = (Math.random() * 0x100000000) >>> 0;
  return rngSeed;
}

function reshuffleCube() {
  if (cube?.imported) {
    cube.cards = shuffle(cube.cards.slice(), mulberry32(freshSeed()));
    render();
    return;
  }
  bootCube();
}

function seatLabel(seat) {
  if (seat === 'p1') return 'Gracz 1';
  if (seat === 'p2') return 'Gracz 2';
  if (seat === 'ai') return 'Komputer';
  return 'Ty';
}

function bootCube() {
  const size = generatedSize();
  try {
    rarityTargets(rarityPct, size);
  } catch (err) {
    status = err.message;
    render();
    return;
  }
  rememberRarityPct();
  rngSeed = (rngSeed + 1) % 100000;
  cube = buildCube(cat.cards, mulberry32(rngSeed + 17), setCode, rarityPct, size);
  cube.imported = false;
  cube.format = format;
  cube.name = CUBE_SETS[setCode];
  screen = 'cube';
  status = '';
  render();
}

function startDraft() {
  if (cube && !cube.imported && cube.format) format = cube.format;
  const rng = mulberry32(freshSeed());
  if (format === 'grid') {
    const starter = gridFirst === 'random' ? (Math.random() < 0.5 ? 'p1' : 'p2') : gridFirst;
    try {
      draft = createGrid(cube.cards.map((c) => c.id), starter, rng);
    } catch (err) {
      status = err.message;
      render();
      return;
    }
    screen = 'draft';
    render();
    return;
  }
  const starter = first === 'random' ? (Math.random() < 0.5 ? 'human' : 'ai') : first;
  first = starter;
  draft = createDraft(cube.cards.map((c) => c.id), starter, rng);
  screen = 'draft';
  pump();
}

function doGrid(line) {
  const res = applyGrid(draft, line);
  if (!res.ok) {
    status = res.error;
    render();
    return;
  }
  status = '';
  if (draft.done) openDeck();
  else render();
}

function summarizeImported(defs) {
  const summary = {
    color: { W: 0, U: 0, B: 0, R: 0, G: 0, gold: 0, colorless: 0, land: 0 },
    rarity: {},
    total: defs.length,
  };
  for (const card of defs) {
    const type = card.typeLine || '';
    const ci = card.colorIdentity || [];
    const key = /\bLand\b/.test(type) ? 'land' : ci.length === 0 ? 'colorless' : ci.length === 1 ? ci[0] : 'gold';
    summary.color[key] += 1;
    summary.rarity[card.rarity] = (summary.rarity[card.rarity] || 0) + 1;
  }
  return summary;
}

async function importCube() {
  if (importing) return;
  importing = true;
  status = 'Pobieram kostkę…';
  render();
  try {
    const res = await fetch(appUrl(`api/cube?url=${encodeURIComponent(cobraUrl)}`));
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Nie udało się wczytać kostki.');
    const defs = json.cards.map((card) => {
      const baseId = String(card.id).replace(/#\d+$/, '');
      const known = cat.byId.get(baseId);
      const upper = (list) => (list || []).map((color) => String(color).toUpperCase());
      const def = known
        ? { ...known, id: card.id, image: known.image || card.image }
        : parseCard(card);
      def.colors = upper(def.colors);
      def.colorIdentity = upper(def.colorIdentity);
      if (!known) def.producedMana = upper(card.produced_mana);
      if (card.image) def.image = def.image || card.image;
      byId.set(def.id, def);
      return def;
    });
    cube = {
      cards: shuffle(defs, mulberry32(freshSeed())),
      notes: [],
      summary: summarizeImported(defs),
      set: json.id,
      name: json.name,
      imported: true,
      rarityRequest: null,
    };
    screen = 'cube';
    status = '';
  } catch (err) {
    status = err.message;
  } finally {
    importing = false;
    render();
  }
}

function doDraft(choice) {
  const res = applyDraft(draft, choice);
  if (!res.ok) status = res.error;
  if (draft.done) {
    openDeck();
    return;
  }
  pump();
}

const BASIC_PL = { W: 'Równina', U: 'Wyspa', B: 'Bagno', R: 'Góra', G: 'Las' };

const LAND_COLORS = ['W', 'U', 'B', 'R', 'G'];

function emptyBasics() {
  return { W: 0, U: 0, B: 0, R: 0, G: 0 };
}

function clampLand(value) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(40, n);
}

function picksFor(seat) {
  if (!landPicks[seat]) landPicks[seat] = emptyBasics();
  return landPicks[seat];
}

function basicsFromHand(bag) {
  const counts = emptyBasics();
  for (const uid of [...(bag?.hand || []), ...(bag?.library || [])]) {
    const match = /^b([WUBRG])(\d+)$/.exec(String(uid));
    if (!match) continue;
    counts[match[1]] = Math.max(counts[match[1]], Number(match[2]) + 1);
  }
  return counts;
}

function mergeLandPicks(saved, handsSaved) {
  const out = {};
  const seats = new Set([
    ...Object.keys(saved || {}),
    ...Object.keys(handsSaved || {}),
    ...seatOrder,
  ]);
  for (const seat of seats) {
    const counts = emptyBasics();
    const fromHand = basicsFromHand(handsSaved?.[seat]);
    for (const color of LAND_COLORS) {
      counts[color] = Math.max(clampLand(saved?.[seat]?.[color]), fromHand[color]);
    }
    out[seat] = counts;
  }
  return out;
}

function openDeck() {
  seatOrder = format === 'grid' ? ['p1', 'p2'] : ['human'];
  seatAt = 0;
  decks = {};
  landPicks = {};
  for (const seat of seatOrder) {
    decks[seat] = new Set();
    landPicks[seat] = emptyBasics();
  }
  selected = decks[seatOrder[0]];
  hands = null;
  screen = 'deck';
  status = '';
  render();
}

function currentPlan() {
  const cards = [...selected].map((id) => byId.get(id)).filter(Boolean);
  return manualBasics(cards, picksFor(seatOrder[seatAt]));
}

function basicsLine(plan) {
  const parts = LAND_COLORS
    .filter((color) => plan.basics[color] > 0)
    .map((color) => `${BASIC_PL[color]} ${plan.basics[color]}`);
  if (!parts.length) return 'Wybrane lądy podstawowe: żadne.';
  return `Wybrane lądy podstawowe: ${parts.join(', ')}.`;
}

function setLandCount(color, value) {
  picksFor(seatOrder[seatAt])[color] = clampLand(value);
  const plan = currentPlan();
  const note = document.querySelector('#land-note');
  const chosen = document.querySelector('#land-chosen');
  const warn = document.querySelector('#land-warn');
  if (note) note.textContent = plan.deckSize ? t(choiceNote(plan)) : '';
  if (chosen) chosen.textContent = t(basicsLine(plan));
  if (warn) warn.textContent = plan.deckSize > 40 ? t('Talia ma więcej niż 40 kart.') : '';
  scheduleSave();
}

function landStepper() {
  const seat = seatOrder[seatAt];
  const picks = picksFor(seat);
  const plan = currentPlan();
  return h('div', { class: 'panel land-picks' }, [
    h('h2', {}, t('Lądy podstawowe')),
    h('p', { class: 'sub' }, t('Każdy kolor startuje od zera. Liczba przy „propozycja” pochodzi z tabeli Karstena i nie wchodzi do talii, dopóki jej nie ustawisz.')),
    h('div', { class: 'row' }, LAND_COLORS.map((color) => h('label', { class: 'land-pick' }, [
      basicLabel(color),
      h('button', {
        type: 'button',
        class: 'ghost',
        'aria-label': t(`Mniej: ${BASIC_PL[color]}`),
        onclick: () => { picks[color] = Math.max(0, picks[color] - 1); render(); },
      }, '−'),
      h('input', {
        type: 'number',
        min: '0',
        max: '40',
        step: '1',
        value: String(picks[color]),
        'aria-label': basicLabel(color),
        oninput: (event) => setLandCount(color, event.target.value),
        onchange: (event) => {
          setLandCount(color, event.target.value);
          event.target.value = String(picks[color]);
        },
      }),
      h('button', {
        type: 'button',
        class: 'ghost',
        'aria-label': t(`Więcej: ${BASIC_PL[color]}`),
        onclick: () => { picks[color] = Math.min(40, picks[color] + 1); render(); },
      }, '+'),
      plan.suggested[color] > 0 ? h('span', { class: 'hint' }, t(`propozycja ${plan.suggested[color]}`)) : null,
    ]))),
  ]);
}

function buildInstances(seat) {
  const chosen = [...(decks[seat] || [])];
  const cards = chosen.map((id) => byId.get(id)).filter(Boolean);
  const plan = manualBasics(cards, picksFor(seat));
  const instances = chosen.map((id, index) => ({ uid: `c${index}:${id}`, defId: id }));
  for (const color of LAND_COLORS) {
    for (let i = 0; i < (plan.basics[color] || 0); i += 1) {
      instances.push({ uid: `b${color}${i}`, defId: `basic-${color}` });
    }
  }
  return { instances, plan };
}

function freshHand(seat, rng) {
  const built = buildInstances(seat);
  const library = shuffle(built.instances.map((item) => item.uid), rng);
  return {
    library,
    hand: library.splice(0, Math.min(7, library.length)),
    mulligans: 0,
    mode: 'keep',
    bottom: new Set(),
    byUid: new Map(built.instances.map((item) => [item.uid, item])),
    plan: built.plan,
  };
}

function openHands() {
  hands = {};
  seatOrder.forEach((seat, index) => {
    hands[seat] = freshHand(seat, mulberry32((rngSeed + 400 + index * 97) >>> 0));
  });
  handSeat = seatOrder[0];
  screen = 'hand';
  status = '';
  render();
}

function finishSeat() {
  const lands = LAND_COLORS.reduce((sum, color) => sum + (picksFor(seatOrder[seatAt])[color] || 0), 0);
  if (selected.size + lands === 0) {
    status = 'Wybierz karty do talii.';
    render();
    return;
  }
  status = '';
  if (seatAt < seatOrder.length - 1) {
    seatAt += 1;
    selected = decks[seatOrder[seatAt]];
    render();
    return;
  }
  openHands();
}

function redrawHand() {
  hands[handSeat] = freshHand(handSeat, mulberry32((Math.random() * 0x100000000) >>> 0));
  status = '';
  render();
}

function mulliganHand() {
  const bag = hands[handSeat];
  if (!bag || bag.mode !== 'keep' || bag.mulligans >= 6) return;
  bag.mulligans += 1;
  const all = shuffle([...bag.hand, ...bag.library], mulberry32((Math.random() * 0x100000000) >>> 0));
  bag.library = all;
  bag.hand = bag.library.splice(0, Math.min(7, bag.library.length));
  bag.mode = 'bottom';
  bag.bottom = new Set();
  status = `Odkładasz ${bag.mulligans} kart na spód.`;
  render();
}

function confirmBottom() {
  const bag = hands[handSeat];
  const n = bag.mulligans;
  if (bag.bottom.size !== n) {
    status = `Odkładasz ${n} kart na spód.`;
    render();
    return;
  }
  const stay = [];
  const down = [];
  for (const uid of bag.hand) {
    if (bag.bottom.has(uid)) down.push(uid);
    else stay.push(uid);
  }
  bag.hand = stay;
  bag.library.push(...down);
  bag.mode = 'keep';
  bag.bottom = new Set();
  status = 'Zostawiasz tę rękę.';
  render();
}

function act(action) {
  const res = apply(game, 'human', action);
  if (!res.ok) {
    status = res.error;
    render();
    return;
  }
  status = '';
  aim = null;
  fast = false;
  pump();
}

function faceOf(id) {
  const obj = game.objects[id];
  const def = byId.get(obj?.defId);
  return def?.faces?.[obj.face || 0] || null;
}

function specsOf(effects) {
  const specs = [];
  for (const effect of effects || []) {
    if (effect.target && effect.target.kind !== 'self') specs.push(effect.target);
    if (effect.targets) specs.push(...effect.targets.filter((t) => t.kind !== 'self'));
  }
  return specs;
}

function playFromHand(id) {
  if (game.pending || actor(game) !== 'human') return;
  const face = faceOf(id);
  if (face?.cycling && !face.spellEffects?.length && !face.isLand && game.objects[id].zone === 'hand') {
    aim = { kind: 'permanent', id };
    render();
    return;
  }
  beginCast(id);
}

function beginCast(id) {
  const face = faceOf(id);
  if (!face) return;
  const view = cardView(game, id, 'human');
  if (view && face.isLand && !face.isCreature) {
    act({ type: 'playLand', id });
    return;
  }
  if (face.choose) {
    aim = { kind: 'cast', id, modes: null, specs: [], targets: [], x: 0, kicker: false, impending: false, choose: face.choose };
    render();
    return;
  }
  openAim({ kind: 'cast', id, modes: [], effects: face.spellEffects, x: 0, kicker: false, impending: false });
}

function openAim(partial) {
  const specs = specsOf(partial.effects);
  aim = { ...partial, specs, targets: [] };
  if (!specs.length) finishAim();
  else render();
}

function finishAim() {
  if (!aim) return;
  const action = aim.kind === 'cast'
    ? { type: 'cast', id: aim.id, targets: aim.targets, modes: aim.modes || [], x: aim.x || 0, kicker: !!aim.kicker, impending: !!aim.impending }
    : { type: 'activate', id: aim.id, index: aim.index, targets: aim.targets };
  act(action);
}

function clickPermanent(id, owner) {
  if (game.pending?.kind === 'stackTargets' && game.pending.player === 'human') {
    pickStackTarget(id);
    return;
  }
  if (aim) {
    if (!legalAim(id)) {
      status = 'To nie jest legalny cel.';
      render();
      return;
    }
    aim.targets.push(id);
    if (aim.targets.length >= aim.specs.length) finishAim();
    else render();
    return;
  }
  if (owner !== 'human') return;
  if (game.awaiting === 'attackers' || game.awaiting === 'blockers') return;
  aim = { kind: 'permanent', id };
  render();
}

function hasInstant() {
  return game.players.human.hand.some((id) => {
    const face = faceOf(id);
    return face && (face.isInstant || face.flash || (face.keywords || []).includes('Flash'));
  });
}

function stopForHuman() {
  if (!game || game.gameOver) return true;
  if (game.pending?.player === 'human') return true;
  if (actor(game) !== 'human') return false;
  if (game.awaiting === 'attackers' || game.awaiting === 'blockers') return true;
  if ((game.step === 'precombat' || game.step === 'postcombat') && game.active === 'human' && !game.stack.length) return true;
  if (game.step === 'end' && game.active === 'human') return true;
  if (game.stack.length && hasInstant()) return true;
  if (game.active !== 'human' && hasInstant() && ['beginCombat', 'declareAttackers', 'declareBlockers', 'end'].includes(game.step)) return true;
  return false;
}

async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    let n = 0;
    while (n++ < 200) {
      render();
      if (screen !== 'draft' || format !== 'winston') break;
      if (!draft || draft.done || draft.active !== 'ai') break;
      await sleep(600);
      if (screen !== 'draft' || format !== 'winston' || !draft || draft.done || draft.active !== 'ai') break;
      const res = applyDraft(draft, chooseDraft(draft, byId, diff));
      if (!res.ok) { status = res.error; break; }
      render();
      await sleep(800);
      if (draft.done) {
        openDeck();
        break;
      }
    }
  } finally {
    pumping = false;
    render();
  }
}

function renderMenu() {
  return h('section', { class: 'panel' }, [
    h('h1', {}, 'Winston Cube'),
    h('p', { class: 'sub' }, t('Draft i składanie talii. Winston: 90 kart z jednego dodatku, Ty przeciwko komputerowi. Grid: dwie osoby przy jednym komputerze, do 18 siatek po 9 kart. Dodatki w losowaniu nigdy się nie mieszają. Kostkę można też wczytać z CubeCobra.')),
    h('p', { class: 'sub' }, [
      t('Gotowe talie Commandera z kolekcji. '),
      h('a', { class: 'text-link', href: 'decki.html' }, t('Zobacz listy z miniaturami.')),
    ]),
    h('div', { class: 'row' }, [
      h('label', {}, t('Tryb')),
      h('select', { onchange: (e) => { format = e.target.value; render(); } }, optionList([
        ['winston', 'Winston'],
        ['grid', 'Grid'],
      ], format)),
      h('label', {}, t('Dodatek')),
      h('select', { onchange: (e) => { setCode = e.target.value; } }, Object.entries(CUBE_SETS).map(([id, name]) => {
        const opt = h('option', { value: id }, name);
        if (id === setCode) opt.selected = true;
        return opt;
      })),
      format === 'winston' ? h('label', {}, t('Trudność')) : null,
      format === 'winston' ? h('select', { onchange: (e) => { diff = e.target.value; } }, optionList(DIFFS, diff)) : null,
      h('label', {}, t('Kto draftuje pierwszy')),
      format === 'grid'
        ? h('select', { onchange: (e) => { gridFirst = e.target.value; } }, optionList([
          ['p1', 'Gracz 1'],
          ['p2', 'Gracz 2'],
          ['random', 'Losowo'],
        ], gridFirst))
        : h('select', { onchange: (e) => { first = e.target.value; } }, optionList([
          ['human', 'Ja'],
          ['ai', 'Komputer'],
          ['random', 'Losowo'],
        ], first)),
      h('button', { onclick: bootCube }, t('Ułóż kostkę')),
      cube ? h('button', { class: 'ghost', onclick: () => {
        if (!cube.imported && cube.format) format = cube.format;
        screen = 'cube';
        status = '';
        render();
      } }, t('Wróć do kostki')) : null,
    ]),
    rarityControls(),
    h('p', { class: 'sub' }, t(weightHelp())),
    h('div', { class: 'row' }, [
      h('label', {}, 'CubeCobra'),
      h('input', {
        type: 'url',
        value: cobraUrl,
        placeholder: 'https://cubecobra.com/cube/list/…',
        'aria-label': t('Link albo identyfikator kostki CubeCobra.'),
        oninput: (event) => {
          cobraUrl = event.target.value;
          try { localStorage.setItem('mtg-cobra-url', cobraUrl); } catch { /* podgląd bez zapisu */ }
        },
      }),
      h('button', { onclick: importCube, disabled: importing }, t('Wczytaj z CubeCobra')),
    ]),
    status ? h('p', { class: 'note' }, t(status)) : null,
    h('p', { class: 'note' }, t('Miniatury kart są zapisane lokalnie (kopia ze Scryfalla). Prawy przycisk myszy otwiera powiększenie i tekst. Te dodatki nie mają polskiego druku, więc nazwa zostaje angielska, a typ i tekst są przekładem do czytania. Tekst kart © Wizards of the Coast.')),
  ]);
}

function renderCube() {
  const s = cube.summary;
  const notes = cube.imported ? [formatNote(cube.cards.length)] : cube.notes;
  const titleName = cube.name || CUBE_SETS[cube.set] || cube.set;
  return h('section', {}, [
    h('div', { class: 'top' }, [
      h('div', {}, [
        h('h1', {}, t(`Kostka, ${cube.cards.length} kart · ${titleName}`)),
        h('p', { class: 'sub' }, t(cubeBlurb())),
      ]),
      h('div', { class: 'row' }, [
        cube.imported
          ? h('label', {}, t('Tryb'))
          : h('span', {}, t(format === 'grid' ? 'Tryb: Grid' : 'Tryb: Winston')),
        cube.imported
          ? h('select', { onchange: (e) => { format = e.target.value; render(); } }, optionList([
            ['winston', 'Winston'],
            ['grid', 'Grid'],
          ], format))
          : null,
        h('button', { class: 'ghost', onclick: () => { screen = 'menu'; status = ''; render(); } }, t(cube.imported ? 'Wróć' : 'Inny dodatek')),
        h('button', { class: 'ghost', onclick: reshuffleCube }, t('Potasuj jeszcze raz')),
        h('button', { onclick: startDraft }, t('Zacznij draft')),
      ]),
    ]),
    h('div', { class: 'panel counts' }, [
      ...['W', 'U', 'B', 'R', 'G'].map((c) => h('span', {}, `${t(COLOR_NAME[c])}: ${s.color[c]}`)),
      h('span', {}, `${t('wielokolor')}: ${s.color.gold}`),
      h('span', {}, `${t('bezbarwne')}: ${s.color.colorless}`),
      h('span', {}, `${t('lądy')}: ${s.color.land}`),
      ...Object.entries(s.rarity).map(([k, n]) => h('span', {}, `${t(RARITY_NAME[k] || k)}: ${n}`)),
      cube.rarityRequest ? h('span', {}, t(`Proszono: pospolita ${cube.rarityRequest.common}, niepospolita ${cube.rarityRequest.uncommon}, rzadka ${cube.rarityRequest.rare}, mityczna ${cube.rarityRequest.mythic}.`)) : null,
    ]),
    cube.imported ? null : rarityControls(),
    cube.imported ? null : h('p', { class: 'sub' }, t(weightHelp())),
    status ? h('p', { class: 'note' }, t(status)) : null,
    notes.length ? h('div', { class: 'panel note' }, notes.slice(0, 8).map((line) => t(line)).join(' ')) : null,
    h('div', { class: 'panel cards' }, cube.cards.map((c) => cardNode(c))),
  ]);
}

function computerDecision(log) {
  const out = [];
  let pending = [];
  for (let i = (log || []).length - 1; i >= 0; i--) {
    const line = log[i];
    if (line.startsWith('Ty ')) break;
    if (line.startsWith('Komputer')) {
      out.unshift(line, ...pending);
      pending = [];
      continue;
    }
    if (line.startsWith('Kupka ')) pending.unshift(line);
    else pending = [];
  }
  return out;
}

function decisionPanel() {
  const lines = computerDecision(draft.log);
  if (!lines.length) return null;
  return h('div', { class: 'panel decision', 'aria-live': 'polite' }, [
    h('h2', {}, t('Decyzja komputera')),
    ...lines.map((line) => h('p', {}, t(line))),
  ]);
}

function renderDraft() {
  const you = draft.active === 'human' && !pumping;
  return h('section', { class: 'draft' }, [
    h('div', { class: 'top' }, [
      h('div', {}, [
        h('h1', {}, you ? t('Twoja kolej przy kupkach') : t('Komputer ogląda kupki')),
        h('p', { class: 'sub' }, t('Oglądasz kupki od pierwszej. Bierzesz całą albo dokładasz zakrytą kartę i idziesz dalej. Po odrzuceniu trzeciej dokładasz do niej kartę i bierzesz wierzch talii w ciemno. Przeciwnik nie widzi tego, co właśnie obejrzałeś. Spacja pasuje.')),
      ]),
      h('div', {}, t(`Talia główna: ${draft.main.length}`)),
    ]),
    decisionPanel(),
    h('div', { class: 'panel row' }, [0, 1, 2].map((index) => {
      const pile = draft.piles[index];
      const known = pileKnown(draft, 'human', index);
      return h('div', { class: `pile ${draft.looking === index ? 'looking' : ''}` }, [
        h('h3', {}, pile ? t(`Kupka ${index + 1} · ${pile.length}`) : t(`Kupka ${index + 1} zniknęła`)),
        h('div', { class: 'cards' }, (pile || []).map((id, i) => known[i]?.known ? cardNode(byId.get(id)) : cardNode(null, { hidden: true }))),
      ]);
    })),
    you ? h('div', { class: 'row' }, [
      h('button', { onclick: () => doDraft('take') }, t('Weź tę kupkę')),
      h('button', { class: 'ghost', onclick: () => doDraft('pass') }, t('Pas i dokładka')),
    ]) : null,
    h('div', { class: 'panel' }, [
      h('h2', {}, t(`Twoja pula (${draft.pools.human.length})`)),
      curveBoard(draft.pools.human),
    ]),
    h('div', { class: 'panel' }, [
      h('h2', {}, t(`Pula komputera: ${draft.pools.ai.length}`)),
      h('div', { class: 'cards' }, knownInPool(draft, 'ai', 'human').map((id) => cardNode(byId.get(id)))),
    ]),
    h('div', { class: 'panel log' }, draft.log.slice(-12).map((line) => h('div', {}, t(line)))),
  ]);
}

function renderDeck() {
  const seat = seatOrder[seatAt];
  const plan = currentPlan();
  const picks = picksFor(seat);
  const landTotal = LAND_COLORS.reduce((sum, color) => sum + picks[color], 0);
  const deckTotal = selected.size + landTotal;
  const last = seatAt >= seatOrder.length - 1;
  const pool = draft.pools[seat] || [];
  const main = [...selected];
  const side = pool.filter((id) => !selected.has(id));
  return h('section', { class: 'draft' }, [
    h('div', { class: 'top' }, [
      h('div', {}, [
        h('h1', {}, t(`Ułóż talię · ${seatLabel(seat)}`)),
        h('p', { class: 'sub' }, t('Kliknij kartę na sideboardzie, a wskoczy do talii. Klik w talii odkłada ją z powrotem. Lądy podstawowe ustawiasz sam. Na starcie każdy kolor ma zero.')),
      ]),
      h('div', { class: 'row' }, [
        h('button', { class: 'ghost', onclick: newMatch }, t('Od nowa')),
        h('button', {
          onclick: finishSeat,
          disabled: deckTotal === 0,
        }, t(last ? 'Ręka startowa' : 'Talia gotowa — kolejny gracz')),
      ]),
    ]),
    h('p', {}, t(`W talii głównej: ${selected.size} kart.`)),
    h('p', { id: 'land-chosen' }, t(basicsLine(plan))),
    plan.deckSize ? h('p', { id: 'land-note', class: 'sub' }, t(choiceNote(plan))) : h('p', { id: 'land-note', class: 'sub' }),
    h('p', { id: 'land-warn', class: 'note' }, deckTotal > 40 ? t('Talia ma więcej niż 40 kart.') : ''),
    landStepper(),
    h('div', { class: 'panel' }, [
      h('h2', {}, t(`Talia główna (${selected.size})`)),
      curveBoard(main, (id) => ({ onclick: () => { selected.delete(id); render(); } })),
    ]),
    h('div', { class: 'panel' }, [
      h('h2', {}, t(`Sideboard (${side.length})`)),
      curveBoard(side, (id) => ({ onclick: () => { selected.add(id); render(); } })),
    ]),
  ]);
}

function renderGrid() {
  const lines = Object.fromEntries(gridLines(draft.grid).map((line) => [line.key, line]));
  const lineButton = (key, label) => {
    const count = lines[key]?.ids.length || 0;
    return h('button', { onclick: () => doGrid(key), disabled: count === 0 }, t(`${label} · ${count}`));
  };
  const cells = [h('span')];
  for (let col = 0; col < 3; col += 1) cells.push(lineButton(`c${col}`, `Weź kolumnę ${col + 1}`));
  for (let row = 0; row < 3; row += 1) {
    cells.push(lineButton(`r${row}`, `Weź rząd ${row + 1}`));
    for (let col = 0; col < 3; col += 1) {
      const id = draft.grid[row * 3 + col];
      cells.push(id ? cardNode(byId.get(id)) : h('div', { class: 'grid-hole' }));
    }
  }
  return h('section', { class: 'draft' }, [
    h('div', { class: 'top' }, [
      h('div', {}, [
        h('h1', {}, t(`Siatka ${draft.packIndex + 1} z ${draft.packCount}. ${seatLabel(draft.active)} wybiera rząd albo kolumnę.`)),
        h('p', { class: 'sub' }, t('Obie pule są jawne. Bierzesz cały rząd albo całą kolumnę. Druga osoba bierze rząd albo kolumnę z tego, co zostało. Reszta siatki odpada.')),
      ]),
      h('button', { class: 'ghost', onclick: newMatch }, t('Od nowa')),
    ]),
    status ? h('p', { class: 'note' }, t(status)) : null,
    h('div', { class: 'grid-board' }, cells),
    h('div', { class: 'panel' }, [
      h('h2', {}, t(`Pula gracza 1: ${draft.pools.p1.length}`)),
      curveBoard(draft.pools.p1),
    ]),
    h('div', { class: 'panel' }, [
      h('h2', {}, t(`Pula gracza 2: ${draft.pools.p2.length}`)),
      curveBoard(draft.pools.p2),
    ]),
    h('div', { class: 'panel log' }, draft.log.slice(-12).map((line) => h('div', {}, t(line)))),
  ]);
}

function renderHand() {
  const bag = hands[handSeat];
  const picking = bag.mode === 'bottom';
  return h('section', { class: 'draft' }, [
    h('div', { class: 'top' }, [
      h('div', {}, [
        h('h1', {}, t('Ręka startowa')),
        h('p', { class: 'sub' }, t('To nie jest partia. To tylko próbna ręka startowa.')),
        h('p', { class: 'sub' }, t('London: zostawiasz albo tasujesz, dobierasz siedem i odkładasz tyle kart, ile razy już mulliganowałeś. Nie ma darmowego pierwszego mulligana.')),
      ]),
      h('div', { class: 'row' }, [
        seatOrder.length > 1
          ? h('select', { onchange: (event) => { handSeat = event.target.value; status = ''; render(); } }, seatOrder.map((seat) => {
            const opt = h('option', { value: seat }, t(seatLabel(seat)));
            if (seat === handSeat) opt.selected = true;
            return opt;
          }))
          : null,
        h('button', { class: 'ghost', onclick: newMatch }, t('Od nowa')),
      ]),
    ]),
    h('h2', {}, t(`Ręka: ${seatLabel(handSeat)} · mulligany ${bag.mulligans}`)),
    status ? h('p', { class: 'note' }, t(status)) : null,
    picking ? h('p', {}, t(`Odkładasz ${bag.mulligans} kart na spód.`)) : null,
    picking ? h('p', {}, t(`Zaznaczono ${bag.bottom.size}.`)) : null,
    h('div', { class: 'cards' }, bag.hand.map((uid) => {
      const def = byId.get(bag.byUid.get(uid)?.defId);
      return cardNode(def, {
        on: bag.bottom.has(uid),
        onclick: picking ? () => {
          if (bag.bottom.has(uid)) bag.bottom.delete(uid);
          else bag.bottom.add(uid);
          render();
        } : null,
      });
    })),
    h('div', { class: 'row' }, picking
      ? [h('button', { onclick: confirmBottom }, t('Potwierdź spód'))]
      : [
        h('button', { onclick: () => { status = 'Zostawiasz tę rękę.'; render(); } }, t('Zostaw')),
        h('button', { class: 'ghost', onclick: mulliganHand, disabled: bag.mulligans >= 6 }, t('Mulligan')),
        h('button', { class: 'ghost', onclick: redrawHand }, t('Losuj od nowa')),
      ]),
    bag.plan?.deckSize ? h('p', { class: 'sub' }, t(choiceNote(bag.plan))) : null,
  ]);
}

function remember(key) {
  if (scratchKey !== key) {
    scratchKey = key;
    scratch = { attackers: new Set(), pairs: [], blocker: null, bottom: new Set(), scry: null, targets: [] };
  }
  return scratch;
}

function pendingPanel() {
  const p = game.pending;
  if (!p || p.player !== 'human') return null;
  if (p.kind === 'mulligan') {
    return h('div', { class: 'panel' }, [
      h('h2', {}, t('Ręka początkowa')),
      h('p', {}, t('London: zostawiasz albo tasujesz, dobierasz siedem i odkładasz tyle kart, ile razy już mulliganowałeś. W grze dwóch osób nie ma darmowego mulligana.')),
      h('div', { class: 'row' }, [
        h('button', { onclick: () => act({ type: 'answer', value: { keep: true } }) }, t('Zostaw')),
        h('button', { class: 'ghost', onclick: () => act({ type: 'answer', value: { keep: false } }), disabled: game.players.human.mulligans >= 6 }, t('Mulligan')),
      ]),
    ]);
  }
  if (p.kind === 'playDraw') {
    return h('div', { class: 'panel' }, [
      h('h2', {}, t('Kto zaczyna?')),
      h('p', {}, t('Draftowałeś jako drugi, więc wybierasz, kto ma pierwszą turę. Ten gracz nie dobiera w swoim pierwszym kroku dobierania.')),
      h('div', { class: 'row' }, [
        h('button', { onclick: () => act({ type: 'answer', value: { first: 'human' } }) }, t('Ja zaczynam')),
        h('button', { class: 'ghost', onclick: () => act({ type: 'answer', value: { first: 'ai' } }) }, t('Komputer zaczyna')),
      ]),
    ]);
  }
  if (p.kind === 'bottom' || p.kind === 'discard' || p.kind === 'discardHand' || p.kind === 'rummage') {
    const bag = remember(`hand-${p.kind}-${p.n}`);
    const box = h('div', { class: 'panel' }, [
      h('h2', {}, t(p.text)),
      h('p', {}, t('Kliknij karty, potem potwierdź.')),
    ]);
    const row = h('div', { class: 'cards' });
    for (const id of game.players.human.hand) {
      row.append(viewNode(cardView(game, id, 'human'), () => {
        if (bag.bottom.has(id)) bag.bottom.delete(id);
        else bag.bottom.add(id);
        render();
      }, { on: bag.bottom.has(id) }));
    }
    box.append(row, h('button', { onclick: () => act({ type: 'answer', value: { ids: [...bag.bottom] } }) }, t('Potwierdź')));
    return box;
  }
  if (p.kind === 'unparsed') {
    return h('div', { class: 'panel' }, [
      h('h2', {}, t('Ten fragment rozstrzygasz ręcznie')),
      h('p', {}, t(p.text)),
      h('div', { class: 'row' }, [
        h('button', { onclick: () => act({ type: 'answer', value: { manual: 'draw', n: 1 } }) }, t('Dobierz 1')),
        h('button', { onclick: () => act({ type: 'answer', value: { manual: 'life', n: 1 } }) }, t('Zyskaj 1 życie')),
        h('button', { onclick: () => act({ type: 'answer', value: { manual: 'token' } }) }, t('Żeton 1/1')),
        h('button', { class: 'ghost', onclick: () => act({ type: 'answer', value: {} }) }, t('Pomiń')),
      ]),
    ]);
  }
  if (p.kind === 'searchLand') {
    return h('div', { class: 'panel row' }, Object.entries(BASIC_NAME).map(([color]) => h('button', {
      onclick: () => act({ type: 'answer', value: { basic: color } }),
    }, basicLabel(color))));
  }
  if (p.kind === 'legend') {
    return h('div', { class: 'panel' }, [
      h('h2', {}, t(p.text)),
      h('div', { class: 'cards' }, p.ids.map((id) => viewNode(cardView(game, id, 'human'), () => act({ type: 'answer', value: { keep: id } })))),
    ]);
  }
  if (p.kind === 'stackTargets') {
    const specs = stackSpecs();
    const bag = stackBag();
    const spec = specs[bag.targets.length];
    const legal = spec ? legalTargets(game, spec, 'human') : [];
    const players = legal.filter((id) => String(id).startsWith('player:'));
    return h('div', { class: 'panel' }, [
      h('h2', {}, t('Wskaż cel zdolności')),
      h('p', {}, t(p.text || '')),
      h('p', {}, spec
        ? t(`Cel ${bag.targets.length + 1} z ${specs.length}. Podświetlone karty są legalne.`)
        : t('Wszystkie cele wskazane.')),
      players.length ? h('div', { class: 'row' }, players.map((id) => h('button', {
        onclick: () => pickStackTarget(id),
      }, id === 'player:human' ? t('Cel: ty') : t('Cel: komputer')))) : null,
      spec
        ? h('button', { class: 'ghost', onclick: () => pickStackTarget(null) }, t('Pomiń ten cel'))
        : h('button', { onclick: () => act({ type: 'answer', value: { targets: bag.targets.slice() } }) }, t('Kontynuuj')),
    ]);
  }
  if (p.kind === 'ward') {
    return h('div', { class: 'panel row' }, [
      h('p', {}, t(p.text)),
      h('button', { onclick: () => act({ type: 'answer', value: { pay: true } }) }, t('Zapłać')),
      h('button', { class: 'ghost', onclick: () => act({ type: 'answer', value: { pay: false } }) }, t('Nie płać')),
    ]);
  }
  if (p.kind === 'scry' || p.kind === 'surveil') {
    const top = game.players.human.library.slice(0, p.n);
    const bag = remember(`top-${p.kind}`);
    if (!bag.scry) bag.scry = new Set(top);
    return h('div', { class: 'panel' }, [
      h('h2', {}, t(p.text)),
      h('p', {}, p.kind === 'surveil' ? t('Odznaczone karty idą na cmentarz.') : t('Odznaczone karty idą na spód.')),
      h('div', { class: 'cards' }, top.map((id) => viewNode(cardView(game, id, 'human'), () => {
        if (bag.scry.has(id)) bag.scry.delete(id);
        else bag.scry.add(id);
        render();
      }, { on: bag.scry.has(id) }))),
      h('button', { onclick: () => act({ type: 'answer', value: { top: [...bag.scry] } }) }, t('Potwierdź')),
    ]);
  }
  if (p.kind === 'manifest') {
    return h('div', { class: 'panel' }, [
      h('h2', {}, t('Manifest dread: wybierz kartę, która staje się 2/2')),
      h('div', { class: 'cards' }, (p.ids || []).map((id) => viewNode(cardView(game, id, 'human'), () => act({ type: 'answer', value: { manifest: id } })))),
    ]);
  }
  if (p.kind === 'dungeon' || p.kind === 'dungeonRoom') {
    const names = p.dungeons || p.rooms || [];
    return h('div', { class: 'panel row' }, names.map((name) => h('button', {
      onclick: () => act({ type: 'answer', value: { name } }),
    }, name)));
  }
  if (p.kind === 'learn') {
    return h('div', { class: 'panel' }, [
      h('h2', {}, t('Learn')),
      h('p', {}, t('Odrzuć kartę z ręki, żeby dobrać, albo kliknij Lesson z boku.')),
      h('div', { class: 'cards' }, game.players.human.hand.map((id) => viewNode(cardView(game, id, 'human'), () => act({ type: 'answer', value: { discard: id } })))),
      h('div', { class: 'cards' }, game.players.human.sideboard.map((id) => viewNode(cardView(game, id, 'human'), () => act({ type: 'answer', value: { lesson: id } })))),
      h('button', { class: 'ghost', onclick: () => act({ type: 'answer', value: {} }) }, t('Nic nie rób')),
    ]);
  }
  return h('div', { class: 'panel' }, t(p.text || p.kind));
}

function combatButtons() {
  if (game.awaiting === 'attackers' && game.active === 'human') {
    const ids = game.players.human.battlefield.filter((id) => {
      const obj = game.objects[id];
      const view = cardView(game, id, 'human');
      return view.power != null && !obj.tapped && !(obj.sick && !(view.keywords || []).includes('Haste'));
    });
    const bag = remember(`atk-${game.turn}`);
    const box = h('div', { class: 'panel' }, [h('h2', {}, t('Wybierz atakujących i potwierdź. Puste potwierdzenie to brak ataku.'))]);
    const row = h('div', { class: 'cards' });
    for (const id of ids) {
      row.append(viewNode(cardView(game, id, 'human'), () => {
        if (bag.attackers.has(id)) bag.attackers.delete(id);
        else bag.attackers.add(id);
        render();
      }, { on: bag.attackers.has(id) }));
    }
    box.append(row, h('button', { onclick: () => act({ type: 'attackers', ids: [...bag.attackers], targets: {} }) }, t('Potwierdź atak')));
    return box;
  }
  if (game.awaiting === 'blockers') {
    const bag = remember(`blk-${game.turn}`);
    const box = h('div', { class: 'panel' }, [
      h('h2', {}, t(`Najpierw kliknij swojego blokującego, potem atakującego. Bloków: ${bag.pairs.length}.`)),
    ]);
    const mine = h('div', { class: 'cards' });
    for (const id of game.players.human.battlefield) {
      mine.append(viewNode(cardView(game, id, 'human'), () => {
        bag.blocker = id;
        status = 'Teraz wskaż atakującego.';
        render();
      }, { on: bag.blocker === id }));
    }
    const theirs = h('div', { class: 'cards' });
    for (const id of game.attackers || []) {
      theirs.append(viewNode(cardView(game, id, 'human'), () => {
        if (!bag.blocker) { status = 'Najpierw wybierz blokującego.'; render(); return; }
        bag.pairs.push({ blocker: bag.blocker, attacker: id });
        bag.blocker = null;
        status = `Bloków: ${bag.pairs.length}`;
        render();
      }));
    }
    box.append(mine, theirs, h('button', { onclick: () => act({ type: 'blockers', pairs: bag.pairs }) }, t('Potwierdź bloki')));
    return box;
  }
  return null;
}

function aimPanel() {
  if (!aim || aim.kind === 'permanent') return null;
  if (aim.choose && aim.modes == null) {
    return h('div', { class: 'panel' }, [
      h('h2', {}, t('Wybierz tryb')),
      h('div', { class: 'row' }, aim.choose.options.map((opt, index) => h('button', {
        onclick: () => openAim({ kind: 'cast', id: aim.id, modes: [index], effects: opt.effects, x: aim.x, kicker: aim.kicker, impending: aim.impending }),
      }, opt.text || t(`Tryb ${index + 1}`)))),
    ]);
  }
  const face = faceOf(aim.id);
  return h('div', { class: 'panel' }, [
    h('h2', {}, aim.kind === 'cast' ? t('Rzucanie') : t('Zdolność')),
    h('p', {}, aim.specs.length ? t(`Wskaż cel ${aim.targets.length + 1} z ${aim.specs.length}.`) : ''),
    h('div', { class: 'row' }, [
      face?.impending ? h('button', { onclick: () => { aim.impending = !aim.impending; render(); } }, t(aim.impending ? 'Impending: tak' : 'Impending: nie')) : null,
      face?.kicker ? h('button', { onclick: () => { aim.kicker = !aim.kicker; render(); } }, t(aim.kicker ? 'Kicker: tak' : 'Kicker: nie')) : null,
      (face?.manaCost || '').includes('{X}') ? h('span', { class: 'row' }, [
        'X',
        h('button', { onclick: () => { aim.x = Math.max(0, (aim.x || 0) - 1); render(); } }, '−'),
        String(aim.x || 0),
        h('button', { onclick: () => { aim.x = (aim.x || 0) + 1; render(); } }, '+'),
      ]) : null,
      h('button', { class: 'ghost', onclick: () => { aim = null; render(); } }, t('Anuluj')),
      aim.specs.length === 0 ? h('button', { onclick: finishAim }, t('Rzuć')) : null,
    ]),
  ]);
}

function permanentPanel() {
  if (!aim || aim.kind !== 'permanent') return null;
  const id = aim.id;
  const obj = game.objects[id];
  const def = byId.get(obj.defId);
  const buttons = [];
  if (obj.room) {
    obj.room.forEach((open, index) => {
      if (!open) buttons.push(h('button', { onclick: () => act({ type: 'unlock', id, face: index }) }, t(`Otwórz: ${faceLabel(def, index)}`)));
    });
  }
  const faces = obj.room ? def.faces.filter((_, i) => obj.room[i]) : [def.faces[obj.face || 0]];
  faces.forEach((face) => {
    (face?.abilities || []).forEach((ab, index) => {
      if (ab.kind !== 'activated' && ab.kind !== 'loyalty') return;
      buttons.push(h('button', { onclick: () => openAim({ kind: 'activate', id, index, effects: ab.effects || [] }) }, ab.text || t('Aktywuj')));
    });
    if (face?.crew) buttons.push(h('button', { onclick: () => crew(id, face.crew) }, t(`Załoga ${face.crew}`)));
  });
  if (obj.faceDown) buttons.push(h('button', { onclick: () => act({ type: 'turnUp', id }) }, t('Odkryj')));
  const handCard = game.players.human.hand.includes(id);
  if (handCard) {
    const face = def.faces[0];
    if (face?.cycling) buttons.push(h('button', { onclick: () => act({ type: 'cycle', id }) }, t('Cycling')));
  }
  return h('div', { class: 'panel' }, [
    h('h2', {}, shown(def).name),
    h('div', { class: 'row' }, buttons.length ? buttons : [h('span', {}, t('Brak zdolności, którą silnik umie włączyć.'))]),
    h('button', { class: 'ghost', onclick: () => { aim = null; render(); } }, t('Zamknij')),
  ]);
}

function crew(id, need) {
  const tappers = [];
  let power = 0;
  const options = game.players.human.battlefield
    .map((tid) => game.objects[tid])
    .filter((obj) => obj.id !== id && cardView(game, obj.id, 'human').power && !obj.tapped)
    .sort((a, b) => cardView(game, a.id, 'human').power - cardView(game, b.id, 'human').power);
  for (const obj of options) {
    tappers.push(obj.id);
    power += cardView(game, obj.id, 'human').power;
    if (power >= need) break;
  }
  act({ type: 'crew', id, tappers });
}

function renderGame() {
  const you = game.players.human;
  const foe = game.players.ai;
  const over = game.gameOver;
  const title = over
    ? (over.draw ? t('Remis') : over.winner === 'human' ? t('Wygrywasz') : t('Komputer wygrywa'))
    : t(`Tura ${game.turn}`);
  const stepLine = over
    ? t(over.reason || '')
    : `${t('Krok')}: ${t(STEP_LABEL[game.step] || game.step)}. ${actor(game) === 'human' ? t('Masz priorytet.') : t('Czeka komputer.')} ${t('Spacja oddaje priorytet.')}`;
  const stackKids = game.stack.length
    ? [...game.stack].reverse().map((s) => {
      const who = s.controller === 'human' ? 'Ty' : 'Komputer';
      const label = `${t(who)}: ${t(s.description)}`;
      return isNextTarget(s.id)
        ? h('button', { onclick: () => pickStackTarget(s.id) }, label)
        : h('div', {}, label);
    })
    : [h('p', {}, t('Pusty.'))];
  return h('section', { class: 'client' }, [
    h('div', { class: 'playmat' }, [
      h('div', { class: 'top' }, [
        h('div', {}, [
          h('h1', {}, title),
          h('p', { class: 'sub' }, stepLine),
        ]),
        h('div', { class: 'row' }, [
          h('button', { onclick: () => act({ type: 'pass' }), disabled: actor(game) !== 'human' || !!game.pending || !!game.awaiting }, t('Pas')),
          h('button', { class: 'ghost', onclick: () => { fast = true; pump(); } }, t('Do mojej decyzji')),
          h('button', { class: 'ghost', onclick: newMatch }, t('Od nowa')),
        ]),
      ]),
      h('div', { class: 'phases' }, STEPS.map((step) => h('span', { class: step === game.step ? 'now' : '' }, t(STEP_LABEL[step])))),
      status ? h('p', { class: 'note' }, t(status)) : null,
      pendingPanel(),
      aimPanel(),
      permanentPanel(),
      combatButtons(),
      h('div', { class: 'seat' }, [
        h('div', { class: 'seat-head' }, [
          h('h2', {}, t(`Komputer · ${foe.life} życia · ręka ${foe.hand.length} · talia ${foe.library.length}`)),
          h('div', { class: 'life' }, String(foe.life)),
        ]),
        h('div', { class: 'cards' }, foe.battlefield.map((id) => viewNode(cardView(game, id, 'human'), () => clickPermanent(id, 'ai')))),
      ]),
      h('div', { class: 'seat' }, [
        h('div', { class: 'seat-head' }, [
          h('h2', {}, t(`Ty · ${you.life} życia · talia ${you.library.length} · mana ${you.mana.length}`)),
          h('div', { class: 'life' }, String(you.life)),
        ]),
        h('div', { class: 'cards' }, you.battlefield.map((id) => viewNode(cardView(game, id, 'human'), () => clickPermanent(id, 'human')))),
      ]),
      h('div', { class: 'hand' }, [
        h('h2', {}, t('Twoja ręka')),
        h('div', { class: 'cards' }, you.hand.map((id) => viewNode(cardView(game, id, 'human'), () => playFromHand(id)))),
        you.exile.some((id) => game.objects[id].impulse) ? h('h2', {}, t('Z wygnania, do końca tury')) : null,
        h('div', { class: 'cards' }, you.exile.filter((id) => game.objects[id].impulse).map((id) => viewNode(cardView(game, id, 'human'), () => playFromHand(id)))),
      ]),
    ]),
    h('aside', { class: 'dock' }, [
      h('div', { class: 'panel' }, [h('h2', {}, t('Stos')), ...stackKids]),
      h('div', { class: 'log' }, game.log.slice(-30).map((line) => h('div', {}, t(line)))),
      h('div', { class: 'panel' }, [
        h('h2', {}, t('Cmentarz')),
        h('p', {}, t(`Ty: ${you.graveyard.length}. Komputer: ${foe.graveyard.length}.`)),
        h('div', { class: 'cards' }, you.graveyard.slice(-6).concat(foe.graveyard.slice(-4)).map((id) => viewNode(
          cardView(game, id, 'human'),
          () => { if (isNextTarget(id)) pickStackTarget(id); },
        ))),
      ]),
      h('p', { class: 'note' }, t('Silnik gra turę, stos, manę i walkę oraz typowe zdania z kart. Nietypowy tekst bywa niepełny. U Ciebie widać wtedy menu ręczne. Komputer go nie używa.')),
    ]),
  ]);
}

function zoomLayer() {
  if (!zoom) return null;
  const def = zoom.defId ? byId.get(zoom.defId) : null;
  const text = def ? shown(def) : {
    name: t(zoom.name || 'Zakryta karta'),
    typeLine: t(zoom.typeLine || ''),
    oracle: t(zoom.oracle || ''),
  };
  const oracle = zoom.hidden ? t(zoom.oracle || '') : (text.oracle || t(zoom.oracle || ''));
  const pt = zoom.pt || (def?.power != null ? `${def.power}/${def.toughness}` : (def?.loyalty || ''));
  const faceIndex = zoom.faceIndex || 0;
  const frontArt = def?.imageLarge || def?.image;
  const backArt = def?.imageBackLarge || def?.imageBack;
  const image = zoom.hidden ? null : (faceIndex === 1 && backArt ? backArt : frontArt);
  const imageBack = zoom.hidden ? null : (faceIndex === 1 ? frontArt : backArt);
  const close = () => { zoom = null; render(); };
  return h('div', { class: 'zoom', onclick: close, oncontextmenu: (event) => { event.preventDefault(); close(); } }, [
    image ? h('div', { class: 'zoom-art' }, [
      h('img', { src: appUrl(image), alt: text.name || 'karta' }),
      imageBack ? h('img', { class: 'second', src: appUrl(imageBack), alt: '' }) : null,
    ]) : h('div', { class: 'zoom-art back' }, text.name),
    h('div', { class: 'zoom-sheet' }, [
      h('h2', {}, text.name),
      text.typeLine ? h('p', { class: 'zoom-type' }, text.typeLine) : null,
      oracle ? h('p', { class: 'zoom-oracle' }, oracle) : null,
      pt ? h('p', { class: 'zoom-pt' }, pt) : null,
      def ? h('p', { class: 'sub' }, t(engineMark(def))) : null,
      h('p', { class: 'sub' }, t('Kliknięcie, prawy przycisk albo Esc zamyka podgląd.')),
    ]),
  ]);
}

function render() {
  if (cube) ensureDraftId();
  document.documentElement.lang = getLang();
  const root = h('div', { class: 'shell' });
  root.append(langBar());
  root.append(h('p', { class: 'fan-note' }, [
    t('Narzędzie fanowskie. Tekst i grafiki kart © Wizards of the Coast. Zapis draftu to lista kart pod losowym linkiem, bez konta.'),
    ' ',
    h('a', { href: 'https://lubisoftware.com/polityka-prywatnosci.html' }, t('Polityka prywatności')),
    ' · ',
    h('a', { href: 'https://lubisoftware.com/blog/narzedzie-dla-hobby-kiedys-i-dzis.html' }, t('Skąd to się wzięło')),
  ]));
  if (draftId && cube) root.append(linkBox());
  if (!cat) {
    root.append(h('p', {}, t('Wczytuję karty…')));
  } else if (screen === 'menu') root.append(renderMenu());
  else if (screen === 'cube') root.append(renderCube());
  else if (screen === 'draft') root.append(format === 'grid' ? renderGrid() : renderDraft());
  else if (screen === 'deck') root.append(renderDeck());
  else if (screen === 'hand') root.append(renderHand());
  const preview = zoomLayer();
  if (preview) root.append(preview);
  app.replaceChildren(root);
  stackCurve();
  if (cube) scheduleSave();
}

document.addEventListener('keydown', (event) => {
  if (zoom && (event.key === 'Escape' || event.code === 'Space')) {
    event.preventDefault();
    zoom = null;
    render();
    return;
  }
  if (event.code !== 'Space') return;
  if (event.target.closest('input, textarea, select')) return;
  event.preventDefault();
  if (screen === 'draft' && format === 'winston' && draft?.active === 'human' && !draft.done && !pumping) doDraft('pass');
});

const response = await fetch(appUrl('data/cards.json'));
const data = await response.json();
cat = catalogFromData(data);
byId = cat.byId;
for (const basic of cat.basics) byId.set(basic.id, basic);
catalogIds = new Set(byId.keys());
try {
  const pl = await fetch(appUrl('data/pl.json'));
  if (pl.ok) {
    const json = await pl.json();
    plCards = json.cards || {};
  }
} catch {
  plCards = {};
}
const requestedDraft = new URLSearchParams(location.search).get('d');
if (requestedDraft && isDraftId(requestedDraft)) {
  try {
    const saved = await fetch(appUrl(`api/draft/${requestedDraft}`));
    const json = await saved.json().catch(() => ({}));
    if (!saved.ok) throw new Error(json.error || 'Nie ma zapisu pod tym linkiem.');
    applySnapshot(unpackSession(json, byId));
    draftId = requestedDraft;
  } catch (err) {
    status = err.message || 'Nie ma zapisu pod tym linkiem.';
    draftId = null;
    rememberLink();
  }
}
render();
window.addEventListener('pagehide', () => saveNow());
if (screen === 'draft' && format === 'winston' && draft?.active === 'ai' && !draft.done) pump();
