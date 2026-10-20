import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const canon = (p) => {
  let r;
  try { r = realpathSync(p); } catch { r = path.resolve(p); }
  return process.platform === 'win32' ? r.toLowerCase() : r;
};

export function isMain(importMetaUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;
  return canon(argv1) === canon(fileURLToPath(importMetaUrl));
}
