import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runVaultCli } from '../scripts/vault-cli.mjs';
import { createProjectIndex } from '../lib/vault.mjs';
import { makeCfg, tmpDir } from './helpers.mjs';

const reg = (root) => ({ projects: [{ slug: 'demo', display: 'Demo', path: path.join(root, 'mis proyectos', 'demo'), port: 6430 }] });

test('session escribe una nota manual con el resumen', () => {
  const root = tmpDir();
  const cfg = makeCfg(root);
  const r = runVaultCli({ sub: 'session', payload: { summary: 'Hecho el parser' }, cfg, reg: reg(root), cwd: path.join(root, 'mis proyectos', 'demo'), now: new Date(2026, 9, 8, 15, 42, 0) });
  assert.equal(r.written, true);
  assert.match(path.basename(r.path), /^2026-10-08-manual-154200\.md$/);
  assert.match(readFileSync(r.path, 'utf8'), /Hecho el parser/);
});

test('decision escribe la nota en Decisiones/', () => {
  const root = tmpDir();
  const cfg = makeCfg(root);
  const r = runVaultCli({ sub: 'decision', payload: { title: 'Usar SQLite', context: 'c', decision: 'd', why: 'w' }, cfg, reg: reg(root), cwd: path.join(root, 'mis proyectos', 'demo') });
  assert.match(r.path, /Decisiones/);
});

test('errores claros: fuera de proyecto, subcomando desconocido, resumen vacío', () => {
  const root = tmpDir();
  const cfg = makeCfg(root);
  assert.throws(() => runVaultCli({ sub: 'session', payload: { summary: 'x' }, cfg, reg: reg(root), cwd: root }), /proyecto registrado/);
  assert.throws(() => runVaultCli({ sub: 'raro', payload: {}, cfg, reg: reg(root), cwd: path.join(root, 'mis proyectos', 'demo') }), /desconocido/);
  assert.throws(() => runVaultCli({ sub: 'session', payload: { summary: '  ' }, cfg, reg: reg(root), cwd: path.join(root, 'mis proyectos', 'demo') }), /summary/);
});

test('estado actualiza el estado de la nota índice del proyecto', () => {
  const root = tmpDir();
  const cfg = makeCfg(root);
  const cwd = path.join(root, 'mis proyectos', 'demo');
  createProjectIndex(cfg, { slug: 'demo', display: 'Demo', path: cwd, port: 6430, notebookId: 'nb1' });
  const r = runVaultCli({ sub: 'estado', payload: { estado: 'en-curso' }, cfg, reg: reg(root), cwd });
  assert.equal(r.written, true);
  assert.match(readFileSync(r.path, 'utf8'), /^estado: en-curso$/m);
});

test('subcomando desconocido se informa aunque estemos fuera de un proyecto', () => {
  const root = tmpDir();
  const cfg = makeCfg(root);
  assert.throws(() => runVaultCli({ sub: 'raro', payload: {}, cfg, reg: reg(root), cwd: root }), /Subcomando desconocido: raro/);
});

test('session usa los valores por defecto cuando activeTask o changes vienen vacíos', () => {
  const root = tmpDir();
  const cfg = makeCfg(root);
  const r = runVaultCli({ sub: 'session', payload: { summary: 'x', activeTask: '   ', changes: '' }, cfg, reg: reg(root), cwd: path.join(root, 'mis proyectos', 'demo'), now: new Date(2026, 9, 8, 9, 5, 7) });
  const text = readFileSync(r.path, 'utf8');
  assert.match(path.basename(r.path), /^2026-10-08-manual-090507\.md$/);
  assert.match(text, /ninguna/);
  assert.match(text, /n\/d/);
});
