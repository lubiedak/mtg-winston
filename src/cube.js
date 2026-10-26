/**
 * 90 kart pod Winstona. Koszyki kolorów są stałe.
 * Bez proporcji zostaje zwykły podział rzadkości.
 * Z wagami Common/Uncommon/Rare/Mythic te same koszyki dostają wyliczone udziały.
 */
import { RARITY_NAME, sampleWeighted, shuffle } from './util.js';

const MONO = ['W', 'U', 'B', 'R', 'G'];

/** Kostka jest zawsze z jednego dodatku. Nigdy z mieszanki. */
export const CUBE_SETS = {
  afr: 'AFR — Forgotten Realms',
  stx: 'STX — Strixhaven',
  dsk: 'DSK — Duskmourn',
};

/** 14 na kolor × 5 = 70, złote 10, bezbarwne 6, lądy 4. */
export const FAIR_QUOTAS = {
  mono: { common: 8, uncommon: 4, rare: 1, mythic: 1 },
  gold: { common: 2, uncommon: 4, rare: 3, mythic: 1 },
  colorless: { common: 3, uncommon: 2, rare: 1, mythic: 0 },
  land: { common: 2, uncommon: 2, rare: 0, mythic: 0 },
};

const RARITIES = ['common', 'uncommon', 'rare', 'mythic'];

/** 14 na kolor, 10 złotych, 6 bezbarwnych, 4 lądy. Suma 90. */
const BUCKETS = [
  ['W', 14, 'W'],
  ['U', 14, 'U'],
  ['B', 14, 'B'],
  ['R', 14, 'R'],
  ['G', 14, 'G'],
  ['gold', 10, 'wielokolor'],
  ['colorless', 6, 'bezbarwne'],
  ['land', 4, 'lądy'],
];

/**
 * Wagi (nie muszą sumować się do 100) na liczby kart, które sumują się do `total`.
 * Reszty idą do największych części ułamkowych.
 */
export function rarityTargets(percents, total = 90) {
  const weights = RARITIES.map((rarity) => {
    const n = Number(percents?.[rarity]);
    return Number.isFinite(n) && n > 0 ? n : 0;
  });
  const sum = weights.reduce((acc, n) => acc + n, 0);
  if (sum <= 0) throw new Error('Podaj proporcję większą od zera.');
  const exact = weights.map((weight) => (weight / sum) * total);
  const counts = exact.map((value) => Math.floor(value));
  let left = total - counts.reduce((acc, n) => acc + n, 0);
  const order = exact
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => (b.frac - a.frac) || (a.index - b.index));
  for (let n = 0; n < left; n += 1) counts[order[n].index] += 1;
  const out = {};
  RARITIES.forEach((rarity, index) => { out[rarity] = counts[index]; });
  return out;
}

export function scaledBuckets(size = 90) {
  if (size === 90) return BUCKETS;
  const weights = BUCKETS.map((row) => row[1]);
  const total = weights.reduce((sum, n) => sum + n, 0);
  const exact = weights.map((weight) => (weight / total) * size);
  const counts = exact.map((value) => Math.floor(value));
  let left = size - counts.reduce((sum, n) => sum + n, 0);
  const order = exact
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => (b.frac - a.frac) || (a.index - b.index));
  for (let n = 0; n < left; n += 1) counts[order[n].index] += 1;
  return BUCKETS.map((row, index) => [row[0], counts[index], row[2]]);
}

function percentQuotas(groups, targets, buckets = BUCKETS) {
  const supply = {};
  const quota = {};
  const room = {};
  const order = {};
  buckets.forEach(([key, size], index) => {
    const by = byRarity(groups[key] || []);
    supply[key] = {};
    quota[key] = { common: 0, uncommon: 0, rare: 0, mythic: 0 };
    for (const rarity of RARITIES) supply[key][rarity] = by[rarity].length;
    const have = RARITIES.reduce((n, rarity) => n + supply[key][rarity], 0);
    room[key] = Math.min(size, have);
    order[key] = index;
  });
  const left = { ...targets };
  const keys = buckets.map(([key]) => key);
  const pickBucket = (rarity) => {
    const options = keys.filter((key) => room[key] > 0 && supply[key][rarity] > quota[key][rarity]);
    if (!options.length) return null;
    options.sort((a, b) => {
      if (quota[a][rarity] !== quota[b][rarity]) return quota[a][rarity] - quota[b][rarity];
      if (room[a] !== room[b]) return room[b] - room[a];
      const spareA = supply[a][rarity] - quota[a][rarity];
      const spareB = supply[b][rarity] - quota[b][rarity];
      if (spareA !== spareB) return spareB - spareA;
      return order[a] - order[b];
    });
    return options[0];
  };
  for (const rarity of ['mythic', 'rare', 'uncommon', 'common']) {
    while (left[rarity] > 0) {
      const key = pickBucket(rarity);
      if (!key) break;
      quota[key][rarity] += 1;
      room[key] -= 1;
      left[rarity] -= 1;
    }
  }
  for (const key of keys) {
    while (room[key] > 0) {
      const options = RARITIES.filter((rarity) => supply[key][rarity] > quota[key][rarity]);
      if (!options.length) break;
      options.sort((a, b) => {
        if ((left[a] > 0) !== (left[b] > 0)) return left[a] > 0 ? -1 : 1;
        return RARITIES.indexOf(a) - RARITIES.indexOf(b);
      });
      const rarity = options[0];
      quota[key][rarity] += 1;
      room[key] -= 1;
      if (left[rarity] > 0) left[rarity] -= 1;
    }
  }
  return quota;
}

function proportionNote(targets, summary) {
  const same = RARITIES.every((rarity) => targets[rarity] === summary.rarity[rarity]);
  if (same) return null;
  const line = (counts) => RARITIES.map((rarity) => `${RARITY_NAME[rarity]} ${counts[rarity]}`).join(', ');
  return `Proporcje rzadkości: proszono ${line(targets)}. W dodatku wyszło ${line(summary.rarity)}.`;
}

function curveWeight(card) {
  const mv = card.cmc ?? 0;
  let w = mv <= 1 ? 3 : mv === 2 ? 5 : mv === 3 ? 5 : mv === 4 ? 3 : mv === 5 ? 2 : 1;
  const type = card.typeLine || '';
  if (type.includes('Creature')) w *= 1.35;
  if (type.includes('Instant') || type.includes('Sorcery')) w *= 1.1;
  return w;
}

function bucketOf(card) {
  const type = card.typeLine || '';
  if (/\bLand\b/.test(type)) return 'land';
  const ci = card.colorIdentity || [];
  if (ci.length === 0) return 'colorless';
  if (ci.length === 1) return ci[0];
  return 'gold';
}

function byRarity(cards) {
  const out = { common: [], uncommon: [], rare: [], mythic: [] };
  for (const card of cards) {
    if (out[card.rarity]) out[card.rarity].push(card);
  }
  return out;
}

function takeQuota(groups, quota, rng, notes, label) {
  const picked = [];
  const pools = {
    common: groups.common.slice(),
    uncommon: groups.uncommon.slice(),
    rare: groups.rare.slice(),
    mythic: groups.mythic.slice(),
  };
  for (const rarity of RARITIES) {
    let need = quota[rarity] || 0;
    while (need > 0 && pools[rarity].length) {
      const [card] = sampleWeighted(pools[rarity], 1, curveWeight, rng);
      pools[rarity] = pools[rarity].filter((c) => c !== card);
      picked.push(card);
      need -= 1;
    }
    if (need > 0) {
      const fallbackOrder = RARITIES.filter((r) => r !== rarity);
      for (const alt of fallbackOrder) {
        while (need > 0 && pools[alt].length) {
          const [card] = sampleWeighted(pools[alt], 1, curveWeight, rng);
          pools[alt] = pools[alt].filter((c) => c !== card);
          picked.push(card);
          notes.push(`${label}: brak kart rzadkości „${rarity}”, dobrano „${alt}” (${card.name}).`);
          need -= 1;
        }
      }
    }
  }
  return picked;
}

function summarize(cards) {
  const summary = { color: {}, rarity: {}, total: cards.length };
  for (const color of [...MONO, 'gold', 'colorless', 'land']) summary.color[color] = 0;
  for (const rarity of RARITIES) summary.rarity[rarity] = 0;
  for (const card of cards) {
    summary.color[bucketOf(card)] += 1;
    summary.rarity[card.rarity] += 1;
  }
  return summary;
}

export function buildCube(catalogCards, rng, setCode, percents, size = 90) {
  const set = String(setCode || '').toLowerCase();
  if (!CUBE_SETS[set]) {
    throw new Error('Kostka jest z jednego dodatku: AFR, STX albo DSK.');
  }
  const notes = [];
  const usable = catalogCards.filter((card) => {
    if (card.set !== set) return false;
    if (card.basic) return false;
    if (/\bBasic\b/.test(card.typeLine || '')) return false;
    if (card.layout === 'token' || card.layout === 'dungeon') return false;
    return true;
  });
  const groups = {};
  for (const card of usable) {
    const key = bucketOf(card);
    if (!groups[key]) groups[key] = [];
    groups[key].push(card);
  }
  const picked = [];
  const used = new Set();
  const take = (list) => {
    for (const card of list) {
      if (used.has(card.id)) continue;
      used.add(card.id);
      picked.push(card);
    }
  };
  const targets = percents == null ? null : rarityTargets(percents, size);
  const buckets = scaledBuckets(size);
  if (!targets) {
    if (size !== 90) throw new Error('Kostka bez proporcji jest liczona na 90 kart.');
    for (const color of MONO) {
      take(takeQuota(byRarity(groups[color] || []), FAIR_QUOTAS.mono, rng, notes, color));
    }
    take(takeQuota(byRarity(groups.gold || []), FAIR_QUOTAS.gold, rng, notes, 'wielokolor'));
    take(takeQuota(byRarity(groups.colorless || []), FAIR_QUOTAS.colorless, rng, notes, 'bezbarwne'));
    take(takeQuota(byRarity(groups.land || []), FAIR_QUOTAS.land, rng, notes, 'lądy'));
  } else {
    const table = percentQuotas(groups, targets, buckets);
    for (const [key, , label] of buckets) {
      take(takeQuota(byRarity(groups[key] || []), table[key], rng, notes, label));
    }
  }

  if (picked.length < size) {
    const rest = usable.filter((card) => !used.has(card.id) && bucketOf(card) !== 'land');
    const extra = sampleWeighted(rest, size - picked.length, curveWeight, rng);
    for (const card of extra) {
      used.add(card.id);
      picked.push(card);
      notes.push(`Uzupełnienie do ${size}: ${card.name}.`);
    }
  }
  const cards = shuffle(picked.slice(0, size), rng);
  if (cards.some((card) => card.set !== set)) {
    throw new Error('Kostka pomieszała dodatki.');
  }
  const summary = summarize(cards);
  if (targets) {
    const note = proportionNote(targets, summary);
    if (note) notes.unshift(note);
  }
  return { cards, notes, summary, quotas: FAIR_QUOTAS, set, rarityRequest: targets };
}
