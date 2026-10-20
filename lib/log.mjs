import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HQ_ROOT } from './config.mjs';

// Sin cfg cargada: <dataDir>/logs si la config legible lo define; si no, junto al fichero de config.
export function fallbackLogsDir() {
  const file = process.env.HQ_CONFIG ?? path.join(HQ_ROOT, 'config.json');
  try {
    const { dataDir } = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof dataDir === 'string' && path.isAbsolute(dataDir)) return path.join(dataDir, 'logs');
  } catch {
    // config ilegible: se usa la ruta junto al fichero
  }
  return path.join(path.dirname(file), 'logs');
}

export function logError(cfg, msg) {
  try {
    const dir = cfg?.logsDir ?? fallbackLogsDir();
    mkdirSync(dir, { recursive: true });
    appendFileSync(path.join(dir, 'hooks.log'), `${new Date().toISOString()} ${msg}\n`);
  } catch {
    // Último recurso: si ni el log funciona, no romper la sesión.
    process.stderr.write(`[hq] ${msg} (host: ${os.hostname()})\n`);
  }
}
