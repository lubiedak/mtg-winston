/**
 * Koszty many i pula.
 * Pula to lista „kropel”: { color, restrict }.
 * Kolor C to mana bezbarwna (symbol {C}), nie ogólna.
 * Ogólny koszt {N} płaci się dowolną maną. {C} tylko bezbarwną.
 */

export const COLOR_LETTERS = ['W', 'U', 'B', 'R', 'G', 'C'];

export function emptyPool() {
  return [];
}

export function parseManaCost(str) {
  const cost = {
    generic: 0,
    pips: [],
    hybrid: [],
    phyrexian: [],
    x: false,
    c: 0,
    text: str || '',
  };
  if (!str) return cost;
  const re = /\{([^}]+)\}/g;
  let m;
  while ((m = re.exec(str))) {
    const sym = m[1].toUpperCase();
    if (sym === 'X') cost.x = true;
    else if (sym === 'C') cost.c += 1;
    else if (/^\d+$/.test(sym)) cost.generic += Number(sym);
    else if (sym.endsWith('/P') && sym.length === 3) cost.phyrexian.push(sym[0]);
    else if (sym.includes('/')) {
      const [a, b] = sym.split('/');
      cost.hybrid.push([a, b]);
    } else if ('WUBRG'.includes(sym) && sym.length === 1) cost.pips.push(sym);
  }
  return cost;
}

export function manaValueOf(str) {
  const c = parseManaCost(str);
  let mv = c.generic + c.pips.length + c.c + c.phyrexian.length;
  for (const [a, b] of c.hybrid) {
    const an = /^\d+$/.test(a) ? Number(a) : 1;
    const bn = /^\d+$/.test(b) ? Number(b) : 1;
    mv += Math.max(an, bn);
  }
  return mv;
}

export function costWithX(cost, x) {
  return { ...cost, generic: cost.generic + (cost.x ? x : 0), x: false, chosenX: x };
}

/** Czy w puli da się opłacić koszt. Nie wydaje many. */
export function poolCanPay(pool, cost, life = 99) {
  return spend(pool, cost, life).ok;
}

/**
 * Wydaje manę z kopii puli.
 * Zwraca { ok, pool, lifePaid }.
 */
export function spend(pool, cost, life = 99) {
  const pips = pool.map((drop) => ({ ...drop }));
  let lifePaid = 0;

  const take = (pred) => {
    const i = pips.findIndex(pred);
    if (i < 0) return false;
    pips.splice(i, 1);
    return true;
  };
  const anyMana = (drop) => !drop.restrict || drop.restrict === cost.restrictOk;

  for (const color of cost.pips) {
    if (!take((d) => d.color === color && anyMana(d))) return { ok: false };
  }
  for (let i = 0; i < cost.c; i++) {
    if (!take((d) => d.color === 'C' && anyMana(d))) return { ok: false };
  }
  for (const [a, b] of cost.hybrid) {
    const paid = payHybrid(pips, a, b, anyMana, (n) => {
      cost = { ...cost, generic: cost.generic + n };
    });
    if (!paid) return { ok: false };
  }
  for (const color of cost.phyrexian) {
    if (take((d) => d.color === color && anyMana(d))) continue;
    if (life - lifePaid >= 2) {
      lifePaid += 2;
      continue;
    }
    return { ok: false };
  }
  let generic = cost.generic;
  while (generic > 0) {
    if (!take((d) => anyMana(d))) return { ok: false };
    generic -= 1;
  }
  return { ok: true, pool: pips, lifePaid };
}

function payHybrid(pips, a, b, anyMana, addGeneric) {
  const options = [a, b];
  for (const opt of options) {
    if (/^\d+$/.test(opt)) continue;
    const i = pips.findIndex((d) => d.color === opt && anyMana(d));
    if (i >= 0) {
      pips.splice(i, 1);
      return true;
    }
  }
  for (const opt of options) {
    if (!/^\d+$/.test(opt)) continue;
    const n = Number(opt);
    if (pips.filter(anyMana).length >= n) {
      let left = n;
      for (let i = pips.length - 1; i >= 0 && left; i--) {
        if (anyMana(pips[i])) {
          pips.splice(i, 1);
          left -= 1;
        }
      }
      return true;
    }
  }
  return false;
}

export function addMana(pool, color, n = 1, restrict = null) {
  const next = pool.slice();
  for (let i = 0; i < n; i++) next.push({ color, restrict });
  return next;
}

export function formatMana(str) {
  if (!str) return '';
  return str.replace(/\{([^}]+)\}/g, (_, s) => s.replace('/', '/'));
}

export function pipList(str) {
  const out = [];
  const re = /\{([^}]+)\}/g;
  let m;
  while ((m = re.exec(str || ''))) out.push(m[1]);
  return out;
}
