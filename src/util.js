/** Losowanie i drobne funkcje wspólne dla silnika, draftu i testów. */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(list, rng) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function pickWeighted(items, weight, rng) {
  let total = 0;
  const weights = items.map((item) => {
    const w = Math.max(0, weight(item));
    total += w;
    return w;
  });
  if (total <= 0) return items[Math.floor(rng() * items.length)];
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

export function sampleWeighted(items, n, weight, rng) {
  const pool = items.slice();
  const out = [];
  while (out.length < n && pool.length) {
    const chosen = pickWeighted(pool, weight, rng);
    out.push(chosen);
    pool.splice(pool.indexOf(chosen), 1);
  }
  return out;
}

export const COLORS = ['W', 'U', 'B', 'R', 'G'];

export const COLOR_NAME = {
  W: 'biały',
  U: 'niebieski',
  B: 'czarny',
  R: 'czerwony',
  G: 'zielony',
  C: 'bezbarwny',
  M: 'wielokolor',
};

export const RARITY_NAME = {
  common: 'pospolita',
  uncommon: 'niepospolita',
  rare: 'rzadka',
  mythic: 'mityczna',
};

const WORDS = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

export function wordNum(token) {
  if (token == null) return null;
  const t = String(token).toLowerCase();
  if (/^\d+$/.test(t)) return Number(t);
  return WORDS[t] ?? null;
}

/** Usuwa tekst przypominający w nawiasach. Powtarza, żeby zdjąć zagnieżdżenia. */
export function stripReminders(text) {
  let s = String(text || '');
  let prev;
  do {
    prev = s;
    s = s.replace(/\([^()]*\)/g, '');
  } while (s !== prev);
  return s.replace(/[ \t]+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').trim();
}

export function escapeReg(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}
