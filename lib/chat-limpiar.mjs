import { parseFrontmatter, serializarFrontmatter } from './vp-frontmatter.mjs';

// Bloque de ruido exacto que deja la exportación; solo se quita este bloque, nunca texto de la conversación.
export const RUIDO = /```[ \t]*\r?\nThis block is not supported on your current device yet\.\r?\n```[ \t]*\r?\n?/g;

export function normalizarParaComparar(s) {
  return String(s).replace(RUIDO, '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

const slugCategoria = (c) => String(c).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const tituloDeNombre = (n) => String(n ?? '').replace(/\.md$/i, '').replace(/^\d{4}-\d{2}-\d{2}\s*/, '').trim();

export function limpiarChat(texto, { nombreFichero = '' } = {}) {
  const avisos = [];
  const fm = parseFrontmatter(texto);
  const datos = fm.valido ? fm.datos : {};
  if (!fm.valido) avisos.push('frontmatter ilegible: reconstruido desde el nombre del fichero');
  let quitados = 0;
  const cuerpo = fm.cuerpo
    .replace(RUIDO, () => { quitados++; return ''; })
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '');

  const titulo = String(datos.titulo ?? '').trim()
    || (cuerpo.match(/^# (.+)$/m)?.[1] ?? '').trim()
    || tituloDeNombre(nombreFichero)
    || 'sin título';
  const fecha = String(datos.fecha ?? '') || (String(nombreFichero).match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? '');
  if (!fecha) avisos.push('sin fecha');

  const etiquetas = ['claude-chat'];
  if (datos.categoria) etiquetas.push(slugCategoria(datos.categoria));
  for (const t of [].concat(datos.tags ?? [], datos.etiquetas ?? [])) if (!etiquetas.includes(String(t))) etiquetas.push(String(t));

  const nuevo = { titulo, tipo: 'chat-claude' };
  if (fecha) nuevo.fecha = fecha;
  if (datos.categoria) nuevo.categoria = datos.categoria;
  if (datos.mensajes !== undefined) nuevo.mensajes = datos.mensajes;
  if (datos.uuid) nuevo.uuid = datos.uuid;
  // Cualquier otra clave del original (aliases, url, resumen…) se conserva.
  const propias = new Set(['titulo', 'tipo', 'fecha', 'categoria', 'mensajes', 'uuid', 'tags', 'etiquetas', 'compartir']);
  for (const [k, v] of Object.entries(datos)) if (!propias.has(k)) nuevo[k] = v;
  nuevo.tags = etiquetas;
  nuevo.etiquetas = etiquetas;
  nuevo.compartir = 'privado';
  return { texto: `${serializarFrontmatter(nuevo)}\n${cuerpo.replace(/\s*$/, '\n')}`, quitados, avisos };
}
