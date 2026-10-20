import { loadConfig } from '../lib/config.mjs';
import { isMain } from '../lib/cli.mjs';
import { ejecutar } from '../lib/vp-migrar.mjs';

const OPCIONES = ['--dry-run', '--forzar-existente'];

export function runVaultMigrar({ argv = [], cfg, ahora = new Date() }) {
  const raro = argv.find((a) => !OPCIONES.includes(a));
  if (raro) throw new Error(`argumento desconocido: ${raro} (usa ${OPCIONES.join(' o ')})`);
  if (!cfg.vaultPersonalOrigen || !cfg.vaultPersonalDestino) throw new Error('config: faltan "vaultPersonalOrigen" y "vaultPersonalDestino" en config.json');
  const inf = ejecutar({
    origen: cfg.vaultPersonalOrigen, destino: cfg.vaultPersonalDestino, backupsDir: cfg.backupsDir, ahora,
    dryRun: argv.includes('--dry-run'), forzarExistente: argv.includes('--forzar-existente'),
  });
  const porTipo = Object.entries(inf.porTipo).map(([k, v]) => `${k}: ${v}`).join(', ');
  if (inf.dryRun) {
    return { codigo: 0, lineas: [`Simulación (no se ha escrito nada). Por tipo: ${porTipo}`, `Avisos: ${inf.avisos.length}`, ...inf.avisos.map((a) => `  - ${a.rel}: ${a.error}`)] };
  }
  const ok = inf.verificacion.ok;
  return {
    codigo: ok ? 0 : 1,
    lineas: [
      `${ok ? '✔' : '✖'} Migración ${ok ? 'verificada' : 'con errores'}: ${inf.migradas} ficheros en ${inf.destino}`,
      `Copia de seguridad: ${inf.backup.dir}`,
      `Por tipo: ${porTipo} · avisos: ${inf.avisos.length} · enlaces sin destino: ${inf.rotos.length}`,
      ...inf.verificacion.detalles.map((d) => `  - ${d}`),
      `Informe: ${inf.destino}\\_migracion\\informe.md`,
    ],
  };
}

if (isMain(import.meta.url)) {
  try {
    const r = runVaultMigrar({ argv: process.argv.slice(2), cfg: loadConfig() });
    console.log(r.lineas.join('\n'));
    process.exit(r.codigo);
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
}
