import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { realRunner, startBoard, resolveCommand, extractNotebookId, setStatuses, backlogInit, gitInit, createNotebook, createTask, isPortOpen, STATUSES } from '../lib/tools.mjs';
import { fakeRunner, tmpDir } from './helpers.mjs';

const esWin = process.platform === 'win32';

// Shim .cmd con el mismo formato que genera npm; el script .js devuelve sus argumentos en JSON.
function shimFalso(dir, nombre = 'falso') {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${nombre}.js`), 'process.stdout.write(JSON.stringify(process.argv.slice(2)));\n');
  writeFileSync(path.join(dir, `${nombre}.cmd`), [
    '@ECHO off', 'GOTO start', ':find_dp0', 'SET dp0=%~dp0', 'EXIT /b', ':start', 'SETLOCAL', 'CALL :find_dp0', '',
    'IF EXIST "%dp0%\\node.exe" (', '  SET "_prog=%dp0%\\node.exe"', ') ELSE (', '  SET "_prog=node"', ')', '',
    `endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${nombre}.js" %*`, '',
  ].join('\r\n'));
}

const entorno = (dir) => ({ ...process.env, PATH: `${dir};${process.env.PATH ?? process.env.Path}` });

test('realRunner no ejecuta nada extra con comillas, &, | o % en los argumentos (shim .cmd)', { skip: !esWin }, () => {
  const dir = tmpDir();
  shimFalso(dir);
  const marca = path.join(dir, 'PWNED.txt');
  const hostiles = [
    `x" & echo pwn > "${marca}" & "`,
    `"&echo pwn>"${marca}"&"`,
    `a | echo pwn > "${marca}"`,
    `a & echo pwn > "${marca}"`,
    '%PATH%', '%COMSPEC%', '^&', 'a"b', 'dos palabras', '', '(x)', '!x!',
  ];
  const r = realRunner('falso', ['task', 'edit', ...hostiles], { env: entorno(dir) });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), ['task', 'edit', ...hostiles]);
  assert.equal(existsSync(marca), false);
});

test('realRunner falla sin ejecutar nada si el shim no apunta a un .js o .exe conocido', { skip: !esWin }, () => {
  const dir = tmpDir();
  const marca = path.join(dir, 'PWNED.txt');
  writeFileSync(path.join(dir, 'raro.cmd'), `@echo off\r\necho pwn > "${marca}"\r\n`);
  const r = realRunner('raro', ['x'], { env: entorno(dir) });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /sin cmd\.exe/);
  assert.equal(existsSync(marca), false);
});

test('realRunner no busca el comando en el cwd (un repo no puede plantar un .cmd)', { skip: !esWin }, () => {
  const bin = tmpDir();
  const repo = tmpDir();
  shimFalso(repo, 'plantado');
  const r = realRunner('plantado', [], { cwd: repo, env: entorno(bin) });
  assert.notEqual(r.status, 0);
});

test('resolveCommand en Windows resuelve el shim de backlog a node + cli.js sin cmd.exe', { skip: !esWin }, () => {
  const dir = tmpDir();
  shimFalso(dir, 'backlog');
  const t = resolveCommand('backlog', { env: entorno(dir) });
  assert.match(t.file, /node\.exe$/i);
  assert.equal(t.prefix.length, 1);
  assert.match(t.prefix[0], /backlog\.js$/);
});

test('resolveCommand no toca el comando fuera de Windows', () => {
  assert.deepEqual(resolveCommand('backlog', { platform: 'linux' }), { file: 'backlog', prefix: [] });
});

test('lib/tools.mjs no usa shell: true', () => {
  assert.doesNotMatch(readFileSync(new URL('../lib/tools.mjs', import.meta.url), 'utf8'), /shell:\s*(true|process\.platform)/);
});

test('extractNotebookId entiende JSON plano, anidado y texto con UUID', () => {
  assert.equal(extractNotebookId('{"id":"abc"}'), 'abc');
  assert.equal(extractNotebookId('{"notebook":{"notebook_id":"n-9"}}'), 'n-9');
  assert.equal(extractNotebookId('Notebook Created\nID: 11111111-2222-3333-4444-555555555555\n'), '11111111-2222-3333-4444-555555555555');
  assert.throws(() => extractNotebookId('nada util'), /no se encontró el ID/);
});

test('setStatuses reemplaza las claves existentes y las añade si faltan', () => {
  const dir = tmpDir();
  mkdirSync(path.join(dir, 'backlog'));
  const cfg = path.join(dir, 'backlog', 'config.yml');
  writeFileSync(cfg, 'project_name: "x"\nstatuses: ["To Do", "Done"]\ndefault_status: "To Do"\n');
  setStatuses(dir);
  let t = readFileSync(cfg, 'utf8');
  assert.match(t, /^statuses: \["Ideas","Planificado","En curso","Verificando","Hecho"\]$/m);
  assert.match(t, /^default_status: "Ideas"$/m);
  assert.equal((t.match(/^statuses:/gm) ?? []).length, 1);
  writeFileSync(cfg, 'project_name: "x"\n');
  setStatuses(dir);
  t = readFileSync(cfg, 'utf8');
  assert.match(t, /statuses: \[/);
  assert.match(t, /default_status: "Ideas"/);
});

test('setStatuses falla con mensaje claro si no hay config de backlog', () => {
  assert.throws(() => setStatuses(tmpDir()), /config.yml/);
});

test('backlogInit usa los flags correctos y es idempotente', () => {
  const dir = tmpDir();
  const run = fakeRunner();
  assert.deepEqual(backlogInit(run, dir, 'demo', 6431), { skipped: false });
  assert.deepEqual(run.calls[0].args, [
    'init', 'demo', '--defaults', '--integration-mode', 'cli', '--agent-instructions', 'none',
    '--web-port', '6431', '--auto-open-browser', 'false',
  ]);
  assert.deepEqual(backlogInit(run, dir, 'demo', 6431), { skipped: true });
  assert.equal(run.calls.length, 1);
});

test('gitInit es idempotente', () => {
  const dir = tmpDir();
  const run = fakeRunner();
  assert.equal(gitInit(run, dir).skipped, false);
  assert.equal(gitInit(run, dir).skipped, true);
});

test('createNotebook pasa el perfil y devuelve el ID; si nlm falla, lanza con el stderr', () => {
  const run = fakeRunner();
  assert.equal(createNotebook(run, 'demo', 'hq'), '11111111-2222-3333-4444-555555555555');
  assert.deepEqual(run.calls[0].args, ['notebook', 'create', 'demo', '--json', '--profile', 'hq']);
  assert.throws(() => createNotebook(fakeRunner({ nlmFails: true }), 'demo', 'hq'), /auth expired/);
});

test('createTask devuelve false (sin lanzar) si backlog falla', () => {
  const ok = () => ({ status: 0, stdout: '', stderr: '' });
  const bad = () => ({ status: 1, stdout: '', stderr: 'boom' });
  assert.equal(createTask(ok, tmpDir(), 'Conectar NotebookLM', 'desc'), true);
  assert.equal(createTask(bad, tmpDir(), 'Conectar NotebookLM', 'desc'), false);
});

test('isPortOpen detecta un servidor local y un puerto cerrado', async () => {
  const server = net.createServer().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const { port } = server.address();
  assert.equal(await isPortOpen(port), true);
  await new Promise((r) => server.close(r));
  assert.equal(await isPortOpen(port), false);
});

test('STATUSES tiene las 5 columnas en orden', () => {
  assert.deepEqual(STATUSES, ['Ideas', 'Planificado', 'En curso', 'Verificando', 'Hecho']);
});

test('realRunner corta por timeout y devuelve stderr con "timeout"', () => {
  const t0 = Date.now();
  const r = realRunner(process.execPath, ['-e', 'setTimeout(()=>{},10000)'], { timeout: 300 });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /timeout/i);
  assert.ok(Date.now() - t0 < 5000);
});

test('realRunner ejecuta node con rutas con espacios y devuelve stdout', () => {
  const r = realRunner(process.execPath, ['-e', 'console.log("hola mundo")']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /hola mundo/);
});

test('startBoard devuelve started:false si el puerto ya responde', async () => {
  const server = net.createServer().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const { port } = server.address();
  assert.deepEqual(await startBoard(tmpDir(), port), { started: false });
  await new Promise((r) => server.close(r));
});

test('startBoard lanza si el tablero nunca responde y no crashea con comando inexistente', async () => {
  const server = net.createServer().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const { port } = server.address();
  await new Promise((r) => server.close(r));
  await assert.rejects(
    startBoard(tmpDir(), port, { command: 'comando-que-no-existe-xyz', attempts: 3, intervalMs: 30 }),
    /no respondió/,
  );
});

test('createNotebook pasa timeout de 60000 ms al runner', () => {
  const seen = [];
  const run = (cmd, args, opts) => { seen.push(opts); return { status: 0, stdout: '{"id":"nb-1"}', stderr: '' }; };
  assert.equal(createNotebook(run, 'demo', 'hq'), 'nb-1');
  assert.deepEqual(seen[0], { timeout: 60000 });
});

test('setStatuses rechaza listas en bloque de YAML y no toca el fichero', () => {
  const dir = tmpDir();
  mkdirSync(path.join(dir, 'backlog'));
  const cfg = path.join(dir, 'backlog', 'config.yml');
  for (const text of [
    'project_name: "x"\nstatuses:\n  - To Do\n  - Done\ndefault_status: "To Do"\n',
    'project_name: "x"\nstatuses: []\n  - To Do\n',
  ]) {
    writeFileSync(cfg, text);
    assert.throws(() => setStatuses(dir), /lista en bloque para statuses/);
    assert.equal(readFileSync(cfg, 'utf8'), text);
  }
});
