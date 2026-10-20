// Uso: node scripts/modelo-tarjeta.mjs <id> [--registrar ejecutor|revisor] [--repo <ruta>]
// Imprime en JSON el modelo y el esfuerzo con que ejecutar y revisar la tarjeta (ver lib/modelo-tarjeta.mjs).
// Con --registrar deja en la tarjeta el rastro `Modelo: <alias>/<esfuerzo> intento <n>` con el autor @<rol>.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { readTasks } from '../lib/backlog-task.mjs';
import { isMain } from '../lib/cli.mjs';
import { loadConfig } from '../lib/config.mjs';
import { modeloTarjeta, textoRegistro } from '../lib/modelo-tarjeta.mjs';
import { findByPath, loadRegistry } from '../lib/registry.mjs';
import { realRunner } from '../lib/tools.mjs';

export const ROLES = ['ejecutor', 'revisor'];

// Proyecto de la carpeta actual: el registrado en HQ y, si no lo hay, la carpeta más cercana con backlog/tasks.
export function localizarRepo(cwd, { registro = () => loadRegistry(loadConfig().registryFile) } = {}) {
  try {
    const p = findByPath(registro(), cwd);
    if (p) return p.path;
  } catch {
    // sin config o registro legible: se busca backlog/ hacia arriba
  }
  let dir = path.resolve(cwd);
  for (;;) {
    if (existsSync(path.join(dir, 'backlog', 'tasks'))) return dir;
    const padre = path.dirname(dir);
    if (padre === dir) break;
    dir = padre;
  }
  throw new Error(`No estás dentro de un proyecto HQ ni de una carpeta con backlog/tasks (${cwd})`);
}

const numero = (id) => String(id).match(/(\d+(?:\.\d+)?)\s*$/)?.[1] ?? null;

export function buscarTarjeta(tasks, id) {
  const q = String(id ?? '').trim().toLowerCase();
  if (!q) return null;
  return tasks.find((t) => String(t.id).toLowerCase() === q)
    ?? (/^\d+(\.\d+)?$/.test(q) ? tasks.find((t) => numero(t.id) !== null && Number(numero(t.id)) === Number(q)) : null)
    ?? null;
}

export function parseArgs(argv) {
  const out = { id: null, registrar: null, repo: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--registrar') out.registrar = argv[++i] ?? '';
    else if (a === '--repo') out.repo = argv[++i] ?? '';
    else if (a.startsWith('--')) throw new Error(`Opción desconocida: ${a} (usa --registrar <ejecutor|revisor> o --repo <ruta>)`);
    else if (!out.id) out.id = a;
    else throw new Error(`Sobra el argumento: ${a}`);
  }
  if (!out.id) throw new Error('Indica el id de la tarjeta, por ejemplo: node modelo-tarjeta.mjs TASK-3');
  if (out.registrar !== null && !ROLES.includes(out.registrar)) throw new Error(`--registrar debe ser ${ROLES.join(' o ')}`);
  return out;
}

export function runModeloTarjeta({ id, repo, registrar = null, run = realRunner }) {
  const tasks = readTasks(repo);
  const task = buscarTarjeta(tasks, id);
  if (!task) throw new Error(`No existe la tarjeta ${id} en ${path.join(repo, 'backlog', 'tasks')}`);
  const r = modeloTarjeta(task, { allTasks: tasks });
  if (!registrar) return r;
  if (r.parar && registrar === 'ejecutor') throw new Error(`${task.id}: ${r.mensaje}`);
  const texto = registrar === 'revisor' ? textoRegistro(r.revisorModel, r.revisorEffort, r.intento) : textoRegistro(r.model, r.effort, r.intento);
  const res = run('backlog', ['task', 'edit', task.id, '--comment', texto, '--comment-author', `@${registrar}`], { cwd: repo });
  if (res.status !== 0) throw new Error(`backlog no pudo añadir el comentario: ${(res.stderr || res.stdout).trim().slice(0, 200)}`);
  return { ...r, registrado: texto };
}

if (isMain(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const repo = args.repo ? path.resolve(args.repo) : localizarRepo(process.cwd());
    console.log(JSON.stringify(runModeloTarjeta({ id: args.id, repo, registrar: args.registrar }), null, 2));
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exitCode = 1;
  }
}
