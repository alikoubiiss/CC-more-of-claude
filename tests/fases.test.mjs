import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadFases, saveFases, setFases, derivePhases, activePhase, approvePhase, projectPhases, fasesFile } from '../lib/fases.mjs';
import { tmpDir, writeTask, writeMilestone } from './helpers.mjs';

function repoConFases() {
  const repo = tmpDir();
  writeMilestone(repo, 'm-0', 'Diseño');
  writeMilestone(repo, 'm-1', 'Construcción');
  setFases(repo, ['Diseño', 'Construcción']);
  return repo;
}

test('loadFases: ausente → vacío; dañado o con forma errónea → error claro', () => {
  const repo = tmpDir();
  assert.deepEqual(loadFases(repo), { fases: [] });
  mkdirSync(path.join(repo, '.hq'), { recursive: true });
  writeFileSync(fasesFile(repo), '{oops');
  assert.throws(() => loadFases(repo), /dañado/);
  writeFileSync(fasesFile(repo), '{"foo":1}');
  assert.throws(() => loadFases(repo), /dañado/);
});

test('saveFases es atómico: no deja el temporal', () => {
  const repo = tmpDir();
  saveFases(repo, { fases: [] });
  assert.equal(existsSync(`${fasesFile(repo)}.tmp`), false);
  assert.deepEqual(loadFases(repo), { fases: [] });
});

test('setFases valida cantidad, caracteres y repetidos', () => {
  const repo = tmpDir();
  assert.throws(() => setFases(repo, []), /entre 1 y 8/);
  assert.throws(() => setFases(repo, Array.from({ length: 9 }, (_, i) => `F${i}`)), /entre 1 y 8/);
  assert.throws(() => setFases(repo, ['Bien', 'mal"nombre']), /no válido/);
  assert.throws(() => setFases(repo, ['con\nsalto']), /no válido/);
  assert.throws(() => setFases(repo, ['A'.repeat(41)]), /no válido/);
  assert.throws(() => setFases(repo, ['Diseño', 'diseño']), /repetidos/);
});

test('setFases asigna ids y conserva las aprobaciones de las fases que siguen existiendo', () => {
  const repo = tmpDir();
  setFases(repo, ['A', 'B']);
  const data = loadFases(repo);
  data.fases[0].aprobada = '2026-10-08';
  saveFases(repo, data);
  const nuevo = setFases(repo, ['A', 'C']);
  assert.deepEqual(nuevo.fases.map((f) => [f.id, f.nombre, f.aprobada]), [['f1', 'A', '2026-10-08'], ['f2', 'C', null]]);
});

test('derivePhases: primera fase esperando, siguiente pendiente; tarjetas sin hito se ignoran', () => {
  const repo = repoConFases();
  writeTask(repo, 1, { status: 'Hecho', milestone: 'm-0' });
  writeTask(repo, 2, { status: 'hecho', milestone: 'm-0' });
  writeTask(repo, 3, { status: 'Planificado', milestone: 'm-1' });
  writeTask(repo, 4, { status: 'En curso' }); // sin hito
  const d = projectPhases(repo);
  assert.deepEqual(d.map((f) => [f.estado, f.hechas, f.total]), [['esperando', 2, 2], ['pendiente', 0, 1]]);
  assert.equal(activePhase(d).id, 'f1');
});

test('derivePhases: una fase en marcha está activa; sin tarjetas también', () => {
  const repo = repoConFases();
  writeTask(repo, 1, { status: 'Hecho', milestone: 'm-0' });
  writeTask(repo, 2, { status: 'En curso', milestone: 'm-0' });
  assert.equal(projectPhases(repo)[0].estado, 'activa');
  const vacio = tmpDir();
  setFases(vacio, ['Solo']);
  assert.equal(projectPhases(vacio)[0].estado, 'activa');
});

test('el hito puede referenciarse por título además de por id', () => {
  const repo = repoConFases();
  writeTask(repo, 1, { status: 'Hecho', milestone: 'Diseño' });
  assert.deepEqual(projectPhases(repo)[0].estado, 'esperando');
});

test('approvePhase: solo si está esperando; luego se activa la siguiente', () => {
  const repo = repoConFases();
  writeTask(repo, 1, { status: 'Hecho', milestone: 'm-0' });
  writeTask(repo, 2, { status: 'Planificado', milestone: 'm-1' });
  const r = approvePhase(repo, 'f1', '2026-10-08');
  assert.equal(r.estado, 'aprobada');
  assert.deepEqual(projectPhases(repo).map((f) => f.estado), ['aprobada', 'activa']);
  assert.throws(() => approvePhase(repo, 'f2', '2026-10-09'), /no está lista \(0\/1/);
  assert.equal(approvePhase(repo, 'f2', '2026-10-09', { force: true }).estado, 'aprobada');
  assert.throws(() => approvePhase(repo, 'f1', '2026-10-09'), /ya está aprobada/);
  assert.throws(() => approvePhase(repo, 'f9', '2026-10-09'), /no existe la fase/);
});

test('una fase aprobada sigue aprobada aunque se reabran sus tarjetas', () => {
  const repo = repoConFases();
  writeTask(repo, 1, { status: 'Hecho', milestone: 'm-0' });
  approvePhase(repo, 'f1', '2026-10-08');
  writeTask(repo, 1, { status: 'En curso', milestone: 'm-0' });
  assert.equal(projectPhases(repo)[0].estado, 'aprobada');
});

test('setFases acepta acentos y espacios; rechaza no-strings, guiones/puntos iniciales, punto final y control', () => {
  const repo = tmpDir();
  assert.doesNotThrow(() => setFases(repo, ['Diseño']));
  assert.doesNotThrow(() => setFases(repo, ['Construcción y despliegue']));
  for (const mal of [5, null, {}, ['a'], '-x', '.oculta', 'fin.', 'con\u0000nul', 'con\u007fdel']) {
    assert.throws(() => setFases(repo, [mal]), /nombre no válido/, JSON.stringify(mal));
  }
});
