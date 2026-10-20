import { loadConfig } from '../lib/config.mjs';
import { isMain } from '../lib/cli.mjs';
import { aplicar, planificar } from '../lib/vault-enlazar.mjs';

const OPCIONES = ['--simular'];

const porNota = (cambios) => cambios.map((c) => `  - ${c.rel}: ${c.cambios.join(', ')}`);
const deAvisos = (avisos) => [`Avisos: ${avisos.length}`, ...avisos.map((a) => `  - ${a.rel}: ${a.error}`)];

export function runVaultEnlazar({ argv = [], cfg, ahora = new Date() }) {
  const raro = argv.find((a) => !OPCIONES.includes(a));
  if (raro) throw new Error(`argumento desconocido: ${raro} (usa ${OPCIONES.join(' o ')})`);
  const plan = planificar({ vaultPath: cfg.vaultPath, vaultProjectsDir: cfg.vaultProjectsDir });
  const n = plan.cambios.length;
  if (argv.includes('--simular')) {
    return {
      codigo: 0,
      lineas: [`Simulación (no se ha escrito nada): ${n} cambios en ${plan.dir} (${plan.revisadas} notas revisadas)`, ...porNota(plan.cambios), ...deAvisos(plan.avisos)],
    };
  }
  if (!n) return { codigo: 0, lineas: [`0 cambios en ${plan.dir}: las ${plan.revisadas} notas ya siguen la convención`, ...deAvisos(plan.avisos)] };
  const r = aplicar(plan, { backupsDir: cfg.backupsDir, ahora });
  const ok = r.omitidas.length === 0;
  const escritas = new Set(r.escritas);
  return {
    codigo: ok ? 0 : 1,
    lineas: [
      `${ok ? '✔' : '✖'} ${r.escritas.length} cambios aplicados en ${plan.dir}${ok ? '' : ` (${r.omitidas.length} sin aplicar)`}`,
      `Copia de seguridad: ${r.backup}`,
      ...porNota(plan.cambios.filter((c) => escritas.has(c.rel))),
      ...deAvisos([...plan.avisos, ...r.omitidas]),
    ],
  };
}

if (isMain(import.meta.url)) {
  try {
    const r = runVaultEnlazar({ argv: process.argv.slice(2), cfg: loadConfig() });
    console.log(r.lineas.join('\n'));
    process.exit(r.codigo);
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
}
