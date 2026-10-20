// Lleva las notas existentes de Proyectos/<slug>/ a la convención de notas HQ:
// cssclasses [hq-<tipo>], indice y línea de vuelta al Índice. Solo añade líneas; nunca cambia las que hay.
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync, statSync, utimesSync } from 'node:fs';
import path from 'node:path';
import { hm, ymd } from './dates.mjs';
import { hashArbol } from './respaldo.mjs';
import { parseFrontmatter, serializarFrontmatter } from './vp-frontmatter.mjs';
import { crearGuardia } from './vp-rutas.mjs';

const UTF8 = new TextDecoder('utf-8', { fatal: true });
const INDICE = 'Índice.md';
const CARPETAS = [['Sesiones', 'sesion'], ['Decisiones', 'decision']];
const NO_VALE_EN_ENLACE = /[[\]|#^]/;

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const nfc = (s) => s.normalize('NFC');

export const enlaceIndice = (slug, carpeta = 'Proyectos') => `[[${carpeta}/${slug}/Índice|${slug}]]`;

// Texto de una nota -> { texto, cambios, avisos }. Sin cambios devuelve el texto original tal cual.
export function retocarNota(original, { tipo, slug, carpeta = 'Proyectos' }) {
  const intacta = (aviso) => ({ texto: original, cambios: [], avisos: [aviso] });
  const bom = original.startsWith('﻿');
  const crlf = original.includes('\r\n');
  const t = original.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  if (!t.startsWith('---\n')) return intacta('sin frontmatter: se deja intacta');
  const fm = parseFrontmatter(t);
  const m = t.match(/^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
  if (!fm.valido || !m) return intacta('frontmatter no válido: se deja intacta');
  if (fm.datos.tipo !== tipo) return intacta(`tipo "${fm.datos.tipo ?? ''}" en una nota de ${tipo}: se deja intacta`);

  const enlace = enlaceIndice(slug, carpeta);
  const nuevos = {};
  const cambios = [];
  const avisos = [];
  if (!('cssclasses' in fm.datos)) {
    nuevos.cssclasses = [`hq-${tipo}`];
    cambios.push('+ cssclasses');
  } else if (![fm.datos.cssclasses].flat().includes(`hq-${tipo}`)) {
    avisos.push(`cssclasses sin hq-${tipo}: no se cambia, revísalo a mano`);
  }
  const conIndice = tipo !== 'proyecto';
  if (conIndice && !('indice' in fm.datos)) {
    nuevos.indice = enlace;
    cambios.push('+ indice');
  } else if (conIndice && nfc(String(fm.datos.indice)) !== nfc(enlace)) {
    avisos.push(`indice distinto de ${enlace}: no se cambia, revísalo a mano`);
  }

  // Frontmatter: las líneas que hay quedan igual; las nuevas van antes del --- de cierre.
  const finFm = 4 + m[1].length;
  let cabeza = t.slice(0, finFm);
  if (Object.keys(nuevos).length) cabeza += `\n${serializarFrontmatter(nuevos).split('\n').slice(1, -2).join('\n')}`;
  let cierre = t.slice(finFm, m[0].length);
  let cuerpo = t.slice(m[0].length);

  const vuelta = `Volver a ${enlace}`;
  const lineas = cuerpo.split('\n');
  // En NFC: el nombre de la carpeta puede venir en NFD (macOS) y la nota en NFC, o al revés.
  const yaVuelve = nfc(`Volver a [[${carpeta}/${slug}/Índice`);
  if (conIndice && !lineas.some((l) => nfc(l.trim()).startsWith(yaVuelve))) {
    const i = lineas.findIndex((l) => l.trim() !== '');
    if (i >= 0 && /^# /.test(lineas[i])) {
      lineas.splice(i + 1, 0, '', vuelta, ...(lineas[i + 1] === '' ? [] : ['']));
      cuerpo = lineas.join('\n');
    } else {
      cuerpo = `${vuelta}\n${cuerpo === '' ? '' : `\n${cuerpo}`}`;
    }
    if (!cierre.endsWith('\n')) cierre += '\n';
    cambios.push('+ línea de vuelta al Índice');
  }

  if (!cambios.length) return { texto: original, cambios, avisos };
  const nuevo = cabeza + cierre + cuerpo;
  return { texto: (bom ? '﻿' : '') + (crlf ? nuevo.replace(/\n/g, '\r\n') : nuevo), cambios, avisos };
}

// Notas candidatas de cada proyecto: Índice.md, Sesiones/*.md y Decisiones/*.md (sin recursión ni enlaces).
function listarNotas(dir, avisos) {
  const notas = [];
  const entradas = (d) => readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
  for (const p of entradas(dir)) {
    if (p.isSymbolicLink()) avisos.push({ rel: p.name, error: 'enlace simbólico o junction: no se toca' });
    if (!p.isDirectory()) continue;
    const slug = p.name;
    if (NO_VALE_EN_ENLACE.test(slug)) {
      avisos.push({ rel: slug, error: 'el nombre de la carpeta no vale en un wikilink ([ ] | # ^): no se toca' });
      continue;
    }
    const base = path.join(dir, slug);
    for (const e of entradas(base)) {
      if (nfc(e.name) === INDICE && e.isFile()) notas.push({ rel: `${slug}/${e.name}`, tipo: 'proyecto', slug });
    }
    for (const [carpeta, tipo] of CARPETAS) {
      const sub = path.join(base, carpeta);
      if (!existsSync(sub)) continue;
      // Una carpeta Sesiones/Decisiones que es enlace o junction podría llevar fuera de Proyectos/.
      if (lstatSync(sub).isSymbolicLink()) {
        avisos.push({ rel: `${slug}/${carpeta}`, error: 'enlace simbólico o junction: no se toca' });
        continue;
      }
      if (!statSync(sub).isDirectory()) continue;
      for (const e of entradas(sub)) {
        const rel = `${slug}/${carpeta}/${e.name}`;
        if (e.isSymbolicLink()) avisos.push({ rel, error: 'enlace simbólico o junction: no se toca' });
        else if (e.isFile() && /\.md$/i.test(e.name)) notas.push({ rel, tipo, slug });
      }
    }
  }
  return notas;
}

// { dir, cambios: [{rel, abs, original, texto, cambios}], avisos: [{rel, error}], revisadas }
export function planificar({ vaultPath, vaultProjectsDir = 'Proyectos' }) {
  const carpeta = vaultProjectsDir.replace(/\\/g, '/').replace(/\/+$/, '');
  const dir = path.join(vaultPath, ...carpeta.split('/'));
  if (!existsSync(dir)) throw new Error(`vault: no existe la carpeta de proyectos ${dir}`);
  const avisos = [];
  const notas = listarNotas(dir, avisos);
  const cambios = [];
  for (const n of notas) {
    const abs = path.join(dir, ...n.rel.split('/'));
    const original = readFileSync(abs);
    let texto;
    try {
      texto = UTF8.decode(original);
    } catch {
      avisos.push({ rel: n.rel, error: 'UTF-8 inválido: se deja intacta' });
      continue;
    }
    const r = retocarNota(texto, { tipo: n.tipo, slug: n.slug, carpeta });
    for (const a of r.avisos) avisos.push({ rel: n.rel, error: a });
    if (r.cambios.length) cambios.push({ rel: n.rel, abs, original, texto: r.texto, cambios: r.cambios });
  }
  return { dir, cambios, avisos, revisadas: notas.length };
}

// Copia de seguridad verificada de cada nota que cambia y después la escritura, conservando la fecha de modificación.
export function aplicar(plan, { backupsDir, ahora = new Date() }) {
  if (!plan.cambios.length) return { escritas: [], omitidas: [], backup: null };
  const base = path.join(backupsDir, `vault-enlazar-${ymd(ahora)}-${hm(ahora).replace(':', '')}`);
  let backup = base;
  for (let n = 2; existsSync(backup); n++) backup = `${base}-${n}`;
  const gB = crearGuardia([backup]);
  for (const c of plan.cambios) gB.escribir(path.join(backup, ...c.rel.split('/')), c.original);
  const copiados = new Map(hashArbol(backup).map((f) => [nfc(f.rel), f.sha256]));
  for (const c of plan.cambios) {
    if (copiados.get(nfc(c.rel)) !== sha(c.original)) {
      throw new Error(`vault: la copia de seguridad de ${c.rel} no coincide con el original; no se escribe nada`);
    }
  }

  const gV = crearGuardia([plan.dir]);
  const escritas = [];
  const omitidas = [];
  for (const c of plan.cambios) {
    if (!readFileSync(c.abs).equals(c.original)) {
      omitidas.push({ rel: c.rel, error: 'la nota cambió mientras se ejecutaba: no se toca' });
      continue;
    }
    const st = statSync(c.abs);
    gV.escribir(c.abs, c.texto);
    utimesSync(c.abs, st.atimeMs / 1000, st.mtimeMs / 1000);
    escritas.push(c.rel);
  }
  return { escritas, omitidas, backup };
}
