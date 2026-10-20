import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { HQ_ROOT } from './config.mjs';
import { limpiarChat, normalizarParaComparar } from './chat-limpiar.mjs';
import { hm, ymd } from './dates.mjs';
import { reescribirBase, reescribirEnlaces } from './enlaces.mjs';
import { copiarConHashes, verificarCopia } from './respaldo.mjs';
import { parseFrontmatter, serializarFrontmatter } from './vp-frontmatter.mjs';
import { crearGuardia, dentro, nombreSeguro } from './vp-rutas.mjs';

const UTF8 = new TextDecoder('utf-8', { fatal: true });
const SIN_CLASIFICAR = 'Notas/Sin clasificar';
const CARPETAS_BASE = ['Diario', 'Notas', 'Salud y Habitos', 'Fuentes/Chats', 'Fuentes/Recursos', 'Wiki/Temas', 'Wiki/Decisiones',
  'Wiki/Recetas', 'Proyectos', 'Plantillas', 'Paneles', '_migracion'];
const MAPA_CARPETAS = {
  '06 - Chats de Claude': 'Fuentes/Chats', '07 - Temas': 'Wiki/Temas', '03 - Proyectos': 'Proyectos',
  '05 - Recursos': 'Fuentes/Recursos', Plantillas: 'Plantillas', '08 - Panel': 'Paneles',
};

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const esMd = (rel) => /\.md$/i.test(rel);
const sinMd = (s) => s.replace(/\.md$/i, '');
const baseDe = (rel) => rel.split('/').pop();

// Ficheros normales y enlaces simbólicos/junctions (estos nunca se siguen: se avisa de ellos).
function listarFicheros(dir) {
  const ficheros = [];
  const enlaces = [];
  const visitar = (d, prefijo) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const rel = prefijo ? `${prefijo}/${e.name}` : e.name;
      if (e.isSymbolicLink()) enlaces.push(rel);
      else if (e.isDirectory()) visitar(path.join(d, e.name), rel);
      else if (e.isFile()) ficheros.push(rel);
    }
  };
  visitar(dir, '');
  return { ficheros, enlaces };
}

const AVISO_ENLACE = 'enlace simbólico o junction: no se migra ni entra en la copia de seguridad; revísalo a mano';
const TIPOS_TEXTO = ['tema', 'recurso', 'proyecto', 'plantilla', 'panel'];

function clasificar(rel) {
  const p = rel.split('/');
  const nombre = p[p.length - 1];
  if (p[0] === '.obsidian') return { tipo: 'omitido' };
  if (rel === 'Inicio.md' || rel === 'Panel.md') return { tipo: 'reemplazado', destinoRel: `Fuentes/Recursos/${sinMd(rel)} (antiguo).md` };
  if (p[0] === '06 - Chats de Claude' && esMd(rel)) return nombre.startsWith('000 ') ? { tipo: 'regenerado' } : { tipo: 'chat' };
  if (p[0] === '05 - Recursos') {
    if (p[1] === 'Adjuntos' && p.length > 2) return { tipo: 'adjunto', destinoRel: `Fuentes/Recursos/Adjuntos/${p.slice(2).join('/')}` };
    if (p.length === 2 && esMd(rel)) return { tipo: 'recurso', destinoRel: `Fuentes/Recursos/${nombre}` };
  }
  if (p[0] === '07 - Temas' && p.length === 2 && esMd(rel)) return nombre.startsWith('000 ') ? { tipo: 'regenerado' } : { tipo: 'tema', destinoRel: `Wiki/Temas/${nombre}` };
  if (p[0] === '03 - Proyectos' && p.length === 2 && esMd(rel)) return { tipo: 'proyecto', destinoRel: `Proyectos/${nombre}` };
  if (p[0] === 'Plantillas' && p.length > 1) return { tipo: 'plantilla', destinoRel: rel };
  if (p[0] === '08 - Panel' && p.length === 2 && /\.base$/i.test(rel)) return { tipo: 'panel', destinoRel: `Paneles/${nombre}` };
  return { tipo: 'sin-clasificar', destinoRel: `${SIN_CLASIFICAR}/${rel}` };
}

export function planificar(origen) {
  const items = [];
  const avisos = [];
  const usados = new Set();
  const unico = (destinoRel) => {
    let d = destinoRel;
    const ext = path.posix.extname(destinoRel);
    const raiz = destinoRel.slice(0, destinoRel.length - ext.length);
    for (let n = 2; usados.has(d.toLowerCase()); n++) d = `${raiz} (${n})${ext}`;
    usados.add(d.toLowerCase());
    return d;
  };
  const { ficheros, enlaces } = listarFicheros(origen);
  for (const rel of enlaces) avisos.push({ rel, error: AVISO_ENLACE });
  for (const rel of ficheros) {
    const c = clasificar(rel);
    const item = { rel, tipo: c.tipo };
    if (TIPOS_TEXTO.includes(c.tipo) && (esMd(rel) || /\.base$/i.test(rel))) {
      try {
        UTF8.decode(readFileSync(path.join(origen, ...rel.split('/'))));
      } catch {
        item.crudo = true;
        avisos.push({ rel, error: 'UTF-8 inválido: copiado sin cambios' });
      }
    }
    if (c.tipo === 'chat') {
      const buf = readFileSync(path.join(origen, ...rel.split('/')));
      let texto = null;
      try {
        texto = UTF8.decode(buf);
      } catch {
        avisos.push({ rel, error: 'UTF-8 inválido: copiado sin cambios a Fuentes/Chats/sin-fecha' });
      }
      if (texto === null) {
        item.crudo = true;
        item.destinoRel = unico(`Fuentes/Chats/sin-fecha/${nombreSeguro(sinMd(baseDe(rel)))}.md`);
      } else {
        const r = limpiarChat(texto, { nombreFichero: baseDe(rel) });
        for (const a of r.avisos) avisos.push({ rel, error: a });
        const datos = parseFrontmatter(r.texto).datos;
        const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(datos.fecha)) ? String(datos.fecha) : '';
        const nombre = `${fecha ? `${fecha} ` : ''}${nombreSeguro(datos.titulo, 100)}.md`;
        item.destinoRel = unico(`Fuentes/Chats/${fecha ? fecha.slice(0, 4) : 'sin-fecha'}/${nombre}`);
        item.limpio = r.texto;
      }
    } else if (c.destinoRel) {
      // Un tema que no se puede leer como UTF-8 se copia literal: nunca a la Wiki, donde su frontmatter (revisada/hq) saltaría la revisión.
      item.destinoRel = unico(item.crudo && c.tipo === 'tema' ? `${SIN_CLASIFICAR}/${rel}` : c.destinoRel);
    }
    items.push(item);
  }
  return { items, avisos, enlaces };
}

function construirResolver(items, avisos) {
  const mapa = new Map();
  const porRuta = new Map();
  const poner = (viejo, nuevo, rel) => {
    const k = viejo.toLowerCase();
    if (mapa.has(k)) avisos.push({ rel, error: `nombre repetido en el vault viejo: [[${viejo}]] apunta a la primera nota` });
    else mapa.set(k, nuevo);
  };
  for (const it of items) {
    const nombre = sinMd(baseDe(it.rel));
    if (['chat', 'tema', 'proyecto', 'plantilla', 'recurso'].includes(it.tipo) && esMd(it.rel)) {
      poner(nombre, sinMd(baseDe(it.destinoRel)), it.rel);
      porRuta.set(sinMd(it.rel).toLowerCase(), sinMd(baseDe(it.destinoRel)));
    }
    else if (it.tipo === 'regenerado') poner(nombre, 'index', it.rel);
    else if (it.tipo === 'reemplazado') mapa.set(nombre.toLowerCase(), 'Inicio');
  }
  return (destino) => {
    const k = destino.toLowerCase().replace(/\\/g, '/');
    if (k.includes('/')) {
      // Con carpeta: gana la nota de esa carpeta aunque otra tenga el mismo nombre.
      for (const [ruta, nuevo] of porRuta) if (ruta === k || ruta.endsWith(`/${k}`)) return nuevo;
    }
    return mapa.get(k.split('/').pop()) ?? null;
  };
}

const neutralizar = (s) => normalizarParaComparar(s).replace(/\[\[[^\]\n]*\]\]/g, '[[]]');

export function verificar({ origen, destino, mapa }) {
  const detalles = [];
  const conEntrada = new Set(mapa.map((m) => m.origen));
  const { ficheros, enlaces } = listarFicheros(origen);
  for (const rel of enlaces) detalles.push(`enlace simbólico no migrado: ${rel}`);
  for (const rel of ficheros) if (!conEntrada.has(rel)) detalles.push(`sin entrada en el mapa: ${rel}`);
  for (const m of mapa) {
    if (m.estado === 'error') detalles.push(`error al migrar ${m.origen}`);
    if (m.estado !== 'migrada' && m.estado !== 'reemplazada') continue;
    const f = path.join(destino, ...m.destino.split('/'));
    if (!existsSync(f)) {
      detalles.push(`falta ${m.destino} (origen ${m.origen})`);
      continue;
    }
    if (m.crudo) {
      if (sha(readFileSync(f)) !== m.sha256Origen) detalles.push(`contenido distinto en ${m.destino}`);
      continue;
    }
    if (m.tipo !== 'chat') continue;
    const viejo = parseFrontmatter(readFileSync(path.join(origen, ...m.origen.split('/')), 'utf8')).cuerpo;
    const nuevo = parseFrontmatter(readFileSync(f, 'utf8')).cuerpo;
    if (neutralizar(viejo) !== neutralizar(nuevo)) detalles.push(`texto distinto en ${m.destino}`);
  }
  return { ok: detalles.length === 0, detalles };
}

function conCompartirPrivado(texto, extra = {}) {
  const fm = parseFrontmatter(texto);
  const datos = { ...(fm.valido ? fm.datos : {}), ...extra, compartir: 'privado' };
  return serializarFrontmatter(datos) + (fm.valido ? fm.cuerpo : texto);
}

function plantilla(plantillasDir, nombre, ahora) {
  return readFileSync(path.join(plantillasDir, nombre), 'utf8').replaceAll('{{fecha}}', ymd(ahora));
}

export function ejecutar({ origen, destino, backupsDir, ahora = new Date(), forzarExistente = false, dryRun = false,
  plantillasDir = path.join(HQ_ROOT, 'templates', 'vault-personal') }) {
  if (!existsSync(origen)) throw new Error(`vault: no existe el vault de origen ${origen}`);
  if (dentro(origen, destino, { incluirBase: true }) || dentro(destino, origen, { incluirBase: true })) {
    throw new Error('vault: el destino no puede estar dentro del origen ni el origen dentro del destino');
  }
  if (existsSync(destino) && readdirSync(destino).length > 0 && !forzarExistente) {
    throw new Error(`vault: el destino ya existe y no está vacío (${destino}); usa --forzar-existente para reescribirlo`);
  }
  const plan = planificar(origen);
  const porTipo = {};
  for (const it of plan.items) porTipo[it.tipo] = (porTipo[it.tipo] ?? 0) + 1;
  if (dryRun) return { dryRun: true, porTipo, avisos: plan.avisos, plan: plan.items.map(({ rel, tipo, destinoRel }) => ({ rel, tipo, destinoRel })) };

  // 1. Copia de seguridad verificada antes de escribir nada en el destino.
  const baseBackup = path.join(backupsDir, `vault-personal-${ymd(ahora)}-${hm(ahora).replace(':', '')}`);
  let dirBackup = baseBackup;
  for (let n = 2; existsSync(dirBackup); n++) dirBackup = `${baseBackup}-${n}`;
  const copia = copiarConHashes(origen, dirBackup, crearGuardia([dirBackup]));
  if (!verificarCopia(origen, dirBackup).ok) throw new Error('vault: la copia de seguridad no coincide con el original; no se escribe nada en el destino');

  // 2. Migración.
  const guardia = crearGuardia([destino]);
  const abs = (rel) => path.join(destino, ...rel.split('/'));
  const avisos = [...plan.avisos];
  // Con --forzar-existente nada del destino se pierde: si un fichero ya existe y cambia, el anterior queda en <fichero>.bak.
  const escribir = (rel, contenido) => {
    const f = abs(rel);
    if (existsSync(f) && readFileSync(f, 'utf8') !== contenido) guardia.escribir(`${f}.bak`, readFileSync(f));
    guardia.escribir(f, contenido);
  };
  const copiar = (origenAbs, rel) => {
    const f = abs(rel);
    if (existsSync(f) && !readFileSync(f).equals(readFileSync(origenAbs))) guardia.escribir(`${f}.bak`, readFileSync(f));
    guardia.copiar(origenAbs, f);
  };
  for (const d of CARPETAS_BASE) guardia.mkdir(abs(d));
  const resolver = construirResolver(plan.items, avisos);
  const rotos = new Set();
  const reescribir = (texto) => {
    const r = reescribirEnlaces(texto, resolver);
    r.rotos.forEach((x) => rotos.add(x));
    return r.texto;
  };
  const mapa = [];
  for (const it of plan.items) {
    const origenAbs = path.join(origen, ...it.rel.split('/'));
    const entrada = { origen: it.rel, destino: it.destinoRel ?? null, tipo: it.tipo, estado: 'migrada', sha256Origen: sha(readFileSync(origenAbs)) };
    if (it.crudo) entrada.crudo = true;
    try {
      if (it.tipo === 'omitido') entrada.estado = 'omitida';
      else if (it.tipo === 'regenerado') entrada.estado = 'regenerada';
      else if (it.crudo) copiar(origenAbs, it.destinoRel);
      else if (it.tipo === 'chat') escribir(it.destinoRel, reescribir(it.limpio));
      else if (it.tipo === 'reemplazado') {
        entrada.estado = 'reemplazada';
        copiar(origenAbs, it.destinoRel);
      } else if (['adjunto', 'sin-clasificar'].includes(it.tipo) || (it.tipo === 'plantilla' && !esMd(it.rel))) copiar(origenAbs, it.destinoRel);
      else {
        const texto = readFileSync(origenAbs, 'utf8');
        let salida;
        if (it.tipo === 'tema') salida = reescribir(conCompartirPrivado(texto, { estado: 'borrador' }));
        else if (it.tipo === 'recurso') salida = conCompartirPrivado(texto);
        else if (it.tipo === 'panel') salida = reescribirBase(texto, MAPA_CARPETAS);
        else salida = reescribir(texto);
        escribir(it.destinoRel, salida);
      }
    } catch (e) {
      entrada.estado = 'error';
      avisos.push({ rel: it.rel, error: e.message });
    }
    mapa.push(entrada);
  }

  // 3. Ficheros generados.
  escribir('Inicio.md', plantilla(plantillasDir, 'Inicio.md', ahora));
  escribir('CLAUDE.md', plantilla(plantillasDir, 'CLAUDE.md', ahora));
  const temas = mapa.filter((m) => m.tipo === 'tema' && m.estado === 'migrada').map((m) => sinMd(baseDe(m.destino))).sort();
  const nChats = mapa.filter((m) => m.tipo === 'chat' && m.estado === 'migrada').length;
  escribir('index.md', `---\ntipo: indice\n---\n\n# Índice\n\n## Wiki\n\n${temas.map((t) => `- [[${t}]]`).join('\n') || '_(vacía)_'}\n\n## Fuentes\n\n- ${nChats} chats en \`Fuentes/Chats\`\n`);
  const migradas = mapa.filter((m) => m.estado === 'migrada' || m.estado === 'reemplazada').length;
  const previo = existsSync(abs('log.md')) ? readFileSync(abs('log.md'), 'utf8') : '# Log\n\n';
  guardia.escribir(abs('log.md'), `${previo}- ${ymd(ahora)} ${hm(ahora)} migración: ${migradas} ficheros, ${avisos.length} avisos\n`);
  guardia.escribir(abs('_migracion/mapa.json'), `${JSON.stringify(mapa, null, 2)}\n`);

  // 4. Verificación e informe.
  const verificacion = verificar({ origen, destino, mapa });
  const informe = {
    dryRun: false, migradas, avisos, rotos: [...rotos].sort(), verificacion, porTipo, destino,
    backup: { dir: dirBackup, ficheros: copia.ficheros.length },
  };
  const lineas = [
    '# Informe de migración', '', `Fecha: ${ymd(ahora)} ${hm(ahora)}`, `Ficheros migrados: ${migradas}`, `Copia de seguridad: ${dirBackup} (${copia.ficheros.length} ficheros)`,
    `Verificación: ${verificacion.ok ? 'correcta' : 'FALLÓ'}`, '', '## Por tipo', ...Object.entries(porTipo).map(([k, v]) => `- ${k}: ${v}`),
    '', '## Avisos', ...(avisos.length ? avisos.map((a) => `- ${a.rel}: ${a.error}`) : ['- ninguno']),
    '', '## Enlaces sin destino (informativo)', ...(informe.rotos.length ? informe.rotos.map((r) => `- [[${r}]]`) : ['- ninguno']),
    '', '## Detalles de verificación', ...(verificacion.detalles.length ? verificacion.detalles.map((d) => `- ${d}`) : ['- ninguno']),
    '', verificacion.ok ? 'El vault viejo ya no hace falta cuando hayas comprobado el nuevo en Obsidian. Borrarlo lo decides tú.' : 'No des por buena la migración: revisa los detalles.',
  ];
  guardia.escribir(abs('_migracion/informe.md'), `${lineas.join('\n')}\n`);
  return informe;
}
