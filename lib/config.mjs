import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const HQ_ROOT = path.resolve(import.meta.dirname, '..');
const REQUIRED = ['vaultPath', 'projectsRoot', 'vaultProjectsDir', 'nlmProfile', 'basePort', 'backupsDir'];

// Orden: HQ_CONFIG, ~/.project-hq/config.json (lo crea scripts/setup.mjs; sobrevive a las actualizaciones del plugin) y config.json junto al código.
export const USER_CONFIG = path.join(os.homedir(), '.project-hq', 'config.json');

export function defaultConfigFile() {
  if (process.env.HQ_CONFIG) return process.env.HQ_CONFIG;
  return existsSync(USER_CONFIG) ? USER_CONFIG : path.join(HQ_ROOT, 'config.json');
}

export function loadConfig(file = defaultConfigFile()) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    const pista = e.code === 'ENOENT' ? ' (primera vez: ejecuta "node scripts/setup.mjs" para crearlo)' : '';
    throw new Error(`config: no se pudo leer ${file}: ${e.message}${pista}`);
  }
  for (const key of REQUIRED) {
    if (raw[key] === undefined || raw[key] === '') throw new Error(`config: falta "${key}" en ${file}`);
  }
  if (!Number.isInteger(raw.basePort) || raw.basePort < 1024 || raw.basePort > 65000) {
    throw new Error('config: "basePort" debe ser un entero entre 1024 y 65000');
  }
  if (raw.dataDir !== undefined && (typeof raw.dataDir !== 'string' || !path.isAbsolute(raw.dataDir))) {
    throw new Error('config: "dataDir" debe ser una ruta absoluta');
  }
  for (const key of ['vaultPersonalOrigen', 'vaultPersonalDestino']) {
    if (raw[key] !== undefined && (typeof raw[key] !== 'string' || !path.isAbsolute(raw[key]))) {
      throw new Error(`config: "${key}" debe ser una ruta absoluta`);
    }
  }
  const conocimientoDir = raw.conocimientoDir ?? 'Conocimiento';
  if (typeof conocimientoDir !== 'string' || !/^[^\\/:*?"<>|]+$/.test(conocimientoDir) || /^\.+$/.test(conocimientoDir)) {
    throw new Error('config: "conocimientoDir" debe ser un nombre de carpeta simple');
  }
  // Con dataDir el estado vive fuera de la copia en caché del plugin; sin él, junto al fichero de config.
  const dir = raw.dataDir ?? path.dirname(file);
  let presupuesto = null;
  if (raw.presupuesto !== undefined) {
    if (!raw.presupuesto || typeof raw.presupuesto !== 'object' || Array.isArray(raw.presupuesto)) throw new Error('config: "presupuesto" debe ser un objeto {diaUsd, tarjetaUsd}');
    presupuesto = { diaUsd: null, tarjetaUsd: null };
    for (const k of ['diaUsd', 'tarjetaUsd']) {
      const v = raw.presupuesto[k];
      if (v === undefined) continue;
      if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) throw new Error(`config: "presupuesto.${k}" debe ser un número > 0`);
      presupuesto[k] = v;
    }
  }
  const days = raw.eventsRetentionDays ?? 7;
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    throw new Error('config: "eventsRetentionDays" debe ser un entero entre 1 y 365');
  }
  return {
    ...raw,
    dataDir: raw.dataDir,
    backupsDir: path.resolve(dir, raw.backupsDir),
    logsDir: path.resolve(dir, 'logs'),
    registryFile: path.join(dir, 'registry.json'),
    eventsDir: path.join(dir, 'events'),
    stateDir: path.join(dir, 'state'),
    eventsRetentionDays: days,
    metricsDir: path.join(dir, 'metrics'),
    presupuesto,
    conocimientoDir,
    conocimientoPath: path.join(raw.vaultPath, conocimientoDir),
  };
}
