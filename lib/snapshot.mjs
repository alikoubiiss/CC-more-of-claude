import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findByPath } from './registry.mjs';
import { activeTasks } from './state.mjs';
import { writeSession } from './vault.mjs';

export const DEBOUNCE_MS = 10 * 60 * 1000;

function lastWrite(file) {
  if (!existsSync(file)) return 0;
  try {
    return Number(JSON.parse(readFileSync(file, 'utf8')).at) || 0;
  } catch {
    return 0;
  }
}

export function snapshotSession({ cfg, reg, input, run, now = new Date(), stateDir = os.tmpdir(), force = false, event = 'Stop' }) {
  const project = findByPath(reg, input.cwd ?? '');
  if (!project) return { written: false, reason: 'sin-proyecto' };
  const sid = String(input.session_id ?? 'sin-id').replace(/[^\w-]/g, '').slice(0, 8) || 'sin-id';
  const stateFile = path.join(stateDir, `hq-snap-${sid}.json`);
  if (!force && now.getTime() - lastWrite(stateFile) < DEBOUNCE_MS) return { written: false, reason: 'debounce' };

  const diff = run('git', ['diff', '--shortstat'], { cwd: project.path });
  const changes = diff.status === 0 && diff.stdout.trim() ? diff.stdout.trim() : 'sin cambios';
  const activeTask = activeTasks(project.path).map((t) => `${t.id} ${t.title}`).join(' | ') || 'ninguna';
  const r = writeSession(cfg, project.slug, {
    sessionId: sid, activeTask, changes,
    summary: `Auto-snapshot (${event}). Para un resumen real usa /guardar.`,
  }, now);
  if (!force) writeFileSync(stateFile, JSON.stringify({ at: now.getTime() }), 'utf8');
  return r;
}
