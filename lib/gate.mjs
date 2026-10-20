// Puerta humana de HQ. Defensa en profundidad: analiza el texto del comando con un
// parser pequeño (heredocs, sustituciones, segmentos, tokens, programa real). No es una
// garantía: comandos ofuscados (variables, base64, etc.) pueden saltarla. Ante cualquier
// error interno, deja pasar (devuelve null).

export const RAZON = 'Puerta humana de HQ: solo la persona usuaria puede cerrar tarjetas (estado "Hecho") y aprobar fases. Hazlo desde cc (tecla a o A) o ejecuta tú el comando en tu terminal (en Claude Code, escribe ! delante). No lo reintentes por tu cuenta.';

const MAX = 500000;
const MAX_DEPTH = 3;
const PH = '_SUB_';

// --- Heredocs: sus cuerpos son datos, salvo si alimentan a un shell --------------
function tagsDeLinea(line) {
  const tags = [];
  let i = line.indexOf('<<');
  while (i !== -1) {
    let j = i + 2;
    if (line[j] === '<') { i = line.indexOf('<<', j + 1); continue; } // <<< here-string
    let dash = false;
    if (line[j] === '-') { dash = true; j++; }
    while (line[j] === ' ' || line[j] === '\t') j++;
    if (line[j] === '"' || line[j] === "'") j++;
    const s = j;
    while (j < line.length && /[A-Za-z0-9_]/.test(line[j])) j++;
    if (j > s && /[A-Za-z_]/.test(line[s])) {
      const fin = line[j] === '"' || line[j] === "'" ? j + 1 : j;
      tags.push({ tag: line.slice(s, j), dash, fin });
    }
    i = line.indexOf('<<', Math.max(j, i + 2));
  }
  return tags;
}

// ¿El heredoc de esta línea alimenta a un shell? Casos: bash <<EOF (con cualquier opción
// salvo -c), <<EOF bash, cat <<EOF | bash. Los demás heredocs son datos.
function alimentaShell(line, fin) {
  const pre = line.slice(0, line.indexOf('<<'));
  let k = -1;
  for (const ch of ';|&(`{') k = Math.max(k, pre.lastIndexOf(ch));
  const a = tokenize(pre.slice(k + 1));
  if (shellSinC(a.words, a.quoted)) return true;
  for (const seg of escanear(line.slice(fin)).segs) {
    const t = tokenize(seg);
    const words = [];
    const quoted = [];
    t.words.forEach((w, n) => { if (!w.includes('<<')) { words.push(w); quoted.push(t.quoted[n]); } });
    if (shellSinC(words, quoted)) return true;
  }
  return false;
}

function separarHeredocs(text) {
  const lines = text.split('\n');
  const out = [];
  const shell = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i++];
    out.push(line);
    if (line.indexOf('<<') === -1) continue;
    const tags = tagsDeLinea(line);
    if (!tags.length) continue;
    const esShell = alimentaShell(line, tags[0].fin);
    for (const { tag, dash } of tags) {
      const cuerpo = [];
      while (i < lines.length) {
        const l = lines[i++];
        const cmp = dash ? l.trim() : l.replace(/\r$/, '');
        if (cmp === tag) break;
        if (esShell) cuerpo.push(l);
      }
      if (esShell && cuerpo.length) shell.push(cuerpo.join('\n'));
    }
  }
  return { sin: out.join('\n'), shell };
}

export function stripHeredocs(text) {
  return separarHeredocs(text).sin;
}

// --- Segmentos: separadores sin comillas; sustituciones extraídas -------------------
// Devuelve los segmentos (con cada $(...) o `...` sustituido por un marcador) y los
// textos internos de las sustituciones, para analizarlos aparte. Dentro de comillas
// dobles también se extraen; dentro de comillas simples, no. Los paréntesis sin comillas
// separan segmentos, así que los subshells ( ... ) se analizan como comandos normales.
function cierraParen(text, i) {
  let d = 1;
  let q = null;
  for (; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (q === '"' && c === '\\') { i++; continue; }
      if (c === q) q = null;
      continue;
    }
    if (c === '\\') { const e = text[i + 1]; if (e === "'" || e === '"' || e === '\n') i++; continue; }
    if (c === "'" || c === '"') { q = c; continue; }
    if (c === '(') d++;
    else if (c === ')' && --d === 0) return i;
  }
  return -1;
}

function escanear(text) {
  const segs = [];
  const pipes = [];
  const inners = [];
  const n = text.length;
  let pipeNext = false;
  let parts = [];
  let start = 0;
  let i = 0;
  let q = null;
  const cut = (end) => { if (end > start) parts.push(text.slice(start, end)); };
  const fin = (end) => {
    cut(end);
    const s = parts.join('');
    parts = [];
    if (s.trim() !== '') { segs.push(s); pipes.push(pipeNext); }
    pipeNext = false;
  };
  const sustituye = (desde, ini, fi, sig) => {
    if (fi <= ini) return; // vacía: nada que analizar
    cut(desde);
    parts.push(PH);
    start = sig;
    inners.push(text.slice(ini, fi));
  };
  const sustitucion = (c) => {
    if (c === '`') {
      let j = i + 1;
      while (j < n && text[j] !== '`') j += text[j] === '\\' ? 2 : 1;
      const e = j < n ? j : -1;
      const sig = e === -1 ? n : e + 1;
      sustituye(i, i + 1, e === -1 ? n : e, sig);
      i = sig;
      return true;
    }
    if (c === '$' && text[i + 1] === '(') {
      const e = cierraParen(text, i + 2);
      const sig = e === -1 ? n : e + 1;
      sustituye(i, i + 2, e === -1 ? n : e, sig);
      i = sig;
      return true;
    }
    return false;
  };
  while (i < n) {
    const c = text[i];
    if (q === "'") { if (c === "'") q = null; i++; continue; }
    if (q === '"') {
      if (c === '\\') { i += 2; continue; }
      if (c === '"') { q = null; i++; continue; }
      if (!sustitucion(c)) i++;
      continue;
    }
    if (c === '\\') {
      const d = text[i + 1];
      if (d === "'" || d === '"' || d === '\n') i += 2;
      else if (d === '\r' && text[i + 2] === '\n') i += 3;
      else i++;
      continue;
    }
    if (c === "'" || c === '"') { q = c; i++; continue; }
    if (sustitucion(c)) continue;
    if (c === ';' || c === '\n' || c === '\r' || c === '(' || c === ')') { fin(i); i++; start = i; continue; }
    if (c === '#' && (i === 0 || ' \t\r\n'.includes(text[i - 1]))) { // comentario hasta fin de línea
      cut(i);
      const e = text.indexOf('\n', i);
      i = e === -1 ? n : e;
      start = i;
      continue;
    }
    if (c === '|') {
      if (text[i - 1] === '>') { i++; continue; } // >|
      fin(i);
      const doble = text[i + 1] === '|';
      i++;
      if (doble || text[i] === '&') i++;
      start = i;
      pipeNext = !doble;
      continue;
    }
    if (c === '&') {
      const prev = text[i - 1];
      if (prev === '>' || prev === '<' || text[i + 1] === '>') { i++; continue; }
      fin(i);
      i++;
      if (text[i] === '&') i++;
      start = i;
      continue;
    }
    i++;
  }
  fin(n);
  return { segs, pipes, inners };
}

export function splitSegments(text) {
  return escanear(text).segs;
}

// --- Tokens ----------------------------------------------------------------------
// Parte en `>` / `>>` sin comillas (no `>&`, `&>`, `2>&1`): su destino es una redirección.
export function tokenize(seg) {
  const toks = [];
  let cur = '';
  let has = false;
  let qd = false;
  let q = null;
  let red = false; // false | 'dst' | 'dup'
  const end = () => {
    if (has) {
      if (red === 'dup') red = false;
      else { toks.push({ v: cur, r: red === 'dst', qd }); red = false; }
    }
    cur = ''; has = false; qd = false;
  };
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i];
    if (q) {
      if (q === '"' && c === '\\' && (seg[i + 1] === '"' || seg[i + 1] === '\\')) { cur += seg[i + 1]; i++; continue; }
      if (c === q) { q = null; continue; }
      cur += c;
      continue;
    }
    if (c === '\\') {
      const d = seg[i + 1];
      if (d === "'" || d === '"') { cur += d; has = true; i++; continue; }
      if (d === '\n') { i++; continue; }
      if (d === '\r' && seg[i + 2] === '\n') { i += 2; continue; }
      cur += c; has = true;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { end(); continue; }
    if (c === "'" || c === '"') { q = c; has = true; qd = true; continue; }
    if (c === '>') {
      if (has && !qd && (cur === '&' || /^\d+$/.test(cur))) { cur = ''; has = false; } else end();
      let j = i + 1;
      if (seg[j] === '>') j++;
      if (seg[j] === '&') { red = 'dup'; j++; } else { if (seg[j] === '|') j++; red = 'dst'; }
      i = j - 1;
      continue;
    }
    cur += c; has = true;
  }
  end();
  const words = [];
  const quoted = [];
  const redirs = [];
  for (const t of toks) {
    if (t.r) redirs.push(t.v);
    else { words.push(t.v); quoted.push(t.qd); }
  }
  return { words, quoted, redirs };
}

// --- Reglas -----------------------------------------------------------------------
const norm = (s) => s.replace(/\\/g, '/').toLowerCase();
const esFases = (t) => { const n = norm(t); return n === 'fases.json' || n.endsWith('/fases.json'); };
const enTareas = (t) => norm(t).includes('backlog/tasks/');
const HECHO = /\b(?:hecho|done)\b/i;
const ESCRIBE = /open\(|write|rename|replace|unlink|remove|dump/;
const FLAGS_CODIGO = new Set(['-c', '-e', '--eval', '-p', '--print', '-pe', '-ne']);
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'cmd', 'powershell', 'pwsh']);
const FLAGS_SHELL = new Set(['-c', '/c', '/k', '-command']);
// -c, -lc, -ec, -xc ..., /c, /k, -Command
const esFlagC = (a) => FLAGS_SHELL.has(a.toLowerCase()) || /^-[a-z]*c$/i.test(a);
// ¿El segmento ejecuta un shell que leerá sus órdenes de stdin (sin -c)?
function shellSinC(words, quoted) {
  const res = resolver(words, quoted);
  return !!res && res.prog !== undefined && SHELLS.has(res.prog) && !res.args.some(esFlagC);
}
const PALABRAS = new Set(['if', 'then', 'else', 'elif', 'do', 'while', 'until']);
const FLAGS_START = /^\/(?:b|wait|min|max|low|normal|high|realtime|abovenormal|belownormal|separate|shared|i)$/i;
// Envolturas con opciones: opciones que consumen el argumento siguiente.
const OPCIONES = {
  nice: ['-n', '--adjustment'],
  timeout: ['-s', '-k', '--signal', '--kill-after'],
  xargs: ['-n', '-I', '-L', '-P', '-s', '-d', '-a', '-E'],
  stdbuf: ['-o', '-e', '-i'],
  ionice: ['-c', '-n', '-p', '-P', '-u'],
  watch: ['-n', '--interval'],
  doas: ['-u', '-C'],
  sudo: ['-u', '-g', '--user', '--group'],
};
const SIN_OPCION = new Set(['command', 'exec', 'nohup', 'time', 'setsid', 'chronic', 'busybox']);
const OPCIONES_SSH = ['-p', '-i', '-l', '-o', '-F', '-J', '-L', '-R', '-D', '-b', '-c', '-e', '-m', '-S', '-W'];

function base(tok) {
  const parts = tok.split(/[\\/]/);
  let b = parts[parts.length - 1].toLowerCase().replace(/\.(?:cmd|exe|ps1|bat)$/, '');
  if (b === 'backlog.md') b = 'backlog';
  return b;
}

// Quita ")" y "}" pegados al final (sin regex: tiempo lineal).
function sinCierre(s) {
  let e = s.length;
  while (e > 0 && (s[e - 1] === ')' || s[e - 1] === '}')) e--;
  return e === s.length ? s : s.slice(0, e);
}

// Resuelve el programa real de un segmento. Devuelve null, { prog, args }
// o { texto } cuando hay que analizar una cadena (eval, env -S).
function resolver(words, quoted) {
  const n = words.length;
  let i = 0;
  for (let guard = 0; guard < 12; guard++) {
    let w = null;
    while (i < n) {
      const x = words[i];
      let k = 0;
      while (k < x.length && (x[k] === '(' || x[k] === '{' || x[k] === '!')) k++;
      const s = k ? x.slice(k) : x;
      if (s === '' || PALABRAS.has(s) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(s)) { i++; continue; }
      w = s;
      break;
    }
    if (w === null) return null;
    const prog = base(w);
    i++;
    const opciones = (conArg) => {
      while (i < n && words[i].length > 1 && words[i][0] === '-') {
        const o = words[i++];
        if (conArg.includes(o) && i < n) i++;
      }
    };
    if (prog === 'call' || prog === 'builtin') continue;
    if (SIN_OPCION.has(prog)) { opciones([]); continue; }
    if (OPCIONES[prog]) {
      opciones(OPCIONES[prog]);
      if (prog === 'timeout' && i < n && words[i][0] !== '-') i++; // DURACION
      continue;
    }
    if (prog === 'start') {
      while (i < n && FLAGS_START.test(words[i])) i++;
      if (i < n && quoted[i]) i++; // título entrecomillado
      while (i < n && FLAGS_START.test(words[i])) i++;
      continue;
    }
    if (prog === 'eval') return { texto: words.slice(i).join(' ') };
    if (prog === 'env') {
      while (i < n && words[i].length > 1 && words[i][0] === '-') {
        const o = words[i++];
        if (o === '-u' || o === '--unset' || o === '-C' || o === '--chdir') { if (i < n) i++; continue; }
        if (o === '-S' || o === '--split-string') return { texto: [words[i] ?? '', ...words.slice(i + 1)].join(' ') };
        if (o.startsWith('--split-string=')) return { texto: [o.slice(15), ...words.slice(i)].join(' ') };
        if (o[1] === 'S' && o[0] === '-') return { texto: [o.slice(2), ...words.slice(i)].join(' ') };
      }
      continue;
    }
    if (prog === 'parallel') { opciones(['-j', '-n', '-N', '-S', '-a', '--jobs']); continue; }
    if (prog === 'strace') { opciones(['-o', '-e', '-p', '-s', '-u']); continue; }
    if (prog === 'flock') { opciones(['-w', '-E']); if (i < n) i++; continue; }
    if (prog === 'wsl') { opciones(['-d', '-u', '--distribution', '--user', '--cd']); continue; }
    if (prog === 'ssh') { opciones(OPCIONES_SSH); if (i < n) i++; return { texto: words.slice(i).join(' ') }; }
    if (prog === 'su' || prog === 'script') {
      for (let j = i; j < n; j++) if (esFlagC(words[j]) || words[j] === '--command') return { texto: words[j + 1] ?? '' };
    }
    if (prog === 'yarn') { opciones([]); if (words[i] === 'run' || words[i] === 'exec') i++; continue; }
    if (prog === 'npx' || prog === 'bunx' || (prog === 'bun' && words[i] === 'x') || (prog === 'npm' && words[i] === 'exec')
      || (prog === 'pnpm' && (words[i] === 'dlx' || words[i] === 'exec'))) {
      if (prog !== 'npx' && prog !== 'bunx') i++;
      while (i < n && words[i][0] === '-') i++;
      continue;
    }
    return { prog, args: words.slice(i) };
  }
  return null;
}

function cierraTarjeta(args) {
  const low = args.map((a) => a.toLowerCase());
  if (!low.includes('task') || !(low.includes('edit') || low.includes('create'))) return false;
  const hecho = (v) => { const x = sinCierre(v.trim()).toLowerCase(); return x === 'hecho' || x === 'done'; };
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (a === '-s' || a === '--status') { if (k + 1 < args.length && hecho(args[k + 1])) return true; continue; }
    if (a.startsWith('--status=') && hecho(a.slice(9))) return true;
    if (a.startsWith('-s') && !a.startsWith('--') && a.length > 2 && hecho(a.slice(2).replace(/^=/, ''))) return true;
  }
  return false;
}

function codigosDe(args) {
  const out = [];
  for (let k = 0; k < args.length - 1; k++) if (FLAGS_CODIGO.has(args[k])) out.push(args[k + 1]);
  return out;
}

function evalSegmento(seg, depth) {
  const { words, quoted, redirs } = tokenize(seg);
  // Cierres de subshell/grupo pegados al final no ocultan el último argumento.
  while (words.length && sinCierre(words[words.length - 1]) === '') { words.pop(); quoted.pop(); }
  if (words.length) words[words.length - 1] = sinCierre(words[words.length - 1]);
  let hechoCache = null;
  const hecho = () => (hechoCache ??= HECHO.test(words.join(' ')));
  for (const r of redirs) {
    if (esFases(r)) return true;
    if (enTareas(r) && hecho()) return true;
  }
  const res = resolver(words, quoted);
  if (!res) return false;
  if (res.texto !== undefined) return checkTexto(res.texto, depth + 1);
  const { prog, args } = res;

  if (SHELLS.has(prog)) {
    const j = args.findIndex(esFlagC);
    if (j !== -1) return checkTexto(args.slice(j + 1).join(' '), depth + 1);
    const h = args.findIndex((a) => a.startsWith('<<<')); // here-string
    if (h === -1) return false;
    return checkTexto([args[h].slice(3), ...args.slice(h + 1)].join(' '), depth + 1);
  }
  if (prog === 'find') {
    const e = args.findIndex((a) => a === '-exec' || a === '-execdir' || a === '-ok' || a === '-okdir');
    if (e !== -1 && checkTexto(args.slice(e + 1).join(' '), depth + 1)) return true;
  }
  if (prog === 'backlog') return cierraTarjeta(args);

  if (prog === 'node' || prog === 'bun' || prog === 'deno') {
    const f = args.findIndex((a) => base(a) === 'fases.mjs' || a.toLowerCase().endsWith('fases.mjs'));
    if (f !== -1 && args.slice(f + 1).includes('approve')) return true;
    for (const code of codigosDe(args)) if (code.includes('approvePhase')) return true;
  }

  const noOpt = args.filter((a) => a[0] !== '-');
  switch (prog) {
    case 'tee': case 'rm': case 'del': case 'erase': case 'rmdir': case 'remove-item':
    case 'set-content': case 'out-file': case 'add-content': case 'new-item': case 'clear-content':
      if (args.some(esFases)) return true;
      break;
    case 'cp': case 'mv': case 'install': case 'ln': case 'copy': case 'move': case 'copy-item': case 'move-item':
      if (noOpt.length && esFases(noOpt[noOpt.length - 1])) return true;
      break;
    default: break;
  }
  if (prog === 'sed' || prog === 'perl' || prog === 'ruby') {
    if (args.some((a) => a === '--in-place' || /^-[a-zA-Z]*i/.test(a))) {
      if (args.some(esFases)) return true;
      if (args.some(enTareas) && hecho()) return true;
    }
  }
  if (['python', 'python3', 'py', 'perl', 'ruby', 'node', 'deno', 'bun'].includes(prog)) {
    for (const code of codigosDe(args)) {
      const c = norm(code);
      if (!ESCRIBE.test(c)) continue;
      if (c.includes('fases.json')) return true;
      if (c.includes('backlog/tasks') && HECHO.test(c)) return true;
    }
  }
  return false;
}

// Contador de profundidad compartido: shells -c, eval, env -S, sustituciones y
// heredocs de shell consumen el mismo presupuesto (MAX_DEPTH).
// Texto que un echo/printf entrega por la tubería a un shell sin -c.
function textoDeEcho(seg) {
  const { words, quoted } = tokenize(seg);
  const res = resolver(words, quoted);
  if (!res || (res.prog !== 'echo' && res.prog !== 'printf')) return null;
  let a = res.args;
  let k = 0;
  while (k < a.length && a[k].length > 1 && a[k][0] === '-') k++;
  a = a.slice(k);
  if (res.prog === 'printf' && a.length && a[0].includes('%')) a = a.slice(1);
  return a.join(' ').replace(/\\n/g, '\n');
}

function checkTexto(text, depth) {
  // Profundidad agotada: sin analizar más, deniega solo si el texto nombra lo vigilado.
  if (depth > MAX_DEPTH) return /backlog|fases\.mjs|approvePhase|fases\.json/i.test(text);
  const { sin, shell } = separarHeredocs(text);
  for (const cuerpo of shell) if (checkTexto(cuerpo, depth + 1)) return true;
  const { segs, pipes, inners } = escanear(sin);
  for (let k = 0; k < segs.length; k++) {
    if (evalSegmento(segs[k], depth)) return true;
    // Optimización: sin esas palabras en el segmento previo nada puede denegarse.
    if (pipes[k] && k > 0 && /backlog|fases|approvePhase/i.test(segs[k - 1])) {
      const t = tokenize(segs[k]);
      if (shellSinC(t.words, t.quoted)) {
        const previo = textoDeEcho(segs[k - 1]);
        if (previo !== null && checkTexto(previo, depth + 1)) return true;
      }
    }
  }
  for (const t of inners) if (checkTexto(t, depth + 1)) return true;
  return false;
}

export function checkCommand(command) {
  try {
    if (typeof command !== 'string') return null;
    return checkTexto(command.slice(0, MAX), 0) ? RAZON : null;
  } catch {
    return null;
  }
}

// Una línea que deja el estado en «Hecho»: `status: Hecho` (con comillas o comentario) o solo el valor, que es lo que
// escribe un Edit que cambia únicamente «En curso» por «Hecho». Un texto largo que menciona la palabra no cuenta.
const ESTADO_HECHO = /^[ \t]*(?:status[ \t]*:[ \t]*)?["']?(?:hecho|done)["']?[ \t]*(?:#.*)?$/im;
const RUTA_TARJETA = /(?:^|\/)backlog\/tasks\/[^/]+\.md$/;
const RUTA_FASES = /(?:^|\/)\.hq\/fases\.json$/;

// Ruta tal y como la resolvería el sistema de ficheros: barras dobles, `.` y `..` colapsados; en Windows se ignoran los
// puntos y espacios finales de cada componente y los flujos alternativos (`fichero:flujo`). Todo en minúsculas.
function rutaNormal(p) {
  const n = norm(p);
  const unidad = n.match(/^[a-z]:/)?.[0] ?? '';
  const partes = [];
  for (const s of n.slice(unidad.length).split('/')) {
    if (s === '' || s === '.') continue;
    if (s === '..') {
      partes.pop();
      continue;
    }
    const limpio = s.replace(/:.*$/, '').replace(/[. ]+$/, '');
    if (limpio) partes.push(limpio);
  }
  return `${unidad}${n.slice(unidad.length).startsWith('/') ? '/' : ''}${partes.join('/')}`;
}

export function checkToolCall(input) {
  try {
    const tool = input?.tool_name;
    const ti = input?.tool_input;
    if (tool === 'Bash' || tool === 'PowerShell') return checkCommand(ti?.command);
    if (tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit') {
      const p = typeof ti?.file_path === 'string' ? ti.file_path : '';
      const ruta = rutaNormal(p);
      if (RUTA_FASES.test(ruta)) return RAZON;
      // Las tarjetas de Backlog.md no pueden quedar en «Hecho» editando el fichero: eso es una aprobación del usuario.
      if (RUTA_TARJETA.test(ruta)) {
        const textos = [ti?.content, ti?.new_string, ...(Array.isArray(ti?.edits) ? ti.edits.map((e) => e?.new_string) : [])];
        if (textos.some((t) => typeof t === 'string' && ESTADO_HECHO.test(t))) return RAZON;
      }
      return null;
    }
  } catch { /* falla abierto */ }
  return null;
}

export function textoDeLaLlamada(input) {
  try {
    const tool = input?.tool_name;
    const ti = input?.tool_input;
    if ((tool === 'Bash' || tool === 'PowerShell') && typeof ti?.command === 'string') return ti.command;
    if ((tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit') && typeof ti?.file_path === 'string') return ti.file_path;
  } catch { /* nada */ }
  return '';
}

export function mencionaProyecto(texto, rutas) {
  try {
    if (typeof texto !== 'string' || !Array.isArray(rutas)) return false;
    const n = (s) => s.toLowerCase().replace(/\\/g, '/').replace(/\/+$/, '');
    const t = n(texto);
    for (const r of rutas) {
      if (typeof r !== 'string') continue;
      const p = n(r);
      if (!p) continue;
      let i = t.indexOf(p);
      while (i !== -1) {
        const next = t[i + p.length];
        if (next === undefined || !/[a-z0-9_.-]/.test(next)) return true;
        i = t.indexOf(p, i + 1);
      }
    }
  } catch { /* falla abierto */ }
  return false;
}
