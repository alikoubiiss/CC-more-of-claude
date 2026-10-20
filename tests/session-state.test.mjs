import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, utimesSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { sid8, modelKey, sessionStateFile, writeSessionState, readSessionState, pruneSessionStates } from '../lib/session-state.mjs';
import { makeCfg, tmpDir } from './helpers.mjs';

test('sid8 sanea y recorta a 8 caracteres, con respaldo', () => {
  assert.equal(sid8('abcdef123456'), 'abcdef12');
  assert.equal(sid8('../../x'), 'x');
  assert.equal(sid8(undefined), 'sin-id');
  assert.equal(sid8(''), 'sin-id');
});

test('modelKey reconoce la familia por el nombre', () => {
  assert.equal(modelKey('Opus 4.1'), 'opus');
  assert.equal(modelKey('Claude Sonnet 5.5'), 'sonnet');
  assert.equal(modelKey('haiku'), 'haiku');
  assert.equal(modelKey('Fable 5.1'), 'fable');
  assert.equal(modelKey('otro'), null);
  assert.equal(modelKey(undefined), null);
});

test('escribir y leer el estado de sesión es atómico y ida y vuelta', () => {
  const cfg = makeCfg(tmpDir());
  assert.equal(readSessionState(cfg, 'abc12345'), null);
  writeSessionState(cfg, 'abc12345-zzzz', { model: 'sonnet', cost: 0.42 });
  assert.deepEqual(readSessionState(cfg, 'abc12345'), { model: 'sonnet', cost: 0.42 });
  assert.equal(existsSync(`${sessionStateFile(cfg, 'abc12345')}.tmp`), false);
});

test('un estado corrupto se lee como null', () => {
  const cfg = makeCfg(tmpDir());
  mkdirSync(cfg.stateDir, { recursive: true });
  writeFileSync(sessionStateFile(cfg, 'abc12345'), '{oops');
  assert.equal(readSessionState(cfg, 'abc12345'), null);
});

test('pruneSessionStates borra solo los estados antiguos', () => {
  const cfg = makeCfg(tmpDir());
  writeSessionState(cfg, 'viejo123', { a: 1 });
  writeSessionState(cfg, 'nuevo123', { a: 1 });
  const hace2dias = new Date(Date.now() - 2 * 86400000);
  utimesSync(sessionStateFile(cfg, 'viejo123'), hace2dias, hace2dias);
  assert.equal(pruneSessionStates(cfg), 1);
  assert.deepEqual(readdirSync(cfg.stateDir), [path.basename(sessionStateFile(cfg, 'nuevo123'))]);
});

test('writeSessionState no deja .tmp tras escrituras repetidas', () => {
  const cfg = makeCfg(tmpDir());
  writeSessionState(cfg, 'abc12345', { a: 1 });
  writeSessionState(cfg, 'abc12345', { a: 2 });
  assert.deepEqual(readdirSync(cfg.stateDir).filter((f) => f.endsWith('.tmp')), []);
  assert.deepEqual(readSessionState(cfg, 'abc12345'), { a: 2 });
});

test('si el renombrado falla, writeSessionState lanza y limpia el .tmp', () => {
  const cfg = makeCfg(tmpDir());
  mkdirSync(sessionStateFile(cfg, 'abc12345'), { recursive: true });
  assert.throws(() => writeSessionState(cfg, 'abc12345', { a: 1 }));
  assert.deepEqual(readdirSync(cfg.stateDir).filter((f) => f.endsWith('.tmp')), []);
});

test('pruneSessionStates solo borra .json y .tmp', () => {
  const cfg = makeCfg(tmpDir());
  mkdirSync(cfg.stateDir, { recursive: true });
  const viejo = new Date(Date.now() - 2 * 86400000);
  for (const f of ['a.json', 'b.json.1.2.tmp', 'lock.txt']) {
    writeFileSync(path.join(cfg.stateDir, f), 'x');
    utimesSync(path.join(cfg.stateDir, f), viejo, viejo);
  }
  assert.equal(pruneSessionStates(cfg), 2);
  assert.deepEqual(readdirSync(cfg.stateDir), ['lock.txt']);
});
