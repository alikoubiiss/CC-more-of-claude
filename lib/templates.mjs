import { readFileSync } from 'node:fs';
import path from 'node:path';
import { HQ_ROOT } from './config.mjs';

export function render(tpl, vars) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    if (!(k in vars)) throw new Error(`plantilla: falta la variable "${k}"`);
    return String(vars[k]);
  });
}

export function loadTemplate(name, dir = path.join(HQ_ROOT, 'templates')) {
  return readFileSync(path.join(dir, name), 'utf8');
}
