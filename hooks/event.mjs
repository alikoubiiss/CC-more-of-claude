import { loadConfig } from '../lib/config.mjs';
import { readTasks } from '../lib/backlog-task.mjs';
import { appendEvent, maybePrune, modeloPedido, summarize } from '../lib/events.mjs';
import { readHookInput } from '../lib/hookio.mjs';
import { logError } from '../lib/log.mjs';
import { appendMetric } from '../lib/metrics.mjs';
import { findByPath, loadRegistry } from '../lib/registry.mjs';
import { readSessionState } from '../lib/session-state.mjs';

let cfg = null;
try {
  const input = await readHookInput();
  cfg = loadConfig();
  const project = findByPath(loadRegistry(cfg.registryFile), input.cwd ?? '');
  if (project) {
    const now = new Date();
    const mainModel = readSessionState(cfg, input.session_id)?.model ?? null;
    // SubagentStart/SubagentStop no traen el modelo. Al terminar se usa el `Modelo:` que dejó ese agente en la tarjeta
    // activa (lo escribe al empezar). Al empezar NO: ese comentario aún sería el del intento anterior; el modelo pedido
    // de verdad queda en el evento PreToolUse de Agent (`req_model`), y aquí se usa el mapa como respaldo.
    let requestedModel = null;
    if (input.hook_event_name === 'SubagentStop' && typeof input.agent_type === 'string') {
      try {
        requestedModel = modeloPedido(readTasks(project.path), input.agent_type)?.model ?? null;
      } catch (e) {
        logError(cfg, `event-modelo: ${e.message}`);
      }
    }
    const evt = summarize(input, { now, mainModel, vaultPath: cfg.vaultPath, conocimientoPath: cfg.conocimientoPath, requestedModel });
    if (evt) {
      appendEvent(cfg, project.slug, { ...evt, slug: project.slug }, now);
      maybePrune(cfg, now);
      // Uso de la memoria: también a las métricas (los eventos solo duran 7 días). Un fallo aquí no afecta al evento.
      if (evt.mem) {
        try {
          appendMetric(cfg, project.slug, { t: evt.t, sid: evt.sid, kind: 'mem', mem: evt.mem }, now);
        } catch (e) {
          logError(cfg, `event-metricas: ${e.message}`);
        }
      }
    }
  }
} catch (e) {
  logError(cfg, `event: ${e.message}`);
}
process.exitCode = 0;
