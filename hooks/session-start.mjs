import { loadConfig } from '../lib/config.mjs';
import { contextOutput, readHookInput } from '../lib/hookio.mjs';
import { logError } from '../lib/log.mjs';
import { appendMetric } from '../lib/metrics.mjs';
import { findByPath, loadRegistry } from '../lib/registry.mjs';
import { sid8 } from '../lib/session-state.mjs';
import { buildSessionContext } from '../lib/state.mjs';

let cfg = null;
try {
  const input = await readHookInput();
  cfg = loadConfig();
  const reg = loadRegistry(cfg.registryFile);
  const cwd = input.cwd ?? process.cwd();
  const ctx = buildSessionContext(cfg, reg, cwd);
  if (ctx) {
    process.stdout.write(contextOutput('SessionStart', ctx));
    // Contexto inyectado al empezar: solo la longitud, para ver cuánto cuesta arrancar. Un fallo no afecta al contexto.
    try {
      const project = findByPath(reg, cwd);
      if (project) appendMetric(cfg, project.slug, { t: new Date().toISOString(), sid: sid8(input.session_id), kind: 'inicio', chars: ctx.length });
    } catch (e) {
      logError(cfg, `session-start-metricas: ${e.message}`);
    }
  }
} catch (e) {
  logError(cfg, `session-start: ${e.message}`);
}
process.exitCode = 0;
