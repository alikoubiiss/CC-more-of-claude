import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { leerTerminos, runVaultExportar } from '../scripts/vault-exportar-hq.mjs';
import { runVaultRevisar } from '../scripts/vault-revisar.mjs';
import { makeCfg, tmpDir } from './helpers.mjs';

function entorno() {
  const root = tmpDir();
  const cfg = { ...makeCfg(root), vaultPersonalDestino: path.join(root, 'Personal'), conocimientoPath: path.join(root, 'ProjectHQ', 'Conocimiento') };
  const w = (rel, txt) => {
    const f = path.join(cfg.vaultPersonalDestino, ...rel.split('/'));
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, txt);
  };
  w('Wiki/Temas/Bueno.md', '---\ntipo: tema\ntitulo: Bueno\nestado: revisada\ncompartir: hq\n---\nTexto limpio.\n');
  w('Wiki/Temas/Contacto.md', '---\ntipo: tema\ntitulo: Contacto\nestado: revisada\ncompartir: hq\n---\nEscribe a ali@correo.example.com\n');
  return { root, cfg };
}

test('exportar informa de exportadas y retenidas, y de cómo desbloquear', () => {
  const { cfg } = entorno();
  const r = runVaultExportar({ argv: [], cfg, terminos: [] });
  const t = r.lineas.join('\n');
  assert.match(t, /1 notas exportadas/);
  assert.match(t, /Contacto\.md: datos personales: correo×1/);
  assert.match(t, /revisar-privacidad: false/);
  assert.ok(existsSync(path.join(cfg.conocimientoPath, 'Temas', 'Bueno.md')));
});

test('leerTerminos: ausente da lista vacía, válido se lee y roto da error claro', () => {
  const d = tmpDir();
  assert.deepEqual(leerTerminos(d), []);
  writeFileSync(path.join(d, 'vault-redactor.json'), '{"terminos":["Farmhispania"]}');
  assert.deepEqual(leerTerminos(d), ['Farmhispania']);
  writeFileSync(path.join(d, 'vault-redactor.json'), '{roto');
  assert.throws(() => leerTerminos(d), /vault-redactor\.json/);
});

test('revisar resume y dice si todo está en orden', () => {
  const { cfg } = entorno();
  assert.match(runVaultRevisar({ cfg }).lineas.join('\n'), /huérfanas/);
  const vacio = { ...cfg, vaultPersonalDestino: path.join(tmpDir(), 'Personal') };
  mkdirSync(vacio.vaultPersonalDestino, { recursive: true });
  assert.match(runVaultRevisar({ cfg: vacio }).lineas[0], /en orden/);
});

test('errores de uso y salida con código 1 y una línea', () => {
  const { cfg } = entorno();
  assert.throws(() => runVaultExportar({ argv: ['--x'], cfg }), /argumento desconocido/);
  assert.throws(() => runVaultRevisar({ argv: ['--x'], cfg }), /argumento desconocido/);
  for (const s of ['vault-exportar-hq.mjs', 'vault-revisar.mjs']) {
    const r = spawnSync(process.execPath, [`scripts/${s}`, '--nope'], { cwd: path.resolve(import.meta.dirname, '..'), encoding: 'utf8' });
    assert.equal(r.status, 1, s);
    assert.equal(r.stderr.trim().split('\n').length, 1, s);
  }
});
