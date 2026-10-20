import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildConfig, parseArgs, setup } from '../scripts/setup.mjs';
import { loadConfig } from '../lib/config.mjs';
import { tmpDir } from './helpers.mjs';

test('setup crea una config válida con rutas bajo el home y no pisa una existente', () => {
  const home = tmpDir();
  const file = path.join(home, '.project-hq', 'config.json');
  const r = setup({}, file, home);
  assert.equal(r.created, true);
  const cfg = loadConfig(file);
  assert.equal(cfg.vaultPath, path.join(home, 'ProjectHQ-vault'));
  assert.equal(cfg.registryFile, path.join(home, '.project-hq', 'registry.json'));
  assert.ok(existsSync(cfg.projectsRoot));
  writeFileSync(file, '{"marca":1}');
  assert.equal(setup({}, file, home).created, false);
  assert.equal(readFileSync(file, 'utf8'), '{"marca":1}');
});

test('buildConfig respeta las opciones y parseArgs rechaza argumentos sueltos', () => {
  const c = buildConfig({ vault: 'D:\\v', puerto: '6500', 'perfil-nlm': 'mio' }, 'C:\\Users\\x');
  assert.equal(c.vaultPath, 'D:\\v');
  assert.equal(c.basePort, 6500);
  assert.equal(c.nlmProfile, 'mio');
  assert.deepEqual(parseArgs(['--vault', 'D:\\v']), { vault: 'D:\\v' });
  assert.throws(() => parseArgs(['--vault']), /argumento no válido/);
});
