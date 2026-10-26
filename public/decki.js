const app = document.querySelector('#app');
let decks = [];
let current = '';
let zoomCard = null;

function h(tag, attrs, kids) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  for (const kid of kids || []) {
    if (kid == null || kid === false) continue;
    node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

function pips(cost) {
  const wrap = h('span');
  for (const sym of String(cost || '').match(/\{[^}]+\}/g) || []) {
    const raw = sym.slice(1, -1);
    wrap.append(h('span', { class: `pip ${raw.length === 1 ? raw : 'C'}` }, raw));
  }
  return wrap;
}

function colorClass(card) {
  const colors = card.colors || [];
  if (colors.length > 1) return 'gold';
  return colors[0] || '';
}

function selectDeck(id) {
  if (id !== current) zoomCard = null;
  current = id;
  const next = `#${encodeURIComponent(id)}`;
  if (location.hash !== next) location.hash = next;
  render();
}

function openZoom(card) {
  zoomCard = card;
  render();
}

function closeZoom() {
  if (!zoomCard) return;
  zoomCard = null;
  render();
}

function flatCards() {
  const deck = decks.find((item) => item.id === current) || decks[0];
  if (!deck) return [];
  return deck.sections.flatMap((section) => section.cards);
}

function stepZoom(delta) {
  const cards = flatCards();
  if (!zoomCard || !cards.length) return;
  const index = cards.indexOf(zoomCard);
  const dir = delta < 0 ? -1 : 1;
  const next = index < 0
    ? (dir < 0 ? cards.length - 1 : 0)
    : (index + dir + cards.length) % cards.length;
  zoomCard = cards[next];
  render();
}

function cardTile(card) {
  const classes = ['card', 'deck-card', colorClass(card), card.missing ? 'missing' : ''].filter(Boolean).join(' ');
  const art = card.image
    ? h('img', { class: 'mini', src: card.image, alt: '' })
    : h('div', { class: 'deck-empty' }, card.missing ? 'Brak w katalogu' : 'Brak miniatury');
  return h('div', {
    class: classes,
    tabindex: '0',
    role: 'button',
    'aria-label': card.count > 1 ? `${card.name}, ${card.count}` : card.name,
    onclick: () => openZoom(card),
    onkeydown: (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openZoom(card);
      }
    },
    oncontextmenu: (event) => {
      event.preventDefault();
      openZoom(card);
    },
  }, [
    card.count > 1 ? h('span', { class: 'deck-qty' }, `×${card.count}`) : null,
    art,
    h('header', {}, [h('span', {}, card.name), pips(card.manaCost)]),
  ]);
}

function zoom() {
  if (!zoomCard) return null;
  const card = zoomCard;
  const front = card.imageLarge || card.image;
  const back = card.imageBackLarge || card.imageBack;
  const pictures = h('div', { class: 'zoom-art' }, [
    front ? h('img', { src: front, alt: '' }) : h('div', { class: 'zoom-art back' }, 'Brak miniatury'),
    back ? h('img', { class: 'second', src: back, alt: '' }) : null,
  ]);
  return h('div', {
    class: 'zoom',
    onclick: closeZoom,
    oncontextmenu: (event) => {
      event.preventDefault();
      closeZoom();
    },
  }, [
    pictures,
    h('div', { class: 'zoom-sheet', onclick: (event) => event.stopPropagation() }, [
      h('h2', {}, card.name),
      card.typeLine ? h('p', { class: 'zoom-type' }, card.typeLine) : null,
      card.oracle ? h('p', { class: 'zoom-oracle' }, card.oracle) : null,
      card.pt ? h('p', { class: 'zoom-pt' }, card.pt) : null,
      card.count > 1 ? h('p', { class: 'zoom-type' }, `W talii: ${card.count}`) : null,
      h('p', { class: 'zoom-type' }, 'Strzałki: poprzednia i następna karta. Esc zamyka.'),
    ]),
  ]);
}

function render() {
  const scrollY = window.scrollY;
  app.replaceChildren();
  const deck = decks.find((item) => item.id === current) || decks[0];
  if (deck) current = deck.id;
  app.append(h('div', { class: 'shell' }, [
    h('header', { class: 'titlebar' }, [
      h('strong', {}, 'Talie Commandera'),
      h('a', { href: './' }, 'Wróć do draftu'),
    ]),
    h('p', { class: 'deck-rank' }, [
      'Najsilniejsza zapisana talia: ',
      h('strong', {}, 'Volo, Guide to Monsters'),
      '. W 2500 partiach bez blokowania jeden przeciwnik ginie do tury 10 w 90% rozdań, mediana w turze 9. Szybciej dobijają Arabella i Trelasarra (mediana tury 8). Z podstawowych, które już masz, najmocniejsza jest Arabella.',
    ]),
    h('nav', { class: 'deck-nav', 'aria-label': 'Talie' }, decks.map((item) => h('button', {
      type: 'button',
      class: item.id === current ? 'on' : '',
      'aria-pressed': item.id === current ? 'true' : 'false',
      onclick: () => selectDeck(item.id),
    }, item.title))),
    deck ? h('section', {}, [
      h('h1', {}, deck.title),
      h('p', { class: 'sub' }, `${deck.total} kart`),
      deck.blurb ? h('p', { class: 'deck-blurb' }, deck.blurb) : null,
      ...deck.sections.map((section) => {
        const count = section.cards.reduce((sum, card) => sum + card.count, 0);
        return h('section', { class: 'deck-section' }, [
          h('h2', {}, `${section.title} (${count})`),
          h('div', { class: 'deck-grid' }, section.cards.map(cardTile)),
        ]);
      }),
      h('p', { class: 'note' }, 'Klik albo prawy przycisk otwiera powiększenie. Strzałki przechodzą do poprzedniej i następnej karty. Nazwa zostaje angielska, typ i tekst są przekładem do czytania. Tekst kart © Wizards of the Coast. Miniatury są lokalną kopią ze Scryfalla.'),
    ]) : h('p', { class: 'note' }, 'Nie ma talii w katalogu decki.'),
  ]));
  const layer = zoom();
  if (layer) app.append(layer);
  if (scrollY) window.scrollTo(0, scrollY);
}

async function boot() {
  app.append(h('p', { class: 'sub' }, 'Wczytuję talie…'));
  try {
    const response = await fetch('api/decks');
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Nie udało się wczytać talii.');
    decks = body.decks || [];
    const wanted = decodeURIComponent(location.hash.replace(/^#/, ''));
    current = decks.some((deck) => deck.id === wanted) ? wanted : (decks[0]?.id || '');
    render();
  } catch (err) {
    app.replaceChildren(h('p', { class: 'note' }, err.message || 'Nie udało się wczytać talii.'));
  }
}

window.addEventListener('hashchange', () => {
  const wanted = decodeURIComponent(location.hash.replace(/^#/, ''));
  if (!decks.some((deck) => deck.id === wanted) || wanted === current) return;
  current = wanted;
  zoomCard = null;
  render();
});

window.addEventListener('keydown', (event) => {
  const tag = event.target?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || event.target?.isContentEditable) return;
  if (event.key === 'Escape') {
    closeZoom();
    return;
  }
  if (!zoomCard) return;
  const dir = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1
    : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1
    : 0;
  if (!dir) return;
  event.preventDefault();
  stepZoom(dir);
});

boot();
