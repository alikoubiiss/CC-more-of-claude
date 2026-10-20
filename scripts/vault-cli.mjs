import { hms } from '../lib/dates.mjs';
import { loadConfig } from '../lib/config.mjs';
import { isMain } from '../lib/cli.mjs';
import { findByPath, loadRegistry } from '../lib/registry.mjs';
import { addDecision, setProjectEstado, writeSession } from '../lib/vault.mjs';

export function runVaultCli({ sub, payload, cfg, reg, cwd, now = new Date() }) {
  if (!['session', 'decision', 'estado'].includes(sub)) throw new Error(`Subcomando desconocido: ${sub} (usa session, decision o estado)`);
  const project = findByPath(reg, cwd);
  if (!project) throw new Error('No estás dentro de un proyecto registrado en HQ');
  if (sub === 'session') {
    if (typeof payload?.summary !== 'string' || !payload.summary.trim()) throw new Error('session: falta "summary"');
    return writeSession(cfg, project.slug, {
      sessionId: `manual-${hms(now)}`,
      activeTask: String(payload.activeTask ?? '').trim() || 'ninguna',
      changes: String(payload.changes ?? '').trim() || 'n/d',
      summary: payload.summary,
    }, now);
  }
  if (sub === 'decision') return addDecision(cfg, project.slug, payload, now);
  return setProjectEstado(cfg, project.slug, payload?.estado);
}

if (isMain(import.meta.url)) {
  try {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    const cfg = loadConfig();
    const r = runVaultCli({ sub: process.argv[2], payload, cfg, reg: loadRegistry(cfg.registryFile), cwd: process.cwd() });
    console.log(r.written ? `Guardado: ${r.path}` : `Ya existía (no se sobrescribió): ${r.path}`);
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
}
