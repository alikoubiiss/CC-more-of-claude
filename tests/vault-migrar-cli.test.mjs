import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { runVaultMigrar } from '../scripts/vault-migrar.mjs';
import { makeCfg, tmpDir, writeConfigFile } from './helpers.mjs';

function entorno() {
  const root = tmpDir();
  const cfg = { ...makeCfg(root), vaultPersonalOrigen: path.join(root, 'viejo'), vaultPersonalDestino: path.join(root, 'nuevo') };
  mkdirSync(path.join(cfg.vaultPersonalOrigen, '07 - Temas'), { recursive: true });
  writeFileSync(path.join(cfg.vaultPersonalOrigen, '07 - Temas', 'Uno.md'), '# Uno\n');
  return { root, cfg };
}

test('migrar real: código 0, destino creado e informe con las rutas', () => {
  const { cfg } = entorno();
  const r = runVaultMigrar({ argv: [], cfg, ahora: new Date(2026, 9, 9, 17, 0, 0) });
  assert.equal(r.codigo, 0);
  assert.match(r.lineas.join('\n'), /Migración verificada/);
  assert.ok(existsSync(path.join(cfg.vaultPersonalDestino, 'Wiki', 'Temas', 'Uno.md')));
});

test('--dry-run no escribe nada', () => {
  const { cfg } = entorno();
  const r = runVaultMigrar({ argv: ['--dry-run'], cfg });
  assert.equal(r.codigo, 0);
  assert.match(r.lineas[0], /Simulación/);
  assert.ok(!existsSync(cfg.vaultPersonalDestino));
});

test('errores de uso y de config son claros', () => {
  const { cfg } = entorno();
  assert.throws(() => runVaultMigrar({ argv: ['--borrar'], cfg }), /argumento desconocido/);
  assert.throws(() => runVaultMigrar({ argv: [], cfg: { ...cfg, vaultPersonalOrigen: undefined } }), /vaultPersonalOrigen/);
  runVaultMigrar({ argv: [], cfg });
  assert.throws(() => runVaultMigrar({ argv: [], cfg }), /ya existe/);
});

test('el script sale con código 1 y un mensaje de una línea si falla', () => {
  const { file } = writeConfigFile(tmpDir());
  const r = spawnSync(process.execPath, ['scripts/vault-migrar.mjs', '--nope'], { cwd: path.resolve(import.meta.dirname, '..'), encoding: 'utf8', env: { ...process.env, HQ_CONFIG: file } });
  assert.equal(r.status, 1);
  assert.equal(r.stderr.trim().split('\n').length, 1);
  assert.match(r.stderr, /argumento desconocido/);
});
