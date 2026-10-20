import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { hm, ymd } from './dates.mjs';
import { slugify } from './names.mjs';
import { loadTemplate, render } from './templates.mjs';

const SLUG_RE = /^[a-z0-9-]+$/;
const MODES = new Set(['create', 'backup', 'replace']);

export const projectDir = (cfg, slug) => path.join(cfg.vaultPath, cfg.vaultProjectsDir, slug);

function resolveInside(cfg, slug, rel) {
  if (!SLUG_RE.test(slug)) throw new Error(`vault: slug inválido: ${slug}`);
  const base = projectDir(cfg, slug);
  const full = path.resolve(base, rel);
  if (full !== base && !full.startsWith(base + path.sep)) throw new Error(`vault: ruta fuera del proyecto: ${rel}`);
  return full;
}

export function writeNote(cfg, slug, rel, content, { mode = 'create' } = {}) {
  if (!MODES.has(mode)) throw new Error(`vault: modo desconocido: ${mode}`);
  const full = resolveInside(cfg, slug, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  if (existsSync(full)) {
    if (mode === 'create') return { written: false, path: full };
    if (mode === 'backup') {
      const dir = path.join(cfg.backupsDir, slug);
      mkdirSync(dir, { recursive: true });
      copyFileSync(full, path.join(dir, `${Date.now()}-${path.basename(full)}.bak`));
    }
  }
  writeFileSync(full, content, 'utf8');
  return { written: true, path: full };
}

export function createProjectIndex(cfg, project, now = new Date()) {
  const content = render(loadTemplate('nota-proyecto.md'), {
    slug: project.slug, display: project.display, repoPath: project.path,
    port: project.port, notebookId: project.notebookId, date: ymd(now),
  });
  return writeNote(cfg, project.slug, 'Índice.md', content, { mode: 'create' });
}

export function addDecision(cfg, slug, d, now = new Date()) {
  for (const k of ['title', 'context', 'decision', 'why']) {
    if (typeof d?.[k] !== 'string' || !d[k].trim()) throw new Error(`decisión: falta el campo "${k}"`);
  }
  const content = render(loadTemplate('decision.md'), { slug, date: ymd(now), ...d });
  const name = `${ymd(now)}-${slugify(d.title).slice(0, 60).replace(/-+$/, '') || 'decision'}.md`;
  const dir = path.join(projectDir(cfg, slug), 'Decisiones');
  const base = name.slice(0, -3);
  let final = name;
  for (let i = 2; existsSync(path.join(dir, final)); i++) final = `${base}-${i}.md`;
  return writeNote(cfg, slug, `Decisiones/${final}`, content, { mode: 'create' });
}

export function listDecisions(cfg, slug, n = 3) {
  const dir = path.join(projectDir(cfg, slug), 'Decisiones');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .reverse()
    .slice(0, n)
    .map((file) => {
      const text = readFileSync(path.join(dir, file), 'utf8');
      const title = text.match(/^# (.+)$/m)?.[1]?.trim() ?? file;
      return { file, title, date: file.slice(0, 10) };
    });
}

export function writeSession(cfg, slug, s, now = new Date()) {
  if (typeof s?.sessionId !== 'string' || !/^[\w-]+$/.test(s.sessionId)) throw new Error(`vault: sessionId inválido: ${s?.sessionId}`);
  for (const k of ['activeTask', 'changes', 'summary']) {
    if (typeof s[k] !== 'string' || !s[k].trim()) throw new Error(`sesión: falta el campo "${k}"`);
  }
  const content = render(loadTemplate('sesion.md'), {
    slug, date: ymd(now), time: hm(now), sessionId: s.sessionId,
    activeTask: s.activeTask, changes: s.changes, summary: s.summary,
  });
  return writeNote(cfg, slug, `Sesiones/${ymd(now)}-${s.sessionId}.md`, content, { mode: 'replace' });
}

const isManual = (f) => /-manual-/.test(f);

// kind: 'manual' (resúmenes de /guardar), 'auto' (snapshots automáticos) o 'any'.
export function lastSession(cfg, slug, { kind = 'any' } = {}) {
  const dir = path.join(projectDir(cfg, slug), 'Sesiones');
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .filter((f) => kind === 'any' || (kind === 'manual') === isManual(f))
    .map((f) => ({ f, m: statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => a.m - b.m || (a.f < b.f ? -1 : a.f > b.f ? 1 : 0));
  return files.length ? path.join(dir, files[files.length - 1].f) : null;
}

export const ESTADOS = ['idea', 'planificado', 'en-curso', 'hecho'];

export function setProjectEstado(cfg, slug, estado) {
  if (!ESTADOS.includes(estado)) throw new Error(`estado inválido: ${estado} (válidos: ${ESTADOS.join(', ')})`);
  const full = resolveInside(cfg, slug, 'Índice.md');
  if (!existsSync(full)) throw new Error(`vault: no existe la nota índice del proyecto ${slug}`);
  const text = readFileSync(full, 'utf8');
  if (!/^estado:.*$/m.test(text)) throw new Error('vault: el índice no tiene la línea "estado:"');
  const next = text.replace(/^estado:.*$/m, `estado: ${estado}`);
  return writeNote(cfg, slug, 'Índice.md', next, { mode: 'backup' });
}
