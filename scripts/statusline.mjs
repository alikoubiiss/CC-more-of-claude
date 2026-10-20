import { loadConfig } from '../lib/config.mjs';
import { ymd } from '../lib/dates.mjs';
import { readHookInput } from '../lib/hookio.mjs';
import { logError } from '../lib/log.mjs';
import { appendSnapshot, calcularPresupuesto, planSnapshot, pruneMetrics } from '../lib/metrics.mjs';
import { findByPath, loadRegistry } from '../lib/registry.mjs';
import { modelKey, pruneSessionStates, readSessionState, sid8, writeSessionState } from '../lib/session-state.mjs';
import { tarjetaActual } from '../lib/state.mjs';
import { formatStatusline } from '../lib/statusline.mjs';

let cfg = null;
let input = {};
let line = '';
try {
  input = await readHookInput();
  const model = input.model?.display_name ?? null;
  const cost = input.cost?.total_cost_usd ?? null;
  const ctx = input.context_window?.used_percentage ?? null;
  line = formatStatusline({ model, cost, ctxPct: ctx }); // respaldo si falla la config
  cfg = loadConfig();
  const cwd = input.workspace?.current_dir ?? input.cwd ?? '';
  const project = findByPath(loadRegistry(cfg.registryFile), cwd);
  const active = project ? tarjetaActual(project.path) : null;
  const tokensIn = input.context_window?.total_input_tokens ?? null;
  const tokensOut = input.context_window?.total_output_tokens ?? null;

  // Métricas de gasto: una foto solo cuando hay cambios; cualquier fallo se anota y la línea sale igual.
  const now = new Date();
  const prev = readSessionState(cfg, input.session_id);
  let rec = prev?.rec_t ? { t: prev.rec_t, cost: prev.rec_cost, model: prev.rec_model, card: prev.rec_card } : null;
  let presupuesto = prev?.presupuesto?.fecha === ymd(now) ? prev.presupuesto : null;
  try {
    const snap = { sid: sid8(input.session_id), model: modelKey(model), card: active ? active.id : null, cost: typeof cost === 'number' ? cost : null,
      tokens_in: tokensIn, tokens_out: tokensOut, ctx_pct: ctx };
    const plan = planSnapshot(rec, snap, now);
    if (plan.escribir) {
      const slugM = project?.slug ?? 'sin-proyecto';
      // La «última foto» solo avanza si quedó escrita: si no, ese gasto se recupera en la siguiente y nunca se cuenta dos veces.
      if (appendSnapshot(cfg, slugM, snap, plan.delta, now)) {
        rec = { t: now.toISOString(), cost: snap.cost, model: snap.model, card: snap.card };
        try {
          presupuesto = calcularPresupuesto(cfg, slugM, snap.card, now);
        } catch (e) {
          logError(cfg, `statusline-presupuesto: ${e.message}`);
        }
        if (Math.random() < 0.02) pruneMetrics(cfg, now);
      }
    }
  } catch (e) {
    logError(cfg, `statusline-metricas: ${e.message}`);
  }

  line = formatStatusline({ slug: project?.slug ?? null, card: active ? `${active.id} ${active.title}` : null, model, cost, ctxPct: ctx, presupuesto });
  writeSessionState(cfg, input.session_id, {
    t: now.toISOString(), sid: sid8(input.session_id), slug: project?.slug ?? null, model: modelKey(model), model_name: model,
    cost, ctx_pct: ctx, tokens_in: tokensIn, tokens_out: tokensOut,
    rec_t: rec?.t ?? null, rec_cost: rec?.cost ?? null, rec_model: rec?.model ?? null, rec_card: rec?.card ?? null, presupuesto,
  });
  if (Math.random() < 0.02) pruneSessionStates(cfg);
} catch (e) {
  logError(cfg, `statusline: ${e.message}`);
}
process.stdout.write(`${line}\n`);
process.exitCode = 0;
