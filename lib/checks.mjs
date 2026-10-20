import { existsSync } from 'node:fs';
import path from 'node:path';
import { HQ_ROOT, defaultConfigFile } from './config.mjs';

const text = (v) => (typeof v === 'string' ? v : '');
const firstLine = (r) => (text(r?.stdout) || text(r?.stderr)).trim().split('\n')[0];

function safeRun(run, cmd, args) {
  try {
    return { ok: true, r: run(cmd, args, {}) };
  } catch (e) {
    return { ok: false, detail: e?.message ?? String(e) };
  }
}

export function runChecks(cfg, run) {
  const results = [];
  // `opcional`: si falla es un aviso (!), no un error: se puede usar HQ sin esa pieza.
  const add = (name, ok, detail = '', opcional = false) => results.push({ name, ok, detail, opcional });
  const major = Number(process.versions.node.split('.')[0]);
  add('Node >= 22', major >= 22, process.versions.node);
  for (const [name, args] of [['git', ['--version']], ['backlog', ['--version']], ['nlm', ['--version']], ['uv', ['--version']]]) {
    const s = safeRun(run, name, args);
    if (!s.ok) { add(name, name === 'uv', s.detail, name === 'nlm'); continue; }
    const ok = s.r.status === 0;
    if (name === 'uv') add(name, true, ['opcional (solo para instalar nlm)', ok ? firstLine(s.r) : ''].filter(Boolean).join(': '));
    else add(name, ok, firstLine(s.r), name === 'nlm');
  }
  const login = safeRun(run, 'nlm', ['login', '--check', '--profile', cfg.nlmProfile]);
  add(`nlm login (${cfg.nlmProfile})`, login.ok && login.r.status === 0, login.ok ? firstLine(login.r) : login.detail, true);
  for (const [name, cmd, args, para] of [['cc', 'cc', ['--help'], 'tablero y `cc start`'], ['Windows Terminal (wt)', 'where.exe', ['wt'], 'paneles de `cc start`']]) {
    const s = safeRun(run, cmd, args);
    add(name, s.ok && s.r.status === 0, s.ok ? `para ${para}` : `falta (${para})`, true);
  }
  add('vault accesible', existsSync(cfg.vaultPath), cfg.vaultPath);
  if (cfg.vaultPersonalDestino) {
    add('vault personal', true, existsSync(cfg.vaultPersonalDestino) ? cfg.vaultPersonalDestino : 'aún no migrado (node scripts/vault-migrar.mjs --dry-run)');
  }
  const p = cfg.presupuesto;
  const partes = [p?.diaUsd ? `día $${p.diaUsd}` : null, p?.tarjetaUsd ? `tarjeta $${p.tarjetaUsd}` : null].filter(Boolean);
  add('presupuesto', true, partes.length ? partes.join(' · ') : 'sin presupuesto (config.json → presupuesto)');
  if (cfg.metricsDir) add('métricas de gasto', true, existsSync(cfg.metricsDir) ? cfg.metricsDir : 'aún sin datos (se crean al trabajar en un proyecto)');
  add('projectsRoot existe', existsSync(cfg.projectsRoot), cfg.projectsRoot);
  add('HQ_ROOT', true, HQ_ROOT);
  add('config en uso', true, defaultConfigFile());
  add('registryFile', true, cfg.registryFile);
  add('backupsDir', true, cfg.backupsDir);
  add('logsDir', true, cfg.logsDir);
  if (cfg.dataDir) add('dataDir existe', existsSync(cfg.dataDir), cfg.dataDir);
  return results;
}
