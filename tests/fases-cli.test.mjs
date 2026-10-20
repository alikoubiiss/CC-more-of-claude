import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runFasesCli, exigeTerminalInteractiva } from '../scripts/fases.mjs';
import { setFases } from '../lib/fases.mjs';
import { tmpDir, writeTask, writeMilestone, writeConfigFile } from './helpers.mjs';

const recorder = (status = 0, stderr = '') => {
  const calls = [];
  const run = (cmd, args, opts) => { calls.push({ cmd, args, cwd: opts.cwd }); return { status, stdout: '', stderr }; };
  run.calls = calls;
  return run;
};

test('set crea con backlog solo los hitos que faltan', () => {
  const repo = tmpDir();
  writeMilestone(repo, 'm-0', 'Diseño');
  const run = recorder();
  const r = runFasesCli({ sub: 'set', payload: { fases: ['Diseño', 'Construcción'] }, repo, run });
  assert.deepEqual(r.creados, ['Construcción']);
  assert.deepEqual(run.calls.map((c) => [c.cmd, c.args, c.cwd]), [['backlog', ['milestone', 'add', 'Construcción'], repo]]);
  assert.deepEqual(r.fases.map((f) => f.nombre), ['Diseño', 'Construcción']);
});

test('set falla con un mensaje claro si backlog no puede crear el hito', () => {
  const repo = tmpDir();
  assert.throws(() => runFasesCli({ sub: 'set', payload: { fases: ['Diseño'] }, repo, run: recorder(1, 'boom') }),
    /no se pudo crear el hito "Diseño": boom/);
});

test('status devuelve las fases derivadas y la activa', () => {
  const repo = tmpDir();
  writeMilestone(repo, 'm-0', 'Diseño');
  setFases(repo, ['Diseño']);
  writeTask(repo, 1, { status: 'Hecho', milestone: 'm-0' });
  const r = runFasesCli({ sub: 'status', repo });
  assert.equal(r.activa, 'Diseño');
  assert.equal(r.fases[0].estado, 'esperando');
  assert.deepEqual(runFasesCli({ sub: 'status', repo: tmpDir() }), { fases: [], activa: null });
});

test('approve aprueba con la fecha dada y exige el id', () => {
  const repo = tmpDir();
  writeMilestone(repo, 'm-0', 'Diseño');
  setFases(repo, ['Diseño']);
  writeTask(repo, 1, { status: 'Hecho', milestone: 'm-0' });
  const r = runFasesCli({ sub: 'approve', args: ['f1'], repo, now: new Date(2026, 9, 8) });
  assert.deepEqual([r.estado, r.aprobada], ['aprobada', '2026-10-08']);
  assert.throws(() => runFasesCli({ sub: 'approve', args: [], repo }), /indica el id/);
});

test('un subcomando desconocido se rechaza antes de tocar el proyecto', () => {
  assert.throws(() => runFasesCli({ sub: 'raro', repo: undefined }), /Subcomando desconocido: raro/);
});

test('exigeTerminalInteractiva: solo approve exige TTY en stdin y stdout', () => {
  assert.equal(exigeTerminalInteractiva('approve', { stdinTTY: true, stdoutTTY: true }), null);
  for (const t of [{ stdinTTY: false, stdoutTTY: true }, { stdinTTY: true, stdoutTTY: false }, { stdinTTY: false, stdoutTTY: false }, {}]) {
    assert.match(exigeTerminalInteractiva('approve', t), /terminal interactiva/);
  }
  for (const sub of ['set', 'status']) assert.equal(exigeTerminalInteractiva(sub, { stdinTTY: false, stdoutTTY: false }), null);
});

test('approve por subproceso sin TTY se rechaza y no crea fases.json', () => {
  const root = tmpDir();
  const { file } = writeConfigFile(root);
  const script = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'fases.mjs');
  const r = spawnSync(process.execPath, [script, 'approve', 'f1'], { cwd: root, env: { ...process.env, HQ_CONFIG: file }, stdio: 'pipe', encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /terminal interactiva/);
  assert.equal(existsSync(path.join(root, '.hq', 'fases.json')), false);
});

test('set no vuelve a crear un hito que existe con otras mayúsculas', () => {
  const repo = tmpDir();
  writeMilestone(repo, 'm-0', 'diseño');
  const run = recorder();
  const r = runFasesCli({ sub: 'set', payload: { fases: ['Diseño'] }, repo, run });
  assert.deepEqual(r.creados, []);
  assert.equal(run.calls.length, 0);
});

test('set: el fallo de backlog sugiere volver a ejecutar', () => {
  assert.throws(() => runFasesCli({ sub: 'set', payload: { fases: ['Diseño'] }, repo: tmpDir(), run: recorder(1, 'boom') }),
    /boom — vuelve a ejecutar "set"/);
});
