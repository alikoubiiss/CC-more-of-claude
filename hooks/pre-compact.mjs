import { loadConfig } from '../lib/config.mjs';
import { readHookInput } from '../lib/hookio.mjs';
import { logError } from '../lib/log.mjs';
import { loadRegistry } from '../lib/registry.mjs';
import { snapshotSession } from '../lib/snapshot.mjs';
import { realRunner } from '../lib/tools.mjs';

let cfg = null;
try {
  const input = await readHookInput();
  cfg = loadConfig();
  snapshotSession({ cfg, reg: loadRegistry(cfg.registryFile), input, run: realRunner, event: 'PreCompact', force: true });
} catch (e) {
  logError(cfg, `pre-compact: ${e.message}`);
}
process.exitCode = 0;
