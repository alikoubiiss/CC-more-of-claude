import { loadConfig } from '../lib/config.mjs';
import { isMain } from '../lib/cli.mjs';
import { readMilestones } from '../lib/backlog-task.mjs';
import { ymd } from '../lib/dates.mjs';
import { activePhase, approvePhase, projectPhases, setFases } from '../lib/fases.mjs';
import { findByPath, loadRegistry } from '../lib/registry.mjs';
import { realRunner } from '../lib/tools.mjs';

const SUBS = ['set', 'status', 'approve'];

// Solo `approve` exige una terminal interactiva: la aprobación es de una persona.
export function exigeTerminalInteractiva(sub, { stdinTTY, stdoutTTY } = {}) {
  if (sub !== 'approve' || (stdinTTY && stdoutTTY)) return null;
  return 'la aprobación de fases debe hacerla una persona desde una terminal interactiva (cc o tu propia terminal)';
}

export function runFasesCli({ sub, payload, args = [], repo, run = realRunner, now = new Date() }) {
  if (!SUBS.includes(sub)) throw new Error(`Subcomando desconocido: ${sub} (usa set, status o approve)`);
  if (sub === 'set') {
    const data = setFases(repo, payload?.fases);
    const existentes = new Set(readMilestones(repo).map((m) => m.title.toLowerCase()));
    const creados = [];
    for (const f of data.fases) {
      if (existentes.has(f.milestone.toLowerCase())) continue;
      const r = run('backlog', ['milestone', 'add', f.milestone], { cwd: repo });
      if (r.status !== 0) throw new Error(`fases: no se pudo crear el hito "${f.milestone}": ${(r.stderr || r.stdout).trim().slice(0, 200)} — vuelve a ejecutar "set"`);
      creados.push(f.milestone);
    }
    return { fases: projectPhases(repo), creados };
  }
  if (sub === 'status') {
    const fases = projectPhases(repo);
    return { fases, activa: activePhase(fases)?.nombre ?? null };
  }
  if (!args[0]) throw new Error('fases: indica el id de la fase (por ejemplo f1)');
  return approvePhase(repo, args[0], ymd(now));
}

if (isMain(import.meta.url)) {
  try {
    const [sub, ...args] = process.argv.slice(2);
    if (!SUBS.includes(sub)) throw new Error(`Subcomando desconocido: ${sub} (usa set, status o approve)`);
    const bloqueo = exigeTerminalInteractiva(sub, { stdinTTY: process.stdin.isTTY, stdoutTTY: process.stdout.isTTY });
    if (bloqueo) throw new Error(bloqueo);
    let payload = {};
    if (sub === 'set') {
      const chunks = [];
      for await (const c of process.stdin) chunks.push(c);
      payload = JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '') || '{}');
    }
    const cfg = loadConfig();
    const project = findByPath(loadRegistry(cfg.registryFile), process.cwd());
    if (!project) throw new Error('No estás dentro de un proyecto registrado en HQ');
    console.log(JSON.stringify(runFasesCli({ sub, payload, args, repo: project.path }), null, 2));
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exitCode = 1;
  }
}
