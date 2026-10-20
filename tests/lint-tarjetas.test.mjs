import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { formatear, lintTarjeta, lintTarjetas, seleccionar, verificaA } from '../lib/lint-tarjetas.mjs';
import { parseLintArgs, runLint } from '../scripts/lint-tarjetas.mjs';
import { tmpDir, writeTask } from './helpers.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'lint-tarjetas.mjs');
const crit = (...t) => ({ done: 0, total: t.length, items: t.map((text, i) => ({ n: i + 1, text, done: false })) });
const OK = crit('`npm test` pasa', 'el endpoint devuelve 200');
const buena = (over = {}) => ({
  id: 'TASK-1', title: 'Tarea', status: 'Planificado', description: 'Hace algo', criteria: OK, dependencies: [],
  labels: ['modelo:sonnet', 'esfuerzo:high', 'riesgo:bajo', 'est:30', 'skill:tdd'], comments: [], ...over,
});
const errores = (t, all = [t]) => lintTarjeta(t, all).errores.join(' | ');

test('una tarjeta completa pasa sin errores ni avisos', () => {
  assert.deepEqual(lintTarjeta(buena()), { id: 'TASK-1', title: 'Tarea', errores: [], avisos: [] });
});

test('rechaza etiquetas que faltan o no valen', () => {
  assert.match(errores(buena({ labels: ['est:30'] })), /falta la etiqueta modelo:.*falta la etiqueta esfuerzo:/);
  assert.match(errores(buena({ labels: ['modelo:sonnet', 'esfuerzo:high'] })), /falta la etiqueta est:/);
  assert.match(errores(buena({ labels: ['modelo:haiku', 'esfuerzo:high', 'est:30'] })), /modelo:haiku solo con esfuerzo:medium/);
  assert.match(errores(buena({ labels: ['modelo:gpt', 'esfuerzo:high', 'est:30'] })), /modelo:gpt no vale/);
  assert.match(errores(buena({ labels: ['modelo:sonnet', 'esfuerzo:max', 'est:30'] })), /esfuerzo:max no vale/);
  assert.match(errores(buena({ labels: ['modelo:sonnet', 'esfuerzo:xhigh', 'est:30'] })), /xhigh solo con modelo:opus/);
  assert.match(errores(buena({ labels: ['modelo:sonnet', 'esfuerzo:high', 'est:media hora'] })), /est:media hora no vale/);
  assert.match(errores(buena({ labels: ['modelo:sonnet', 'esfuerzo:high', 'est:30', 'riesgo:extremo'] })), /riesgo:extremo no vale/);
});

test('est mayor de 90 pide dividir; descripción y número de criterios', () => {
  assert.match(errores(buena({ labels: ['modelo:sonnet', 'esfuerzo:high', 'est:120'] })), /supera 90 min: divide la tarjeta/);
  assert.equal(errores(buena({ labels: ['modelo:sonnet', 'esfuerzo:high', 'est:90'] })), '');
  assert.match(errores(buena({ description: '' })), /sin descripción/);
  assert.match(errores(buena({ criteria: crit('`a` pasa') })), /tiene 1 criterios/);
  assert.match(errores(buena({ criteria: crit('`1`', '`2`', '`3`', '`4`', '`5`', '`6`') })), /tiene 6 criterios/);
});

test('riesgo:alto exige opus y su tarjeta "Verificar TASK-n" que dependa de ella', () => {
  const alta = buena({ labels: ['modelo:sonnet', 'esfuerzo:high', 'riesgo:alto', 'est:60'] });
  const e = errores(alta);
  assert.match(e, /riesgo:alto exige modelo:opus/);
  assert.match(e, /sin tarjeta "Verificar TASK-1"/);

  const opus = buena({ labels: ['modelo:opus', 'esfuerzo:xhigh', 'riesgo:alto', 'est:60'] });
  const verif = buena({ id: 'TASK-2', title: 'Verificar TASK-1', dependencies: ['TASK-1'], labels: ['modelo:opus', 'esfuerzo:high', 'riesgo:medio', 'est:30'] });
  assert.deepEqual(lintTarjeta(opus, [opus, verif]).errores, []);
  assert.deepEqual(lintTarjeta(verif, [opus, verif]), { id: 'TASK-2', title: 'Verificar TASK-1', errores: [], avisos: [] });
  const suelta = { ...verif, dependencies: [] };
  assert.match(errores(opus, [opus, suelta]), /debe depender de TASK-1/);
  assert.equal(verificaA({ title: 'verificar task-7 casos límite' }), 'task-7');
  assert.equal(verificaA({ title: 'Webhook' }), null);
});

test('incoherencia con la rúbrica es solo un aviso', () => {
  const t = buena({ title: 'Migración con hilos en paralelo', criteria: crit('`1`', '`2`', '`3`', '`4`') });
  const r = lintTarjeta(t);
  assert.deepEqual(r.errores, []);
  assert.match(r.avisos[0], /la rúbrica pide opus\/high .* y la tarjeta dice sonnet\/high/);
  assert.deepEqual(lintTarjeta(buena({ title: 'Rotar el token', labels: ['modelo:opus', 'esfuerzo:high', 'est:30'] })).avisos, []);
  const alto = buena({ labels: ['modelo:opus', 'esfuerzo:high', 'riesgo:alto', 'est:30'] });
  assert.match(lintTarjeta(alto, [alto]).avisos[0], /pide opus\/xhigh/);
});

test('selección: por defecto Planificado; ids o --todas', () => {
  const ts = [buena(), buena({ id: 'TASK-2', status: 'Hecho' }), buena({ id: 'TASK-3', status: 'En curso' })];
  assert.deepEqual(seleccionar(ts).map((t) => t.id), ['TASK-1']);
  assert.deepEqual(seleccionar(ts, { todas: true }).map((t) => t.id), ['TASK-1', 'TASK-3']);
  assert.deepEqual(seleccionar(ts, { ids: ['task-2'] }).map((t) => t.id), ['TASK-2']);
  const res = lintTarjetas([buena(), buena({ id: 'TASK-4', description: '' })]);
  assert.deepEqual([res.revisadas, res.errores, res.avisos], [2, 1, 0]);
  const txt = formatear(res);
  assert.match(txt, /TASK-4 «Tarea»\n {2}ERROR sin descripción/);
  assert.match(txt, /Resultado: 1 error\(es\) y 0 aviso\(s\) en 2 tarjeta\(s\); 1 sin errores\. Corrige/);
  assert.equal(formatear(lintTarjetas([])), 'No hay tarjetas que revisar (Planificado).');
});

test('parseLintArgs y runLint sobre un backlog en disco', () => {
  assert.deepEqual(parseLintArgs(['TASK-1', '--todas', '--json']), { ids: ['TASK-1'], todas: true, json: true, repo: null });
  assert.throws(() => parseLintArgs(['--x']), /Opción desconocida/);
  const repo = tmpDir();
  writeTask(repo, 1, { labels: ['modelo:sonnet', 'esfuerzo:high', 'est:20'], description: 'd', criteria: ['`a` pasa', '`b` pasa'] });
  assert.equal(runLint({ repo }).errores, 0);
});

test('CLI: código 0 con tarjetas buenas, 1 con malas y salida legible', () => {
  const repo = tmpDir();
  writeTask(repo, 1, { title: 'Buena', labels: ['modelo:sonnet', 'esfuerzo:high', 'est:20'], description: 'd', criteria: ['`a` pasa', '`b` pasa'] });
  const ok = spawnSync(process.execPath, [SCRIPT, '--repo', repo], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /0 error\(es\)/);
  writeTask(repo, 2, { title: 'Mala', labels: ['modelo:gpt'] });
  const mal = spawnSync(process.execPath, [SCRIPT], { cwd: repo, encoding: 'utf8', env: { ...process.env, HQ_CONFIG: path.join(repo, 'no-existe.json') } });
  assert.equal(mal.status, 1);
  assert.match(mal.stdout, /TASK-2 «Mala»/);
  assert.match(mal.stdout, /ERROR modelo:gpt no vale/);
  assert.match(mal.stdout, /ERROR falta la etiqueta est:/);
  const noId = spawnSync(process.execPath, [SCRIPT, 'TASK-9', '--repo', repo], { encoding: 'utf8' });
  assert.equal(noId.status, 1);
  assert.match(noId.stderr, /no existe/);
});
