import { test } from 'node:test';
import assert from 'node:assert/strict';
import { polishCard, polishOracle, polishTypeLine } from '../src/pltext.js';

test('przekład karty zostawia nazwę i tłumaczy typ oraz typowe zdanie', () => {
  const card = polishCard({
    name: 'Academic Dispute',
    typeLine: 'Instant',
    oracle: 'Target creature gets +1/+1 until end of turn.\nDraw a card.',
  });
  assert.equal(card.name, 'Academic Dispute');
  assert.equal(card.typeLine, 'Instant');
  assert.match(card.oracle, /Wybrane stworzenie dostaje \+1\/\+1 do końca tury/);
  assert.match(card.oracle, /Dobierz kartę/);
  assert.equal(polishTypeLine('Legendary Creature — Human Wizard'), 'Legendarne Stworzenie — Człowiek Czarodziej');
  assert.equal(polishOracle('Flying'), 'Latanie');
  assert.equal(polishOracle('{T}: Add {G}.'), '{T}: Dodaj {G}.');
});
