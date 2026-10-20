const clean = (s) => String(s).replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/ {2,}/g, ' ').trim();
const clip = (s, n) => (s.length > n ? s.slice(0, n) : s);

const ESC = String.fromCharCode(27);
const ANSI = { aviso: `${ESC}[33m`, pasado: `${ESC}[31m` };
const RESET = `${ESC}[0m`;

export function formatStatusline({ slug = null, card = null, model = null, cost = null, ctxPct = null, presupuesto = null } = {}) {
  const parts = [];
  const add = (v, n) => {
    const c = v ? clean(v) : '';
    if (c) parts.push(n ? clip(c, n) : c);
  };
  add(slug);
  add(card, 30);
  add(model);
  if (typeof cost === 'number' && Number.isFinite(cost)) parts.push(`$${cost.toFixed(2).replace('.', ',')}`);
  if (typeof ctxPct === 'number' && Number.isFinite(ctxPct)) parts.push(`ctx ${Math.round(ctxPct)}%`);
  // Avisos de presupuesto: el texto se limpia antes de añadir los colores propios.
  const aviso = (e, texto) => {
    if (!e || !ANSI[e.estado] || !Number.isFinite(e.pct)) return;
    parts.push(`${ANSI[e.estado]}⚠ ${clean(texto)} ${Math.round(e.pct)}%${RESET}`);
  };
  aviso(presupuesto?.dia, 'día');
  if (presupuesto?.tarjeta) aviso(presupuesto.tarjeta, String(presupuesto.tarjeta.id ?? ''));
  return parts.join(' · ');
}
