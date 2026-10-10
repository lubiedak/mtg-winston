/**
 * Przekład do czytania. AFR, STX i DSK nie mają polskiego druku w Scryfallu.
 * Nazwa zostaje angielska. Typ i tekst są słownikiem, nie tekstem z karty.
 * Silnik dalej czyta angielski oracle.
 */

const NOUN = {
  Creature: { pl: 'Stworzenie', g: 'n' },
  Artifact: { pl: 'Artefakt', g: 'm' },
  Enchantment: { pl: 'Urok', g: 'm' },
  Land: { pl: 'Ląd', g: 'm' },
  Battle: { pl: 'Bitwa', g: 'f' },
  Instant: { pl: 'Instant', g: 'm' },
  Sorcery: { pl: 'Sorcery', g: 'n' },
  Planeswalker: { pl: 'Planeswalker', g: 'm' },
};

const WORD = {
  Room: 'Pokój',
  Lesson: 'Lekcja',
  Saga: 'Saga',
  Equipment: 'Wyposażenie',
  Aura: 'Aura',
  Vehicle: 'Pojazd',
  Treasure: 'Skarb',
  Food: 'Jedzenie',
  Clue: 'Wskazówka',
  Blood: 'Krew',
  Powerstone: 'Kamień mocy',
  Class: 'Klasa',
  Token: 'Żeton',
  World: 'Świat',
  Human: 'Człowiek',
  Wizard: 'Czarodziej',
  Warrior: 'Wojownik',
  Soldier: 'Żołnierz',
  Knight: 'Rycerz',
  Cleric: 'Kleryk',
  Rogue: 'Łotrzyk',
  Shaman: 'Szaman',
  Druid: 'Druid',
  Warlock: 'Czarnoksiężnik',
  Bard: 'Bard',
  Monk: 'Mnich',
  Ranger: 'Łowca',
  Barbarian: 'Barbarzyńca',
  Sorcerer: 'Czarownik',
  Advisor: 'Doradca',
  Student: 'Student',
  Teacher: 'Nauczyciel',
  Spirit: 'Duch',
  Zombie: 'Zombie',
  Vampire: 'Wampir',
  Elf: 'Elf',
  Goblin: 'Goblin',
  Dragon: 'Smok',
  Beast: 'Bestia',
  Bird: 'Ptak',
  Cat: 'Kot',
  Dog: 'Pies',
  Elemental: 'Żywiołak',
  Wall: 'Mur',
  Insect: 'Owad',
  Spider: 'Pająk',
  Snake: 'Wąż',
  Rat: 'Szczur',
  Skeleton: 'Szkielet',
  Angel: 'Anioł',
  Demon: 'Demon',
  Devil: 'Diabeł',
  Giant: 'Gigant',
  Ooze: 'Szlam',
  Plant: 'Roślina',
  Treefolk: 'Drzewiec',
  Construct: 'Konstrukt',
  Illusion: 'Iluzja',
  Sphinx: 'Sfinks',
  Hydra: 'Hydra',
  Dinosaur: 'Dinozaur',
  Pirate: 'Pirat',
  Scout: 'Zwiadowca',
  Horror: 'Horror',
  Nightmare: 'Koszmar',
  Golem: 'Golem',
  Eye: 'Oko',
  Bat: 'Nietoperz',
  Frog: 'Żaba',
  Lizard: 'Jaszczurka',
};

const KW = {
  flying: 'latanie',
  trample: 'deptanie',
  haste: 'pośpiech',
  vigilance: 'czujność',
  lifelink: 'łącznik życia',
  deathtouch: 'zabójczy dotyk',
  menace: 'groza',
  indestructible: 'niezniszczalność',
  hexproof: 'ochrona przed czarami',
  reach: 'zasięg',
  'first strike': 'pierwszy cios',
  'double strike': 'podwójny cios',
  flash: 'błysk',
  defender: 'obrońca',
  prowess: 'biegłość',
  skulk: 'skradanie',
  toxic: 'toksyczność',
  ward: 'osłona',
};

const NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };

function count(word) {
  const key = String(word || '').toLowerCase();
  if (NUM[key] != null) return NUM[key];
  const n = Number(key);
  return Number.isFinite(n) ? n : 1;
}

function cards(n) {
  if (n === 1) return 'kartę';
  const teen = n % 100;
  if (teen >= 12 && teen <= 14) return `${n} kart`;
  const last = n % 10;
  if (last >= 2 && last <= 4) return `${n} karty`;
  return `${n} kart`;
}

function life(n) {
  if (n === 1) return '1 życie';
  const teen = n % 100;
  if (teen >= 12 && teen <= 14) return `${n} żyć`;
  const last = n % 10;
  if (last >= 2 && last <= 4) return `${n} życia`;
  return `${n} żyć`;
}

function agree(kind, gender) {
  if (kind === 'Legendary') return gender === 'f' ? 'Legendarna' : gender === 'n' ? 'Legendarne' : 'Legendarny';
  if (kind === 'Basic') return gender === 'f' ? 'Podstawowa' : gender === 'n' ? 'Podstawowe' : 'Podstawowy';
  if (kind === 'Snow') return gender === 'f' ? 'Śnieżna' : gender === 'n' ? 'Śnieżne' : 'Śnieżny';
  return kind;
}

export function polishTypeLine(line) {
  if (!line) return '';
  const [left, right] = String(line).split(' — ');
  const words = left.split(/\s+/).filter(Boolean);
  const noun = [...words].reverse().map((word) => NOUN[word]).find(Boolean);
  const gender = noun?.g || 'm';
  const leftPl = words.map((word) => {
    if (word === 'Legendary' || word === 'Basic' || word === 'Snow') return agree(word, gender);
    if (NOUN[word]) return NOUN[word].pl;
    return WORD[word] || word;
  }).join(' ');
  if (!right) return leftPl;
  const rightPl = right.split(/\s+/).map((word) => WORD[word] || NOUN[word]?.pl || word).join(' ');
  return `${leftPl} — ${rightPl}`;
}

function kwList(text) {
  return text.split(/,| and /i).map((part) => part.trim()).filter(Boolean);
}

function polishKeywords(text) {
  const parts = kwList(text);
  if (!parts.length || parts.some((part) => !KW[part.toLowerCase()])) return null;
  return parts.map((part) => KW[part.toLowerCase()]).join(', ');
}

function cap(text) {
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function polishSentence(line) {
  const c = line.trim().replace(/\.$/, '');
  let m;
  if ((m = c.match(/^(?:you )?draw (a|an|one|two|three|four|five|six|seven|\d+) cards?$/i))) {
    const n = count(m[1]);
    return n === 1 ? 'Dobierz kartę.' : `Dobierz ${cards(n)}.`;
  }
  if ((m = c.match(/^each player draws (a|an|one|two|three|\d+) cards?$/i))) {
    const n = count(m[1]);
    return n === 1 ? 'Każdy gracz dobiera kartę.' : `Każdy gracz dobiera ${cards(n)}.`;
  }
  if ((m = c.match(/^target player draws (a|an|one|two|three|\d+) cards?$/i))) {
    const n = count(m[1]);
    return n === 1 ? 'Wybrany gracz dobiera kartę.' : `Wybrany gracz dobiera ${cards(n)}.`;
  }
  if ((m = c.match(/^you gain (\d+|a|an|one|two|three|four|five|six|seven) life$/i))) {
    return `Zyskujesz ${life(count(m[1]))}.`;
  }
  if ((m = c.match(/^you lose (\d+) life$/i))) return `Tracisz ${life(Number(m[1]))}.`;
  if ((m = c.match(/^each opponent loses (\d+) life$/i))) return `Każdy przeciwnik traci ${life(Number(m[1]))}.`;
  if ((m = c.match(/^(?:THIS|it) deals (\d+) damage to (any target|target creature or planeswalker|target creature|target player|target opponent|target planeswalker)$/i))) {
    const who = {
      'any target': 'dowolnemu celowi',
      'target creature or planeswalker': 'wybranemu stworzeniu albo planeswalkerowi',
      'target creature': 'wybranemu stworzeniu',
      'target player': 'wybranemu graczowi',
      'target opponent': 'wybranemu przeciwnikowi',
      'target planeswalker': 'wybranemu planeswalkerowi',
    }[m[2].toLowerCase()];
    return `Zadaje ${m[1]} obrażeń ${who}.`;
  }
  if ((m = c.match(/^deal (\d+) damage to (any target|target creature or planeswalker|target creature|target player|target opponent)$/i))) {
    const who = {
      'any target': 'dowolnemu celowi',
      'target creature or planeswalker': 'wybranemu stworzeniu albo planeswalkerowi',
      'target creature': 'wybranemu stworzeniu',
      'target player': 'wybranemu graczowi',
      'target opponent': 'wybranemu przeciwnikowi',
    }[m[2].toLowerCase()];
    return `Zadaj ${m[1]} obrażeń ${who}.`;
  }
  if ((m = c.match(/^target creature(?: you control)? gets ([+-]\d+)\/([+-]\d+) until end of turn$/i))) {
    return `Wybrane stworzenie dostaje ${m[1]}/${m[2]} do końca tury.`;
  }
  if ((m = c.match(/^creatures you control get ([+-]\d+)\/([+-]\d+) until end of turn$/i))) {
    return `Stworzenia pod twoją kontrolą dostają ${m[1]}/${m[2]} do końca tury.`;
  }
  if ((m = c.match(/^target creature gets ([+-]\d+)\/([+-]\d+) and gains ([a-z ]+?) until end of turn$/i))) {
    const kws = polishKeywords(m[3]);
    return `Wybrane stworzenie dostaje ${m[1]}/${m[2]} i zyskuje ${kws || m[3]} do końca tury.`;
  }
  if (/^destroy all creatures$/i.test(c)) return 'Zniszcz wszystkie stworzenia.';
  if ((m = c.match(/^destroy target (.+)$/i))) return `Zniszcz wybrane: ${phrase(m[1])}.`;
  if ((m = c.match(/^exile target (.+)$/i))) return `Wygnaj wybrane: ${phrase(m[1])}.`;
  if ((m = c.match(/^scry (\d+)$/i))) return `Scry ${m[1]}.`;
  if ((m = c.match(/^surveil (\d+)$/i))) return `Surveil ${m[1]}.`;
  if (/^learn$/i.test(c)) return 'Learn.';
  if (/^manifest dread$/i.test(c)) return 'Manifest dread.';
  if (/^venture into the dungeon$/i.test(c)) return 'Wejdź do lochu.';
  if (/^you may discard a card\. if you do, draw a card$/i.test(c)) {
    return 'Możesz odrzucić kartę. Jeśli to zrobisz, dobierz kartę.';
  }
  if (/^discard a card$/i.test(c)) return 'Odrzuć kartę.';
  if (/^search your library for a basic land card, put it onto the battlefield tapped, then shuffle$/i.test(c)) {
    return 'Przeszukaj swoją talię za podstawowym lądem, połóż go na pole bitwy przekręcony i przetasuj.';
  }
  if (/^search your library for a basic land card, reveal it, put it into your hand, then shuffle$/i.test(c)) {
    return 'Przeszukaj swoją talię za podstawowym lądem, odkryj go, weź do ręki i przetasuj.';
  }
  if (/^this enters tapped$/i.test(c)) return 'Wchodzi na pole bitwy przekręcony.';
  if (/^you win the game$/i.test(c)) return 'Wygrywasz grę.';
  if (/^gain control of target creature until end of turn$/i.test(c)) {
    return 'Przejmij kontrolę nad wybranym stworzeniem do końca tury.';
  }
  if ((m = c.match(/^\{T\}: Add (\{[^}]+\})\.?$/i))) return `{T}: Dodaj ${m[1]}.`;
  if (/^\{T\}: Add one mana of any color\.?$/i.test(c)) return '{T}: Dodaj jedną manę dowolnego koloru.';
  if ((m = c.match(/^Ward (\{[^}]+\})/i))) return `Osłona ${m[1]}.`;
  return null;
}

const PHRASES = [
  [/until end of turn/gi, 'do końca tury'],
  [/until your next turn/gi, 'do twojej następnej tury'],
  [/enters the battlefield tapped/gi, 'wchodzi na pole bitwy przekręcony'],
  [/enter the battlefield tapped/gi, 'wchodzą na pole bitwy przekręcone'],
  [/enters the battlefield/gi, 'wchodzi na pole bitwy'],
  [/enter the battlefield/gi, 'wchodzą na pole bitwy'],
  [/at the beginning of your upkeep/gi, 'na początku twojego utrzymania'],
  [/at the beginning of combat/gi, 'na początku walki'],
  [/at the beginning of/gi, 'na początku'],
  [/target creature you control/gi, 'wybrane stworzenie pod twoją kontrolą'],
  [/target creature an opponent controls/gi, 'wybrane stworzenie pod kontrolą przeciwnika'],
  [/creatures you control/gi, 'stworzenia pod twoją kontrolą'],
  [/target creature/gi, 'wybrane stworzenie'],
  [/target player/gi, 'wybrany gracz'],
  [/target opponent/gi, 'wybrany przeciwnik'],
  [/each opponent/gi, 'każdy przeciwnik'],
  [/each player/gi, 'każdy gracz'],
  [/each creature/gi, 'każde stworzenie'],
  [/you don't control/gi, 'poza twoją kontrolą'],
  [/you control/gi, 'pod twoją kontrolą'],
  [/your graveyard/gi, 'twojego cmentarza'],
  [/your library/gi, 'twojej talii'],
  [/your hand/gi, 'twojej ręki'],
  [/the battlefield/gi, 'pole bitwy'],
  [/draw a card/gi, 'dobierz kartę'],
  [/draws a card/gi, 'dobiera kartę'],
  [/discard a card/gi, 'odrzuć kartę'],
  [/gain control of/gi, 'przejmij kontrolę nad'],
  [/search your library/gi, 'przeszukaj swoją talię'],
  [/then shuffle/gi, 'potem przetasuj'],
  [/you may/gi, 'możesz'],
  [/if you do/gi, 'jeśli to zrobisz'],
  [/any target/gi, 'dowolny cel'],
  [/can't be blocked/gi, 'nie może być zablokowane'],
  [/can't block/gi, 'nie może blokować'],
  [/can't attack/gi, 'nie może atakować'],
  [/this turn/gi, 'w tej turze'],
  [/deals (\d+) damage/gi, 'zadaje $1 obrażeń'],
  [/deal (\d+) damage/gi, 'zadaj $1 obrażeń'],
  [/\bWhenever\b/g, 'Zawsze gdy'],
  [/\bWhen\b/g, 'Kiedy'],
  [/\bgets\b/gi, 'dostaje'],
  [/\bgains\b/gi, 'zyskuje'],
  [/\bFlying\b/g, 'Latanie'],
  [/\bflying\b/g, 'latanie'],
  [/\bTrample\b/g, 'Deptanie'],
  [/\btrample\b/g, 'deptanie'],
  [/\bHaste\b/g, 'Pośpiech'],
  [/\bhaste\b/g, 'pośpiech'],
  [/\bVigilance\b/g, 'Czujność'],
  [/\bvigilance\b/g, 'czujność'],
  [/\bLifelink\b/g, 'Łącznik życia'],
  [/\blifelink\b/g, 'łącznik życia'],
  [/\bDeathtouch\b/g, 'Zabójczy dotyk'],
  [/\bdeathtouch\b/g, 'zabójczy dotyk'],
  [/\bMenace\b/g, 'Groza'],
  [/\bmenace\b/g, 'groza'],
  [/\bIndestructible\b/g, 'Niezniszczalność'],
  [/\bindestructible\b/g, 'niezniszczalność'],
  [/\bHexproof\b/g, 'Ochrona przed czarami'],
  [/\bhexproof\b/g, 'ochrona przed czarami'],
  [/\bReach\b/g, 'Zasięg'],
  [/\breach\b/g, 'zasięg'],
  [/\bFirst strike\b/g, 'Pierwszy cios'],
  [/\bfirst strike\b/g, 'pierwszy cios'],
  [/\bDouble strike\b/g, 'Podwójny cios'],
  [/\bdouble strike\b/g, 'podwójny cios'],
  [/\bFlash\b/g, 'Błysk'],
  [/\bflash\b/g, 'błysk'],
  [/\bDefender\b/g, 'Obrońca'],
  [/\bdefender\b/g, 'obrońca'],
];

function phrase(text) {
  let out = text;
  for (const [pattern, to] of PHRASES) out = out.replace(pattern, to);
  return out;
}

function polishLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return line;
  const ward = trimmed.match(/^Ward (\{[^}]+\})(?:\s+\([^)]*\))?\.?$/i);
  if (ward) return `Osłona ${ward[1]}.`;
  const bare = trimmed.replace(/\s*\([^)]*\)/g, '').trim();
  const onlyKw = polishKeywords(bare);
  if (onlyKw && bare === trimmed.replace(/\.$/, '')) return cap(onlyKw) + (trimmed.endsWith('.') ? '.' : '');
  const sentence = polishSentence(bare);
  if (sentence) return sentence;
  return phrase(trimmed);
}

export function polishOracle(text) {
  if (!text) return '';
  return String(text).split('\n').map(polishLine).join('\n');
}

export function polishCard(card) {
  return {
    name: card?.name || '',
    typeLine: polishTypeLine(card?.typeLine || card?.type_line || ''),
    oracle: polishOracle(card?.oracle || card?.text || ''),
  };
}
