import test from 'node:test';
import assert from 'node:assert/strict';
import { addScheme } from '../scripts/install-wt-scheme.mjs';

test('addScheme inserta en array vacío, conserva comentarios y es idempotente', () => {
  const src = '{\n  // hola\n  "schemes": [],\n  "themes": []\n}';
  const r = addScheme(src);
  assert.ok(r.changed && r.text.includes('// hola'));
  const parsed = JSON.parse(r.text.replace('// hola', ''));
  assert.equal(parsed.schemes[0].name, 'HQ');
  assert.equal(addScheme(r.text).changed, false);
});

test('addScheme respeta esquemas existentes', () => {
  const r = addScheme('{"schemes": [{"name":"X"}]}');
  const p = JSON.parse(r.text);
  assert.deepEqual(p.schemes.map((s) => s.name), ['HQ', 'X']);
});
