import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync, utimesSync } from 'node:fs';
import path from 'node:path';
import { projectDir, writeNote, createProjectIndex, addDecision, listDecisions, writeSession, lastSession, setProjectEstado, ESTADOS } from '../lib/vault.mjs';
import { makeCfg, tmpDir } from './helpers.mjs';

const project = { slug: 'demo', display: 'Demo', path: 'C:\\x\\demo', port: 6430, notebookId: 'nb1' };

test('createProjectIndex crea la nota con frontmatter y no pisa ediciones del usuario', () => {
  const cfg = makeCfg(tmpDir());
  const a = createProjectIndex(cfg, project);
  assert.equal(a.written, true);
  assert.match(readFileSync(a.path, 'utf8'), /proyecto: demo/);
  writeFileSync(a.path, 'editado por el usuario');
  const b = createProjectIndex(cfg, project);
  assert.equal(b.written, false);
  assert.equal(readFileSync(a.path, 'utf8'), 'editado por el usuario');
});

test('writeNote nunca escribe fuera de la carpeta del proyecto', () => {
  const cfg = makeCfg(tmpDir());
  assert.throws(() => writeNote(cfg, 'demo', '../evil.md', 'x'), /fuera del proyecto/);
  assert.throws(() => writeNote(cfg, 'demo', '..\\..\\evil.md', 'x'), /fuera del proyecto/);
  assert.throws(() => writeNote(cfg, 'demo', 'C:\\evil.md', 'x'), /fuera del proyecto/);
  assert.throws(() => writeNote(cfg, '../demo', 'a.md', 'x'), /slug inválido/);
});

test('writeNote en modo backup copia el original a backupsDir', () => {
  const cfg = makeCfg(tmpDir());
  writeNote(cfg, 'demo', 'N.md', 'v1');
  writeNote(cfg, 'demo', 'N.md', 'v2', { mode: 'backup' });
  assert.equal(readFileSync(path.join(projectDir(cfg, 'demo'), 'N.md'), 'utf8'), 'v2');
  const baks = readdirSync(path.join(cfg.backupsDir, 'demo'));
  assert.equal(baks.length, 1);
  assert.match(baks[0], /N\.md\.bak$/);
});

test('writeNote rechaza modos desconocidos', () => {
  const cfg = makeCfg(tmpDir());
  assert.throws(() => writeNote(cfg, 'demo', 'N.md', 'x', { mode: 'raro' }), /modo/);
});

test('decisiones: la más reciente primero, con título; carpeta ausente → []', () => {
  const cfg = makeCfg(tmpDir());
  assert.deepEqual(listDecisions(cfg, 'demo'), []);
  addDecision(cfg, 'demo', { title: 'Usar SQLite', context: 'c', decision: 'd', why: 'w' }, new Date(2026, 9, 1));
  addDecision(cfg, 'demo', { title: 'Sin framework', context: 'c', decision: 'd', why: 'w' }, new Date(2026, 9, 5));
  const list = listDecisions(cfg, 'demo', 3);
  assert.deepEqual(list.map((d) => d.title), ['Sin framework', 'Usar SQLite']);
  assert.equal(list[0].date, '2026-10-05');
});

test('addDecision exige todos los campos', () => {
  const cfg = makeCfg(tmpDir());
  assert.throws(() => addDecision(cfg, 'demo', { title: 'x' }), /context/);
});

test('writeSession reemplaza la misma sesión sin crear duplicados y lastSession la encuentra', () => {
  const cfg = makeCfg(tmpDir());
  const now = new Date(2026, 9, 8, 15, 42);
  writeSession(cfg, 'demo', { sessionId: 'abc12345', activeTask: 'T1', changes: 'n', summary: 'uno' }, now);
  writeSession(cfg, 'demo', { sessionId: 'abc12345', activeTask: 'T1', changes: 'n', summary: 'dos' }, now);
  const dir = path.join(projectDir(cfg, 'demo'), 'Sesiones');
  assert.equal(readdirSync(dir).length, 1);
  assert.match(readFileSync(path.join(dir, readdirSync(dir)[0]), 'utf8'), /dos/);
  assert.equal(existsSync(lastSession(cfg, 'demo')), true);
  assert.equal(lastSession(makeCfg(tmpDir()), 'otro'), null);
});

const sess = (o = {}) => ({ sessionId: 'abc12345', activeTask: 'T1', changes: 'n', summary: 'uno', ...o });
const now8 = new Date(2026, 9, 8, 15, 42);

test('writeSession valida sessionId y no crea nada si es inválido', () => {
  const cfg = makeCfg(tmpDir());
  for (const id of ['../x', 'a/b', 'a:b', 'a' + String.fromCharCode(10) + 'b', '', undefined]) {
    assert.throws(() => writeSession(cfg, 'demo', sess({ sessionId: id }), now8), /sessionId inválido/);
  }
  assert.equal(existsSync(path.join(projectDir(cfg, 'demo'), 'Sesiones')), false);
  assert.equal(writeSession(cfg, 'demo', sess({ sessionId: 'manual-1542' }), now8).written, true);
  assert.equal(writeSession(cfg, 'demo', sess(), now8).written, true);
});

test('writeSession exige activeTask, changes y summary como texto no vacío', () => {
  const cfg = makeCfg(tmpDir());
  assert.throws(() => writeSession(cfg, 'demo', sess({ summary: undefined }), now8), /summary/);
  assert.throws(() => writeSession(cfg, 'demo', sess({ changes: ' ' }), now8), /changes/);
  assert.throws(() => writeSession(cfg, 'demo', sess({ activeTask: 3 }), now8), /activeTask/);
  assert.equal(existsSync(path.join(projectDir(cfg, 'demo'), 'Sesiones')), false);
  writeSession(cfg, 'demo', sess(), now8);
  const dir = path.join(projectDir(cfg, 'demo'), 'Sesiones');
  for (const f of readdirSync(dir)) assert.doesNotMatch(readFileSync(path.join(dir, f), 'utf8'), /undefined/);
});

test('lastSession devuelve la nota modificada más recientemente', () => {
  const cfg = makeCfg(tmpDir());
  const a = writeSession(cfg, 'demo', sess({ sessionId: 'zzz11111' }), now8).path;
  const b = writeSession(cfg, 'demo', sess({ sessionId: 'aaa22222' }), now8).path;
  utimesSync(a, new Date(2026, 9, 8, 10), new Date(2026, 9, 8, 10));
  utimesSync(b, new Date(2026, 9, 8, 11), new Date(2026, 9, 8, 11));
  assert.equal(lastSession(cfg, 'demo'), b);
});

test('addDecision no pierde decisiones cuando el nombre de archivo ya existe', () => {
  const cfg = makeCfg(tmpDir());
  const d = new Date(2026, 9, 1);
  const r1 = addDecision(cfg, 'demo', { title: 'Usar SQLite', context: 'c1', decision: 'd', why: 'w' }, d);
  const r2 = addDecision(cfg, 'demo', { title: 'Usar SQLite!', context: 'c2', decision: 'd', why: 'w' }, d);
  assert.equal(r1.written, true);
  assert.equal(r2.written, true);
  assert.notEqual(r1.path, r2.path);
  assert.match(readFileSync(r1.path, 'utf8'), /c1/);
  assert.match(readFileSync(r2.path, 'utf8'), /c2/);
  assert.deepEqual(listDecisions(cfg, 'demo', 5).map((x) => x.title).sort(), ['Usar SQLite', 'Usar SQLite!']);
});

test('setProjectEstado cambia solo la línea estado del índice y deja copia de seguridad', () => {
  const cfg = makeCfg(tmpDir());
  const a = createProjectIndex(cfg, project);
  const before = readFileSync(a.path, 'utf8');
  const r = setProjectEstado(cfg, 'demo', 'en-curso');
  assert.equal(r.written, true);
  assert.equal(readFileSync(a.path, 'utf8'), before.replace('estado: idea', 'estado: en-curso'));
  const baks = readdirSync(path.join(cfg.backupsDir, 'demo'));
  assert.equal(baks.length, 1);
  assert.equal(readFileSync(path.join(cfg.backupsDir, 'demo', baks[0]), 'utf8'), before);
});

test('setProjectEstado rechaza estados inválidos sin tocar el índice', () => {
  const cfg = makeCfg(tmpDir());
  const a = createProjectIndex(cfg, project);
  const before = readFileSync(a.path, 'utf8');
  assert.throws(() => setProjectEstado(cfg, 'demo', 'raro'), /estado inválido: raro/);
  assert.deepEqual(ESTADOS, ['idea', 'planificado', 'en-curso', 'hecho']);
  assert.equal(readFileSync(a.path, 'utf8'), before);
});

test('setProjectEstado funciona con un índice CRLF y conserva los saltos de línea', () => {
  const cfg = makeCfg(tmpDir());
  const a = createProjectIndex(cfg, project);
  const crlf = readFileSync(a.path, 'utf8').replace(/\n/g, '\r\n');
  writeFileSync(a.path, crlf);
  setProjectEstado(cfg, 'demo', 'hecho');
  assert.equal(readFileSync(a.path, 'utf8'), crlf.replace('estado: idea', 'estado: hecho'));
});

test('setProjectEstado lanza error si falta el índice o la línea estado', () => {
  const cfg = makeCfg(tmpDir());
  assert.throws(() => setProjectEstado(cfg, 'demo', 'hecho'), /no existe la nota índice del proyecto demo/);
  const a = createProjectIndex(cfg, project);
  writeFileSync(a.path, '# sin frontmatter\n');
  assert.throws(() => setProjectEstado(cfg, 'demo', 'hecho'), /no tiene la línea "estado:"/);
});

test('lastSession con kind distingue resumen manual y auto-snapshot', () => {
  const cfg = makeCfg(tmpDir());
  assert.equal(lastSession(cfg, 'demo', { kind: 'manual' }), null);
  const m = writeSession(cfg, 'demo', sess({ sessionId: 'manual-100000' }), now8).path;
  assert.equal(lastSession(cfg, 'demo', { kind: 'auto' }), null);
  const a = writeSession(cfg, 'demo', sess({ sessionId: 'abc12345' }), now8).path;
  utimesSync(m, new Date(2026, 9, 8, 10), new Date(2026, 9, 8, 10));
  utimesSync(a, new Date(2026, 9, 8, 11), new Date(2026, 9, 8, 11));
  assert.equal(lastSession(cfg, 'demo', { kind: 'manual' }), m);
  assert.equal(lastSession(cfg, 'demo', { kind: 'auto' }), a);
  assert.equal(lastSession(cfg, 'demo', { kind: 'any' }), a);
  assert.equal(lastSession(cfg, 'demo'), a);
});
