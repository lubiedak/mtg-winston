/**
 * Grid draft dla dwóch osób (Jason Waddell / Lucky Paper).
 * 9 kart w siatce 3×3. Pierwszy bierze rząd albo kolumnę.
 * Drugi bierze rząd albo kolumnę z tego, co zostało (może być krótsza).
 * Reszta siatki odpada. Kto zaczyna, zmienia się co siatkę.
 * Pełny draft to 18 siatek, czyli 162 karty. Mniejsza kostka daje mniej siatek.
 */
import { shuffle } from './util.js';

export const GRID_PACKS = 18;
export const GRID_CELLS = 9;

const LINES = {
  r0: [0, 1, 2],
  r1: [3, 4, 5],
  r2: [6, 7, 8],
  c0: [0, 3, 6],
  c1: [1, 4, 7],
  c2: [2, 5, 8],
};

export function gridPackCount(cardCount) {
  return Math.min(GRID_PACKS, Math.floor(Math.max(0, cardCount) / GRID_CELLS));
}

function other(player) {
  return player === 'p1' ? 'p2' : 'p1';
}

function firstOfPack(draft) {
  return draft.packIndex % 2 === 0 ? draft.starter : other(draft.starter);
}

export function createGrid(cardIds, starter, rng) {
  const packCount = gridPackCount(cardIds.length);
  if (packCount < 1) throw new Error('Grid potrzebuje co najmniej 9 kart.');
  const who = starter === 'p2' ? 'p2' : 'p1';
  const ids = shuffle(cardIds, rng).slice(0, packCount * GRID_CELLS);
  const packs = [];
  for (let i = 0; i < packCount; i += 1) packs.push(ids.slice(i * GRID_CELLS, (i + 1) * GRID_CELLS));
  return {
    packs,
    packCount,
    packIndex: 0,
    grid: packs[0].slice(),
    starter: who,
    active: who,
    pickInPack: 0,
    pools: { p1: [], p2: [] },
    discarded: [],
    log: [`Grid: ${packCount} siatek po 9 kart.`],
    done: false,
  };
}

export function gridLines(grid) {
  return Object.entries(LINES).map(([key, indexes]) => ({
    key,
    indexes,
    ids: indexes.map((index) => grid[index]).filter(Boolean),
  }));
}

export function applyGrid(draft, lineKey) {
  if (draft.done) return { ok: false, error: 'Draft jest skończony.' };
  const indexes = LINES[lineKey];
  if (!indexes) return { ok: false, error: 'Nie ma takiej linii.' };
  const ids = indexes.map((index) => draft.grid[index]).filter(Boolean);
  if (!ids.length) return { ok: false, error: 'Ta linia jest pusta.' };
  for (const index of indexes) draft.grid[index] = null;
  draft.pools[draft.active].push(...ids);
  const kind = lineKey.startsWith('r') ? 'rząd' : 'kolumnę';
  draft.log.push(`${draft.active === 'p1' ? 'Gracz 1' : 'Gracz 2'} bierze ${kind} (${ids.length}).`);
  draft.pickInPack += 1;
  if (draft.pickInPack < 2) {
    draft.active = other(draft.active);
    return { ok: true };
  }
  const rest = draft.grid.filter(Boolean);
  draft.discarded.push(...rest);
  if (rest.length) draft.log.push(`Odpada ${rest.length} kart z siatki.`);
  draft.packIndex += 1;
  if (draft.packIndex >= draft.packCount) {
    draft.done = true;
    draft.grid = [];
    draft.log.push('Grid skończony.');
    return { ok: true };
  }
  draft.grid = draft.packs[draft.packIndex].slice();
  draft.pickInPack = 0;
  draft.active = firstOfPack(draft);
  return { ok: true };
}
