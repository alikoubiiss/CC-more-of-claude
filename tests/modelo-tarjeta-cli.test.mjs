import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buscarTarjeta, localizarRepo, parseArgs, runModeloTarjeta } from '../scripts/modelo-tarjeta.mjs';
import { tmpDir, writeConfigFile, writeTask } from './helpers.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'modelo-tarjeta.mjs');


const recorder = (status = 0) => {
  const calls = [];
  const run = (cmd, args, opts) => { calls.push({ cmd, args, cwd: opts.cwd }); return { status, stdout: '', stderr: status ? 'boom' : '' }; };
  run.calls = calls;
  return run;
};

test('parseArgs: id, --registrar y errores claros', () => {
  assert.deepEqual(parseArgs(['TASK-3']), { id: 'TASK-3', registrar: null, repo: null });
  assert.deepEqual(parseArgs(['3', '--registrar', 'revisor']), { id: '3', registrar: 'revisor', repo: null });
  assert.throws(() => parseArgs([]), /Indica el id/);
  assert.throws(() => parseArgs(['1', '--registrar', 'arquitecto']), /ejecutor o revisor/);
  assert.throws(() => parseArgs(['1', '--x']), /Opción desconocida/);
});

test('buscarTarjeta: sin distinguir mayúsculas y por número', () => {
  const tasks = [{ id: 'TASK-1' }, { id: 'TASK-12' }];
  assert.equal(buscarTarjeta(tasks, 'task-12').id, 'TASK-12');
  assert.equal(buscarTarjeta(tasks, '1').id, 'TASK-1');
  assert.equal(buscarTarjeta(tasks, '2'), null);
});

test('localizarRepo: registro HQ primero, luego backlog/ hacia arriba, si no error', () => {
  const root = tmpDir();
  mkdirSync(path.join(root, 'backlog', 'tasks'), { recursive: true });
  mkdirSync(path.join(root, 'src', 'a'), { recursive: true });
  assert.equal(localizarRepo(path.join(root, 'src', 'a'), { registro: () => { throw new Error('sin config'); } }), root);
  assert.equal(localizarRepo(path.join(root, 'src'), { registro: () => ({ projects: [{ path: path.join(root, 'src') }] }) }), path.join(root, 'src'));
  assert.throws(() => localizarRepo(tmpDir(), { registro: () => ({ projects: [] }) }), /ni de una carpeta con backlog/);
});

test('runModeloTarjeta: JSON de la tarjeta y error si no existe', () => {
  const repo = tmpDir();
  writeTask(repo, 1, { labels: ['modelo:opus', 'esfuerzo:high', 'est:30'] });
  const r = runModeloTarjeta({ id: 'TASK-1', repo });
  assert.deepEqual([r.model, r.effort, r.revisorModel, r.revisorEffort, r.intento, r.parar], ['opus', 'high', 'opus', 'high', 1, false]);
  assert.throws(() => runModeloTarjeta({ id: 'TASK-9', repo }), /No existe la tarjeta TASK-9/);
});

test('--registrar deja el comentario Modelo: con el autor del rol y respeta parar', () => {
  const repo = tmpDir();
  writeTask(repo, 1, { title: 'Uno', labels: ['modelo:sonnet', 'esfuerzo:medium'], comments: [{ text: 'Falta: no valida' }] });
  const run = recorder();
  const r = runModeloTarjeta({ id: '1', repo, registrar: 'ejecutor', run });
  assert.equal(r.registrado, 'Modelo: sonnet/high intento 2');
  assert.deepEqual(run.calls[0], { cmd: 'backlog', args: ['task', 'edit', 'TASK-1', '--comment', 'Modelo: sonnet/high intento 2', '--comment-author', '@ejecutor'], cwd: repo });
  assert.equal(runModeloTarjeta({ id: '1', repo, registrar: 'revisor', run }).registrado, 'Modelo: sonnet/high intento 2');
  assert.throws(() => runModeloTarjeta({ id: '1', repo, registrar: 'ejecutor', run: recorder(1) }), /no pudo añadir el comentario: boom/);

  writeTask(repo, 2, { title: 'Dos', labels: ['modelo:opus', 'esfuerzo:xhigh', 'riesgo:alto'],
    comments: [{ text: 'Falta: a' }, { author: '@usuario', text: 'Falta: b' }] });
  const parado = recorder();
  assert.throws(() => runModeloTarjeta({ id: 'TASK-2', repo, registrar: 'ejecutor', run: parado }), /divide la tarjeta o pregunta al usuario/);
  assert.equal(parado.calls.length, 0);
  assert.equal(runModeloTarjeta({ id: 'TASK-2', repo }).parar, true);
});

test('CLI: imprime JSON desde la carpeta del proyecto y falla con código ≠0 y mensaje claro', () => {
  const root = tmpDir();
  const { file } = writeConfigFile(root);
  const repo = path.join(root, 'proyecto');
  writeTask(repo, 4, { labels: ['modelo:sonnet', 'esfuerzo:high', 'est:20'] });
  const env = { ...process.env, HQ_CONFIG: file };
  const ok = spawnSync(process.execPath, [SCRIPT, 'task-4'], { cwd: path.join(repo, 'backlog'), env, encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  const j = JSON.parse(ok.stdout);
  assert.deepEqual([j.id, j.model, j.effort, j.revisorModel, j.intento], ['TASK-4', 'sonnet', 'high', 'sonnet', 1]);

  const sinId = spawnSync(process.execPath, [SCRIPT], { cwd: repo, env, encoding: 'utf8' });
  assert.notEqual(sinId.status, 0);
  assert.match(sinId.stderr, /^Error: Indica el id/);
  const noExiste = spawnSync(process.execPath, [SCRIPT, 'TASK-99'], { cwd: repo, env, encoding: 'utf8' });
  assert.notEqual(noExiste.status, 0);
  assert.match(noExiste.stderr, /No existe la tarjeta TASK-99/);
  const fuera = spawnSync(process.execPath, [SCRIPT, 'TASK-4'], { cwd: tmpDir(), env, encoding: 'utf8' });
  assert.notEqual(fuera.status, 0);
  assert.match(fuera.stderr, /ni de una carpeta con backlog/);
});
