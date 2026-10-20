import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { runVaultDestilar } from '../scripts/vault-destilar.mjs';
import { runVaultAprobar } from '../scripts/vault-aprobar.mjs';
import { makeCfg, tmpDir } from './helpers.mjs';

function entorno() {
  const root = tmpDir();
  const cfg = { ...makeCfg(root), vaultPersonalDestino: path.join(root, 'Personal') };
  const f = path.join(cfg.vaultPersonalDestino, 'Fuentes', 'Chats', '2026', '2026-03-16 Uno.md');
  mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(f, '---\ntitulo: Uno\ntipo: chat-claude\ncategoria: Finanzas\n---\n\nhola\n');
  return cfg;
}

const run = async (prompt) => `---\ntipo: tema\ntitulo: Nota\nfuentes: [2026-03-16 Uno]\n---\nCuerpo.`;

test('destilar sin --si solo estima y no llama al modelo', async () => {
  const cfg = entorno();
  let llamadas = 0;
  const r = await runVaultDestilar({ argv: [], cfg, run: async () => { llamadas++; return ''; } });
  assert.equal(llamadas, 0);
  assert.match(r.lineas[0], /Estimación/);
  assert.match(r.lineas.join('\n'), /lote-finanzas-1/);
});

test('destilar --si escribe borradores y aprobar los aprueba o rechaza', async () => {
  const cfg = entorno();
  const r = await runVaultDestilar({ argv: ['--si', '--categoria', 'Finanzas'], cfg, run });
  assert.match(r.lineas[0], /1 notas borrador/);
  assert.ok(existsSync(path.join(cfg.vaultPersonalDestino, 'Wiki', 'Temas', 'Nota.md')));
  const a = runVaultAprobar({ argv: ['lote-finanzas-1'], cfg });
  assert.match(a.lineas[0], /1 notas aprobadas/);
  const n = runVaultAprobar({ argv: ['lote-finanzas-1', '--rechazar'], cfg });
  assert.match(n.lineas[0], /No había borradores/);
});

test('errores de uso son claros', async () => {
  const cfg = entorno();
  await assert.rejects(runVaultDestilar({ argv: ['--zzz'], cfg, run }), /argumento desconocido/);
  await assert.rejects(runVaultDestilar({ argv: ['--limite', 'x'], cfg, run }), /--limite/);
  assert.throws(() => runVaultAprobar({ argv: [], cfg }), /uso:/);
  assert.throws(() => runVaultAprobar({ argv: ['../x.md'], cfg }), /no permitida|no existe/);
});

test('los scripts salen con código 1 y un mensaje de una línea', () => {
  for (const s of ['vault-destilar.mjs', 'vault-aprobar.mjs']) {
    const r = spawnSync(process.execPath, [`scripts/${s}`, '--nope'], { cwd: path.resolve(import.meta.dirname, '..'), encoding: 'utf8' });
    assert.equal(r.status, 1, s);
    assert.equal(r.stderr.trim().split('\n').length, 1, s);
  }
});

test('vault-compartir: marca en lote y valida los argumentos', async () => {
  const { runVaultCompartir } = await import('../scripts/vault-compartir.mjs');
  const cfg = entorno();
  await runVaultDestilar({ argv: ['--si'], cfg, run });
  const r = runVaultCompartir({ argv: ['*', 'hq'], cfg });
  assert.match(r.lineas[0], /1 notas marcadas como compartir: hq/);
  assert.match(runVaultCompartir({ argv: ['*', 'hq'], cfg }).lineas[0], /No había/);
  assert.throws(() => runVaultCompartir({ argv: ['*'], cfg }), /uso:/);
  assert.throws(() => runVaultCompartir({ argv: ['*', 'todos'], cfg }), /hq|privado/);
});
