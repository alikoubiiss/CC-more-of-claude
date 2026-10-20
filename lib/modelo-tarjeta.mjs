// Modelo y esfuerzo de cada tarjeta: etiquetas `modelo:`, `esfuerzo:`, `riesgo:`, `est:` puestas por el arquitecto,
// rúbrica de respaldo si faltan, escalera de reintentos por cada comentario `Falta:` y modelo mínimo del revisor.
// Se prioriza el modelo más barato que alcance: haiku para lo mínimo, sonnet para lo corriente y opus solo para lo difícil.

export const MODELOS = ['haiku', 'sonnet', 'opus'];
export const ESFUERZOS = ['medium', 'high', 'xhigh'];
export const RIESGOS = ['bajo', 'medio', 'alto'];
export const EST_MAX = 90;
export const MAX_RECHAZOS_EN_TOPE = 2;

// Orden de potencia: haiku < sonnet/medium < sonnet/high < opus/medium < opus/high < opus/xhigh.
const NIVELES = ['haiku/medium', 'sonnet/medium', 'sonnet/high', 'opus/medium', 'opus/high', 'opus/xhigh'];
const ESCALERA = ['sonnet/high', 'opus/high', 'opus/xhigh'];
export const rango = (model, effort) => NIVELES.indexOf(`${model}/${effort}`);
const nivel = (s) => { const [model, effort] = s.split('/'); return { model, effort }; };

// Primera etiqueta `clave:valor` de cada clave del sistema (valor en minúsculas).
export function etiquetas(labels = []) {
  const out = { modelo: null, esfuerzo: null, riesgo: null, est: null, skill: null };
  for (const raw of labels) {
    const m = String(raw).trim().match(/^(modelo|esfuerzo|riesgo|est|skill):\s*(.*)$/i);
    if (!m) continue;
    const k = m[1].toLowerCase();
    if (out[k] === null) out[k] = k === 'skill' ? m[2].trim() : m[2].trim().toLowerCase();
  }
  return out;
}

// --- Rúbrica (+2 por señal) ---------------------------------------------------------------------------------------
const RE_SEGURIDAD = /\b(firma\w*|firmar|auth\w*|autentic\w*|autoriz\w*|secret\w*|token\w*|contraseñ\w*|password\w*|credencial\w*|cifr\w*|encript\w*|seguridad|permisos?|migraci\w*|migrar|borr(?:ar|a|an|ado|ados|ada|adas|e|en)|elimin(?:ar|a|an|ado|ados|ada|adas|e|en)|irreversibles?|purg\w*|drop|delete)\b/i;
const RE_CONCURRENCIA = /\b(concurren\w*|paralel\w*|hilos?|threads?|mutex\w*|locks?|condici\w* de carrera|race|at[oó]mic\w*|sem[aá]foros?|simult[aá]ne\w*)\b/i;
const RE_FICHERO = /[\w./\\-]+\.(?:m?js|cjs|tsx?|jsx|py|md|json|ya?ml|toml|css|scss|html|sql|sh|ps1|go|rs|java|kt|cs|rb|php|vue|svelte)\b/gi;
const RE_N_FICHEROS = /\b(\d+)\s+(?:ficheros|archivos|m[oó]dulos)\b/i;
const RE_VERIFICABLE = /`[^`]+`|\d|devuelve|imprime|muestra|pasa|falla|existe|contiene|incluye|aparece|responde|rechaza|acepta|crea|genera|guarda|escribe|sale|c[oó]digo|error|tests?\b|comando|=|→|->/i;
const RE_VAGO = /\b(adecuad\w*|correctamente|bien|mejor\w*|intuitiv\w*|bonit\w*|r[aá]pid\w*|robust\w*|limpi\w*|apropiad\w*|etc)\b/i;

export function criterioAmbiguo(texto) {
  const t = String(texto ?? '');
  if (/`[^`]+`|\d/.test(t)) return false;
  return !RE_VERIFICABLE.test(t) || RE_VAGO.test(t);
}

export function contarDependientes(task, allTasks = []) {
  const id = String(task.id ?? '').toLowerCase();
  if (!id) return 0;
  return allTasks.filter((t) => (t.dependencies ?? []).some((d) => String(d).toLowerCase() === id)).length;
}

export function rubrica(task, { dependientes = 0 } = {}) {
  const criterios = (task.criteria?.items ?? []).map((i) => i.text);
  const texto = [task.title, task.description, ...criterios].filter(Boolean).join('\n');
  const senales = [];
  if (RE_SEGURIDAD.test(texto)) senales.push('seguridad o datos');
  if (RE_CONCURRENCIA.test(texto)) senales.push('concurrencia');
  if (criterios.length > 3) senales.push('más de 3 criterios');
  const ficheros = new Set((texto.match(RE_FICHERO) ?? []).map((f) => f.toLowerCase()));
  const n = Number(texto.match(RE_N_FICHEROS)?.[1] ?? 0);
  if (Math.max(ficheros.size, n) > 5) senales.push('más de 5 ficheros');
  if (criterios.some(criterioAmbiguo)) senales.push('criterio ambiguo');
  if (dependientes >= 2) senales.push('2 o más tarjetas dependen de ella');
  const puntos = senales.length * 2;
  const alto = etiquetas(task.labels).riesgo === 'alto';
  // Mínima: sin señales, como mucho un fichero y dos criterios.
  const minima = puntos === 0 && ficheros.size <= 1 && criterios.length <= 2;
  const { model, effort } = alto ? nivel('opus/xhigh') : puntos >= 6 ? nivel('opus/high') : puntos >= 2 ? nivel('sonnet/high') : minima ? nivel('haiku/medium') : nivel('sonnet/high');
  return { puntos, senales, model, effort };
}

// --- Comentarios ----------------------------------------------------------------------------------------------------
export const esFalta = (c) => /^falta:/i.test(String(c?.text ?? '').trim());
export const contarFalta = (comments = []) => comments.filter(esFalta).length;

export function textoRegistro(model, effort, intento) {
  return `Modelo: ${model}/${effort} intento ${intento}`;
}

// Último `Modelo: <alias>/<esfuerzo>` que dejó ese agente (o cualquiera si no se indica) en la tarjeta.
export function modeloRegistrado(task, agente = null) {
  const autor = agente ? `@${String(agente).replace(/^.*:/, '').toLowerCase()}` : null;
  let out = null;
  for (const c of task?.comments ?? []) {
    if (autor && String(c.author).toLowerCase() !== autor) continue;
    const m = String(c.text).trim().match(/^Modelo:\s*(opus|sonnet)\/(medium|high|xhigh)\b/i);
    if (m) out = { model: m[1].toLowerCase(), effort: m[2].toLowerCase(), created: c.created };
  }
  return out;
}

// --- Decisión ---------------------------------------------------------------------------------------------------------
export function modeloTarjeta(task, { allTasks = [] } = {}) {
  const et = etiquetas(task.labels);
  const rub = rubrica(task, { dependientes: contarDependientes(task, allTasks) });
  let model = MODELOS.includes(et.modelo) ? et.modelo : null;
  let effort = ESFUERZOS.includes(et.esfuerzo) ? et.esfuerzo : null;
  let fuente = 'etiquetas';
  if (!model && !effort) {
    ({ model, effort } = rub);
    fuente = 'rubrica';
  } else if (!model || !effort) {
    model = model ?? rub.model;
    effort = effort ?? 'high';
    fuente = 'mixta';
  }
  const ajustes = [];
  if (model === 'haiku' && effort !== 'medium') {
    effort = 'medium';
    ajustes.push('haiku solo se usa con esfuerzo medium');
  }
  if (model === 'sonnet' && effort === 'xhigh') {
    model = 'opus';
    ajustes.push('sonnet/xhigh no existe en la tabla: se sube a opus/xhigh');
  }
  if (et.riesgo === 'alto' && rango(model, effort) < rango('opus', 'xhigh')) {
    ({ model, effort } = nivel('opus/xhigh'));
    ajustes.push('riesgo:alto exige opus/xhigh');
  }
  const base = { model, effort };

  // Escalera: nivel de la tarjeta y después los peldaños más altos que él.
  const escalera = [`${model}/${effort}`, ...ESCALERA.filter((l) => rango(...l.split('/')) > rango(model, effort))].map(nivel);
  const rechazos = contarFalta(task.comments);
  const tope = escalera.length - 1;
  const actual = escalera[Math.min(rechazos, tope)];
  const rechazosEnTope = Math.max(0, rechazos - tope);
  const parar = rechazosEnTope >= MAX_RECHAZOS_EN_TOPE;

  // Revisor: nunca más débil que la tarjeta ni que el ejecutor tras escalar.
  const opus = base.model === 'opus' || actual.model === 'opus' || et.riesgo === 'alto';
  const revisorModel = opus ? 'opus' : 'sonnet';
  const revisorEffort = !opus && base.effort === 'medium' && rechazos === 0 ? 'medium' : 'high';

  return {
    id: task.id,
    model: actual.model,
    effort: actual.effort,
    revisorModel,
    revisorEffort,
    intento: rechazos + 1,
    escalada: rechazos > 0 && (actual.model !== base.model || actual.effort !== base.effort),
    parar,
    rechazos,
    base,
    fuente,
    riesgo: et.riesgo,
    est: et.est,
    rubrica: { puntos: rub.puntos, senales: rub.senales, model: rub.model, effort: rub.effort },
    ajustes,
    ...(parar ? { mensaje: `${rechazos} rechazos y ${rechazosEnTope} en el tope (${actual.model}/${actual.effort}): no ejecutes; divide la tarjeta o pregunta al usuario` } : {}),
  };
}
