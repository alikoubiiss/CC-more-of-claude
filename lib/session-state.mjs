import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const sid8 = (id) => String(id ?? 'sin-id').replace(/[^\w-]/g, '').slice(0, 8) || 'sin-id';

export function modelKey(name) {
  const s = String(name ?? '').toLowerCase();
  for (const key of ['opus', 'sonnet', 'haiku', 'fable']) if (s.includes(key)) return key;
  return null;
}

export const sessionStateFile = (cfg, sid) => path.join(cfg.stateDir, `${sid8(sid)}.json`);

export function writeSessionState(cfg, sid, state) {
  const file = sessionStateFile(cfg, sid);
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(state), 'utf8');
  try {
    renameSync(tmp, file);
  } catch (e) {
    try { rmSync(tmp, { force: true }); } catch { /* se omite */ }
    throw e;
  }
}

export function readSessionState(cfg, sid) {
  try {
    return JSON.parse(readFileSync(sessionStateFile(cfg, sid), 'utf8'));
  } catch {
    return null;
  }
}

export function pruneSessionStates(cfg, now = new Date(), maxAgeMs = 24 * 3600 * 1000) {
  let borrados = 0;
  let files = [];
  try { files = readdirSync(cfg.stateDir); } catch { return 0; }
  for (const f of files) {
    if (!f.endsWith('.json') && !f.endsWith('.tmp')) continue;
    const file = path.join(cfg.stateDir, f);
    try {
      if (now.getTime() - statSync(file).mtimeMs > maxAgeMs) {
        rmSync(file, { force: true });
        borrados++;
      }
    } catch {
      // se omite
    }
  }
  return borrados;
}
