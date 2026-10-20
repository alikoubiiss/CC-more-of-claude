// Instala (si falta) el esquema de color "HQ" en el settings.json de Windows Terminal.
// Idempotente y aditivo: edita por inserción de texto (conserva comentarios y formato),
// hace copia de seguridad con fecha junto al original y no toca nada más.
// Uso: node scripts/install-wt-scheme.mjs [--dry-run] [--settings <ruta>]
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCHEME_NAME = 'HQ';

export const HQ_SCHEME = {
  name: SCHEME_NAME,
  background: '#0B0E1A',
  foreground: '#E6E9F5',
  cursorColor: '#FFC86B',
  selectionBackground: '#3B4360',
  black: '#2A3150',
  red: '#FF6B81',
  green: '#6FE3A0',
  yellow: '#FFC86B',
  blue: '#6EA8FF',
  purple: '#8B7CFF',
  cyan: '#5ED3C2',
  white: '#C9CEE3',
  brightBlack: '#7A84A6',
  brightRed: '#FF8FA0',
  brightGreen: '#8CF0B6',
  brightYellow: '#FFD98F',
  brightBlue: '#8FBCFF',
  brightPurple: '#A89CFF',
  brightCyan: '#7FE6D8',
  brightWhite: '#F4F6FF',
};

export function defaultSettingsPath() {
  const local = process.env.LOCALAPPDATA;
  if (!local) return null;
  const cands = [
    path.join(local, 'Packages', 'Microsoft.WindowsTerminal_8wekyb3d8bbwe', 'LocalState', 'settings.json'),
    path.join(local, 'Microsoft', 'Windows Terminal', 'settings.json'),
  ];
  return cands.find((p) => existsSync(p)) ?? null;
}

// Posición del ']' que cierra el array que empieza en `open` (ignora cadenas y comentarios).
function matchingBracket(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === '\\') i++; }
    else if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; }
    else if (c === '/' && text[i + 1] === '*') { i = text.indexOf('*/', i + 2); if (i < 0) return -1; i++; }
    else if (c === '[') depth++;
    else if (c === ']' && --depth === 0) return i;
  }
  return -1;
}

// Devuelve { changed, text }. Lanza si no puede insertar con seguridad.
export function addScheme(text) {
  if (new RegExp(`"name"\\s*:\\s*"${SCHEME_NAME}"`).test(text.slice(text.search(/"schemes"\s*:/)))) {
    return { changed: false, text };
  }
  const m = /"schemes"\s*:\s*\[/.exec(text);
  if (!m) throw new Error('no se encontró el array "schemes" en settings.json');
  const open = m.index + m[0].length - 1;
  const close = matchingBracket(text, open);
  if (close < 0) throw new Error('"schemes" mal formado');
  const inner = text.slice(open + 1, close);
  const body = JSON.stringify(HQ_SCHEME, null, 4).replace(/^/gm, '        ');
  const vacio = inner.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '').trim() === '';
  const nuevo = vacio
    ? `${text.slice(0, open + 1)}\n${body}\n    ${text.slice(close)}`
    : `${text.slice(0, open + 1)}\n${body},${text.slice(open + 1)}`;
  return { changed: true, text: nuevo };
}

export function installScheme({ settings = defaultSettingsPath(), dryRun = false } = {}) {
  if (!settings || !existsSync(settings)) throw new Error('no se encontró el settings.json de Windows Terminal');
  const original = readFileSync(settings, 'utf8');
  const { changed, text } = addScheme(original);
  if (!changed) return { changed: false, settings };
  if (dryRun) return { changed: true, settings, dryRun: true };
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const backup = `${settings}.bak-${stamp}`;
  copyFileSync(settings, backup);
  writeFileSync(settings, text, 'utf8');
  return { changed: true, settings, backup };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--settings');
  try {
    const r = installScheme({ settings: i >= 0 ? argv[i + 1] : undefined, dryRun: argv.includes('--dry-run') });
    console.log(r.changed ? `Esquema "${SCHEME_NAME}" ${r.dryRun ? 'se añadiría' : 'añadido'} en ${r.settings}${r.backup ? `\nCopia: ${r.backup}` : ''}` : `El esquema "${SCHEME_NAME}" ya existe en ${r.settings}; nada que hacer.`);
  } catch (e) {
    console.error(`install-wt-scheme: ${e.message}`);
    process.exit(1);
  }
}
