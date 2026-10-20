import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { runChecks } from '../lib/checks.mjs';
import { makeCfg, tmpDir } from './helpers.mjs';

const ok = () => ({ status: 0, stdout: 'v1.0\nmás', stderr: '' });

test('todo correcto → todas las comprobaciones ok', () => {
  const cfg = makeCfg(tmpDir());
  mkdirSync(cfg.vaultPath, { recursive: true });
  mkdirSync(cfg.projectsRoot, { recursive: true });
  const res = runChecks(cfg, ok);
  assert.ok(res.every((r) => r.ok), JSON.stringify(res.filter((r) => !r.ok)));
});

test('detecta herramienta ausente, login de nlm caducado y vault inexistente', () => {
  const cfg = makeCfg(tmpDir());
  const run = (cmd, args) => {
    if (cmd === 'backlog') return { status: 1, stdout: '', stderr: 'no encontrado' };
    if (cmd === 'nlm' && args[0] === 'login') return { status: 1, stdout: '', stderr: 'expired' };
    return ok();
  };
  const bad = runChecks(cfg, run).filter((r) => !r.ok).map((r) => r.name);
  assert.ok(bad.includes('backlog'));
  assert.ok(bad.some((n) => n.startsWith('nlm login')));
  assert.ok(bad.includes('vault accesible'));
});

test('runChecks informa rutas resueltas y la comprobación "dataDir existe"', () => {
  const root = tmpDir();
  const cfg = makeCfg(root);
  mkdirSync(cfg.vaultPath, { recursive: true });
  mkdirSync(cfg.projectsRoot, { recursive: true });
  const names = runChecks(cfg, ok).map((r) => r.name);
  for (const n of ['HQ_ROOT', 'config en uso', 'registryFile', 'backupsDir', 'logsDir']) assert.ok(names.includes(n), n);
  assert.ok(!names.includes('dataDir existe'));
  const withData = { ...cfg, dataDir: path.join(root, 'datos') };
  let r = runChecks(withData, ok).find((x) => x.name === 'dataDir existe');
  assert.equal(r.ok, false);
  mkdirSync(withData.dataDir);
  r = runChecks(withData, ok).find((x) => x.name === 'dataDir existe');
  assert.equal(r.ok, true);
});

test('un runner que lanza solo marca como fallida esa comprobación', () => {
  const cfg = makeCfg(tmpDir());
  const run = (cmd) => { if (cmd === 'backlog') throw new Error('boom'); return ok(); };
  const res = runChecks(cfg, run);
  const backlog = res.find((r) => r.name === 'backlog');
  assert.equal(backlog.ok, false);
  assert.match(backlog.detail, /boom/);
  assert.equal(res.find((r) => r.name === 'git').ok, true);
  assert.equal(res.find((r) => r.name === 'nlm').ok, true);
});

test('un runner que devuelve {status:0} sin stdout no rompe; uv es informativo', () => {
  const cfg = makeCfg(tmpDir());
  const res = runChecks(cfg, () => ({ status: 0 }));
  assert.equal(res.find((r) => r.name === 'git').ok, true);
  const missingUv = runChecks(cfg, (cmd) => (cmd === 'uv' ? { status: 1, stdout: '', stderr: 'no está' } : ok()));
  const uv = missingUv.find((r) => r.name === 'uv');
  assert.equal(uv.ok, true);
  assert.match(uv.detail, /opcional \(solo para instalar nlm\)/);
});

test('vault personal: informativo; avisa si aún no se ha migrado y nunca falla', () => {
  const root = tmpDir();
  const destino = path.join(root, 'Personal');
  const cfg = { ...makeCfg(root), vaultPersonalDestino: destino };
  let r = runChecks(cfg, ok).find((x) => x.name === 'vault personal');
  assert.equal(r.ok, true);
  assert.match(r.detail, /aún no migrado/);
  mkdirSync(destino, { recursive: true });
  r = runChecks(cfg, ok).find((x) => x.name === 'vault personal');
  assert.equal(r.ok, true);
  assert.equal(r.detail, destino);
  assert.equal(runChecks(makeCfg(root), ok).some((x) => x.name === 'vault personal'), false);
});

test('presupuesto y métricas: informativos, nunca fallan', () => {
  const root = tmpDir();
  const cfg = { ...makeCfg(root), presupuesto: { diaUsd: 50, tarjetaUsd: null } };
  let res = runChecks(cfg, ok);
  const pres = res.find((x) => x.name === 'presupuesto');
  assert.equal(pres.ok, true);
  assert.match(pres.detail, /día \$50/);
  assert.doesNotMatch(pres.detail, /tarjeta/);
  const met = res.find((x) => x.name === 'métricas de gasto');
  assert.equal(met.ok, true);
  assert.match(met.detail, /aún sin datos/);
  mkdirSync(cfg.metricsDir, { recursive: true });
  assert.equal(runChecks(cfg, ok).find((x) => x.name === 'métricas de gasto').detail, cfg.metricsDir);
  res = runChecks(makeCfg(root), ok);
  assert.match(res.find((x) => x.name === 'presupuesto').detail, /sin presupuesto/);
  assert.equal(res.find((x) => x.name === 'presupuesto').ok, true);
});
