/**
 * Lądy do talii ograniczonej (40 kart).
 *
 * Liczba lądów: Frank Karsten, „How Many Lands” / praktyka limited.
 * 17 to założenie jego tabeli źródeł dla talii 40 kart (2022).
 * 16, gdy krzywa jest niska. 18, gdy jest wysoka.
 *
 * Kolory: opublikowana kolumna talii 40 kart z „How Many Sources… A 2022 Update”.
 * Dla każdego koloru bierzemy najcięższe zaklęcie i tyle źródeł,
 * ile ta tabela chce, żeby rzucić je na krzywą.
 * Hybryda i phyrexian nie podbijają twardego progu (da się je zapłacić inaczej),
 * ale ciągną nadmiar lądów w swoją stronę.
 */

const COLORS = ['W', 'U', 'B', 'R', 'G'];
const COLOR_NAME = { W: 'biały', U: 'niebieski', B: 'czarny', R: 'czerwony', G: 'zielony' };

/**
 * Kolumna „40-card deck” z tabeli Karstena (TCGplayer, 2022).
 * Klucz to liczba symboli jednego koloru, potem koszt many.
 * Poza tabelą zostaje najbliższy znany, łatwiejszy koszt. Pięć symboli wymaga 17.
 */
const SOURCE_TABLE = {
  1: { 1: 9, 2: 9, 3: 8, 4: 7, 5: 6, 6: 6 },
  2: { 2: 14, 3: 12, 4: 11, 5: 10, 6: 9, 7: 8 },
  3: { 3: 16, 4: 14, 5: 13, 6: 11, 7: 10 },
  4: { 4: 17, 5: 15 },
};

/** Ile źródeł koloru trzeba, żeby rzucić zaklęcie o tylu symbolach na krzywą. */
export function sourcesFor(pips, manaValue) {
  const count = Math.max(0, Math.round(Number(pips) || 0));
  if (count === 0) return 0;
  if (count >= 5) return 17;
  const row = SOURCE_TABLE[count];
  const mv = Math.max(count, Math.round(Number(manaValue) || count));
  if (row[mv]) return row[mv];
  const known = Object.keys(row).map(Number).sort((a, b) => a - b);
  const below = known.filter((cost) => cost <= mv).pop();
  return row[below ?? known[0]];
}

export function recommendedLandCount(spells) {
  if (!spells.length) return 0;
  const costs = spells.map((card) => Number(card.cmc) || 0);
  const avg = costs.reduce((sum, n) => sum + n, 0) / costs.length;
  const big = costs.filter((n) => n >= 5).length;
  const top = Math.max(...costs);
  if (big >= 3 || avg >= 3.4) return 18;
  if (big === 0 && avg <= 2.5 && top <= 4) return 16;
  return 17;
}

function parseSymbols(manaCost) {
  const colors = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  const flex = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  const text = String(manaCost || '');
  for (const match of text.matchAll(/\{([^}]+)\}/g)) {
    const sym = match[1].toUpperCase();
    if (COLORS.includes(sym)) {
      colors[sym] += 1;
      continue;
    }
    const hybrid = sym.match(/^([WUBRG])\/([WUBRG])$/);
    if (hybrid) {
      flex[hybrid[1]] += 0.5;
      flex[hybrid[2]] += 0.5;
      continue;
    }
    const phy = sym.match(/^([WUBRG])\/P$/);
    if (phy) {
      flex[phy[1]] += 0.5;
      continue;
    }
    const twobrid = sym.match(/^2\/([WUBRG])$/);
    if (twobrid) flex[twobrid[1]] += 0.5;
  }
  return { colors, flex };
}

function halves(manaCost) {
  const parts = String(manaCost || '').split(/\s*\/\/\s*/);
  return parts.length ? parts : [''];
}

export function isLandCard(card) {
  return /\bLand\b/.test(card?.typeLine || '');
}

export function landColors(card) {
  const type = card?.typeLine || '';
  const typed = [];
  if (/\bPlains\b/i.test(type)) typed.push('W');
  if (/\bIsland\b/i.test(type)) typed.push('U');
  if (/\bSwamp\b/i.test(type)) typed.push('B');
  if (/\bMountain\b/i.test(type)) typed.push('R');
  if (/\bForest\b/i.test(type)) typed.push('G');
  if (typed.length) return typed;
  const produced = [...(card?.producedMana || []), ...(card?.produced_mana || [])]
    .map((color) => String(color).toUpperCase())
    .filter((color) => COLORS.includes(color));
  if (produced.length) return [...new Set(produced)];
  const oracle = card?.oracle || '';
  if (/any color/i.test(oracle)) return COLORS.slice();
  const added = [...oracle.matchAll(/add \{([WUBRG])\}/gi)].map((match) => match[1].toUpperCase());
  return [...new Set(added)];
}

function largestRemainder(keys, weights, total) {
  const out = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  if (total <= 0) return out;
  const sum = keys.reduce((acc, color) => acc + (weights[color] || 0), 0);
  if (sum <= 0) {
    out.W = total;
    return out;
  }
  const exact = keys.map((color) => ((weights[color] || 0) / sum) * total);
  const base = exact.map((value) => Math.floor(value));
  let left = total - base.reduce((acc, n) => acc + n, 0);
  const order = exact
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => (b.frac - a.frac) || (a.index - b.index));
  for (let n = 0; n < left; n += 1) base[order[n].index] += 1;
  keys.forEach((color, index) => { out[color] = base[index]; });
  return out;
}

function emptyColors() {
  return { W: 0, U: 0, B: 0, R: 0, G: 0 };
}

/**
 * Dobiera lądy podstawowe tak, żeby talia miała 40 kart,
 * a źródła kolorów były jak najbliżej tabeli Karstena.
 */
export function suggestBasics(cards) {
  const list = (cards || []).filter(Boolean);
  const spells = list.filter((card) => !isLandCard(card));
  const lands = list.filter((card) => isLandCard(card));
  const basics = emptyColors();
  const required = emptyColors();
  const weight = emptyColors();
  const have = emptyColors();
  if (!list.length) {
    return { basics, recommended: 0, actualLands: 0, deckSize: 0, required, sources: have, genericOnly: false };
  }
  for (const spell of spells) {
    for (const half of halves(spell.manaCost)) {
      const parsed = parseSymbols(half);
      const mv = Math.max(1, Math.round(Number(spell.cmc) || 1));
      for (const color of COLORS) {
        weight[color] += parsed.colors[color] + parsed.flex[color];
        if (parsed.colors[color] > 0) {
          required[color] = Math.max(required[color], sourcesFor(parsed.colors[color], mv));
        }
      }
    }
  }
  for (const land of lands) {
    for (const color of landColors(land)) have[color] += 1;
  }
  const room = Math.max(0, 40 - list.length);
  const active = COLORS.filter((color) => weight[color] > 0 || required[color] > 0);
  const need = emptyColors();
  for (const color of COLORS) need[color] = Math.max(0, required[color] - have[color]);
  const needSum = active.reduce((sum, color) => sum + need[color], 0);
  if (!active.length) {
    basics.W = room;
  } else if (needSum <= room) {
    for (const color of active) basics[color] = need[color];
    const extra = largestRemainder(active, weight, room - needSum);
    for (const color of active) basics[color] += extra[color];
  } else {
    const share = largestRemainder(active, need, room);
    for (const color of active) basics[color] = share[color];
  }
  const sources = emptyColors();
  for (const color of COLORS) sources[color] = have[color] + basics[color];
  return {
    basics,
    recommended: recommendedLandCount(spells),
    actualLands: lands.length + room,
    deckSize: list.length + room,
    required,
    sources,
    genericOnly: spells.length > 0 && active.length === 0,
  };
}

export function landNote(plan) {
  if (!plan || plan.deckSize === 0) return '';
  if (plan.genericOnly) {
    return `Zaklęcia nie mają kolorowych kosztów. Do kosztów ogólnych dokładam ${plan.basics.W} równin. Talia ma ${plan.deckSize} kart, w tym ${plan.actualLands} lądów. Karsten dla tej krzywej chce ${plan.recommended}.`;
  }
  const parts = COLORS
    .filter((color) => plan.required[color] > 0 || plan.basics[color] > 0 || plan.sources[color] > 0)
    .map((color) => `${COLOR_NAME[color]} ${plan.sources[color]}/${plan.required[color] || 0}`);
  return `Lądy: ${plan.actualLands} (Karsten dla krzywej: ${plan.recommended}). Źródła, jest/trzeba: ${parts.join(', ')}. Talia ma ${plan.deckSize} kart.`;
}

/** Liczby wybrane przez gracza. Puste i ujemne zostają zerem. Nie dobiera brakujących lądów. */
export function manualBasics(cards, chosen) {
  const list = (cards || []).filter(Boolean);
  const lands = list.filter((card) => isLandCard(card));
  const suggestion = list.length ? suggestBasics(list) : null;
  const basics = emptyColors();
  for (const color of COLORS) {
    const n = Math.floor(Number(chosen?.[color]) || 0);
    basics[color] = Number.isFinite(n) && n > 0 ? n : 0;
  }
  const have = emptyColors();
  for (const land of lands) {
    for (const color of landColors(land)) have[color] += 1;
  }
  const sources = emptyColors();
  for (const color of COLORS) sources[color] = have[color] + basics[color];
  const basicTotal = COLORS.reduce((sum, color) => sum + basics[color], 0);
  return {
    basics,
    suggested: suggestion?.basics || emptyColors(),
    recommended: suggestion?.recommended || 0,
    required: suggestion?.required || emptyColors(),
    sources,
    actualLands: lands.length + basicTotal,
    deckSize: list.length + basicTotal,
    genericOnly: !!suggestion?.genericOnly,
    spellCount: list.length - lands.length,
  };
}

export function choiceNote(plan) {
  if (!plan || plan.deckSize === 0) return '';
  const parts = COLORS
    .filter((color) => plan.required[color] > 0 || plan.sources[color] > 0)
    .map((color) => `${COLOR_NAME[color]} ${plan.sources[color]}/${plan.required[color] || 0}`);
  return `Talia ma ${plan.deckSize} kart, w tym ${plan.actualLands} lądów. Karsten dla krzywej chce ${plan.recommended}. Źródła, jest/trzeba: ${parts.join(', ') || 'brak'}.`;
}
