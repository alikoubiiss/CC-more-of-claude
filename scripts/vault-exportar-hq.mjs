import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { HQ_ROOT, loadConfig } from '../lib/config.mjs';
import { isMain } from '../lib/cli.mjs';
import { exportar } from '../lib/exportar-hq.mjs';

export function leerTerminos(dir = HQ_ROOT) {
  const f = path.join(dir, 'vault-redactor.json');
  if (!existsSync(f)) return [];
  try {
    const t = JSON.parse(readFileSync(f, 'utf8')).terminos;
    return Array.isArray(t) ? t.map(String) : [];
  } catch (e) {
    throw new Error(`no se pudo leer ${f}: ${e.message}`);
  }
}

export function runVaultExportar({ argv = [], cfg, terminos = leerTerminos(), ahora = new Date() }) {
  if (argv.length) throw new Error(`argumento desconocido: ${argv[0]} (este comando no lleva opciones)`);
  if (!cfg.vaultPersonalDestino) throw new Error('config: falta "vaultPersonalDestino" en config.json');
  const r = exportar({ destino: cfg.vaultPersonalDestino, conocimiento: cfg.conocimientoPath, terminos, ahora });
  const lineas = [`✔ ${r.exportadas.length} notas exportadas a ${cfg.conocimientoPath}`, ...r.exportadas.map((x) => `  ${x}`)];
  if (r.retenidas.length) {
    lineas.push(`${r.retenidas.length} notas retenidas (no salen del vault personal):`, ...r.retenidas.map((x) => `  ${x.rel}: ${x.motivo}`));
    lineas.push('Revísalas en Obsidian: si el contenido es correcto pon "revisar-privacidad: false" y vuelve a exportar (se exportará redactado).');
  }
  if (r.obsoletas.length) lineas.push(`Ya no se comparten pero siguen en HQ (bórralas tú si quieres): ${r.obsoletas.join(', ')}`);
  return { codigo: 0, lineas };
}

if (isMain(import.meta.url)) {
  try {
    const r = runVaultExportar({ argv: process.argv.slice(2), cfg: loadConfig() });
    console.log(r.lineas.join('\n'));
    process.exit(r.codigo);
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
}
