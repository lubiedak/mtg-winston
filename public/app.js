import { catalogFromData } from '/src/catalog.js';
import { buildCube, CUBE_SETS } from '/src/cube.js';
import { createDraft, applyDraft, pileKnown, knownInPool } from '/src/winston.js';
import { actor, apply, cardView, createGame, legalTargets, registerCatalog, STEP_LABEL, STEPS } from '/src/engine.js';
import { buildDeck, chooseAction, chooseDraft, engineMark, fallback } from '/src/ai.js';
import { COLOR_NAME, mulberry32, RARITY_NAME } from '/src/util.js';
import { getLang, setLang, t } from '/src/i18n.js';
import { polishCard } from '/src/pltext.js';

const app = document.querySelector('#app');
const DIFFS = [
  ['easy', 'Łatwy'],
  ['medium', 'Średni'],
  ['hard', 'Trudny'],
];
const BASIC_NAME = { W: 'Równina', U: 'Wyspa', B: 'Bagno', R: 'Góra', G: 'Las' };

let cat;
let byId;
let catalogKey;
let diff = 'medium';
let first = 'human';
let setCode = 'afr';
let cube;
let draft;
let game;
let screen = 'menu';
let status = '';
let selected = new Set();
let basics = { W: 3, U: 3, B: 3, R: 3, G: 3 };
let aim = null;
let fast = false;
let scratchKey = '';
let scratch = { attackers: new Set(), pairs: [], blocker: null, bottom: new Set(), scry: null };
let pumping = false;
let rngSeed = 1;
let plCards = {};

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
    src: url,
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

function cardNode(def, extra = {}) {
  if (!def || extra.hidden) {
    return h('article', { class: 'card back' }, [
      h('header', {}, t('Zakryta karta')),
      h('p', { class: 'oracle' }, t('Tej karty jeszcze nie widziałeś.')),
    ]);
  }
  const text = shown(def);
  const art = artNodes(def);
  const node = h('article', {
    class: `card ${colorOf(def)}${art.length ? ' has-art' : ''}${extra.on ? ' on' : ''}${extra.tapped ? ' tapped' : ''}`,
    onclick: extra.onclick,
  }, [
    ...art,
    h('header', {}, [h('span', {}, text.name), pipNodes(def.manaCost)]),
    h('div', { class: 'type' }, text.typeLine),
    h('p', { class: 'oracle' }, text.oracle.slice(0, 420)),
    h('footer', {}, [
      h('span', {}, t(engineMark(def))),
      h('span', { class: 'pt' }, def.power != null ? `${def.power}/${def.toughness}` : (def.loyalty || '')),
    ]),
  ]);
  if (extra.tapped) node.append(h('b', { class: 'stamp' }, 'TAP'));
  return node;
}

function viewNode(view, onclick, extra = {}) {
  if (!view) return h('article', { class: 'card back' }, '—');
  const def = byId.get(view.defId);
  const marked = extra.on || (aim && legalAim(view.id)) || isNextTarget(view.id);
  if (view.faceDown && view.name.startsWith('Zakryte')) {
    return h('article', { class: `card back${marked ? ' on' : ''}`, onclick }, [
      h('header', {}, t(view.name)),
      h('p', { class: 'oracle' }, t(view.text || '')),
    ]);
  }
  const text = shown(def);
  const faceIndex = game?.objects?.[view.id]?.face || 0;
  const art = artNodes(def, faceIndex);
  const node = h('article', {
    class: `card ${colorOf(def)} ${view.tapped ? 'tapped' : ''} ${marked ? 'on' : ''} ${art.length ? 'has-art' : ''}`,
    onclick,
  }, [
    ...art,
    h('header', {}, [h('span', {}, text.name || view.name), pipNodes(view.manaCost)]),
    h('div', { class: 'type' }, text.typeLine || view.typeLine || ''),
    h('p', { class: 'oracle' }, (text.oracle || view.text || '').slice(0, 420)),
    h('footer', {}, [
      h('span', {}, t(engineMark(def))),
      h('span', { class: 'pt' }, view.power != null ? `${view.power}/${view.toughness}` : (view.loyalty ?? '')),
    ]),
  ]);
  if (view.tapped) node.append(h('b', { class: 'stamp' }, 'TAP'));
  if (view.attacking) node.append(h('div', { class: 'type' }, t('atakuje')));
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
  game = null;
  draft = null;
  cube = null;
  screen = 'menu';
  aim = null;
  fast = false;
  status = '';
  selected = new Set();
  basics = { W: 3, U: 3, B: 3, R: 3, G: 3 };
  render();
}

function bootCube() {
  rngSeed = (rngSeed + 1) % 100000;
  cube = buildCube(cat.cards, mulberry32(rngSeed + 17), setCode);
  screen = 'cube';
  status = '';
  render();
}

function startDraft() {
  const starter = first === 'random' ? (Math.random() < 0.5 ? 'human' : 'ai') : first;
  first = starter;
  draft = createDraft(cube.cards.map((c) => c.id), starter, mulberry32(rngSeed + 99));
  screen = 'draft';
  pump();
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

function openDeck() {
  selected = new Set();
  basics = { W: 3, U: 3, B: 3, R: 3, G: 3 };
  screen = 'deck';
  render();
}

function deckCount() {
  return selected.size + Object.values(basics).reduce((s, n) => s + n, 0);
}

function startGame() {
  if (deckCount() < 40) {
    status = 'Talia musi mieć co najmniej 40 kart.';
    render();
    return;
  }
  const humanDeck = [...selected];
  for (const [color, n] of Object.entries(basics)) {
    for (let i = 0; i < n; i++) humanDeck.push(`basic-${color}`);
  }
  const side = draft.pools.human.filter((id) => !selected.has(id));
  const ai = buildDeck(draft.pools.ai, byId, diff);
  if (!catalogKey) catalogKey = registerCatalog(byId, cat.dungeons);
  const chooser = other(first);
  game = createGame({
    catalogKey,
    humanDeck,
    aiDeck: ai.deck,
    humanSide: side,
    aiSide: ai.side,
    starting: first,
    chooseStart: true,
    chooser,
    seed: (rngSeed + 5) >>> 0,
  });
  aim = null;
  fast = false;
  screen = 'game';
  status = '';
  pump();
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
    while (n++ < 80) {
      render();
      if (screen === 'draft') {
        if (!draft || draft.done || draft.active !== 'ai') break;
        const res = applyDraft(draft, chooseDraft(draft, byId, diff));
        if (!res.ok) { status = res.error; break; }
        if (draft.done) {
          openDeck();
          break;
        }
        await sleep(40);
        continue;
      }
      if (screen !== 'game' || !game || game.gameOver) break;
      const who = actor(game);
      if (who === 'ai') {
        let res = apply(game, 'ai', chooseAction(game, 'ai', diff));
        if (!res.ok) res = apply(game, 'ai', fallback(game, 'ai'));
        if (!res.ok) { status = res.error || 'Komputer nie ma ruchu.'; break; }
        await sleep(30);
        continue;
      }
      if (who === 'human' && fast && !stopForHuman()) {
        const action = game.awaiting === 'attackers'
          ? { type: 'attackers', ids: [] }
          : game.awaiting === 'blockers'
            ? { type: 'blockers', pairs: [] }
            : { type: 'pass' };
        const res = apply(game, 'human', action);
        if (!res.ok) { fast = false; status = res.error; break; }
        continue;
      }
      break;
    }
  } finally {
    pumping = false;
    render();
  }
}

function renderMenu() {
  return h('section', { class: 'panel' }, [
    h('h1', {}, 'Winston Cube'),
    h('p', { class: 'sub' }, t('Dwie osoby, 90 kart z jednego dodatku, trzy kupki. Ty przeciwko komputerowi. Dodatki nigdy się nie mieszają.')),
    h('div', { class: 'row' }, [
      h('label', {}, t('Dodatek')),
      h('select', { onchange: (e) => { setCode = e.target.value; } }, Object.entries(CUBE_SETS).map(([id, name]) => {
        const opt = h('option', { value: id }, name);
        if (id === setCode) opt.selected = true;
        return opt;
      })),
      h('label', {}, t('Trudność')),
      h('select', { onchange: (e) => { diff = e.target.value; } }, DIFFS.map(([id, name]) => {
        const opt = h('option', { value: id }, t(name));
        if (id === diff) opt.selected = true;
        return opt;
      })),
      h('label', {}, t('Kto draftuje pierwszy')),
      h('select', { onchange: (e) => { first = e.target.value; } }, [
        ['human', 'Ja'],
        ['ai', 'Komputer'],
        ['random', 'Losowo'],
      ].map(([id, name]) => {
        const opt = h('option', { value: id }, t(name));
        if (id === first) opt.selected = true;
        return opt;
      })),
      h('button', { onclick: bootCube }, t('Ułóż kostkę')),
    ]),
    h('p', { class: 'note' }, t('Miniatury kart pochodzą ze Scryfalla. Tekst zasad zostaje na karcie, gdy obrazek się nie wczyta. Te dodatki nie mają polskiego druku, więc nazwa zostaje angielska, a typ i tekst są przekładem do czytania. Silnik czyta angielski tekst. Tekst kart © Wizards of the Coast.')),
  ]);
}

function renderCube() {
  const s = cube.summary;
  return h('section', {}, [
    h('div', { class: 'top' }, [
      h('div', {}, [
        h('h1', {}, t(`Kostka, 90 kart · ${CUBE_SETS[cube.set] || cube.set}`)),
        h('p', { class: 'sub' }, t('Tylko ten dodatek. Kwoty: 14 na każdy kolor, 10 wielokolorowych, 6 bezbarwnych, 4 lądy inne niż podstawowe. Lądy podstawowe dochodzą dopiero przy składaniu talii.')),
      ]),
      h('div', { class: 'row' }, [
        h('button', { class: 'ghost', onclick: () => { screen = 'menu'; render(); } }, t('Inny dodatek')),
        h('button', { class: 'ghost', onclick: bootCube }, t('Potasuj jeszcze raz')),
        h('button', { onclick: startDraft }, t('Zacznij draft')),
      ]),
    ]),
    h('div', { class: 'panel counts' }, [
      ...['W', 'U', 'B', 'R', 'G'].map((c) => h('span', {}, `${t(COLOR_NAME[c])}: ${s.color[c]}`)),
      h('span', {}, `${t('wielokolor')}: ${s.color.gold}`),
      h('span', {}, `${t('bezbarwne')}: ${s.color.colorless}`),
      h('span', {}, `${t('lądy')}: ${s.color.land}`),
      ...Object.entries(s.rarity).map(([k, n]) => h('span', {}, `${t(RARITY_NAME[k])}: ${n}`)),
    ]),
    cube.notes.length ? h('div', { class: 'panel note' }, cube.notes.slice(0, 8).map((line) => t(line)).join(' ')) : null,
    h('div', { class: 'panel cards' }, cube.cards.map((c) => cardNode(c))),
  ]);
}

function renderDraft() {
  const you = draft.active === 'human';
  return h('section', {}, [
    h('div', { class: 'top' }, [
      h('div', {}, [
        h('h1', {}, you ? t('Twoja kolej przy kupkach') : t('Komputer ogląda kupki')),
        h('p', { class: 'sub' }, t('Oglądasz kupki od pierwszej. Bierzesz całą albo dokładasz zakrytą kartę i idziesz dalej. Po odrzuceniu trzeciej dokładasz do niej kartę i bierzesz wierzch talii w ciemno. Przeciwnik nie widzi tego, co właśnie obejrzałeś. Spacja pasuje.')),
      ]),
      h('div', {}, t(`Talia główna: ${draft.main.length}`)),
    ]),
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
      h('div', { class: 'cards' }, draft.pools.human.map((id) => cardNode(byId.get(id)))),
    ]),
    h('div', { class: 'panel' }, [
      h('h2', {}, t(`Pula komputera: ${draft.pools.ai.length}`)),
      h('div', { class: 'cards' }, knownInPool(draft, 'ai', 'human').map((id) => cardNode(byId.get(id)))),
    ]),
    h('div', { class: 'panel log' }, draft.log.slice(-12).map((line) => h('div', {}, t(line)))),
  ]);
}

function renderDeck() {
  const total = deckCount();
  const lands = Object.values(basics).reduce((s, n) => s + n, 0);
  return h('section', {}, [
    h('div', { class: 'top' }, [
      h('div', {}, [
        h('h1', {}, t('Ułóż talię')),
        h('p', { class: 'sub' }, t(`Minimum 40 kart. Teraz ${total}. Lądy podstawowe są bez limitu i nie wchodziły do kostki. Kliknij kartę, żeby dodać ją do talii albo z niej zdjąć.`)),
      ]),
      h('div', { class: 'row' }, [
        h('button', { class: 'ghost', onclick: newMatch }, t('Od nowa')),
        h('button', { onclick: startGame, disabled: total < 40 }, t('Graj')),
      ]),
    ]),
    h('div', { class: 'panel row' }, Object.entries(BASIC_NAME).map(([color]) => h('span', { class: 'row' }, [
      basicLabel(color),
      h('button', { onclick: () => { basics[color] = Math.max(0, basics[color] - 1); render(); } }, '−'),
      String(basics[color]),
      h('button', { onclick: () => { basics[color] += 1; render(); } }, '+'),
    ]))),
    lands === 0 ? h('p', { class: 'note' }, t('W talii nie ma lądów. Da się tak zagrać, ale mana się nie pojawi.')) : null,
    h('div', { class: 'panel' }, [
      h('h2', {}, t(`Talia bez lądów podstawowych (${selected.size})`)),
      h('div', { class: 'cards' }, [...selected].map((id) => cardNode(byId.get(id), { on: true, onclick: () => { selected.delete(id); render(); } }))),
    ]),
    h('div', { class: 'panel' }, [
      h('h2', {}, t('Pula')),
      h('div', { class: 'cards' }, draft.pools.human.map((id) => cardNode(byId.get(id), {
        on: selected.has(id),
        onclick: () => {
          if (selected.has(id)) selected.delete(id);
          else selected.add(id);
          render();
        },
      }))),
    ]),
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
        h('div', { class: 'cards' }, you.hand.map((id) => viewNode(cardView(game, id, 'human'), () => {
          if (game.pending || actor(game) !== 'human') return;
          const face = faceOf(id);
          if (face?.cycling && !face.spellEffects?.length && !face.isLand) {
            aim = { kind: 'permanent', id };
            render();
            return;
          }
          beginCast(id);
        }))),
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

function render() {
  document.documentElement.lang = getLang();
  const root = h('div', { class: 'shell' });
  root.append(langBar());
  if (!cat) {
    root.append(h('p', {}, t('Wczytuję karty…')));
  } else if (screen === 'menu') root.append(renderMenu());
  else if (screen === 'cube') root.append(renderCube());
  else if (screen === 'draft') root.append(renderDraft());
  else if (screen === 'deck') root.append(renderDeck());
  else if (screen === 'game') root.append(renderGame());
  app.replaceChildren(root);
}

document.addEventListener('keydown', (event) => {
  if (event.code !== 'Space') return;
  if (event.target.closest('input, textarea, select')) return;
  event.preventDefault();
  if (screen === 'draft' && draft?.active === 'human' && !draft.done) doDraft('pass');
  if (screen === 'game' && game && actor(game) === 'human' && !game.pending && !game.awaiting) act({ type: 'pass' });
});

const response = await fetch('/data/cards.json');
const data = await response.json();
cat = catalogFromData(data);
byId = cat.byId;
for (const basic of cat.basics) byId.set(basic.id, basic);
try {
  const pl = await fetch('/data/pl.json');
  if (pl.ok) {
    const json = await pl.json();
    plCards = json.cards || {};
  }
} catch {
  plCards = {};
}
render();
