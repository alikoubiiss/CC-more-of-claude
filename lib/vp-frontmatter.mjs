// Subconjunto de YAML suficiente para el frontmatter de las notas del vault.

function dividirLista(s) {
  const out = [];
  let actual = '';
  let comilla = null;
  for (const c of s) {
    if (comilla) {
      actual += c;
      if (c === comilla) comilla = null;
    } else if (c === '"' || c === "'") {
      comilla = c;
      actual += c;
    } else if (c === ',') {
      out.push(actual);
      actual = '';
    } else {
      actual += c;
    }
  }
  out.push(actual);
  return out.map((x) => x.trim()).filter((x) => x !== '');
}

function valor(raw) {
  const s = raw.trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    try {
      return JSON.parse(s);
    } catch {
      return s.slice(1, -1);
    }
  }
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+$/.test(s)) return Number(s);
  if (s.startsWith('[') && s.endsWith(']')) return dividirLista(s.slice(1, -1)).map(valor);
  return s;
}

export function parseFrontmatter(texto) {
  const t = String(texto).replace(/^﻿/, '').replace(/\r\n/g, '\n');
  if (!t.startsWith('---\n')) return { datos: {}, cuerpo: String(texto), valido: true };
  const m = t.match(/^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
  if (!m) return { datos: {}, cuerpo: t, valido: false };
  const datos = {};
  let clave = null;
  for (const linea of m[1].split('\n')) {
    if (linea.trim() === '') continue;
    const item = linea.match(/^\s+-\s*(.*)$/);
    if (item && clave !== null && Array.isArray(datos[clave])) {
      datos[clave].push(valor(item[1]));
      continue;
    }
    const kv = linea.match(/^([\w-]+):\s*(.*)$/);
    if (!kv) return { datos: {}, cuerpo: t, valido: false };
    clave = kv[1];
    datos[clave] = kv[2] === '' ? [] : valor(kv[2]);
    if (kv[2] !== '') clave = null;
  }
  return { datos, cuerpo: t.slice(m[0].length), valido: true };
}

const NECESITA_COMILLAS = /^(?:\s|.*\s$)|[:#\n]|^[-?,[\]{}#&*!|>'"%@`]|^(?:true|false|null|~|-?\d+(?:\.\d+)?)$/i;

function escalar(v, enLista = false) {
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const s = String(v);
  if (s === '' || NECESITA_COMILLAS.test(s) || (enLista && /[,[\]]/.test(s))) return JSON.stringify(s);
  return s;
}

export function serializarFrontmatter(datos) {
  const lineas = Object.entries(datos).map(([k, v]) => (
    Array.isArray(v) ? `${k}: [${v.map((x) => escalar(x, true)).join(', ')}]` : `${k}: ${escalar(v)}`
  ));
  return `---\n${lineas.join('\n')}\n---\n`;
}
