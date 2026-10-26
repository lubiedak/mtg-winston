import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getLang, setLang, t } from '../src/i18n.js';

test('angielski tłumaczy zdania silnika i wraca do polskiego', () => {
  setLang('en');
  assert.equal(getLang(), 'en');
  assert.equal(
    t('Komputer pomija krok dobierania w pierwszej turze.'),
    'Computer skips the draw step on the first turn.',
  );
  assert.equal(t('Pas'), 'Pass');
  assert.equal(t('Decyzja komputera'), "The computer's decision");
  assert.equal(t('Tura 3'), 'Turn 3');
  assert.equal(t('mityczna'), 'mythic');
  assert.equal(
    t('Z 90 kart: pospolita 47, niepospolita 28, rzadka 9, mityczna 6.'),
    'Of 90 cards: common 47, uncommon 28, rare 9, mythic 6.',
  );
  assert.equal(
    t('Proporcje rzadkości: proszono pospolita 0, niepospolita 0, rzadka 45, mityczna 45. W dodatku wyszło pospolita 5, niepospolita 20, rzadka 45, mityczna 20.'),
    'Rarity mix: asked common 0, uncommon 0, rare 45, mythic 45. This set came out common 5, uncommon 20, rare 45, mythic 20.',
  );
  setLang('pl');
  assert.equal(t('Pas'), 'Pas');
  assert.equal(t('Komputer pomija krok dobierania w pierwszej turze.'), 'Komputer pomija krok dobierania w pierwszej turze.');
  assert.equal(getLang(), 'pl');
});
