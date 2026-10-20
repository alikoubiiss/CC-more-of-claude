import test from 'node:test';
import assert from 'node:assert/strict';
import { slugify, validateName } from '../lib/names.mjs';

test('slugify quita acentos, espacios y mayúsculas', () => {
  assert.equal(slugify('Bot de Telegram'), 'bot-de-telegram');
  assert.equal(slugify('Árduíno ñandú'), 'arduino-nandu');
  assert.equal(slugify('  --Mi_Proyecto!!  '), 'mi-proyecto');
});

test('validateName conserva el nombre original como display', () => {
  const v = validateName('  Bot de Telegram  ');
  assert.deepEqual(v, { ok: true, slug: 'bot-de-telegram', display: 'Bot de Telegram' });
});

test('validateName neutraliza intentos de path traversal', () => {
  const v = validateName('..\\..\\Windows');
  assert.equal(v.ok, true);
  assert.equal(v.slug, 'windows');
});

test('validateName rechaza vacío, solo símbolos, largo y reservados de Windows', () => {
  assert.equal(validateName('').ok, false);
  assert.equal(validateName(undefined).ok, false);
  assert.equal(validateName('!!!').ok, false);
  assert.equal(validateName('a'.repeat(41)).ok, false);
  for (const r of ['CON', 'nul', 'COM1', 'lpt9', 'project-hq']) {
    const v = validateName(r);
    assert.equal(v.ok, false, r);
    assert.match(v.error, /reservado/);
  }
});
