/**
 * Zapis draftu i talii pod linkiem /?d=…
 * Karty z lokalnego katalogu zostają jako identyfikatory.
 * Karty spoza katalogu (import) idą w całości.
 */

const SCREENS = new Set(['menu', 'cube', 'draft', 'deck', 'hand']);

export function isDraftId(id) {
  return /^[a-f0-9]{16,32}$/.test(String(id || ''));
}

export function newDraftId() {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function packCard(card, catalogIds) {
  const base = String(card?.id || '').replace(/#\d+$/, '');
  if (base && catalogIds?.has(base)) return { id: card.id };
  return { id: card.id, card };
}

function packHands(hands) {
  if (!hands) return null;
  const out = {};
  for (const [seat, bag] of Object.entries(hands)) {
    if (!bag) continue;
    out[seat] = {
      library: bag.library || [],
      hand: bag.hand || [],
      mulligans: bag.mulligans || 0,
      mode: bag.mode === 'bottom' ? 'bottom' : 'keep',
      bottom: [...(bag.bottom || [])],
    };
  }
  return out;
}

function packDecks(decks) {
  if (!decks) return null;
  const out = {};
  for (const [seat, ids] of Object.entries(decks)) out[seat] = [...ids];
  return out;
}

export function packSession(state) {
  const cube = state.cube;
  return {
    version: 1,
    screen: SCREENS.has(state.screen) ? state.screen : 'cube',
    format: state.format === 'grid' ? 'grid' : 'winston',
    gridFirst: state.gridFirst || 'p1',
    first: state.first || 'human',
    diff: state.diff || 'medium',
    setCode: state.setCode || 'afr',
    rngSeed: state.rngSeed || 1,
    status: state.status || '',
    seatOrder: state.seatOrder || ['human'],
    seatAt: state.seatAt || 0,
    handSeat: state.handSeat || null,
    cube: cube ? {
      notes: cube.notes || [],
      summary: cube.summary || null,
      set: cube.set || '',
      name: cube.name || '',
      imported: !!cube.imported,
      format: cube.format || null,
      rarityRequest: cube.rarityRequest || null,
      cards: (cube.cards || []).map((card) => packCard(card, state.catalogIds)),
    } : null,
    draft: state.draft || null,
    decks: packDecks(state.decks),
    basics: packBasics(state.landPicks),
    hands: packHands(state.hands),
  };
}

function packBasics(picks) {
  if (!picks) return null;
  const out = {};
  for (const [seat, counts] of Object.entries(picks)) {
    out[seat] = {
      W: Math.max(0, Math.floor(Number(counts?.W) || 0)),
      U: Math.max(0, Math.floor(Number(counts?.U) || 0)),
      B: Math.max(0, Math.floor(Number(counts?.B) || 0)),
      R: Math.max(0, Math.floor(Number(counts?.R) || 0)),
      G: Math.max(0, Math.floor(Number(counts?.G) || 0)),
    };
  }
  return out;
}

function resolveCard(entry, byId) {
  if (entry?.card) {
    const card = { ...entry.card, id: entry.id || entry.card.id };
    byId.set(card.id, card);
    return card;
  }
  const id = String(entry?.id || '');
  const base = id.replace(/#\d+$/, '');
  const known = byId.get(base);
  if (!known) {
    const missing = { id, name: id, manaCost: '', cmc: 0, typeLine: '', oracle: '', colorIdentity: [], colors: [] };
    byId.set(id, missing);
    return missing;
  }
  if (known.id === id) return known;
  const copy = { ...known, id };
  byId.set(id, copy);
  return copy;
}

export function unpackSession(raw, byId) {
  if (!raw || raw.version !== 1 || !raw.cube || !Array.isArray(raw.cube.cards)) {
    throw new Error('Zapis draftu jest uszkodzony.');
  }
  const cards = raw.cube.cards.map((entry) => resolveCard(entry, byId));
  const seatOrder = Array.isArray(raw.seatOrder) && raw.seatOrder.length ? raw.seatOrder : ['human'];
  const decks = raw.decks ? {} : null;
  if (raw.decks) {
    for (const [seat, ids] of Object.entries(raw.decks)) {
      decks[seat] = new Set(Array.isArray(ids) ? ids : []);
    }
  }
  let screen = SCREENS.has(raw.screen) ? raw.screen : 'cube';
  const draft = raw.draft || null;
  if ((screen === 'draft' || screen === 'deck' || screen === 'hand') && !draft) screen = 'cube';
  if (screen === 'hand' && !raw.hands) screen = 'deck';
  let format = raw.format === 'grid' ? 'grid' : 'winston';
  if (draft?.packs) format = 'grid';
  else if (draft?.piles) format = 'winston';
  return {
    screen,
    format,
    gridFirst: raw.gridFirst || 'p1',
    first: raw.first || 'human',
    diff: raw.diff || 'medium',
    setCode: raw.setCode || 'afr',
    rngSeed: Number(raw.rngSeed) || 1,
    status: raw.status || '',
    seatOrder,
    seatAt: Number.isInteger(raw.seatAt) && raw.seatAt >= 0 && raw.seatAt < seatOrder.length ? raw.seatAt : 0,
    handSeat: raw.handSeat || seatOrder[0],
    cube: {
      cards,
      notes: raw.cube.notes || [],
      summary: raw.cube.summary,
      set: raw.cube.set || '',
      name: raw.cube.name || '',
      imported: !!raw.cube.imported,
      format: raw.cube.format || null,
      rarityRequest: raw.cube.rarityRequest || null,
    },
    draft,
    decks,
    landPicks: raw.basics && typeof raw.basics === 'object' ? raw.basics : null,
    hands: raw.hands || null,
  };
}
