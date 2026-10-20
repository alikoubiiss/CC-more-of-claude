import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { snapshotSession, DEBOUNCE_MS } from '../lib/snapshot.mjs';
import { projectDir } from '../lib/vault.mjs';
import { fakeRunner, makeCfg, tmpDir } from './helpers.mjs';

function setup() {
  const root = tmpDir();
  const cfg = makeCfg(root);
  const repo = path.join(root, 'mis proyectos', 'demo');
  mkdirSync(repo, { recursive: true });
  const reg = { projects: [{ slug: 'demo', display: 'Demo', path: repo, port: 6430 }] };
  return { root, cfg, repo, reg };
}

test('escribe una nota de sesión con el resumen de cambios de git', () => {
  const { root, cfg, repo, reg } = setup();
  const r = snapshotSession({ cfg, reg, input: { cwd: repo, session_id: 'abcdef123456' }, run: fakeRunner(), stateDir: root, now: new Date(2026, 9, 8, 15, 0) });
  assert.equal(r.written, true);
  const dir = path.join(projectDir(cfg, 'demo'), 'Sesiones');
  const text = readFileSync(path.join(dir, readdirSync(dir)[0]), 'utf8');
  assert.match(text, /2 files changed/);
  assert.match(text, /sesion: abcdef12/);
});

test('debounce: una segunda llamada dentro de 10 min no escribe, salvo con force', () => {
  const { root, cfg, repo, reg } = setup();
  const args = { cfg, reg, input: { cwd: repo, session_id: 'abcdef123456' }, run: fakeRunner(), stateDir: root };
  const t0 = new Date(2026, 9, 8, 15, 0);
  assert.equal(snapshotSession({ ...args, now: t0 }).written, true);
  const soon = new Date(t0.getTime() + DEBOUNCE_MS - 1000);
  assert.deepEqual(snapshotSession({ ...args, now: soon }), { written: false, reason: 'debounce' });
  assert.equal(snapshotSession({ ...args, now: soon, force: true }).written, true);
  const later = new Date(t0.getTime() + DEBOUNCE_MS + 5000);
  assert.equal(snapshotSession({ ...args, now: later }).written, true);
});

test('fuera de un proyecto no escribe', () => {
  const { root, cfg, reg } = setup();
  assert.deepEqual(snapshotSession({ cfg, reg, input: { cwd: root }, run: fakeRunner(), stateDir: root }), { written: false, reason: 'sin-proyecto' });
});

test('un session_id con caracteres peligrosos se sanea', () => {
  const { root, cfg, repo, reg } = setup();
  const r = snapshotSession({ cfg, reg, input: { cwd: repo, session_id: '../../x' }, run: fakeRunner(), stateDir: root });
  assert.equal(r.written, true);
  assert.ok(r.path.startsWith(projectDir(cfg, 'demo')));
});
