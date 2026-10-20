// Lint de tarjetas recién planificadas: etiquetas de modelo/esfuerzo/estimación, descripción, número de criterios,
// riesgo alto con su tarjeta de verificación y coherencia con la rúbrica (solo aviso).
import {
  ESFUERZOS, EST_MAX, MODELOS, RIESGOS, contarDependientes, etiquetas, rango, rubrica,
} from './modelo-tarjeta.mjs';

const RE_VERIFICAR = /^\s*verificar\s+([a-z]+-\d+(?:\.\d+)?)\b/i;
export const verificaA = (t) => String(t.title ?? '').match(RE_VERIFICAR)?.[1]?.toLowerCase() ?? null;

export function lintTarjeta(task, allTasks = []) {
  const errores = [];
  const avisos = [];
  const et = etiquetas(task.labels);

  if (!et.modelo) errores.push('falta la etiqueta modelo:<haiku|sonnet|opus>');
  else if (!MODELOS.includes(et.modelo)) errores.push(`modelo:${et.modelo} no vale: usa haiku, sonnet u opus`);
  if (!et.esfuerzo) errores.push('falta la etiqueta esfuerzo:<medium|high|xhigh>');
  else if (!ESFUERZOS.includes(et.esfuerzo)) errores.push(`esfuerzo:${et.esfuerzo} no vale: usa medium, high o xhigh`);
  else if (et.modelo === 'haiku' && et.esfuerzo !== 'medium') errores.push('modelo:haiku solo con esfuerzo:medium');
  else if (et.modelo !== 'opus' && et.esfuerzo === 'xhigh') errores.push('esfuerzo:xhigh solo con modelo:opus');
  if (et.est === null) errores.push('falta la etiqueta est:<minutos>');
  else if (!/^\d+$/.test(et.est) || Number(et.est) <= 0) errores.push(`est:${et.est} no vale: minutos enteros mayores que 0`);
  else if (Number(et.est) > EST_MAX) errores.push(`est:${et.est} supera ${EST_MAX} min: divide la tarjeta`);
  if (et.riesgo !== null && !RIESGOS.includes(et.riesgo)) errores.push(`riesgo:${et.riesgo} no vale: usa bajo, medio o alto`);
  if (!String(task.description ?? '').trim()) errores.push('sin descripción');
  const n = task.criteria?.total ?? 0;
  if (n < 2 || n > 5) errores.push(`tiene ${n} criterios de aceptación: deben ser entre 2 y 5`);

  if (et.riesgo === 'alto') {
    if (et.modelo !== 'opus') errores.push(`riesgo:alto exige modelo:opus (tiene ${et.modelo ?? 'ninguno'})`);
    const id = String(task.id).toLowerCase();
    const verif = allTasks.find((t) => verificaA(t) === id);
    if (!verif) errores.push(`riesgo:alto sin tarjeta "Verificar ${task.id}"`);
    else if (!(verif.dependencies ?? []).some((d) => String(d).toLowerCase() === id)) errores.push(`"${verif.title}" (${verif.id}) debe depender de ${task.id}`);
  }

  // Coherencia con la rúbrica: solo aviso, y no en las tarjetas de verificación.
  if (!verificaA(task) && MODELOS.includes(et.modelo) && ESFUERZOS.includes(et.esfuerzo)) {
    const rub = rubrica(task, { dependientes: contarDependientes(task, allTasks) });
    const pedido = rub.model === 'haiku' || (rub.model === 'sonnet' && rub.effort === 'high' && et.modelo !== 'haiku') ? null : `${rub.model}/${rub.effort}`;
    if (pedido && rango(et.modelo, et.esfuerzo) < rango(rub.model, rub.effort)) {
      avisos.push(`la rúbrica pide ${pedido} (${rub.puntos} puntos: ${rub.senales.join(', ') || 'riesgo:alto'}) y la tarjeta dice ${et.modelo}/${et.esfuerzo}`);
    }
  }
  return { id: task.id, title: task.title, errores, avisos };
}

// Por defecto revisa las tarjetas en "Planificado"; con ids, solo esas; con todas, las que no están en "Hecho".
export function seleccionar(tasks, { ids = [], todas = false } = {}) {
  if (ids.length) {
    const q = new Set(ids.map((i) => String(i).toLowerCase()));
    return tasks.filter((t) => q.has(String(t.id).toLowerCase()));
  }
  return tasks.filter((t) => (todas ? String(t.status).toLowerCase() !== 'hecho' : String(t.status).toLowerCase() === 'planificado'));
}

export function lintTarjetas(tasks, opts = {}) {
  const resultados = seleccionar(tasks, opts).map((t) => lintTarjeta(t, tasks));
  const errores = resultados.reduce((s, r) => s + r.errores.length, 0);
  const avisos = resultados.reduce((s, r) => s + r.avisos.length, 0);
  return { revisadas: resultados.length, errores, avisos, resultados };
}

export function formatear(res, { alcance = 'Planificado' } = {}) {
  if (!res.revisadas) return `No hay tarjetas que revisar (${alcance}).`;
  const out = [];
  for (const r of res.resultados) {
    if (!r.errores.length && !r.avisos.length) continue;
    out.push(`${r.id} «${r.title}»`);
    for (const e of r.errores) out.push(`  ERROR ${e}`);
    for (const a of r.avisos) out.push(`  AVISO ${a}`);
  }
  const ok = res.resultados.filter((r) => !r.errores.length).length;
  out.push(`Resultado: ${res.errores} error(es) y ${res.avisos} aviso(s) en ${res.revisadas} tarjeta(s); ${ok} sin errores.${res.errores ? ' Corrige los errores antes de presentar el plan.' : ''}`);
  return out.join('\n');
}
