import { loadConfig } from '../lib/config.mjs';
import { isMain } from '../lib/cli.mjs';
import { compartir } from '../lib/destilar.mjs';

export function runVaultCompartir({ argv = [], cfg, ahora = new Date() }) {
  if (argv.length !== 2) throw new Error('uso: vault-compartir <lote|ruta|*> <hq|privado>');
  if (!cfg.vaultPersonalDestino) throw new Error('config: falta "vaultPersonalDestino" en config.json');
  const [objetivo, valor] = argv;
  const r = compartir({ destino: cfg.vaultPersonalDestino, objetivo, valor, ahora });
  return { codigo: 0, lineas: [r.cambiadas.length ? `✔ ${r.cambiadas.length} notas marcadas como compartir: ${valor}` : 'No había notas que cambiar para ese objetivo.'] };
}

if (isMain(import.meta.url)) {
  try {
    const r = runVaultCompartir({ argv: process.argv.slice(2), cfg: loadConfig() });
    console.log(r.lineas.join('\n'));
    process.exit(r.codigo);
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
}
