import { copyFileSync, existsSync, lstatSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const canon = (p) => {
  const r = path.resolve(p);
  return process.platform === 'win32' ? r.toLowerCase() : r;
};

// ¿destino está dentro de base? (base misma solo con incluirBase)
export function dentro(base, destino, { incluirBase = false } = {}) {
  const rel = path.relative(canon(base), canon(destino));
  if (rel === '') return incluirBase;
  return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

// Alguna parte ya existente del camino (desde la raíz) es un enlace simbólico o junction.
function pasaPorEnlace(raiz, ruta) {
  const rel = path.relative(path.resolve(raiz), path.resolve(ruta));
  let actual = path.resolve(raiz);
  for (const parte of ['', ...rel.split(path.sep).filter(Boolean)]) {
    if (parte) actual = path.join(actual, parte);
    if (!existsSync(actual)) return false;
    if (lstatSync(actual).isSymbolicLink()) return true;
  }
  return false;
}

export function crearGuardia(raices) {
  const lista = raices.map((r) => path.resolve(r));
  const raizDe = (ruta) => lista.find((r) => dentro(r, ruta, { incluirBase: true }));
  const comprobar = (ruta) => {
    const r = raizDe(ruta);
    if (!r) throw new Error(`vault: ruta no permitida: ${ruta}`);
    if (pasaPorEnlace(r, ruta)) throw new Error(`vault: ruta no permitida (pasa por un enlace simbólico): ${ruta}`);
    return path.resolve(ruta);
  };
  return {
    permitida(ruta) {
      try {
        comprobar(ruta);
        return true;
      } catch {
        return false;
      }
    },
    mkdir(ruta) {
      mkdirSync(comprobar(ruta), { recursive: true });
    },
    escribir(ruta, contenido) {
      const r = comprobar(ruta);
      mkdirSync(path.dirname(r), { recursive: true });
      writeFileSync(r, contenido);
    },
    borrar(ruta) {
      rmSync(comprobar(ruta), { force: true });
    },
    copiar(origen, destino) {
      const r = comprobar(destino);
      mkdirSync(path.dirname(r), { recursive: true });
      copyFileSync(origen, r);
    },
  };
}

const RESERVADOS = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

export function nombreSeguro(s, max = 120) {
  let n = String(s ?? '')
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .replace(/[:<>|*\\/]/g, '-')
    .replace(/["?#^]/g, '')
    .replace(/\[/g, '(')
    .replace(/\]/g, ')')
    .replace(/\s+/g, ' ')
    .trim();
  n = n.slice(0, max).replace(/[. ]+$/, '').trim();
  if (!n) return 'sin-titulo';
  if (RESERVADOS.test(n.split('.')[0])) n = `_${n}`.slice(0, max);
  return n;
}
