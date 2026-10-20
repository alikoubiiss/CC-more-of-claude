import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { readTasks } from './backlog-task.mjs';
import { activePhase, projectPhases } from './fases.mjs';
import { findByPath } from './registry.mjs';
import { lastSession, listDecisions, projectDir } from './vault.mjs';

export const MAX_CONTEXT = 1200;

export function parseFrontmatter(text) {
  const m = text.replace(/^﻿/, '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { data: {}, body: text };
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (kv) data[kv[1]] = kv[2].replace(/^["']|["']$/g, '').trim();
  }
  return { data, body: text.replace(/^﻿/, '').slice(m[0].length) };
}

function tasksWithStatus(repoPath, status) {
  return readTasks(repoPath)
    .filter((t) => t.status.toLowerCase() === status)
    .map((t) => ({ id: t.id, title: t.title, labels: t.labels, milestone: t.milestone }));
}

export const activeTasks = (repoPath) => tasksWithStatus(repoPath, 'en curso');
export const reviewTasks = (repoPath) => tasksWithStatus(repoPath, 'verificando');

// Tarjeta a la que se atribuye el gasto: la primera «En curso» y, si no hay, la de «Verificando» aún sin `revisada`
// tocada más recientemente (la que /revisar está revisando). Las ya revisadas esperan al usuario: no gastan.
export function tarjetaActual(repoPath) {
  const tasks = readTasks(repoPath);
  const enCurso = tasks.find((t) => t.status.toLowerCase() === 'en curso');
  if (enCurso) return { id: enCurso.id, title: enCurso.title };
  const revisando = tasks
    .filter((t) => t.status.toLowerCase() === 'verificando' && !t.labels.includes('revisada'))
    .sort((a, b) => String(b.updated).localeCompare(String(a.updated)))[0];
  return revisando ? { id: revisando.id, title: revisando.title } : null;
}

export function buildSessionContext(cfg, reg, cwd) {
  const project = findByPath(reg, cwd);
  if (!project) return null;
  let estado = 'desconocido';
  const idx = path.join(projectDir(cfg, project.slug), 'Índice.md');
  if (existsSync(idx)) estado = parseFrontmatter(readFileSync(idx, 'utf8')).data.estado || estado;
  const active = activeTasks(project.path);
  const review = reviewTasks(project.path);
  const esperando = review.filter((t) => t.labels.includes('revisada'));
  const porRevisar = review.filter((t) => !t.labels.includes('revisada'));
  const decisions = listDecisions(cfg, project.slug, 3);
  let fase = null;
  try {
    fase = activePhase(projectPhases(project.path));
  } catch {
    // fases.json dañado: se ignora en el contexto de arranque
  }
  const indiceConocimiento = cfg.conocimientoPath ? path.join(cfg.conocimientoPath, 'index.md') : null;
  const conocimiento = indiceConocimiento && existsSync(indiceConocimiento) ? indiceConocimiento : null;
  const lista = (ts) => ts.map((t) => `${t.id} ${t.title}`).join(' | ');
  const text = [
    `[Project HQ] ${project.display} (${project.slug}) · estado: ${estado}`,
    fase
      ? (fase.estado === 'esperando'
        ? `Fase "${fase.nombre}" lista (${fase.hechas}/${fase.total}): esperando tu aprobación en cc`
        : `Fase activa: ${fase.nombre} (${fase.hechas}/${fase.total})`)
      : null,
    active.length ? `Tarjeta activa: ${lista(active)}` : 'Sin tarjeta activa: usa /ejecutar siguiente',
    esperando.length ? `Esperando tu visto bueno: ${lista(esperando)}` : null,
    porRevisar.length ? `Por revisar: ${lista(porRevisar)} → /revisar` : null,
    decisions.length ? `Últimas decisiones: ${decisions.map((d) => `${d.date} ${d.title}`).join(' · ')}` : 'Sin decisiones registradas',
    conocimiento ? `Conocimiento: ${conocimiento} (lee solo la nota que encaje, no la carpeta)` : null,
    'Tablero: cc board (terminal; ahí apruebas) · Comandos: /retomar /ejecutar /revisar /guardar',
  ].filter(Boolean).join('\n');
  return text.length > MAX_CONTEXT ? text.slice(0, MAX_CONTEXT - 3) + '...' : text;
}

export function projectPaths(cfg, reg, cwd) {
  const project = findByPath(reg, cwd);
  if (!project) return null;
  return { project, index: path.join(projectDir(cfg, project.slug), 'Índice.md'), lastSession: lastSession(cfg, project.slug),
    lastManual: lastSession(cfg, project.slug, { kind: 'manual' }), lastAuto: lastSession(cfg, project.slug, { kind: 'auto' }) };
}
