import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { buildWtArgs } from '../lib/hq-open.mjs';
import { runHqOpen } from '../scripts/hq-open.mjs';
import { HQ_ROOT } from '../lib/config.mjs';
import { saveRegistry } from '../lib/registry.mjs';
import { tmpDir, writeConfigFile } from './helpers.mjs';

const REPO = 'C:\\proyectos personales\\demo-hq';

test('buildWtArgs reparte Claude, tablero y foco en una sola pestaña', () => {
  assert.deepEqual(buildWtArgs({ slug: 'demo-hq', repo: REPO }), [
    '-w', 'new',
    '--maximized',
    'new-tab', '--title', 'demo-hq', '--colorScheme', 'HQ', '-d', REPO, 'cmd', '/k', 'claude',
    ';', 'split-pane', '-V', '-s', '0.42', '--colorScheme', 'HQ', '-d', REPO,
    'cmd', '/c', 'set', 'HQ_LAYOUT=demo-hq&&', 'cc', 'board', 'demo-hq',
    ';', 'split-pane', '-H', '-s', '0.5', '--colorScheme', 'HQ', '-d', REPO, 'cc', 'focus', 'demo-hq',
    ';', 'move-focus', 'left',
  ]);
});

test('buildWtArgs: el tablero arranca con HQ_LAYOUT=<slug> (sin espacio antes de &&) y solo el tablero', () => {
  const args = buildWtArgs({ slug: 'demo-hq', repo: REPO, tui: 'C:\\x\\hq.exe' });
  const seps = args.flatMap((a, i) => (a === ';' ? [i] : []));
  const tablero = args.slice(seps[0] + 1, seps[1]);
  assert.deepEqual(tablero.slice(-7), ['cmd', '/c', 'set', 'HQ_LAYOUT=demo-hq&&', 'C:\\x\\hq.exe', 'board', 'demo-hq']);
  const resto = [...args.slice(0, seps[0]), ...args.slice(seps[1])];
  assert.ok(resto.every((a) => !a.includes('HQ_LAYOUT')), 'Claude y el foco no llevan HQ_LAYOUT');
});

test('buildWtArgs: los separadores ; son argumentos sueltos y la ruta con espacios es un solo argumento', () => {
  const args = buildWtArgs({ slug: 'demo-hq', repo: REPO });
  assert.equal(args.filter((a) => a === ';').length, 3);
  assert.equal(args.filter((a) => a === REPO).length, 3);
  assert.ok(args.every((a) => a === ';' || !a.includes(';')));
});

test('buildWtArgs acepta otro comando de Claude y otro ejecutable de paneles', () => {
  const args = buildWtArgs({ slug: 'p', repo: REPO, claudeCmd: 'claude --resume', tui: 'C:\\x\\hq.exe', window: '0' });
  assert.deepEqual(args.slice(0, 2), ['-w', '0']);
  assert.ok(args.includes('claude --resume'));
  assert.ok(args.includes('C:\\x\\hq.exe'));
});

test('buildWtArgs rechaza slugs inválidos y rutas relativas', () => {
  assert.throws(() => buildWtArgs({ slug: 'Mal Nombre', repo: REPO }), /slug inválido/);
  assert.throws(() => buildWtArgs({ slug: '../x', repo: REPO }), /slug inválido/);
  assert.throws(() => buildWtArgs({ slug: 'ok', repo: 'relativa\\ruta' }), /ruta del proyecto debe ser absoluta/);
});

test('runHqOpen: dry-run no lanza; sin dry-run llama al lanzador; errores claros', async () => {
  const repo = tmpDir();
  const reg = { projects: [{ slug: 'demo', path: repo }] };
  let llamadas = 0;
  const spawnFn = async () => { llamadas++; };
  const seco = await runHqOpen({ slug: 'demo', reg, dryRun: true, spawnFn });
  assert.equal(llamadas, 0);
  assert.equal(seco.args[0], '-w');
  await runHqOpen({ slug: 'demo', reg, spawnFn });
  assert.equal(llamadas, 1);
  await assert.rejects(() => runHqOpen({ slug: 'otro', reg, spawnFn }), /no hay un proyecto registrado llamado "otro"/);
  await assert.rejects(() => runHqOpen({ slug: 'demo', reg: { projects: [{ slug: 'demo', path: path.join(repo, 'no-existe') }] }, spawnFn }), /no existe la carpeta/);
});

test('la CLI en dry-run imprime los argumentos y no lanza nada', () => {
  const root = tmpDir();
  const { file, cfg } = writeConfigFile(root);
  const repo = path.join(root, 'mis proyectos', 'demo');
  mkdirSync(repo, { recursive: true });
  saveRegistry(cfg.registryFile, { projects: [{ slug: 'demo', display: 'Demo', path: repo, port: 6430 }] });
  const r = spawnSync(process.execPath, [path.join(HQ_ROOT, 'scripts', 'hq-open.mjs'), 'demo', '--dry-run'], {
    encoding: 'utf8', env: { ...process.env, HQ_CONFIG: file },
  });
  assert.equal(r.status, 0, r.stderr);
  const args = JSON.parse(r.stdout);
  assert.ok(args.includes('focus'));
  const mal = spawnSync(process.execPath, [path.join(HQ_ROOT, 'scripts', 'hq-open.mjs'), 'nope', '--dry-run'], {
    encoding: 'utf8', env: { ...process.env, HQ_CONFIG: file },
  });
  assert.equal(mal.status, 1);
  assert.match(mal.stderr, /no hay un proyecto registrado/);
});

test('buildWtArgs: la ventana se abre maximizada salvo que se pida lo contrario', () => {
  assert.ok(buildWtArgs({ slug: 'p', repo: REPO }).includes('--maximized'));
  assert.ok(!buildWtArgs({ slug: 'p', repo: REPO, maximized: false }).includes('--maximized'));
});

test('buildWtArgs: colorScheme configurable y desactivable', () => {
  const a = buildWtArgs({ slug: 'p', repo: REPO, colorScheme: 'Otro' });
  assert.equal(a.filter((x) => x === '--colorScheme').length, 3);
  assert.ok(a.includes('Otro'));
  assert.ok(!buildWtArgs({ slug: 'p', repo: REPO, colorScheme: null }).includes('--colorScheme'));
});
