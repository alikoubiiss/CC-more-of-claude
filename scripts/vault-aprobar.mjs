import { loadConfig } from '../lib/config.mjs';
import { isMain } from '../lib/cli.mjs';
import { aprobar } from '../lib/destilar.mjs';

export function runVaultAprobar({ argv = [], cfg, ahora = new Date() }) {
  const rechazar = argv.includes('--rechazar');
  const resto = argv.filter((a) => a !== '--rechazar');
  if (resto.length !== 1 || resto[0].startsWith('--')) throw new Error('uso: vault-aprobar <lote|ruta-de-la-nota> [--rechazar]');
  if (!cfg.vaultPersonalDestino) throw new Error('config: falta "vaultPersonalDestino" en config.json');
  const r = aprobar({ destino: cfg.vaultPersonalDestino, objetivo: resto[0], rechazar, ahora });
  if (!r.cambiadas.length) return { codigo: 0, lineas: ['No había borradores que cambiar para ese objetivo.'] };
  return { codigo: 0, lineas: [`✔ ${r.cambiadas.length} notas ${rechazar ? 'rechazadas (borradores borrados)' : 'aprobadas'}:`, ...r.cambiadas.map((x) => `  ${x}`)] };
}

if (isMain(import.meta.url)) {
  try {
    const r = runVaultAprobar({ argv: process.argv.slice(2), cfg: loadConfig() });
    console.log(r.lineas.join('\n'));
    process.exit(r.codigo);
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
}
