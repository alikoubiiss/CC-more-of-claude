import { loadConfig } from '../lib/config.mjs';
import { checkToolCall, mencionaProyecto, textoDeLaLlamada } from '../lib/gate.mjs';
import { readHookInput } from '../lib/hookio.mjs';
import { logError } from '../lib/log.mjs';
import { findByPath, loadRegistry } from '../lib/registry.mjs';

let cfg = null;
try {
  const input = await readHookInput();
  const razon = checkToolCall(input);
  if (razon) {
    cfg = loadConfig();
    const reg = loadRegistry(cfg.registryFile);
    if (findByPath(reg, input.cwd ?? '') || mencionaProyecto(textoDeLaLlamada(input), reg.projects.map((p) => p.path))) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: razon },
      }));
    }
  }
} catch (e) {
  logError(cfg, `gate: ${e.message}`);
}
process.exitCode = 0;
