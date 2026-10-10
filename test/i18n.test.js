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
  assert.equal(t('Tura 3'), 'Turn 3');
  setLang('pl');
  assert.equal(t('Pas'), 'Pas');
  assert.equal(t('Komputer pomija krok dobierania w pierwszej turze.'), 'Komputer pomija krok dobierania w pierwszej turze.');
  assert.equal(getLang(), 'pl');
});
