import { loadConfig } from '../lib/config.mjs';
import { isMain } from '../lib/cli.mjs';
import { revisar } from '../lib/vp-indice.mjs';

export function runVaultRevisar({ argv = [], cfg, ahora = new Date() }) {
  if (argv.length) throw new Error(`argumento desconocido: ${argv[0]} (este comando no lleva opciones)`);
  if (!cfg.vaultPersonalDestino) throw new Error('config: falta "vaultPersonalDestino" en config.json');
  const r = revisar({ destino: cfg.vaultPersonalDestino, ahora });
  const limpio = !r.huerfanas.length && !r.rotos.length && !r.borradoresAntiguos.length;
  return {
    codigo: 0,
    lineas: limpio ? ['✔ Wiki en orden: sin huérfanas, sin enlaces rotos y sin borradores antiguos.'] : [
      ...(r.huerfanas.length ? ['Notas huérfanas (nadie las enlaza):', ...r.huerfanas.map((x) => `  ${x}`)] : []),
      ...(r.rotos.length ? ['Enlaces rotos:', ...r.rotos.map((x) => `  ${x.rel} → [[${x.destino}]]`)] : []),
      ...(r.borradoresAntiguos.length ? ['Borradores de más de 14 días (aprueba o rechaza):', ...r.borradoresAntiguos.map((x) => `  ${x}`)] : []),
    ],
  };
}

if (isMain(import.meta.url)) {
  try {
    const r = runVaultRevisar({ argv: process.argv.slice(2), cfg: loadConfig() });
    console.log(r.lineas.join('\n'));
    process.exit(r.codigo);
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
}
