import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  appendMetric, appendSnapshot, estadoPresupuesto, gastoDia, metricsFile, planSnapshot, pruneMetrics, readMetrics, totalesTarjetas,
} from '../lib/metrics.mjs';
import { loadConfig } from '../lib/config.mjs';
import { makeCfg, tmpDir, writeConfigFile } from './helpers.mjs';

const D = (d, h = 12, m = 0) => new Date(2026, 9, d, h, m, 0);
const snap = (extra = {}) => ({ sid: 'abc12345', model: 'sonnet', card: 'TASK-1', cost: 1, tokens_in: 10, tokens_out: 2, ctx_pct: 5, ...extra });

test('planSnapshot: primera foto, ya en marcha, sin cambios, cambios y reinicio', () => {
  const rec = { t: D(10).toISOString(), cost: 1, model: 'sonnet', card: 'TASK-1' };
  assert.deepEqual(planSnapshot(null, { cost: 0.2, model: 'sonnet', card: null }, D(10)), { escribir: true, delta: 0.2 });
  assert.deepEqual(planSnapshot(null, { cost: 108, model: 'sonnet', card: null }, D(10)), { escribir: true, delta: 0 });
  assert.deepEqual(planSnapshot(rec, { cost: 1.004, model: 'sonnet', card: 'TASK-1' }, D(10, 12, 1)), { escribir: false, delta: 0.004 });
  assert.deepEqual(planSnapshot(rec, { cost: 1.5, model: 'sonnet', card: 'TASK-1' }, D(10, 12, 1)), { escribir: true, delta: 0.5 });
  assert.deepEqual(planSnapshot(rec, { cost: 1, model: 'opus', card: 'TASK-1' }, D(10, 12, 1)), { escribir: true, delta: 0 });
  assert.deepEqual(planSnapshot(rec, { cost: 1, model: 'sonnet', card: 'TASK-2' }, D(10, 12, 1)), { escribir: true, delta: 0 });
  assert.deepEqual(planSnapshot(rec, { cost: 0.3, model: 'sonnet', card: 'TASK-1' }, D(10, 12, 1)), { escribir: true, delta: 0.3 });
  assert.deepEqual(planSnapshot(rec, { cost: 1, model: 'sonnet', card: 'TASK-1' }, D(10, 12, 6)), { escribir: true, delta: 0 });
  assert.equal(planSnapshot(rec, { cost: null, model: 'sonnet', card: null }, D(10)).escribir, false);
  assert.equal(planSnapshot(rec, { cost: Number.NaN, model: 'sonnet', card: null }, D(10)).escribir, false);
});

test('appendSnapshot y readMetrics: ida y vuelta, y líneas corruptas ignoradas', () => {
  const cfg = makeCfg(tmpDir());
  appendSnapshot(cfg, 'demo', snap(), 1, D(10));
  appendMetric(cfg, 'demo', { t: D(10).toISOString(), sid: 'abc12345', kind: 'mem', mem: 'nlm' }, D(10));
  writeFileSync(metricsFile(cfg, 'demo', D(10)), '{corrupta\n', { flag: 'a' });
  const l = readMetrics(cfg, 'demo', {});
  assert.deepEqual(l.map((x) => x.kind), ['snap', 'mem']);
  assert.equal(l[0].delta, 1);
  assert.equal(l[0].card, 'TASK-1');
  assert.equal(readMetrics(cfg, null, {}).length, 2);
  assert.deepEqual(readMetrics(cfg, 'otro', {}), []);
});

test('una sesión que cruza la medianoche suma cada delta una sola vez', () => {
  const cfg = makeCfg(tmpDir());
  appendSnapshot(cfg, 'demo', snap({ cost: 2 }), 2, D(10, 23, 50));
  appendSnapshot(cfg, 'demo', snap({ cost: 5 }), 3, D(11, 0, 10));
  assert.equal(gastoDia(cfg, D(10)), 2);
  assert.equal(gastoDia(cfg, D(11)), 3);
  appendSnapshot(cfg, 'otro', snap({ sid: 'zzz', cost: 1 }), 1, D(11, 9));
  assert.equal(gastoDia(cfg, D(11)), 4);
});

test('tarjetas.json suma por tarjeta, ignora «sin tarjeta» y se reconstruye si está corrupto', () => {
  const cfg = makeCfg(tmpDir());
  appendSnapshot(cfg, 'demo', snap({ card: 'TASK-1' }), 1.5, D(10));
  appendSnapshot(cfg, 'demo', snap({ card: 'TASK-1' }), 0.5, D(10, 13));
  appendSnapshot(cfg, 'demo', snap({ card: 'TASK-2' }), 1, D(10, 14));
  appendSnapshot(cfg, 'demo', snap({ card: null }), 4, D(10, 15));
  assert.deepEqual(totalesTarjetas(cfg, 'demo'), { 'TASK-1': 2, 'TASK-2': 1 });
  writeFileSync(path.join(cfg.metricsDir, 'demo', 'tarjetas.json'), '{roto');
  assert.deepEqual(totalesTarjetas(cfg, 'demo'), { 'TASK-1': 2, 'TASK-2': 1 });
  appendSnapshot(cfg, 'demo', snap({ card: 'TASK-2' }), 1, D(10, 16));
  assert.deepEqual(totalesTarjetas(cfg, 'demo'), { 'TASK-1': 2, 'TASK-2': 2 });
});

test('slug inválido, fichero lleno y tarjeta con caracteres raros', () => {
  const cfg = makeCfg(tmpDir());
  assert.throws(() => appendMetric(cfg, '../x', { a: 1 }, D(10)), /slug inválido/);
  assert.throws(() => metricsFile(cfg, 'Mal Slug', D(10)), /slug inválido/);
  assert.equal(appendMetric(cfg, 'demo', { a: 1 }, D(10), { maxBytes: 5 }), true);
  assert.equal(appendMetric(cfg, 'demo', { a: 2 }, D(10), { maxBytes: 5 }), false);
  appendSnapshot(cfg, 'demo', snap({ card: 'TASK-1\x1b[31m' }), 1, D(10, 14));
  assert.deepEqual(Object.keys(totalesTarjetas(cfg, 'demo')), []);
  assert.equal(readMetrics(cfg, 'demo', {}).find((x) => x.kind === 'snap').card, null);
});

test('pruneMetrics borra los ficheros de más de 400 días y deja el resto', () => {
  const cfg = makeCfg(tmpDir());
  const viejo = new Date(2025, 0, 1, 12);
  appendMetric(cfg, 'demo', { kind: 'snap', delta: 1 }, viejo);
  appendMetric(cfg, 'demo', { kind: 'snap', delta: 1 }, D(10));
  assert.equal(pruneMetrics(cfg, D(10), 400), 1);
  assert.equal(existsSync(metricsFile(cfg, 'demo', viejo)), false);
  assert.equal(existsSync(metricsFile(cfg, 'demo', D(10))), true);
});

test('estadoPresupuesto: umbrales 79/80/99/100/150 y sin límite', () => {
  assert.deepEqual(estadoPresupuesto(79, 100), { pct: 79, estado: 'ok' });
  assert.equal(estadoPresupuesto(80, 100).estado, 'aviso');
  assert.equal(estadoPresupuesto(99, 100).estado, 'aviso');
  assert.equal(estadoPresupuesto(100, 100).estado, 'pasado');
  assert.deepEqual(estadoPresupuesto(150, 100), { pct: 150, estado: 'pasado' });
  assert.equal(estadoPresupuesto(5, null).estado, 'sin');
  assert.equal(estadoPresupuesto(5, 0).estado, 'sin');
});

test('config: presupuesto opcional y validado, y metricsDir junto al estado', () => {
  const root = tmpDir();
  const base = JSON.parse(readFileSync(writeConfigFile(root).file, 'utf8'));
  const cargar = (extra) => {
    const f = path.join(root, 'c3.json');
    writeFileSync(f, JSON.stringify({ ...base, ...extra }));
    return loadConfig(f);
  };
  const sin = cargar({});
  assert.equal(sin.presupuesto, null);
  assert.equal(sin.metricsDir, path.join(root, 'metrics'));
  assert.deepEqual(cargar({ presupuesto: { diaUsd: 50, tarjetaUsd: 15 } }).presupuesto, { diaUsd: 50, tarjetaUsd: 15 });
  assert.deepEqual(cargar({ presupuesto: { diaUsd: 50 } }).presupuesto, { diaUsd: 50, tarjetaUsd: null });
  assert.throws(() => cargar({ presupuesto: { diaUsd: 0 } }), /presupuesto\.diaUsd/);
  assert.throws(() => cargar({ presupuesto: { tarjetaUsd: 'mucho' } }), /presupuesto\.tarjetaUsd/);
  assert.throws(() => cargar({ presupuesto: 5 }), /presupuesto/);
});

test('calcularPresupuesto combina el gasto del día y el acumulado de la tarjeta', async () => {
  const { calcularPresupuesto } = await import('../lib/metrics.mjs');
  const cfg = { ...makeCfg(tmpDir()), presupuesto: { diaUsd: 10, tarjetaUsd: 2 } };
  appendSnapshot(cfg, 'demo', snap({ card: 'TASK-1' }), 1.7, D(10, 9));
  appendSnapshot(cfg, 'demo', snap({ card: 'TASK-2' }), 6.5, D(10, 10));
  assert.deepEqual(calcularPresupuesto(cfg, 'demo', 'TASK-1', D(10, 11)), {
    fecha: '2026-10-10', dia: { pct: 82, estado: 'aviso' }, tarjeta: { id: 'TASK-1', pct: 85, estado: 'aviso' },
  });
  assert.deepEqual(calcularPresupuesto(cfg, 'demo', null, D(10, 11)).tarjeta, null);
  assert.equal(calcularPresupuesto({ ...cfg, presupuesto: null }, 'demo', 'TASK-1', D(10)), null);
  assert.equal(calcularPresupuesto({ ...cfg, presupuesto: { diaUsd: null, tarjetaUsd: null } }, 'demo', 'TASK-1', D(10)).dia.estado, 'sin');
});

test('R2 totales por tarjeta derivados del historial: sin pérdidas, con caché inválida o impracticable', async () => {
  const { totalesTarjetas: totales } = await import('../lib/metrics.mjs');
  const cfg = makeCfg(tmpDir());
  const linea = (card, delta) => ({ t: D(10).toISOString(), sid: 's', kind: 'snap', model: 'sonnet', card, cost: delta, delta });
  appendMetric(cfg, 'demo', linea('TASK-1', 1.5), D(10, 9));
  appendMetric(cfg, 'demo', linea('TASK-2', 1), D(10, 10));
  assert.deepEqual(totales(cfg, 'demo'), { 'TASK-1': 1.5, 'TASK-2': 1 });
  // el historial crece sin pasar por appendSnapshot (otra sesión): el siguiente cálculo lo recoge
  appendMetric(cfg, 'demo', linea('TASK-1', 2), D(10, 11));
  assert.deepEqual(totales(cfg, 'demo'), { 'TASK-1': 3.5, 'TASK-2': 1 });
  // caché con números inventados y con un tamaño que no coincide: se ignora
  writeFileSync(path.join(cfg.metricsDir, 'demo', 'tarjetas.json'), JSON.stringify({ v: 1, dias: { '2026-10-10': { size: 1, cards: { 'TASK-1': 99 } } } }));
  assert.deepEqual(totales(cfg, 'demo'), { 'TASK-1': 3.5, 'TASK-2': 1 });
  // caché imposible de escribir (es un directorio): el resultado sigue siendo correcto y no lanza
  rmSync(path.join(cfg.metricsDir, 'demo', 'tarjetas.json'), { force: true });
  mkdirSync(path.join(cfg.metricsDir, 'demo', 'tarjetas.json'));
  assert.deepEqual(totales(cfg, 'demo'), { 'TASK-1': 3.5, 'TASK-2': 1 });
  assert.deepEqual(totales(cfg, 'no-existe'), {});
});

test('R2 appendSnapshot ya no depende de la caché: devuelve true aunque no se pueda escribir', () => {
  const cfg = makeCfg(tmpDir());
  mkdirSync(path.join(cfg.metricsDir, 'demo', 'tarjetas.json'), { recursive: true });
  assert.equal(appendSnapshot(cfg, 'demo', snap(), 1, D(10)), true);
  assert.equal(totalesTarjetas(cfg, 'demo')['TASK-1'], 1);
});
