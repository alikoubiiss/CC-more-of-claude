import { loadConfig } from '../lib/config.mjs';
import { loadRegistry } from '../lib/registry.mjs';
import { buildSessionContext, projectPaths } from '../lib/state.mjs';

try {
  const cfg = loadConfig();
  const reg = loadRegistry(cfg.registryFile);
  const cwd = process.cwd();
  const ctx = buildSessionContext(cfg, reg, cwd);
  if (!ctx) {
    console.log('No estás dentro de un proyecto HQ.');
  } else {
    const p = projectPaths(cfg, reg, cwd);
    console.log(ctx);
    console.log(`Índice: ${p.index}`);
    console.log(`Último resumen (/guardar): ${p.lastManual ?? 'ninguno'}`);
    console.log(`Último auto-snapshot: ${p.lastAuto ?? 'ninguno'}`);
  }
} catch (e) {
  console.error(`Error: ${e.message}`);
  process.exit(1);
}
