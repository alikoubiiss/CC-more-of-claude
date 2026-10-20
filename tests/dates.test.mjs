import test from 'node:test';
import assert from 'node:assert/strict';
import { hm, hms, ymd } from '../lib/dates.mjs';

test('ymd, hm y hms formatean con ceros a la izquierda', () => {
  const d = new Date(2026, 0, 5, 3, 4, 9);
  assert.equal(ymd(d), '2026-01-05');
  assert.equal(hm(d), '03:04');
  assert.equal(hms(d), '030409');
});
