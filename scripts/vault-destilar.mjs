import { loadConfig } from '../lib/config.mjs';
import { isMain } from '../lib/cli.mjs';
import { destilar } from '../lib/destilar.mjs';

export async function runVaultDestilar({ argv = [], cfg, run, ahora = new Date() }) {
  let categoria;
  let limite;
  let confirmar = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--si') confirmar = true;
    else if (a === '--categoria') categoria = argv[++i];
    else if (a === '--limite') limite = Number(argv[++i]);
    else throw new Error(`argumento desconocido: ${a} (usa --categoria <nombre>, --limite <n>, --si)`);
  }
  if (categoria !== undefined && !categoria) throw new Error('--categoria necesita un nombre');
  if (limite !== undefined && (!Number.isInteger(limite) || limite < 0)) throw new Error('--limite debe ser un entero ≥ 0');
  if (!cfg.vaultPersonalDestino) throw new Error('config: falta "vaultPersonalDestino" en config.json');
  const r = await destilar({ destino: cfg.vaultPersonalDestino, run, confirmar, categoria, limite, ahora });
  const tabla = r.lotes.map((l) => `  ${l.id}: ${l.estimacion.chats} chats, ~${l.estimacion.tokensAprox} tokens de entrada`);
  const total = r.lotes.reduce((s, l) => s + l.estimacion.tokensAprox, 0);
  if (!r.ejecutado) {
    return { codigo: 0, lineas: [`Estimación (no se ha llamado al modelo): ${r.lotes.length} lotes, ~${total} tokens de entrada en total`, ...tabla, 'Para ejecutar: añade --si (usa --categoria <nombre> para un piloto).'] };
  }
  return {
    codigo: 0,
    lineas: [`✔ ${r.escritas.length} notas borrador escritas en ${r.lotes.length} lotes`, ...r.escritas.map((x) => `  ${x}`), ...r.avisos.map((a) => `  aviso: ${a}`),
      'Revísalas en Obsidian y aprueba con: node scripts/vault-aprobar.mjs <lote|ruta> [--rechazar]'],
  };
}

if (isMain(import.meta.url)) {
  try {
    const r = await runVaultDestilar({ argv: process.argv.slice(2), cfg: loadConfig() });
    console.log(r.lineas.join('\n'));
    process.exit(r.codigo);
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
}
