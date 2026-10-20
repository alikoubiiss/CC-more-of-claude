import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { newProject } from '../scripts/new-project.mjs';
import { loadRegistry } from '../lib/registry.mjs';
import { fakeRunner, makeCfg, tmpDir } from './helpers.mjs';

const stubs = () => {
  const s = { boards: [], opened: [] };
  s.board = async (dir, port) => { s.boards.push([dir, port]); return { started: true }; };
  s.open = (url) => s.opened.push(url);
  return s;
};

test('crea repo, backlog con 5 columnas, CLAUDE.md, nota de vault, registro; el tablero web no se arranca (se usa hq)', async () => {
  const cfg = makeCfg(tmpDir());
  const run = fakeRunner();
  const s = stubs();
  const r = await newProject({ name: 'Bot de Telegram', cfg, run, board: s.board, open: s.open });
  assert.equal(r.slug, 'bot-de-telegram');
  assert.equal(r.repo, path.join(cfg.projectsRoot, 'bot-de-telegram'));
  assert.equal(r.port, 6430);
  assert.equal(r.url, 'http://localhost:6430');
  assert.ok(r.steps.filter((x) => x.step !== 'tablero').every((x) => x.status === 'ok'), JSON.stringify(r.steps));
  assert.equal(r.steps.find((x) => x.step === 'tablero').status, 'skipped');
  assert.match(r.steps.find((x) => x.step === 'tablero').detail, /cc/);
  assert.match(readFileSync(path.join(r.repo, 'backlog', 'config.yml'), 'utf8'), /"Verificando"/);
  const claude = readFileSync(path.join(r.repo, 'CLAUDE.md'), 'utf8');
  assert.ok(claude.split('\n').length <= 26);
  assert.match(claude, /11111111-2222-3333-4444-555555555555/);
  assert.equal(JSON.parse(readFileSync(path.join(r.repo, '.hq', 'project.json'), 'utf8')).slug, 'bot-de-telegram');
  assert.ok(existsSync(path.join(cfg.vaultPath, 'Proyectos', 'bot-de-telegram', 'Índice.md')));
  assert.equal(loadRegistry(cfg.registryFile).projects[0].display, 'Bot de Telegram');
  assert.deepEqual(s.opened, []);
  assert.deepEqual(s.boards, []);
});

test('con web: true (opcional) sí arranca el tablero web y abre el navegador', async () => {
  const cfg = makeCfg(tmpDir());
  const s = stubs();
  const r = await newProject({ name: 'Bot web', cfg, run: fakeRunner(), board: s.board, open: s.open, web: true });
  assert.equal(r.steps.find((x) => x.step === 'tablero').status, 'ok');
  assert.deepEqual(s.opened, ['http://localhost:6430']);
  assert.deepEqual(s.boards[0], [r.repo, 6430]);
});

test('dos proyectos reciben puertos distintos', async () => {
  const cfg = makeCfg(tmpDir());
  const run = fakeRunner();
  const s = stubs();
  const a = await newProject({ name: 'uno', cfg, run, board: s.board, open: s.open });
  const b = await newProject({ name: 'dos', cfg, run, board: s.board, open: s.open });
  assert.deepEqual([a.port, b.port], [6430, 6431]);
});

test('volver a ejecutar es idempotente: no recrea nada ni pisa CLAUDE.md editado', async () => {
  const cfg = makeCfg(tmpDir());
  const run = fakeRunner();
  const s = stubs();
  const a = await newProject({ name: 'demo', cfg, run, board: s.board, open: s.open });
  writeFileSync(path.join(a.repo, 'CLAUDE.md'), 'editado');
  const before = run.calls.length;
  const b = await newProject({ name: 'demo', cfg, run, board: s.board, open: s.open });
  assert.equal(b.port, a.port);
  assert.equal(b.notebookId, a.notebookId);
  assert.equal(readFileSync(path.join(a.repo, 'CLAUDE.md'), 'utf8'), 'editado');
  const newCalls = run.calls.slice(before).filter((c) => (c.cmd === 'nlm') || (c.cmd === 'backlog' && c.args[0] === 'init') || (c.cmd === 'git' && c.args[0] === 'init'));
  assert.deepEqual(newCalls, []);
  assert.equal(loadRegistry(cfg.registryFile).projects.length, 1);
});

test('si NotebookLM falla, el resto sigue, notebookId=pendiente y el proyecto sigue sin tarjetas', async () => {
  const cfg = makeCfg(tmpDir());
  const run = fakeRunner({ nlmFails: true });
  const s = stubs();
  const a = await newProject({ name: 'demo', cfg, run, board: s.board, open: s.open });
  assert.equal(a.notebookId, 'pendiente');
  const nlm = a.steps.find((x) => x.step === 'notebooklm');
  assert.equal(nlm.status, 'failed');
  assert.match(nlm.detail, /nlm login/);
  assert.ok(a.steps.filter((x) => !['notebooklm', 'tablero'].includes(x.step)).every((x) => x.status === 'ok'));
  await newProject({ name: 'demo', cfg, run, board: s.board, open: s.open });
  // Las tarjetas las define el usuario después de su primer prompt (/idea y /planificar): el proyecto nace vacío.
  assert.equal(run.calls.filter((c) => c.cmd === 'backlog' && c.args[0] === 'task').length, 0);
});

test('si el tablero no arranca, el proyecto se crea igualmente', async () => {
  const cfg = makeCfg(tmpDir());
  const r = await newProject({ name: 'demo', cfg, run: fakeRunner(), board: async () => { throw new Error('puerto ocupado'); }, open: () => {}, web: true });
  assert.equal(r.steps.find((x) => x.step === 'tablero').status, 'failed');
  assert.ok(existsSync(path.join(r.repo, 'backlog')));
});

test('nombre inválido lanza antes de crear nada', async () => {
  const cfg = makeCfg(tmpDir());
  await assert.rejects(() => newProject({ name: 'CON', cfg, run: fakeRunner() }), /reservado/);
  assert.equal(existsSync(cfg.projectsRoot), false);
});

test('display se sanea: sin saltos de línea ni espacios repetidos y frontmatter bien formado', async () => {
  const cfg = makeCfg(tmpDir());
  const s = stubs();
  const r = await newProject({ name: 'Mi\nproyecto   raro: "x"', cfg, run: fakeRunner(), board: s.board, open: s.open });
  assert.equal(r.slug, 'mi-proyecto-raro-x');
  const display = loadRegistry(cfg.registryFile).projects[0].display;
  assert.ok(!/[\r\n]/.test(display) && !/\s{2,}/.test(display), JSON.stringify(display));
  const idx = readFileSync(path.join(cfg.vaultPath, 'Proyectos', r.slug, 'Índice.md'), 'utf8');
  const fm = idx.split('\n---')[0].split('\n').slice(1);
  assert.deepEqual(fm.map((l) => l.split(':')[0]), ['tipo', 'proyecto', 'estado', 'repo', 'notebook', 'puerto', 'nivel', 'creado', 'cssclasses']);
});

test('display largo se recorta a 80 caracteres', async () => {
  const cfg = makeCfg(tmpDir());
  const s = stubs();
  const name = 'a'.repeat(30) + ' '.repeat(150) + '!'.repeat(50);
  const r = await newProject({ name, cfg, run: fakeRunner(), board: s.board, open: s.open });
  const display = loadRegistry(cfg.registryFile).projects[0].display;
  assert.ok(display.length <= 80 && display.length > 0, display);
  assert.equal(JSON.parse(readFileSync(path.join(r.repo, '.hq', 'project.json'), 'utf8')).display, display);
});

test('borrar el registro entre ejecuciones conserva el puerto (desde .hq/project.json)', async () => {
  const cfg = makeCfg(tmpDir());
  const s = stubs();
  await newProject({ name: 'otro', cfg, run: fakeRunner(), board: s.board, open: s.open });
  const a = await newProject({ name: 'demo', cfg, run: fakeRunner(), board: s.board, open: s.open });
  assert.equal(a.port, 6431);
  rmSync(cfg.registryFile);
  const b = await newProject({ name: 'demo', cfg, run: fakeRunner(), board: s.board, open: s.open });
  assert.equal(b.port, a.port);
  assert.equal(loadRegistry(cfg.registryFile).projects[0].port, a.port);
});

test('si falla a mitad, el puerto ya quedó reservado en el registro', async () => {
  const cfg = makeCfg(tmpDir());
  const s = stubs();
  const base = fakeRunner();
  const crash = (cmd, args, o) => { if (cmd === 'backlog' && args[0] === 'init') throw new Error('crash'); return base(cmd, args, o); };
  await assert.rejects(() => newProject({ name: 'uno', cfg, run: crash, board: s.board, open: s.open }), /crash/);
  const reserved = loadRegistry(cfg.registryFile).projects.find((p) => p.slug === 'uno').port;
  const dos = await newProject({ name: 'dos', cfg, run: fakeRunner(), board: s.board, open: s.open });
  assert.notEqual(dos.port, reserved);
});

test('.hq/project.json dañado lanza antes de crear nada más', async () => {
  for (const bad of ['{oops', 'null']) {
    const cfg = makeCfg(tmpDir());
    const repo = path.join(cfg.projectsRoot, 'demo');
    mkdirSync(path.join(repo, '.hq'), { recursive: true });
    writeFileSync(path.join(repo, '.hq', 'project.json'), bad);
    const run = fakeRunner();
    await assert.rejects(() => newProject({ name: 'demo', cfg, run }), /dañado/);
    assert.equal(run.calls.length, 0);
  }
});

test('CLAUDE.md lleva la ruta ABSOLUTA de la nota del vault y project.json la relativa', async () => {
  const cfg = makeCfg(tmpDir());
  const s = stubs();
  const r = await newProject({ name: 'Bot de Telegram', cfg, run: fakeRunner(), board: s.board, open: s.open });
  const claude = readFileSync(path.join(r.repo, 'CLAUDE.md'), 'utf8');
  const abs = path.join(cfg.vaultPath, 'Proyectos', 'bot-de-telegram', 'Índice.md');
  assert.ok(claude.includes(abs), claude);
  assert.ok(claude.split('\n').length <= 26);
  const hq = JSON.parse(readFileSync(path.join(r.repo, '.hq', 'project.json'), 'utf8'));
  assert.equal(hq.vaultNote, path.join('Proyectos', 'bot-de-telegram', 'Índice.md'));
});
