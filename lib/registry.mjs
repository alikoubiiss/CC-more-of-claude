import { copyFileSync, existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export function loadRegistry(file) {
  if (!existsSync(file)) return { projects: [] };
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    throw new Error(`registry: no se pudo leer ${file}: ${e.message}`);
  }
  let reg;
  try {
    reg = JSON.parse(text);
  } catch (e) {
    throw corruptError(file, e.message);
  }
  if (!reg || !Array.isArray(reg.projects)) throw corruptError(file, 'falta "projects"');
  return reg;
}

function corruptError(file, reason) {
  try {
    preserveCorruptCopy(file);
    return new Error(`registry: ${file} está dañado (${reason}); copia guardada como .corrupt-*`);
  } catch (copyErr) {
    return new Error(`registry: ${file} está dañado (${reason}); no se pudo guardar copia .corrupt-* (${copyErr.message})`);
  }
}

// Guarda una copia .corrupt-* salvo que ya exista una idéntica en el mismo directorio.
function preserveCorruptCopy(file) {
  const dir = path.dirname(file);
  const prefix = `${path.basename(file)}.corrupt-`;
  const content = readFileSync(file);
  for (const name of readdirSync(dir)) {
    if (!name.startsWith(prefix)) continue;
    const p = path.join(dir, name);
    try {
      if (statSync(p).isFile() && readFileSync(p).equals(content)) return;
    } catch {
      // entrada no legible: se ignora
    }
  }
  copyFileSync(file, `${file}.corrupt-${Date.now()}`);
}

export function saveRegistry(file, reg) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(reg, null, 2) + '\n', 'utf8');
  renameSync(tmp, file);
}

export function allocatePort(reg, basePort) {
  const used = new Set(reg.projects.map((p) => p.port));
  let port = basePort;
  while (used.has(port)) port++;
  return port;
}

export function upsertProject(reg, project) {
  const i = reg.projects.findIndex((p) => p.slug === project.slug);
  if (i >= 0) reg.projects[i] = { ...reg.projects[i], ...project };
  else reg.projects.push(project);
  return reg;
}

const norm = (p) => path.resolve(p).toLowerCase();

export function findByPath(reg, cwd) {
  if (!cwd) return null;
  const here = norm(cwd);
  return reg.projects.find((p) => {
    if (typeof p?.path !== 'string' || p.path === '') return false;
    const root = norm(p.path);
    return here === root || here.startsWith(root + path.sep);
  }) ?? null;
}
