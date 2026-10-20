import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ymd } from '../lib/dates.mjs';
import { loadConfig } from '../lib/config.mjs';
import { validateName } from '../lib/names.mjs';
import { allocatePort, loadRegistry, saveRegistry, upsertProject } from '../lib/registry.mjs';
import { loadTemplate, render } from '../lib/templates.mjs';
import * as tools from '../lib/tools.mjs';
import { isMain } from '../lib/cli.mjs';
import { createProjectIndex } from '../lib/vault.mjs';

export async function newProject({ name, cfg, run = tools.realRunner, now = new Date(), board = tools.startBoard, open = tools.openUrl, web = false }) {
  const v = validateName(name);
  if (!v.ok) throw new Error(v.error);
  const { slug } = v;
  const display = v.display.replace(/\s+/g, ' ').trim().slice(0, 80);
  const steps = [];
  const step = (s, status, detail = '') => steps.push({ step: s, status, detail });

  const repo = path.join(cfg.projectsRoot, slug);
  const hqFile = path.join(repo, '.hq', 'project.json');
  let prev = {};
  if (existsSync(hqFile)) {
    try { prev = JSON.parse(readFileSync(hqFile, 'utf8')); } catch { prev = null; }
    if (prev === null || typeof prev !== 'object' || Array.isArray(prev)) {
      throw new Error(`proyecto: ${hqFile} está dañado o no es un objeto JSON; bórralo o corrígelo`);
    }
  }
  mkdirSync(repo, { recursive: true });

  const reg = loadRegistry(cfg.registryFile);
  const known = reg.projects.find((p) => p.slug === slug);
  const port = known?.port ?? prev.port ?? allocatePort(reg, cfg.basePort);
  upsertProject(reg, { slug, display, path: repo, port, notebookId: prev.notebookId ?? 'pendiente', created: prev.created ?? ymd(now) });
  saveRegistry(cfg.registryFile, reg);

  step('git', tools.gitInit(run, repo).skipped ? 'skipped' : 'ok');
  step('backlog', tools.backlogInit(run, repo, slug, port).skipped ? 'skipped' : 'ok');
  tools.setStatuses(repo);
  step('columnas', 'ok', tools.STATUSES.join(' → '));

  let notebookId = prev.notebookId && prev.notebookId !== 'pendiente' ? prev.notebookId : null;
  if (notebookId) {
    step('notebooklm', 'skipped', notebookId);
  } else {
    try {
      notebookId = tools.createNotebook(run, slug, cfg.nlmProfile);
      step('notebooklm', 'ok', notebookId);
    } catch (e) {
      notebookId = 'pendiente';
      // Sin tarjeta: las tarjetas las define el usuario tras su primer prompt. Solo se avisa de cómo arreglarlo.
      step('notebooklm', 'failed', `${e.message}. Ejecuta nlm login --profile ${cfg.nlmProfile} y repite /nuevo-proyecto (no pisa nada)`);
    }
  }

  const vaultNote = path.join(cfg.vaultProjectsDir, slug, 'Índice.md');
  mkdirSync(path.dirname(hqFile), { recursive: true });
  writeFileSync(hqFile, JSON.stringify({
    slug, display, port, notebookId, vaultNote, created: prev.created ?? ymd(now),
  }, null, 2) + '\n', 'utf8');

  const claudeFile = path.join(repo, 'CLAUDE.md');
  if (!existsSync(claudeFile)) {
    writeFileSync(claudeFile, render(loadTemplate('CLAUDE.md'), {
      display, slug, port, repoPath: repo, vaultNote: path.join(cfg.vaultPath, vaultNote), notebookId,
    }), 'utf8');
  }
  const archFile = path.join(repo, 'docs', 'ARQUITECTURA.md');
  if (!existsSync(archFile)) {
    mkdirSync(path.dirname(archFile), { recursive: true });
    writeFileSync(archFile, `# Arquitectura de ${display}\n\nPendiente: ejecuta /planificar.\n`, 'utf8');
  }
  step('archivos', 'ok', 'CLAUDE.md, docs/ARQUITECTURA.md, .hq/project.json');

  const idx = createProjectIndex(cfg, { slug, display, path: repo, port, notebookId }, now);
  step('vault', idx.written ? 'ok' : 'skipped', idx.path);

  upsertProject(reg, { slug, display, path: repo, port, notebookId, created: prev.created ?? ymd(now) });
  saveRegistry(cfg.registryFile, reg);
  step('registro', 'ok');

  const url = `http://localhost:${port}`;
  if (!web) {
    // El tablero se usa y se aprueba desde la terminal (cc). El tablero web de Backlog.md es opcional (HQ_WEB=1).
    step('tablero', 'skipped', 'se usa cc en la terminal: ejecuta cc start');
  } else {
    try {
      await board(repo, port);
      open(url);
      step('tablero', 'ok', url);
    } catch (e) {
      step('tablero', 'failed', e.message);
    }
  }
  return { slug, repo, port, notebookId, url, steps };
}

if (isMain(import.meta.url)) {
  try {
    const report = await newProject({ name: process.argv.slice(2).join(' '), cfg: loadConfig(), web: process.env.HQ_WEB === '1' });
    const icon = { ok: '✓', skipped: '·', failed: '✗' };
    for (const s of report.steps) console.log(`${icon[s.status]} ${s.step}${s.detail ? ' — ' + s.detail : ''}`);
    console.log(`Repo: ${report.repo}\nTablero: en la terminal con cc (cc start desde la carpeta del proyecto)`);
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
}
