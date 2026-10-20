import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';

export const STATUSES = ['Ideas', 'Planificado', 'En curso', 'Verificando', 'Hecho'];
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const WIN_EXTS = ['.com', '.exe', '.bat', '.cmd'];

// Localiza `cmd` en PATH (nunca en el cwd, para que un repo no pueda plantar un backlog.cmd) respetando el orden de PATHEXT.
function buscarEnPath(cmd, env) {
  const ext = path.extname(cmd).toLowerCase();
  const conRuta = /[\\/]/.test(cmd);
  const dirs = conRuta ? [''] : String(env.PATH ?? env.Path ?? '').split(';').filter(Boolean);
  const pathext = String(env.PATHEXT ?? '').toLowerCase().split(';').filter((e) => WIN_EXTS.includes(e));
  const exts = WIN_EXTS.includes(ext) ? [''] : (pathext.length ? pathext : WIN_EXTS);
  for (const d of dirs) {
    for (const e of exts) {
      const f = path.join(d, cmd + e);
      if (existsSync(f)) return f;
    }
  }
  return null;
}

// En Windows backlog/npm instalan shims .cmd, y Node no puede (ni debe) lanzar un .cmd sin cmd.exe. En vez de pasar
// los argumentos por cmd.exe, se lee el shim, se extrae el destino real (script .js o .exe) y se lanza directamente:
// los argumentos van como vector a CreateProcess y ningun metacaracter (& | % ") se interpreta.
export function resolveCommand(cmd, { env = process.env, platform = process.platform } = {}) {
  if (platform !== 'win32') return { file: cmd, prefix: [] };
  const found = buscarEnPath(cmd, env);
  if (!found) return { file: cmd, prefix: [] }; // spawn sin shell lo resolverá o fallará con ENOENT
  const ext = path.extname(found).toLowerCase();
  if (ext !== '.cmd' && ext !== '.bat') return { file: found, prefix: [] };
  const dp0 = path.dirname(found);
  const shim = readFileSync(found, 'utf8');
  const exe = shim.match(/"%dp0%[\\/]+([^"%]+\.exe)"\s+%\*/i);
  if (exe) return { file: path.join(dp0, exe[1]), prefix: [] };
  const js = shim.match(/"%dp0%[\\/]+([^"%]+\.[cm]?js)"\s+%\*/i);
  if (!js) throw new Error(`no sé lanzar ${found} sin cmd.exe: el shim no apunta a un .js o .exe conocido`);
  const nodeLocal = path.join(dp0, 'node.exe');
  return { file: existsSync(nodeLocal) ? nodeLocal : process.execPath, prefix: [path.join(dp0, js[1])] };
}

// Nunca usa shell: los argumentos llegan al proceso hijo como vector, sin pasar por cmd.exe ni por ninguna cadena armada a mano.
export function realRunner(cmd, args, { cwd, timeout = 120000, env } = {}) {
  let target;
  try {
    target = resolveCommand(cmd, { env: env ?? process.env });
  } catch (e) {
    return { status: 1, stdout: '', stderr: e.message };
  }
  const r = spawnSync(target.file, [...target.prefix, ...args], { cwd, env, encoding: 'utf8', windowsHide: true, timeout });
  const timedOut = r.error?.code === 'ETIMEDOUT';
  const stderr = timedOut ? `timeout tras ${timeout} ms: ${cmd}` : (r.stderr || r.error?.message || '');
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr };
}

function must(r, what) {
  if (r.status !== 0) throw new Error(`${what} falló: ${(r.stderr || r.stdout).trim().slice(0, 300)}`);
  return r;
}

export function gitInit(run, dir) {
  if (existsSync(path.join(dir, '.git'))) return { skipped: true };
  must(run('git', ['init'], { cwd: dir }), 'git init');
  return { skipped: false };
}

export function backlogInit(run, dir, slug, port) {
  if (existsSync(path.join(dir, 'backlog'))) return { skipped: true };
  must(run('backlog', [
    'init', slug, '--defaults', '--integration-mode', 'cli', '--agent-instructions', 'none',
    '--web-port', String(port), '--auto-open-browser', 'false',
  ], { cwd: dir }), 'backlog init');
  return { skipped: false };
}

function setYamlLine(text, key, line) {
  const re = new RegExp(`^${key}:.*$`, 'm');
  if (re.test(text)) return text.replace(re, line);
  return text.replace(/\n*$/, '\n') + line + '\n';
}

export function setStatuses(dir, statuses = STATUSES) {
  const file = path.join(dir, 'backlog', 'config.yml');
  if (!existsSync(file)) throw new Error(`backlog: no existe ${file} (¿falló backlog init?)`);
  let text = readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((l) => /^statuses:/.test(l));
  if (at >= 0 && (/^statuses:\s*$/.test(lines[at]) || /^\s+-/.test(lines[at + 1] ?? ''))) {
    throw new Error('backlog: config.yml usa una lista en bloque para statuses; ajusta setStatuses');
  }
  text = setYamlLine(text, 'statuses', `statuses: ${JSON.stringify(statuses)}`);
  text = setYamlLine(text, 'default_status', `default_status: ${JSON.stringify(statuses[0])}`);
  writeFileSync(file, text, 'utf8');
}

function findId(v, depth = 0) {
  if (!v || typeof v !== 'object' || depth > 3) return null;
  for (const k of ['id', 'notebook_id', 'notebookId']) if (typeof v[k] === 'string' && v[k]) return v[k];
  for (const child of Object.values(v)) {
    const f = findId(child, depth + 1);
    if (f) return f;
  }
  return null;
}

export function extractNotebookId(stdout) {
  try {
    const id = findId(JSON.parse(stdout));
    if (id) return id;
  } catch {
    // no era JSON: se intenta con el UUID del texto
  }
  const m = stdout.match(UUID);
  if (m) return m[0];
  throw new Error(`nlm: no se encontró el ID del cuaderno en la salida: ${stdout.slice(0, 200)}`);
}

export function createNotebook(run, slug, profile) {
  const r = must(run('nlm', ['notebook', 'create', slug, '--json', '--profile', profile], { timeout: 60000 }), 'nlm notebook create');
  return extractNotebookId(r.stdout);
}

export function createTask(run, dir, title, description) {
  return run('backlog', ['task', 'create', title, '-d', description], { cwd: dir }).status === 0;
}

export function isPortOpen(port, host = '127.0.0.1', timeout = 500) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host });
    const done = (ok) => { s.destroy(); resolve(ok); };
    s.setTimeout(timeout, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}

export async function startBoard(dir, port, { command = 'backlog', attempts = 25, intervalMs = 200 } = {}) {
  if (await isPortOpen(port)) return { started: false };
  const target = resolveCommand(command);
  const child = spawn(target.file, [...target.prefix, 'browser', '--port', String(port), '--no-open'], {
    cwd: dir, detached: true, stdio: 'ignore', windowsHide: true,
  });
  child.on('error', () => {});
  child.unref();
  for (let i = 0; i < attempts; i++) {
    await new Promise((r) => setTimeout(r, intervalMs));
    if (await isPortOpen(port)) return { started: true };
  }
  throw new Error(`el tablero no respondió en el puerto ${port}`);
}

export function openUrl(url) {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}
