import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ymd } from './dates.mjs';
import { sid8 } from './session-state.mjs';

const SLUG_RE = /^[a-z0-9-]+$/;
const CARD_RE = /^[A-Za-z]+-\d+(\.\d+)?$/;
const MODEL_RE = /^[a-z0-9-]{1,20}$/;
const DIA_RE = /^\d{4}-\d{2}-\d{2}\.jsonl$/;
const DIA_MS = 86_400_000;
const redondea = (v) => Math.round(v * 1e6) / 1e6;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function metricsFile(cfg, slug, date) {
  if (!SLUG_RE.test(String(slug))) throw new Error(`metrics: slug inválido: ${slug}`);
  return path.join(cfg.metricsDir, slug, `${ymd(date)}.jsonl`);
}

export function appendMetric(cfg, slug, linea, now = new Date(), { maxBytes = 5 * 1024 * 1024 } = {}) {
  const file = metricsFile(cfg, slug, now);
  mkdirSync(path.dirname(file), { recursive: true });
  try {
    if (statSync(file).size >= maxBytes) return false;
  } catch {
    // el fichero del día aún no existe
  }
  appendFileSync(file, `${JSON.stringify(linea)}\n`, 'utf8');
  return true;
}

// Líneas válidas de uno o todos los proyectos entre dos fechas (inclusive); las corruptas se ignoran.
export function readMetrics(cfg, slug, { desde, hasta } = {}) {
  let slugs;
  try {
    slugs = slug ? [slug] : readdirSync(cfg.metricsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
  const a = desde ? ymd(desde) : '0000-00-00';
  const b = hasta ? ymd(hasta) : '9999-99-99';
  const out = [];
  for (const s of slugs) {
    if (!SLUG_RE.test(s)) continue;
    let files;
    try { files = readdirSync(path.join(cfg.metricsDir, s)); } catch { continue; }
    for (const f of files.sort()) {
      if (!DIA_RE.test(f)) continue;
      const dia = f.slice(0, 10);
      if (dia < a || dia > b) continue;
      let texto;
      try { texto = readFileSync(path.join(cfg.metricsDir, s, f), 'utf8'); } catch { continue; }
      for (const l of texto.split('\n')) {
        if (!l.trim()) continue;
        try {
          const o = JSON.parse(l);
          if (o && typeof o === 'object' && !Array.isArray(o)) out.push({ slug: s, ...o });
        } catch { /* línea corrupta */ }
      }
    }
  }
  return out;
}

// Decide si hay que escribir una foto y cuánto gasto hay desde la anterior de la misma sesión.
export function planSnapshot(rec, snap, now) {
  const cost = num(snap?.cost);
  if (cost === null) return { escribir: false, delta: 0 };
  let delta;
  if (!rec || num(rec.cost) === null) delta = cost <= 0.5 ? cost : 0; // sesión ya en marcha: no arrastra lo anterior
  else if (cost < rec.cost) delta = cost; // sesión reiniciada
  else delta = cost - rec.cost;
  const cambio = !rec || delta >= 0.01 || snap.model !== rec.model || snap.card !== rec.card
    || now.getTime() - new Date(rec.t).getTime() >= 5 * 60 * 1000;
  return { escribir: cambio, delta: redondea(delta) };
}

// Escribe la foto. Devuelve false si no se pudo (fichero del día lleno): quien llama NO debe avanzar su «última foto».
export function appendSnapshot(cfg, slug, snap, delta, now = new Date()) {
  const card = typeof snap.card === 'string' && CARD_RE.test(snap.card) ? snap.card : null;
  const model = typeof snap.model === 'string' && MODEL_RE.test(snap.model) ? snap.model : null;
  return appendMetric(cfg, slug, {
    t: now.toISOString(), sid: sid8(snap.sid), kind: 'snap', model, card, cost: num(snap.cost), delta: num(delta) ?? 0,
    tokens_in: num(snap.tokens_in), tokens_out: num(snap.tokens_out), ctx_pct: num(snap.ctx_pct),
  }, now);
}

// Totales por tarjeta: siempre derivados del historial. La caché `tarjetas.json` guarda el resultado por día junto al tamaño
// del fichero que lo originó, así que solo se recalculan los ficheros que han cambiado y una caché vieja, rota o con
// escrituras perdidas nunca da un número incorrecto.
const tarjetasFile = (cfg, slug) => path.join(cfg.metricsDir, slug, 'tarjetas.json');

function sumarFichero(file) {
  const cards = {};
  let texto = '';
  try { texto = readFileSync(file, 'utf8'); } catch { return cards; }
  for (const l of texto.split('\n')) {
    if (!l.trim()) continue;
    try {
      const o = JSON.parse(l);
      if (o?.kind === 'snap' && typeof o.card === 'string' && CARD_RE.test(o.card) && num(o.delta) !== null) cards[o.card] = (cards[o.card] ?? 0) + o.delta;
    } catch { /* línea corrupta */ }
  }
  return cards;
}

function guardarCache(cfg, slug, dias) {
  const f = tarjetasFile(cfg, slug);
  const tmp = `${f}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify({ v: 1, dias }), 'utf8');
    renameSync(tmp, f);
  } catch {
    try { rmSync(tmp, { force: true }); } catch { /* se omite */ }
  }
}

export function totalesTarjetas(cfg, slug) {
  if (!SLUG_RE.test(String(slug))) return {};
  const dir = path.join(cfg.metricsDir, slug);
  let ficheros;
  try { ficheros = readdirSync(dir).filter((f) => DIA_RE.test(f)).sort(); } catch { return {}; }
  let cache = {};
  try {
    const c = JSON.parse(readFileSync(tarjetasFile(cfg, slug), 'utf8'));
    if (c?.v === 1 && c.dias && typeof c.dias === 'object' && !Array.isArray(c.dias)) cache = c.dias;
  } catch { /* sin caché válida */ }
  const dias = {};
  const total = {};
  let cambio = false;
  for (const f of ficheros) {
    const dia = f.slice(0, 10);
    let size;
    try { size = statSync(path.join(dir, f)).size; } catch { continue; }
    let e = cache[dia];
    if (!e || e.size !== size || !e.cards || typeof e.cards !== 'object') {
      e = { size, cards: sumarFichero(path.join(dir, f)) };
      cambio = true;
    }
    dias[dia] = e;
    for (const [k, v] of Object.entries(e.cards)) if (CARD_RE.test(k) && num(v) !== null) total[k] = (total[k] ?? 0) + v;
  }
  if (cambio || Object.keys(cache).length !== ficheros.length) guardarCache(cfg, slug, dias);
  for (const k of Object.keys(total)) total[k] = redondea(total[k]);
  return total;
}

export function gastoDia(cfg, date) {
  return readMetrics(cfg, null, { desde: date, hasta: date })
    .filter((l) => l.kind === 'snap' && num(l.delta) !== null)
    .reduce((s, l) => s + l.delta, 0);
}

export function estadoPresupuesto(usado, limite) {
  if (!Number.isFinite(limite) || limite <= 0) return { pct: null, estado: 'sin' };
  const pct = Math.round((usado / limite) * 100);
  return { pct, estado: pct >= 100 ? 'pasado' : pct >= 80 ? 'aviso' : 'ok' };
}

export function pruneMetrics(cfg, now = new Date(), days = 400) {
  if (!existsSync(cfg.metricsDir)) return 0;
  const limite = ymd(new Date(now.getTime() - days * DIA_MS));
  let borrados = 0;
  for (const name of readdirSync(cfg.metricsDir)) {
    let files;
    try { files = readdirSync(path.join(cfg.metricsDir, name)); } catch { continue; }
    for (const f of files) {
      if (DIA_RE.test(f) && f.slice(0, 10) < limite) {
        rmSync(path.join(cfg.metricsDir, name, f), { force: true });
        borrados++;
      }
    }
  }
  return borrados;
}

// Estado del presupuesto para la statusline; null si no hay presupuesto configurado.
export function calcularPresupuesto(cfg, slug, card, now = new Date()) {
  const p = cfg.presupuesto;
  if (!p) return null;
  const dia = estadoPresupuesto(gastoDia(cfg, now), p.diaUsd);
  const tarjeta = card ? { id: card, ...estadoPresupuesto(totalesTarjetas(cfg, slug)[card] ?? 0, p.tarjetaUsd) } : null;
  return { fecha: ymd(now), dia, tarjeta };
}
