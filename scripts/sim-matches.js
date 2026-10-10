/**
 * 20 meczy komputer–komputer na każdy dodatek (STX, AFR, DSK).
 * Zawieszenie nie liczy się do dwudziestki: ten sam mecz startuje z nowego ziarna.
 * Wynik: results/matches.json i results/card-strength.md
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalogFromData } from '../src/catalog.js';
import { buildCube, CUBE_SETS } from '../src/cube.js';
import { createDraft, applyDraft } from '../src/winston.js';
import { actor, apply, createGame, registerCatalog } from '../src/engine.js';
import { buildDeck, chooseAction, chooseDraft, fallback } from '../src/ai.js';
import { mulberry32 } from '../src/util.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const probe = process.argv.includes('--probe');
const SETS = probe ? ['stx'] : ['stx', 'afr', 'dsk'];
const PER_SET = probe ? 1 : 20;
const MAX_TRIES = 9;
const TURN_CAP = 80;
const ACTION_CAP = 6000;
const TIME_CAP_MS = 20000;
const STALL_CAP = 30;

const data = JSON.parse(readFileSync(path.join(root, 'data', 'cards.json'), 'utf8'));
const cat = catalogFromData(data);
const byId = cat.byId;
const catalogKey = registerCatalog(byId, cat.dungeons);
let plCards = {};
try {
  plCards = JSON.parse(readFileSync(path.join(root, 'data', 'pl.json'), 'utf8')).cards || {};
} catch {
  plCards = {};
}

const BASIC_PL = { W: 'Równina', U: 'Wyspa', B: 'Bagno', R: 'Góra', G: 'Las' };

class Hang extends Error {}

function fingerprint(state) {
  const h = state.players.human;
  const a = state.players.ai;
  return [
    state.turn, state.step, state.phase, state.pending?.kind || '', state.awaiting || '',
    state.priority, state.active, state.stack.length,
    h.life, a.life, h.hand.length, a.hand.length, h.library.length, a.library.length,
    h.battlefield.length, a.battlefield.length, h.graveyard.length, a.graveyard.length,
  ].join('|');
}

function noteLife(state, life) {
  const row = { turn: state.turn, p1: state.players.human.life, p2: state.players.ai.life };
  const last = life[life.length - 1];
  if (!last || last.turn !== row.turn || last.p1 !== row.p1 || last.p2 !== row.p2) life.push(row);
}

function deckRecord(ids) {
  const counts = new Map();
  const basics = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const id of ids) {
    if (String(id).startsWith('basic-')) {
      const color = String(id).slice(6);
      basics[color] = (basics[color] || 0) + 1;
      continue;
    }
    const name = byId.get(id)?.name || String(id);
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  const cards = [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, n]) => ({ name, n }));
  return { cards, basics };
}

const byName = new Map(cat.cards.map((card) => [card.name, card]));

function printedName(name) {
  const def = byName.get(name);
  if (!def) return name;
  return plCards[def.oracleId]?.name || def.name;
}

function deckLine(side) {
  const parts = side.cards.map((card) => (card.n > 1 ? `${printedName(card.name)} ×${card.n}` : printedName(card.name)));
  for (const [color, n] of Object.entries(side.basics)) {
    if (!n) continue;
    const name = BASIC_PL[color] || color;
    parts.push(n > 1 ? `${name} ×${n}` : name);
  }
  return parts.sort((a, b) => a.localeCompare(b, 'pl')).join(', ');
}

function draftBoth(cubeCards, rng) {
  const draftedFirst = rng() < 0.5 ? 'human' : 'ai';
  const draft = createDraft(cubeCards.map((card) => card.id), draftedFirst, rng);
  let guard = 0;
  while (!draft.done) {
    if (++guard > 500) throw new Hang('draft przekroczył 500 decyzji');
    const choice = chooseDraft(draft, byId, 'hard');
    let res = applyDraft(draft, choice);
    if (!res.ok) res = applyDraft(draft, choice === 'take' ? 'pass' : 'take');
    if (!res.ok) throw new Hang(res.error || 'draft stanął');
  }
  if (draft.pools.human.length + draft.pools.ai.length !== 90) {
    throw new Hang('pula draftu nie ma 90 kart');
  }
  return { draft, draftedFirst };
}

function playGame(setCode, seed) {
  const rng = mulberry32(seed >>> 0);
  const cube = buildCube(cat.cards, rng, setCode);
  if (cube.cards.some((card) => card.set !== setCode)) throw new Hang('kostka pomieszała dodatki');
  const { draft, draftedFirst } = draftBoth(cube.cards, rng);
  const p1 = buildDeck(draft.pools.human, byId, 'hard');
  const p2 = buildDeck(draft.pools.ai, byId, 'hard');
  const chooser = draftedFirst === 'human' ? 'ai' : 'human';
  const state = createGame({
    catalogKey,
    chooseStart: true,
    chooser,
    humanDeck: p1.deck,
    aiDeck: p2.deck,
    humanSide: p1.side,
    aiSide: p2.side,
    seed: (seed ^ 0x9e3779b9) >>> 0 || 1,
  });
  const life = [];
  noteLife(state, life);
  const started = Date.now();
  let actions = 0;
  let lastPrint = '';
  let stall = 0;
  while (!state.gameOver) {
    if (Date.now() - started > TIME_CAP_MS) throw new Hang('ponad 20 s');
    if (state.turn > TURN_CAP) throw new Hang(`tura ${state.turn}`);
    if (++actions > ACTION_CAP) throw new Hang(`ponad ${ACTION_CAP} akcji`);
    const player = actor(state);
    if (!player) throw new Hang('brak gracza przy ruchu');
    let action;
    try {
      action = chooseAction(state, player, 'hard');
    } catch (error) {
      throw new Hang(error.message || 'wybór ruchu');
    }
    let res;
    try {
      res = apply(state, player, action);
      if (!res.ok) res = apply(state, player, fallback(state, player));
    } catch (error) {
      throw new Hang(error.message || 'ruch rzucił wyjątek');
    }
    if (!res.ok) throw new Hang(res.error || 'ruch odrzucony');
    noteLife(state, life);
    const print = fingerprint(state);
    stall = print === lastPrint ? stall + 1 : 0;
    lastPrint = print;
    if (stall >= STALL_CAP) throw new Hang('stan gry przestał się zmieniać');
  }
  noteLife(state, life);
  const over = state.gameOver;
  const winner = over.draw ? 'draw' : over.winner === 'human' ? 'p1' : 'p2';
  return {
    seed,
    winner,
    reason: over.reason || '',
    turns: state.turn,
    actions,
    ms: Date.now() - started,
    draftedFirst: draftedFirst === 'human' ? 'p1' : 'p2',
    started: state.startingPlayer === 'human' ? 'p1' : 'p2',
    p1: { colors: p1.colors, ...deckRecord(p1.deck), ids: p1.deck },
    p2: { colors: p2.colors, ...deckRecord(p2.deck), ids: p2.deck },
    life,
  };
}

function strengthOf(matches) {
  const table = new Map();
  for (const match of matches) {
    for (const [side, result] of [
      ['p1', match.winner === 'draw' ? 'draw' : match.winner === 'p1' ? 'win' : 'loss'],
      ['p2', match.winner === 'draw' ? 'draw' : match.winner === 'p2' ? 'win' : 'loss'],
    ]) {
      const seen = new Set();
      for (const id of match[side].ids) {
        if (String(id).startsWith('basic-')) continue;
        const def = byId.get(id);
        if (!def || def.basic) continue;
        if (seen.has(def.name)) continue;
        seen.add(def.name);
        const row = table.get(def.name) || {
          name: def.name,
          printed: plCards[def.oracleId]?.name || def.name,
          games: 0,
          wins: 0,
          losses: 0,
          draws: 0,
        };
        row.games += 1;
        if (result === 'win') row.wins += 1;
        else if (result === 'loss') row.losses += 1;
        else row.draws += 1;
        table.set(def.name, row);
      }
    }
  }
  return [...table.values()]
    .map((row) => {
      const decisive = row.wins + row.losses;
      return { ...row, winRate: decisive ? row.wins / decisive : null };
    })
    .sort((a, b) => (b.winRate ?? -1) - (a.winRate ?? -1) || b.games - a.games || a.name.localeCompare(b.name));
}

function pct(rate) {
  if (rate == null) return '—';
  return `${Math.round(rate * 100)}%`;
}

function lifeLine(life) {
  return life.map((row) => `${row.turn}: ${row.p1}–${row.p2}`).join(', ');
}

function tableOf(rows) {
  const lines = ['| Karta | Talie | Wygrane | Przegrane | Remisy | Wygrane przy wyniku |', '| --- | ---: | ---: | ---: | ---: | ---: |'];
  for (const row of rows) {
    lines.push(`| ${row.printed} | ${row.games} | ${row.wins} | ${row.losses} | ${row.draws} | ${pct(row.winRate)} |`);
  }
  return lines.join('\n');
}

function report(out) {
  const lines = [];
  lines.push('# Siła kart z meczy komputer–komputer');
  lines.push('');
  lines.push('Po 20 dokończonych meczy na dodatek: Strixhaven (STX), Adventures in the Forgotten Realms (AFR) i Duskmourn (DSK). Oba stanowiska gra komputer na trudności trudnej. Kostka ma 90 kart z jednego dodatku. Dodatki się nie mieszają.');
  lines.push('');
  lines.push('Zawieszenie (tura powyżej 80, ponad 6000 akcji, ponad 20 sekund, błąd albo stan, który przestał się zmieniać) nie wchodzi do wyniku. Taki mecz startuje od nowa z innym ziarnem losowania.');
  lines.push('');
  lines.push('Siła karty to odsetek wygranych wśród partii z rozstrzygnięciem, w których karta była w talii (nie w boku i nie jako ląd podstawowy). Jedna kopia w talii liczy się raz na mecz. Ranking bierze karty z co najmniej 4 taliami. Każdy dodatek jest osobno.');
  lines.push('');
  lines.push(`Dokończone mecze: ${out.completed}. Powtórzenia po zawieszeniu: ${out.retries}.`);
  lines.push('');
  for (const setCode of SETS) {
    const block = out.sets[setCode];
    const wins1 = block.matches.filter((m) => m.winner === 'p1').length;
    const wins2 = block.matches.filter((m) => m.winner === 'p2').length;
    const draws = block.matches.filter((m) => m.winner === 'draw').length;
    const ranked = block.strength.filter((row) => row.games >= 4 && row.winRate != null);
    lines.push(`## ${CUBE_SETS[setCode]} (${setCode.toUpperCase()})`);
    lines.push('');
    lines.push(`Mecze: ${block.matches.length}. Komputer A wygrał ${wins1}, komputer B wygrał ${wins2}, remisy: ${draws}. Powtórzenia tego dodatku: ${block.retries}.`);
    lines.push('');
    lines.push('### Najsilniejsze');
    lines.push('');
    lines.push(ranked.length ? tableOf(ranked.slice(0, 15)) : 'Za mało powtórzeń, żeby ułożyć ranking.');
    lines.push('');
    lines.push('### Najsłabsze');
    lines.push('');
    lines.push(ranked.length ? tableOf([...ranked].reverse().slice(0, 15)) : 'Za mało powtórzeń, żeby ułożyć ranking.');
    lines.push('');
    lines.push('### Mecze');
    lines.push('');
    block.matches.forEach((match, index) => {
      const who = match.winner === 'draw' ? 'remis' : match.winner === 'p1' ? 'wygrał komputer A' : 'wygrał komputer B';
      lines.push(`#### Mecz ${index + 1} · ziarno ${match.seed} · ${who} · tura ${match.turns}`);
      lines.push('');
      lines.push(`Draft zaczyna ${match.draftedFirst === 'p1' ? 'komputer A' : 'komputer B'}. Partię zaczyna ${match.started === 'p1' ? 'komputer A' : 'komputer B'}. Próby: ${match.tries}. Akcje: ${match.actions}. Czas: ${match.ms} ms.`);
      if (match.replaced.length) {
        lines.push(`Odrzucone losowania: ${match.replaced.map((item) => `${item.seed} (${item.reason})`).join('; ')}.`);
      }
      lines.push('');
      lines.push(`Komputer A (${match.p1.colors.join('')}): ${deckLine(match.p1)}`);
      lines.push('');
      lines.push(`Komputer B (${match.p2.colors.join('')}): ${deckLine(match.p2)}`);
      lines.push('');
      lines.push(`Życie A–B: ${lifeLine(match.life)}.`);
      lines.push('');
    });
  }
  lines.push('Nazwy kart są angielskie. Te dodatki nie mają polskiego druku w bazie Scryfalla. Tekst kart © Wizards of the Coast. Dane: Scryfall.');
  lines.push('');
  return lines.join('\n');
}

function publicMatch(match) {
  const copySide = (side) => ({
    colors: side.colors,
    cards: side.cards,
    basics: side.basics,
  });
  return {
    seed: match.seed,
    tries: match.tries,
    replaced: match.replaced,
    winner: match.winner,
    reason: match.reason,
    turns: match.turns,
    actions: match.actions,
    ms: match.ms,
    draftedFirst: match.draftedFirst,
    started: match.started,
    p1: copySide(match.p1),
    p2: copySide(match.p2),
    life: match.life,
  };
}

const outDir = path.join(root, 'results');
mkdirSync(outDir, { recursive: true });
const out = {
  playedAt: new Date().toISOString(),
  difficulty: 'hard',
  perSet: PER_SET,
  hang: { turn: TURN_CAP, actions: ACTION_CAP, ms: TIME_CAP_MS, stall: STALL_CAP, maxTries: MAX_TRIES },
  completed: 0,
  retries: 0,
  sets: {},
};

for (const setCode of SETS) {
  const matches = [];
  let setRetries = 0;
  let serial = 1;
  for (let n = 1; n <= PER_SET; n++) {
    const replaced = [];
    let played = null;
    for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
      const seed = (0x510000 + SETS.indexOf(setCode) * 100000 + n * 100 + serial) >>> 0;
      serial += 1;
      try {
        played = playGame(setCode, seed);
        played.tries = attempt;
        played.replaced = replaced;
        break;
      } catch (error) {
        const reason = error instanceof Hang ? error.message : (error.message || 'wyjątek');
        replaced.push({ seed, reason });
        setRetries += 1;
        out.retries += 1;
        console.log(`${setCode} mecz ${n} próba ${attempt} odrzucona (${reason}), ziarno ${seed}`);
        played = null;
      }
    }
    if (!played) {
      writeFileSync(path.join(outDir, 'matches.json'), JSON.stringify(out, null, 2));
      throw new Error(`${setCode} mecz ${n} nie dokończył się po ${MAX_TRIES} losowaniach`);
    }
    matches.push(played);
    out.completed += 1;
    out.sets[setCode] = {
      retries: setRetries,
      matches: matches.map(publicMatch),
      strength: strengthOf(matches),
    };
    writeFileSync(path.join(outDir, 'matches.json'), JSON.stringify(out, null, 2));
    console.log(`${setCode} ${n}/${PER_SET} ${played.winner} tura ${played.turns} akcje ${played.actions} ${played.ms} ms ziarno ${played.seed}`);
  }
}

if (!probe) writeFileSync(path.join(outDir, 'card-strength.md'), report(out));
console.log(`Gotowe. Mecze: ${out.completed}. Powtórzenia: ${out.retries}.`);
