import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { readMilestones, readTasks } from './backlog-task.mjs';

export const fasesFile = (repo) => path.join(repo, '.hq', 'fases.json');

export function loadFases(repo) {
  const file = fasesFile(repo);
  if (!existsSync(file)) return { fases: [] };
  let data;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`fases: ${file} está dañado (${e.message})`);
  }
  if (!data || !Array.isArray(data.fases)) throw new Error(`fases: ${file} está dañado (falta "fases")`);
  return data;
}

export function saveFases(repo, data) {
  const file = fasesFile(repo);
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  renameSync(tmp, file);
}

const NOMBRE_RE = /^[^\r\n"'`$%&|<>^\\]{1,40}$/;
const nombreValido = (n) => typeof n === 'string' && NOMBRE_RE.test(n.trim())
  && !/[\u0000-\u001f\u007f]/.test(n) && !/^[-.]/.test(n.trim()) && !n.trim().endsWith('.');

/** Las aprobaciones se conservan solo por NOMBRE exacto de fase: renombrar una fase pierde su aprobación. */
export function setFases(repo, nombres) {
  if (!Array.isArray(nombres) || nombres.length < 1 || nombres.length > 8) throw new Error('fases: indica entre 1 y 8 fases');
  for (const n of nombres) if (!nombreValido(n)) throw new Error(`fases: nombre no válido: "${typeof n === 'string' ? n : JSON.stringify(n)}"`);
  const limpios = nombres.map((n) => n.trim());
  if (new Set(limpios.map((n) => n.toLowerCase())).size !== limpios.length) throw new Error('fases: hay nombres repetidos');
  const previas = loadFases(repo).fases;
  const data = {
    fases: limpios.map((nombre, i) => ({
      id: `f${i + 1}`, nombre, milestone: nombre, aprobada: previas.find((p) => p.nombre === nombre)?.aprobada ?? null,
    })),
  };
  saveFases(repo, data);
  return data;
}

export function derivePhases(data, tasks, milestones) {
  let hayCandidata = false;
  return data.fases.map((f) => {
    const ms = milestones.find((m) => m.title === f.milestone);
    const propias = tasks.filter((t) => t.milestone && (t.milestone === f.milestone || (ms && t.milestone === ms.id)));
    const total = propias.length;
    const hechas = propias.filter((t) => t.status.toLowerCase() === 'hecho').length;
    let estado;
    if (f.aprobada) estado = 'aprobada';
    else if (hayCandidata) estado = 'pendiente';
    else {
      hayCandidata = true;
      estado = total > 0 && hechas === total ? 'esperando' : 'activa';
    }
    return { ...f, estado, total, hechas };
  });
}

export const activePhase = (derived) => derived.find((f) => f.estado === 'activa' || f.estado === 'esperando') ?? null;

export const projectPhases = (repo) => derivePhases(loadFases(repo), readTasks(repo), readMilestones(repo));

/** `force` es solo para recuperación manual: permite aprobar una fase fuera de orden o sin estar lista. */
export function approvePhase(repo, id, date, { force = false } = {}) {
  const data = loadFases(repo);
  const f = derivePhases(data, readTasks(repo), readMilestones(repo)).find((x) => x.id === id);
  if (!f) throw new Error(`fases: no existe la fase "${id}"`);
  if (f.estado === 'aprobada') throw new Error(`fases: la fase "${f.nombre}" ya está aprobada`);
  if (f.estado !== 'esperando' && !force) {
    throw new Error(`fases: la fase "${f.nombre}" no está lista (${f.hechas}/${f.total} tarjetas hechas)`);
  }
  data.fases.find((x) => x.id === id).aprobada = date;
  saveFases(repo, data);
  return { ...f, estado: 'aprobada', aprobada: date };
}
