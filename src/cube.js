/**
 * 90 kart pod Winstona, równo co do koloru i rzadkości.
 * To nie jest symulacja sześciu boosterów (te bywają krzywe), tylko kostka
 * złożona tak, żeby obaj gracze mieli z czego budować talię.
 */
import { sampleWeighted, shuffle } from './util.js';

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

export function buildCube(catalogCards, rng, setCode) {
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
  for (const color of MONO) {
    take(takeQuota(byRarity(groups[color] || []), FAIR_QUOTAS.mono, rng, notes, color));
  }
  take(takeQuota(byRarity(groups.gold || []), FAIR_QUOTAS.gold, rng, notes, 'wielokolor'));
  take(takeQuota(byRarity(groups.colorless || []), FAIR_QUOTAS.colorless, rng, notes, 'bezbarwne'));
  take(takeQuota(byRarity(groups.land || []), FAIR_QUOTAS.land, rng, notes, 'lądy'));

  if (picked.length < 90) {
    const rest = usable.filter((card) => !used.has(card.id) && bucketOf(card) !== 'land');
    const extra = sampleWeighted(rest, 90 - picked.length, curveWeight, rng);
    for (const card of extra) {
      used.add(card.id);
      picked.push(card);
      notes.push(`Uzupełnienie do 90: ${card.name}.`);
    }
  }
  const cards = shuffle(picked.slice(0, 90), rng);
  if (cards.some((card) => card.set !== set)) {
    throw new Error('Kostka pomieszała dodatki.');
  }
  return { cards, notes, summary: summarize(cards), quotas: FAIR_QUOTAS, set };
}
