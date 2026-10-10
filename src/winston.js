/**
 * Winston Draft dla dwóch osób.
 *
 * Zasady (Garfield / opis turniejowy i zgodne relacje Draftsim, MTG Wiki JP, BGG):
 * - talia główna zakryta, trzy kupki startują od jednej karty
 * - gracz ogląda kupki od pierwszej; bierze całą albo dokłada zakrytą kartę i idzie dalej
 * - po odrzuceniu trzeciej dokłada do niej kartę i bierze w ciemno wierzch talii
 * - gdy na koniec brakuje kart, nie da się jednocześnie dołożyć i wziąć w ciemno:
 *   jedna karta na talii idzie jako wzięcie w ciemno, pusta talia zmusza do wzięcia ostatniej kupki
 * - dobieranie kończy się, gdy nie zostało nic ani na talii, ani na kupkach
 */

function existingIndexes(draft) {
  return [0, 1, 2].filter((i) => draft.piles[i] && draft.piles[i].length);
}

function remember(draft, player, ids) {
  for (const id of ids) {
    if (!draft.seen[id]) draft.seen[id] = [];
    if (!draft.seen[id].includes(player)) draft.seen[id].push(player);
  }
}

function nextPlayer(player) {
  return player === 'human' ? 'ai' : 'human';
}

function finishIfEmpty(draft) {
  const anyPile = existingIndexes(draft).length > 0;
  if (!anyPile && draft.main.length === 0) {
    draft.done = true;
    draft.looking = null;
    draft.log.push('Wszystkie karty zostały wydraftowane.');
  }
}

function beginLook(draft) {
  if (draft.done) return;
  const indexes = existingIndexes(draft);
  if (!indexes.length) {
    if (!draft.main.length) {
      finishIfEmpty(draft);
      return;
    }
    const blind = draft.main.shift();
    draft.pools[draft.active].push(blind);
    remember(draft, draft.active, [blind]);
    draft.log.push(`${label(draft.active)} bierze ostatnią kartę z talii głównej.`);
    draft.active = nextPlayer(draft.active);
    draft.turn += 1;
    finishIfEmpty(draft);
    if (!draft.done) beginLook(draft);
    return;
  }
  draft.looking = indexes[0];
  remember(draft, draft.active, draft.piles[draft.looking]);
}

function label(player) {
  return player === 'human' ? 'Ty' : 'Komputer';
}

export function createDraft(cardIds, first, rng) {
  const main = cardIds.slice();
  for (let i = main.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [main[i], main[j]] = [main[j], main[i]];
  }
  const piles = [null, null, null];
  for (let i = 0; i < 3 && main.length; i++) piles[i] = [main.shift()];
  const draft = {
    main,
    piles,
    active: first,
    looking: 0,
    pools: { human: [], ai: [] },
    seen: {},
    log: ['Kostka została potasowana. Trzy kupki leżą na stole.'],
    done: false,
    turn: 1,
    first,
  };
  beginLook(draft);
  return draft;
}

function endTurn(draft) {
  draft.active = nextPlayer(draft.active);
  draft.turn += 1;
  finishIfEmpty(draft);
  if (!draft.done) beginLook(draft);
}

function takePile(draft, index) {
  const cards = draft.piles[index] || [];
  draft.pools[draft.active].push(...cards);
  draft.log.push(`${label(draft.active)} bierze kupkę ${index + 1} (${cards.length}).`);
  if (draft.main.length) {
    draft.piles[index] = [draft.main.shift()];
  } else {
    draft.piles[index] = null;
    draft.log.push(`Kupka ${index + 1} znika — nie ma czym jej uzupełnić.`);
  }
  endTurn(draft);
}

export function applyDraft(draft, action) {
  if (draft.done) return { ok: false, error: 'Draft się skończył.' };
  if (action !== 'take' && action !== 'pass') return { ok: false, error: 'Nieznana decyzja.' };
  const indexes = existingIndexes(draft);
  if (!indexes.length) return { ok: false, error: 'Nie ma kupek.' };
  const index = draft.looking;
  if (!draft.piles[index]) return { ok: false, error: 'Ta kupka jest pusta.' };
  if (action === 'take') {
    takePile(draft, index);
    return { ok: true };
  }
  const last = indexes[indexes.length - 1];
  if (index !== last) {
    if (draft.main.length) {
      const added = draft.main.shift();
      draft.piles[index].push(added);
      draft.log.push(`${label(draft.active)} pasuje kupkę ${index + 1} i dokłada zakrytą kartę.`);
    } else {
      draft.log.push(`${label(draft.active)} pasuje kupkę ${index + 1}. Talia główna jest pusta.`);
    }
    const next = indexes.find((i) => i > index);
    draft.looking = next;
    remember(draft, draft.active, draft.piles[next]);
    return { ok: true };
  }
  if (draft.main.length >= 2) {
    draft.piles[index].push(draft.main.shift());
    const blind = draft.main.shift();
    draft.pools[draft.active].push(blind);
    remember(draft, draft.active, [blind]);
    draft.log.push(`${label(draft.active)} odrzuca ostatnią kupkę, dokłada do niej kartę i bierze w ciemno wierzch talii.`);
    endTurn(draft);
    return { ok: true };
  }
  if (draft.main.length === 1) {
    const blind = draft.main.shift();
    draft.pools[draft.active].push(blind);
    remember(draft, draft.active, [blind]);
    draft.log.push(`${label(draft.active)} bierze ostatnią kartę talii głównej zamiast dokładać ją do kupki.`);
    endTurn(draft);
    return { ok: true };
  }
  draft.log.push(`${label(draft.active)} musi wziąć ostatnią kupkę.`);
  takePile(draft, index);
  return { ok: true };
}

export function pileKnown(draft, viewer, index) {
  const cards = draft.piles[index] || [];
  return cards.map((id) => ({
    id,
    known: draft.active === viewer && draft.looking === index ? true : (draft.seen[id] || []).includes(viewer),
  }));
}

export function knownInPool(draft, owner, viewer) {
  return draft.pools[owner].filter((id) => (draft.seen[id] || []).includes(viewer) || owner === viewer);
}
