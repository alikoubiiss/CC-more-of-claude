import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { hm, ymd } from './dates.mjs';
import { desenlazar, reescribirEnlaces } from './enlaces.mjs';
import { redactar } from './redactor.mjs';
import { parseFrontmatter, serializarFrontmatter } from './vp-frontmatter.mjs';
import { listarMd, primeraLinea } from './vp-indice.mjs';
import { crearGuardia, dentro, nombreSeguro } from './vp-rutas.mjs';

const CARPETA_TIPO = { tema: 'Temas', decision: 'Decisiones', receta: 'Recetas' };
const sinMd = (s) => s.replace(/\.md$/i, '');
const posix = (p) => p.split(path.sep).join('/');
const sinFecha = (t) => t.replace(/^exportada: .*$/m, '');

function motivo(coincidencias) {
  return `datos personales: ${coincidencias.map((c) => `${c.tipo}×${c.cantidad}`).join(', ')}`;
}

export function exportar({ destino, conocimiento, terminos = [], ahora = new Date() }) {
  if (dentro(destino, conocimiento, { incluirBase: true }) || dentro(conocimiento, destino, { incluirBase: true })) {
    throw new Error('vault: la carpeta de conocimiento no puede estar dentro del vault personal ni el vault personal dentro de ella');
  }
  const wiki = path.join(destino, 'Wiki');
  const gK = crearGuardia([conocimiento]);
  const gW = crearGuardia([wiki, path.join(destino, 'log.md')]);
  const retenidas = [];
  const candidatas = [];

  for (const f of listarMd(wiki)) {
    const { datos, cuerpo, valido } = parseFrontmatter(readFileSync(f, 'utf8'));
    const rel = posix(path.relative(wiki, f));
    if (!valido || datos.estado !== 'revisada' || datos.compartir !== 'hq') continue;
    if (datos['revisar-privacidad'] === true) {
      retenidas.push({ rel, motivo: 'pendiente de tu revisión de privacidad (revisar-privacidad: true)' });
      continue;
    }
    const titulo = String(datos.titulo ?? sinMd(path.basename(f)));
    const etiquetas = [].concat(datos.etiquetas ?? []).map(String);
    const { coincidencias } = redactar([titulo, ...etiquetas, cuerpo].join('\n'), { terminos });
    if (coincidencias.length && datos['revisar-privacidad'] !== false) {
      gW.escribir(f, serializarFrontmatter({ ...datos, 'revisar-privacidad': true }) + cuerpo);
      retenidas.push({ rel, motivo: motivo(coincidencias) });
      continue;
    }
    candidatas.push({ f, rel, datos, cuerpo, titulo, etiquetas });
  }

  // Nombres que existirán en HQ: los enlaces a ellos se conservan, el resto se quita.
  const nombreExport = new Map(candidatas.map((c) => {
    const origen = sinMd(path.basename(c.f));
    return [origen.toLowerCase(), nombreSeguro(redactar(origen, { terminos }).texto)];
  }));
  const exportadas = [];
  for (const c of candidatas) {
    const origen = sinMd(path.basename(c.f));
    let cuerpo = desenlazar(c.cuerpo, (d) => nombreExport.has(d.split('/').pop().toLowerCase()));
    cuerpo = reescribirEnlaces(cuerpo, (d) => nombreExport.get(d.split('/').pop().toLowerCase()) ?? null).texto;
    const red = (s) => redactar(s, { terminos }).texto;
    const fm = {
      titulo: red(c.titulo), tipo: c.datos.tipo ?? 'tema', etiquetas: c.etiquetas.map(red), origen: 'wiki-personal', exportada: ymd(ahora),
    };
    const salida = `${serializarFrontmatter(fm)}\n${red(cuerpo).trim()}\n`;
    const rel = `${CARPETA_TIPO[fm.tipo] ?? 'Temas'}/${nombreExport.get(origen.toLowerCase())}.md`;
    const f = path.join(conocimiento, ...rel.split('/'));
    if (existsSync(f)) {
      const actual = readFileSync(f, 'utf8');
      if (sinFecha(actual) !== sinFecha(salida)) {
        gK.escribir(`${f}.bak`, actual);
        gK.escribir(f, salida);
      }
    } else {
      gK.escribir(f, salida);
    }
    exportadas.push({ rel, fm, cuerpo: red(cuerpo) });
  }

  const publicadas = new Set(exportadas.map((e) => e.rel));
  const obsoletas = listarMd(conocimiento)
    .map((f) => ({ rel: posix(path.relative(conocimiento, f)), datos: parseFrontmatter(readFileSync(f, 'utf8')).datos }))
    .filter((n) => n.rel !== 'index.md' && n.datos.origen === 'wiki-personal' && !publicadas.has(n.rel))
    .map((n) => n.rel);

  const lineas = exportadas.sort((a, b) => (a.rel < b.rel ? -1 : 1)).map((e) => {
    const resumen = primeraLinea(e.cuerpo);
    return `- [[${sinMd(path.posix.basename(e.rel))}]]${resumen ? ` — ${resumen}` : ''}`;
  });
  gK.escribir(path.join(conocimiento, 'index.md'), `---\ntipo: indice\norigen: wiki-personal\n---\n\n# Conocimiento\n\n${lineas.join('\n') || '_(vacío)_'}\n`);
  const log = path.join(destino, 'log.md');
  gW.escribir(log, `${existsSync(log) ? readFileSync(log, 'utf8') : '# Log\n\n'}- ${ymd(ahora)} ${hm(ahora)} exportado a HQ: ${exportadas.length} notas, ${retenidas.length} retenidas\n`);
  return { exportadas: exportadas.map((e) => e.rel), retenidas, obsoletas };
}
