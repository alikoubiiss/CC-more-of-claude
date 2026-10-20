// Uso: node scripts/lint-tarjetas.mjs [TASK-n ...] [--todas] [--json] [--repo <ruta>]
// Sin ids revisa las tarjetas en "Planificado". Sale con código 1 si hay errores (los avisos no cuentan).
import path from 'node:path';
import { readTasks } from '../lib/backlog-task.mjs';
import { isMain } from '../lib/cli.mjs';
import { formatear, lintTarjetas } from '../lib/lint-tarjetas.mjs';
import { localizarRepo } from './modelo-tarjeta.mjs';

export function parseLintArgs(argv) {
  const out = { ids: [], todas: false, json: false, repo: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--todas') out.todas = true;
    else if (a === '--json') out.json = true;
    else if (a === '--repo') out.repo = argv[++i] ?? '';
    else if (a.startsWith('--')) throw new Error(`Opción desconocida: ${a} (usa --todas, --json o --repo <ruta>)`);
    else out.ids.push(a);
  }
  return out;
}

export function runLint({ repo, ids = [], todas = false }) {
  return lintTarjetas(readTasks(repo), { ids, todas });
}

if (isMain(import.meta.url)) {
  try {
    const args = parseLintArgs(process.argv.slice(2));
    const repo = args.repo ? path.resolve(args.repo) : localizarRepo(process.cwd());
    const res = runLint({ repo, ids: args.ids, todas: args.todas });
    const alcance = args.ids.length ? args.ids.join(', ') : args.todas ? 'todas menos Hecho' : 'Planificado';
    console.log(args.json ? JSON.stringify(res, null, 2) : formatear(res, { alcance }));
    if (args.ids.length && res.revisadas < args.ids.length) {
      console.error('Error: alguno de los ids indicados no existe');
      process.exitCode = 1;
    } else if (res.errores) process.exitCode = 1;
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exitCode = 1;
  }
}
