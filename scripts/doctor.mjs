import http from 'node:http';
import { loadConfig } from '../lib/config.mjs';
import { runChecks } from '../lib/checks.mjs';
import { realRunner } from '../lib/tools.mjs';

function pingObsidian(key) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: 27124, path: '/', timeout: 1500,
      headers: { Authorization: `Bearer ${key}` } }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try { resolve({ ok: JSON.parse(body).authenticated === true, detail: `HTTP ${res.statusCode}` }); }
        catch { resolve({ ok: false, detail: `respuesta no válida (HTTP ${res.statusCode})` }); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, detail: 'sin respuesta (¿Obsidian abierto con el vault ProjectHQ?)' }); });
    req.on('error', (e) => resolve({ ok: false, detail: e.message }));
  });
}

try {
  const cfg = loadConfig();
  const run = (cmd, args, opts = {}) => realRunner(cmd, args, { ...opts, timeout: 15000 });
  const results = runChecks(cfg, run);
  const key = process.env.HQ_OBSIDIAN_KEY;
  if (key) {
    const p = await pingObsidian(key);
    results.push({ name: 'Obsidian REST API (opcional)', ok: p.ok, detail: p.detail });
  } else {
    results.push({ name: 'Obsidian REST API (opcional)', ok: true, detail: 'HQ_OBSIDIAN_KEY no definida; se omite' });
  }
  for (const r of results) console.log(`${r.ok ? '✓' : r.opcional ? '!' : '✗'} ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
  const avisos = results.filter((r) => !r.ok && r.opcional).length;
  if (avisos) console.log(`
${avisos} aviso(s) con !: piezas opcionales que no se usarán hasta instalarlas (ver README).`);
  process.exit(results.every((r) => r.ok || r.opcional) ? 0 : 1);
} catch (e) {
  console.error(`Error: ${e.message}`);
  process.exit(1);
}
