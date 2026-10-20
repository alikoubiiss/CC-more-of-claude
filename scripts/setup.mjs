// Crea ~/.project-hq/config.json con rutas propias (no pisa uno existente).
// Uso: node scripts/setup.mjs [--vault <ruta>] [--proyectos <ruta>] [--perfil-nlm <nombre>] [--puerto <n>]
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { USER_CONFIG } from '../lib/config.mjs';

export function buildConfig(opts = {}, home = os.homedir()) {
  const dataDir = path.join(home, '.project-hq');
  return {
    vaultPath: opts.vault ?? path.join(home, 'ProjectHQ-vault'),
    projectsRoot: opts.proyectos ?? path.join(home, 'proyectos'),
    vaultProjectsDir: 'Proyectos',
    nlmProfile: opts['perfil-nlm'] ?? 'hq',
    basePort: Number(opts.puerto ?? 6430),
    backupsDir: 'backups',
    dataDir,
    eventsRetentionDays: 7,
    conocimientoDir: 'Conocimiento',
    presupuesto: { diaUsd: 50, tarjetaUsd: 15 },
  };
}

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--') || argv[i + 1] === undefined) throw new Error(`argumento no válido: ${argv[i]}`);
    out[argv[i].slice(2)] = argv[i + 1];
  }
  return out;
}

export function setup(opts = {}, file = USER_CONFIG, home = os.homedir()) {
  if (existsSync(file)) return { created: false, file };
  const cfg = buildConfig(opts, home);
  for (const dir of [path.dirname(file), cfg.vaultPath, cfg.projectsRoot]) mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
  return { created: true, file, cfg };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const r = setup(parseArgs(process.argv.slice(2)));
    if (!r.created) console.log(`Ya existe ${r.file}; no se toca. Bórralo para empezar de cero.`);
    else {
      console.log(`Creado ${r.file}`);
      console.log(`  vault: ${r.cfg.vaultPath}\n  proyectos: ${r.cfg.projectsRoot}`);
      console.log('Siguiente: abre el vault con Obsidian, ejecuta "nlm login --profile ' + r.cfg.nlmProfile + '" y comprueba con: node scripts/doctor.mjs');
    }
  } catch (e) { console.error(`Error: ${e.message}`); process.exit(1); }
}
