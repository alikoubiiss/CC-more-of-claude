import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { formatStatusline } from '../lib/statusline.mjs';
import { HQ_ROOT } from '../lib/config.mjs';
import { saveRegistry } from '../lib/registry.mjs';
import { readSessionState } from '../lib/session-state.mjs';
import { readMetrics } from '../lib/metrics.mjs';
import { tmpDir, writeConfigFile, writeTask } from './helpers.mjs';

test('formatStatusline compone proyecto, tarjeta, modelo, coste y contexto', () => {
  assert.equal(formatStatusline({ slug: 'demo-hq', card: 'TASK-1 Conectar NotebookLM', model: 'Sonnet', cost: 0.42, ctxPct: 8.4 }),
    'demo-hq · TASK-1 Conectar NotebookLM · Sonnet · $0,42 · ctx 8%');
  assert.equal(formatStatusline({ model: 'Opus', cost: 1 }), 'Opus · $1,00');
  assert.equal(formatStatusline({}), '');
  assert.equal(formatStatusline({ slug: 'p', card: 'x'.repeat(60) }).length, 'p · '.length + 30);
});

function entorno() {
  const root = tmpDir();
  const { file, cfg } = writeConfigFile(root);
  const repo = path.join(root, 'mis proyectos', 'demo');
  mkdirSync(repo, { recursive: true });
  writeTask(repo, 1, { title: 'Parser', status: 'En curso' });
  saveRegistry(cfg.registryFile, { projects: [{ slug: 'demo', display: 'Demo', path: repo, port: 6430 }] });
  return { root, file, repo, cfg: { ...cfg, stateDir: path.join(root, 'state') } };
}
const correr = (e, input) => spawnSync(process.execPath, [path.join(HQ_ROOT, 'scripts', 'statusline.mjs')], {
  input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8', env: { ...process.env, HQ_CONFIG: e.file },
});

test('la statusline dentro de un proyecto muestra la tarjeta activa y guarda el estado', () => {
  const e = entorno();
  const r = correr(e, { session_id: 'abc12345-xyz', model: { display_name: 'Sonnet' }, workspace: { current_dir: path.join(e.repo, 'src') },
    cost: { total_cost_usd: 0.42 }, context_window: { used_percentage: 8, total_input_tokens: 15500, total_output_tokens: 1200 } });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), 'demo · TASK-1 Parser · Sonnet · $0,42 · ctx 8%');
  const s = readSessionState(e.cfg, 'abc12345');
  assert.deepEqual([s.slug, s.model, s.cost, s.ctx_pct, s.tokens_in, s.tokens_out], ['demo', 'sonnet', 0.42, 8, 15500, 1200]);
});

test('fuera de un proyecto solo muestra modelo y coste', () => {
  const e = entorno();
  const r = correr(e, { session_id: 'zzz99999', model: { display_name: 'Opus' }, workspace: { current_dir: e.root }, cost: { total_cost_usd: 0.1 } });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), 'Opus · $0,10');
});

test('con stdin vacío o inválido sale con 0 e imprime una línea', () => {
  const e = entorno();
  for (const input of ['', 'esto no es json']) {
    const r = correr(e, input);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '\n');
  }
});

test('formatStatusline neutraliza caracteres de control en todas las partes', () => {
  const ctrl = /[\u0000-\u001f\u007f-\u009f]/;
  const out = formatStatusline({ slug: 'p', card: '\u001b[31mRojo\nLinea2\r\u0007', model: 'Opus\u001b]0;pwned\u0007' });
  assert.equal(ctrl.test(out.replace(/ · /g, ' ')), false);
  assert.ok(out.includes('Rojo Linea2'));
  assert.equal(ctrl.test(formatStatusline({ slug: 's\u001b[2Jx', model: 'm\u009bz' })), false);
});

test('el recorte de 30 caracteres cuenta el texto limpio', () => {
  const out = formatStatusline({ slug: 'p', card: '\n'.repeat(5) + 'x'.repeat(60) });
  assert.equal(out, `p · ${'x'.repeat(30)}`);
});

const AMBAR = '\x1b[33m';
const ROJO = '\x1b[31m';
const RESET = '\x1b[0m';

test('formatStatusline avisa del presupuesto solo en aviso o pasado y con color', () => {
  const p = (dia, tarjeta) => ({ dia, tarjeta });
  const base = { slug: 'demo', model: 'Sonnet', cost: 1 };
  assert.equal(formatStatusline({ ...base, presupuesto: p({ pct: 79, estado: 'ok' }, null) }), 'demo · Sonnet · $1,00');
  assert.equal(formatStatusline({ ...base, presupuesto: p({ pct: null, estado: 'sin' }, null) }), 'demo · Sonnet · $1,00');
  assert.equal(formatStatusline({ ...base, presupuesto: p({ pct: 82, estado: 'aviso' }, null) }), `demo · Sonnet · $1,00 · ${AMBAR}⚠ día 82%${RESET}`);
  assert.equal(formatStatusline({ ...base, presupuesto: p({ pct: 104, estado: 'pasado' }, { id: 'TASK-3', pct: 90, estado: 'aviso' }) }),
    `demo · Sonnet · $1,00 · ${ROJO}⚠ día 104%${RESET} · ${AMBAR}⚠ TASK-3 90%${RESET}`);
  assert.equal(formatStatusline({ ...base, presupuesto: null }), 'demo · Sonnet · $1,00');
});

test('formatStatusline no deja colarse controles ni colores propios en el presupuesto', () => {
  const l = formatStatusline({ model: 'M', presupuesto: { dia: { pct: Number.NaN, estado: 'aviso' }, tarjeta: { id: 'T\x1b[31mX\n', pct: 90, estado: 'aviso' } } });
  assert.equal(l, `M · ${AMBAR}⚠ T [31mX 90%${RESET}`);
  assert.equal(l.split('\x1b').length - 1, 2);
});

function conPresupuesto(e, presupuesto) {
  const cfg = JSON.parse(readFileSync(e.file, 'utf8'));
  writeFileSync(e.file, JSON.stringify({ ...cfg, presupuesto }));
}
const entrada = (e, cost) => ({ session_id: 'abc12345-xyz', model: { display_name: 'Sonnet' }, workspace: { current_dir: e.repo },
  cost: { total_cost_usd: cost }, context_window: { used_percentage: 8, total_input_tokens: 100, total_output_tokens: 10 } });
const lineasSnap = (e) => readMetrics({ metricsDir: path.join(e.root, 'metrics') }, 'demo', {}).filter((l) => l.kind === 'snap');

test('la statusline registra fotos con delta y tarjeta, avisa del presupuesto y no escribe sin cambios', () => {
  const e = entorno();
  conPresupuesto(e, { diaUsd: 1, tarjetaUsd: 0.5 });
  let r = correr(e, entrada(e, 0.2));
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), 'demo · TASK-1 Parser · Sonnet · $0,20 · ctx 8%');
  r = correr(e, entrada(e, 0.9));
  assert.equal(r.stdout.trim(), `demo · TASK-1 Parser · Sonnet · $0,90 · ctx 8% · ${AMBAR}⚠ día 90%${RESET} · ${ROJO}⚠ TASK-1 180%${RESET}`);
  const antes = lineasSnap(e);
  assert.deepEqual(antes.map((l) => [l.card, l.delta, l.model]), [['TASK-1', 0.2, 'sonnet'], ['TASK-1', 0.7, 'sonnet']]);
  r = correr(e, entrada(e, 0.9));
  assert.equal(lineasSnap(e).length, 2);
  assert.match(r.stdout, /⚠ día 90%/);
  const estado = readSessionState(e.cfg, 'abc12345');
  assert.equal(estado.rec_cost, 0.9);
  assert.equal(estado.presupuesto.dia.estado, 'aviso');
});

test('sin presupuesto en la config no hay avisos pero sí se registra el gasto', () => {
  const e = entorno();
  correr(e, entrada(e, 0.2));
  const r = correr(e, entrada(e, 0.4));
  assert.equal(r.stdout.trim(), 'demo · TASK-1 Parser · Sonnet · $0,40 · ctx 8%');
  assert.equal(lineasSnap(e).length, 2);
});

test('si no se puede escribir el historial la línea sale igual y el código es 0', () => {
  const e = entorno();
  conPresupuesto(e, { diaUsd: 1 });
  writeFileSync(path.join(e.root, 'metrics'), 'esto es un fichero, no una carpeta');
  const r = correr(e, entrada(e, 0.3));
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), 'demo · TASK-1 Parser · Sonnet · $0,30 · ctx 8%');
});

test('con un presupuesto inválido en la config la statusline sigue respondiendo', () => {
  const e = entorno();
  conPresupuesto(e, { diaUsd: -5 });
  const r = correr(e, entrada(e, 0.3));
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), 'Sonnet · $0,30 · ctx 8%');
});

test('R1 si falla la caché de tarjetas el gasto no se cuenta dos veces', () => {
  const e = entorno();
  conPresupuesto(e, { diaUsd: 10, tarjetaUsd: 5 });
  mkdirSync(path.join(e.root, 'metrics', 'demo', 'tarjetas.json'), { recursive: true });
  for (const c of [0.1, 0.2, 0.3, 0.4]) correr(e, entrada(e, c));
  const deltas = lineasSnap(e).map((l) => l.delta);
  assert.equal(Math.round(deltas.reduce((a, b) => a + b, 0) * 1e6) / 1e6, 0.4);
  assert.equal(readSessionState(e.cfg, 'abc12345').rec_cost, 0.4);
});

test('R1 si el historial del día está lleno la foto no se pierde: el delta se recupera en la siguiente', () => {
  const e = entorno();
  correr(e, entrada(e, 0.1));
  const fichero = path.join(e.root, 'metrics', 'demo', readdirSync(path.join(e.root, 'metrics', 'demo')).find((f) => f.endsWith('.jsonl')));
  const original = readFileSync(fichero, 'utf8');
  writeFileSync(fichero, original + ' '.repeat(5 * 1024 * 1024));
  correr(e, entrada(e, 0.6));
  assert.equal(readSessionState(e.cfg, 'abc12345').rec_cost, 0.1);
  writeFileSync(fichero, original);
  correr(e, entrada(e, 0.7));
  const deltas = lineasSnap(e).map((l) => l.delta);
  assert.equal(Math.round(deltas.reduce((a, b) => a + b, 0) * 1e6) / 1e6, 0.7);
});
