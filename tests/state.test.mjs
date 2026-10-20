import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseFrontmatter, activeTasks, reviewTasks, buildSessionContext, projectPaths, tarjetaActual } from '../lib/state.mjs';
import { addDecision, createProjectIndex, writeSession } from '../lib/vault.mjs';
import { setFases } from '../lib/fases.mjs';
import { makeCfg, tmpDir, writeTask, writeMilestone } from './helpers.mjs';

function setup() {
  const root = tmpDir();
  const cfg = makeCfg(root);
  const repo = path.join(root, 'mis proyectos', 'demo');
  mkdirSync(path.join(repo, 'backlog', 'tasks'), { recursive: true });
  const project = { slug: 'demo', display: 'Demo', path: repo, port: 6430, notebookId: 'nb' };
  createProjectIndex(cfg, project);
  return { cfg, repo, reg: { projects: [project] } };
}

test('parseFrontmatter lee claves, quita comillas y tolera CRLF y BOM', () => {
  const { data, body } = parseFrontmatter('﻿---\r\nid: task-1\r\ntitle: "Hola mundo"\r\n---\r\ncuerpo');
  assert.deepEqual(data, { id: 'task-1', title: 'Hola mundo' });
  assert.equal(body, 'cuerpo');
  assert.deepEqual(parseFrontmatter('sin frontmatter').data, {});
});

test('activeTasks devuelve solo las tarjetas En curso (también con CRLF)', () => {
  const { repo } = setup();
  const t = path.join(repo, 'backlog', 'tasks');
  writeFileSync(path.join(t, 'task-1 - A.md'), '---\nid: task-1\ntitle: A\nstatus: En curso\n---\n');
  writeFileSync(path.join(t, 'task-2 - B.md'), '---\r\nid: task-2\r\ntitle: B\r\nstatus: En curso\r\n---\r\n');
  writeFileSync(path.join(t, 'task-3 - C.md'), '---\nid: task-3\ntitle: C\nstatus: Hecho\n---\n');
  assert.deepEqual(activeTasks(repo).map((x) => x.id).sort(), ['task-1', 'task-2']);
  assert.deepEqual(activeTasks(path.join(repo, 'no-existe')), []);
});

test('buildSessionContext: null fuera de proyecto; con proyecto incluye estado, tarjeta y decisiones', () => {
  const { cfg, repo, reg } = setup();
  assert.equal(buildSessionContext(cfg, reg, path.join(repo, '..', 'otro')), null);
  writeFileSync(path.join(repo, 'backlog', 'tasks', 'task-1 - A.md'), '---\nid: task-1\ntitle: Parser\nstatus: En curso\n---\n');
  addDecision(cfg, 'demo', { title: 'Usar SQLite', context: 'c', decision: 'd', why: 'w' }, new Date(2026, 9, 1));
  const text = buildSessionContext(cfg, reg, path.join(repo, 'src'));
  assert.match(text, /\[Project HQ\] Demo \(demo\) · estado: idea/);
  assert.match(text, /Tarjeta activa: task-1 Parser/);
  assert.match(text, /2026-10-01 Usar SQLite/);
  assert.match(text, /cc board/);
  assert.doesNotMatch(text, /localhost/);
});

test('buildSessionContext nunca supera 1200 caracteres', () => {
  const { cfg, repo, reg } = setup();
  const long = 'x'.repeat(400);
  for (let i = 1; i <= 5; i++) {
    writeFileSync(path.join(repo, 'backlog', 'tasks', `task-${i}.md`), `---\nid: task-${i}\ntitle: ${long}\nstatus: En curso\n---\n`);
    addDecision(cfg, 'demo', { title: long + i, context: 'c', decision: 'd', why: 'w' }, new Date(2026, 9, i));
  }
  const text = buildSessionContext(cfg, reg, repo);
  assert.ok(text.length <= 1200, `longitud ${text.length}`);
});

test('projectPaths devuelve lastManual y lastAuto además de lastSession', () => {
  const { cfg, repo, reg } = setup();
  const p0 = projectPaths(cfg, reg, repo);
  assert.equal(p0.lastManual, null);
  assert.equal(p0.lastAuto, null);
  const m = writeSession(cfg, 'demo', { sessionId: 'manual-100000', activeTask: 'a', changes: 'c', summary: 's' }, new Date(2026, 9, 8));
  const a = writeSession(cfg, 'demo', { sessionId: 'abc12345', activeTask: 'a', changes: 'c', summary: 's' }, new Date(2026, 9, 8));
  utimesSync(m.path, new Date(2026, 9, 8, 10), new Date(2026, 9, 8, 10));
  utimesSync(a.path, new Date(2026, 9, 8, 11), new Date(2026, 9, 8, 11));
  const p = projectPaths(cfg, reg, repo);
  assert.equal(p.lastManual, m.path);
  assert.equal(p.lastAuto, a.path);
  assert.equal(p.lastSession, a.path);
});

test('buildSessionContext lista las tarjetas Verificando como "Por revisar"', () => {
  const { cfg, repo, reg } = setup();
  writeFileSync(path.join(repo, 'backlog', 'tasks', 'task-7 - V.md'), '---\nid: task-7\ntitle: Validar\nstatus: Verificando\n---\n');
  assert.deepEqual(reviewTasks(repo).map((t) => t.id), ['task-7']);
  assert.match(buildSessionContext(cfg, reg, repo), /Por revisar: task-7 Validar → \/revisar/);
});

test('una entrada ilegible (directorio x.md) no tumba el contexto', () => {
  const { cfg, repo, reg } = setup();
  const t = path.join(repo, 'backlog', 'tasks');
  mkdirSync(path.join(t, 'x.md'));
  writeFileSync(path.join(t, 'task-1.md'), '---\nid: task-1\ntitle: Ok\nstatus: En curso\n---\n');
  assert.deepEqual(activeTasks(repo).map((x) => x.id), ['task-1']);
  assert.deepEqual(reviewTasks(repo), []);
  assert.match(buildSessionContext(cfg, reg, repo), /Tarjeta activa: task-1 Ok/);
});

test('el tope de 1200 caracteres se mantiene con muchas tarjetas por revisar', () => {
  const { cfg, repo, reg } = setup();
  const long = 'y'.repeat(300);
  for (let i = 1; i <= 8; i++) {
    writeFileSync(path.join(repo, 'backlog', 'tasks', `task-${i}.md`), `---\nid: task-${i}\ntitle: ${long}\nstatus: Verificando\n---\n`);
  }
  assert.ok(buildSessionContext(cfg, reg, repo).length <= 1200);
});

test('sin tarjetas por revisar no aparece línea "Por revisar" ni "null"', () => {
  const { cfg, repo, reg } = setup();
  const text = buildSessionContext(cfg, reg, repo);
  assert.doesNotMatch(text, /Por revisar|null/);
});

test('el contexto incluye la fase activa y lo que espera tu visto bueno', () => {
  const { cfg, repo, reg } = setup();
  writeMilestone(repo, 'm-0', 'Diseño');
  writeTask(repo, 1, { title: 'Esquema', status: 'Hecho', milestone: 'm-0' });
  writeTask(repo, 2, { title: 'Prototipo', status: 'Verificando', milestone: 'm-0', labels: ['revisada'] });
  setFases(repo, ['Diseño']);
  const text = buildSessionContext(cfg, reg, repo);
  assert.match(text, /Fase activa: Diseño \(1\/2\)/);
  assert.match(text, /Esperando tu visto bueno: TASK-2 Prototipo/);
  assert.doesNotMatch(text, /Por revisar/);
});

test('con la fase completa el contexto pide tu aprobación', () => {
  const { cfg, repo, reg } = setup();
  writeMilestone(repo, 'm-0', 'Diseño');
  writeTask(repo, 1, { status: 'Hecho', milestone: 'm-0' });
  setFases(repo, ['Diseño']);
  assert.match(buildSessionContext(cfg, reg, repo), /Fase "Diseño" lista \(1\/1\): esperando tu aprobación en cc/);
});

test('Verificando sin etiqueta revisada sigue siendo Por revisar', () => {
  const { cfg, repo, reg } = setup();
  writeTask(repo, 1, { title: 'Algo', status: 'Verificando' });
  const text = buildSessionContext(cfg, reg, repo);
  assert.match(text, /Por revisar: TASK-1 Algo → \/revisar/);
  assert.doesNotMatch(text, /Esperando tu visto bueno/);
});

test('un fases.json dañado no rompe el contexto', () => {
  const { cfg, repo, reg } = setup();
  mkdirSync(path.join(repo, '.hq'), { recursive: true });
  writeFileSync(path.join(repo, '.hq', 'fases.json'), '{oops');
  const text = buildSessionContext(cfg, reg, repo);
  assert.match(text, /\[Project HQ\]/);
  assert.doesNotMatch(text, /Fase/);
});

test('el contexto apunta al índice de Conocimiento solo si existe', () => {
  const { cfg, repo, reg } = setup();
  const conocimientoPath = path.join(path.dirname(cfg.vaultPath), 'Conocimiento-prueba');
  assert.doesNotMatch(buildSessionContext({ ...cfg, conocimientoPath }, reg, repo), /Conocimiento/);
  assert.doesNotMatch(buildSessionContext(cfg, reg, repo), /Conocimiento/);
  mkdirSync(conocimientoPath, { recursive: true });
  writeFileSync(path.join(conocimientoPath, 'index.md'), '# Conocimiento\n');
  const text = buildSessionContext({ ...cfg, conocimientoPath }, reg, repo);
  assert.match(text, /Conocimiento: .*index\.md/);
  assert.ok(text.length <= 1200);
});

test('tarjetaActual: En curso primero; si no, la Verificando sin revisada tocada más tarde', () => {
  const repo = tmpDir();
  assert.equal(tarjetaActual(repo), null);
  const dir = path.join(repo, 'backlog', 'tasks');
  mkdirSync(dir, { recursive: true });
  const md = (n, status, updated, labels = '[]') => writeFileSync(path.join(dir, `task-${n} - t.md`),
    `---\nid: TASK-${n}\ntitle: T${n}\nstatus: ${status}\nupdated_date: '${updated}'\nlabels: ${labels}\ndependencies: []\n---\n`);
  md(1, 'Verificando', '2026-10-12 09:00');
  md(2, 'Verificando', '2026-10-12 11:00');
  md(3, 'Verificando', '2026-10-12 12:00', '[revisada]');
  assert.deepEqual(tarjetaActual(repo), { id: 'TASK-2', title: 'T2' });
  md(4, 'En curso', '2026-10-01 08:00');
  assert.deepEqual(tarjetaActual(repo), { id: 'TASK-4', title: 'T4' });
});
