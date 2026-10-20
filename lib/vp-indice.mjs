import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { ymd } from './dates.mjs';
import { reescribirEnlaces } from './enlaces.mjs';
import { parseFrontmatter } from './vp-frontmatter.mjs';

const sinMd = (s) => s.replace(/\.md$/i, '');
const posix = (p) => p.split(path.sep).join('/');

export function listarMd(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  const visitar = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) visitar(path.join(d, e.name));
      else if (e.isFile() && /\.md$/i.test(e.name)) out.push(path.join(d, e.name));
    }
  };
  visitar(dir);
  return out.sort();
}

export function primeraLinea(cuerpo, max = 100) {
  for (const l of cuerpo.split('\n')) {
    const t = l.trim();
    if (!t || /^(#|>|```|---)/.test(t)) continue;
    return t.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').replace(/[*_`[\]]/g, '').slice(0, max);
  }
  return '';
}

const SECCIONES = [['Temas', 'Temas'], ['Decisiones', 'Decisiones'], ['Recetas', 'Recetas']];

export function regenerarIndice(destino, guardia) {
  const partes = ['---\ntipo: indice\n---\n', '# Índice\n'];
  for (const [carpeta, titulo] of SECCIONES) {
    const lineas = listarMd(path.join(destino, 'Wiki', carpeta)).map((f) => {
      const { datos, cuerpo } = parseFrontmatter(readFileSync(f, 'utf8'));
      const resumen = primeraLinea(cuerpo);
      return `- [[${sinMd(path.basename(f))}]]${resumen ? ` — ${resumen}` : ''}${datos.estado === 'borrador' ? ' (borrador)' : ''}`;
    });
    partes.push(`## ${titulo}\n\n${lineas.join('\n') || '_(vacío)_'}\n`);
  }
  const nChats = listarMd(path.join(destino, 'Fuentes', 'Chats')).length;
  partes.push(`## Fuentes\n\n- ${nChats} chats en \`Fuentes/Chats\`\n`);
  guardia.escribir(path.join(destino, 'index.md'), partes.join('\n'));
}

const DIAS_BORRADOR = 14;

export function revisar({ destino, ahora = new Date() }) {
  const todas = listarMd(destino).filter((f) => !/^_migracion\//.test(posix(path.relative(destino, f))));
  const base = new Set(todas.map((f) => sinMd(path.basename(f)).toLowerCase()));
  const leer = (f) => {
    const t = readFileSync(f, 'utf8');
    return { rel: posix(path.relative(destino, f)), texto: t, ...parseFrontmatter(t) };
  };
  const notas = todas.map(leer);
  const entrantes = new Set();
  for (const n of notas) {
    if (['index.md', 'log.md', 'Inicio.md'].includes(n.rel)) continue;
    reescribirEnlaces(n.texto, (d) => {
      entrantes.add(d.split('/').pop().toLowerCase());
      return null;
    });
  }
  const wiki = notas.filter((n) => n.rel.startsWith('Wiki/'));
  const huerfanas = wiki.filter((n) => !entrantes.has(sinMd(path.posix.basename(n.rel)).toLowerCase())).map((n) => n.rel);
  const rotos = [];
  for (const n of wiki) {
    for (const destinoRoto of reescribirEnlaces(n.texto, (d) => (base.has(d.split('/').pop().toLowerCase()) ? d : null)).rotos) {
      rotos.push({ rel: n.rel, destino: destinoRoto });
    }
  }
  const hoy = Date.parse(`${ymd(ahora)}T00:00:00Z`);
  const borradoresAntiguos = wiki.filter((n) => {
    if (n.datos.estado !== 'borrador') return false;
    const creada = Date.parse(`${String(n.datos.creada ?? '')}T00:00:00Z`);
    return Number.isFinite(creada) && (hoy - creada) / 86_400_000 > DIAS_BORRADOR;
  }).map((n) => n.rel);
  return { huerfanas, rotos, borradoresAntiguos };
}
