import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

// Recorre un árbol sin seguir enlaces simbólicos: { ficheros: [{rel, sha256, bytes}], omitidos: [rel] } ordenado por rel.
function recorrer(raiz) {
  const ficheros = [];
  const omitidos = [];
  const visitar = (dir, prefijo) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefijo ? `${prefijo}/${e.name}` : e.name;
      const abs = path.join(dir, e.name);
      if (e.isSymbolicLink()) omitidos.push(rel);
      else if (e.isDirectory()) visitar(abs, rel);
      else if (e.isFile()) {
        const buf = readFileSync(abs);
        ficheros.push({ rel, sha256: sha(buf), bytes: buf.length });
      }
    }
  };
  visitar(raiz, '');
  ficheros.sort((a, b) => (a.rel < b.rel ? -1 : 1));
  return { ficheros, omitidos: omitidos.sort() };
}

export const hashArbol = (dir) => recorrer(dir).ficheros;

export function copiarConHashes(origen, destino, guardia) {
  if (!existsSync(origen)) throw new Error(`respaldo: no existe el origen ${origen}`);
  const { ficheros, omitidos } = recorrer(origen);
  guardia.mkdir(destino);
  for (const f of ficheros) guardia.copiar(path.join(origen, ...f.rel.split('/')), path.join(destino, ...f.rel.split('/')));
  return { ficheros, omitidos };
}

export function verificarCopia(origen, destino) {
  const copia = new Map(existsSync(destino) ? hashArbol(destino).map((f) => [f.rel, f.sha256]) : []);
  const faltan = [];
  const distintos = [];
  for (const f of hashArbol(origen)) {
    if (!copia.has(f.rel)) faltan.push(f.rel);
    else if (copia.get(f.rel) !== f.sha256) distintos.push(f.rel);
  }
  return { ok: faltan.length === 0 && distintos.length === 0, faltan, distintos };
}
