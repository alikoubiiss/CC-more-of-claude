import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../lib/config.mjs';
import { tmpDir, writeConfigFile } from './helpers.mjs';

test('loadConfig resuelve backups, logs y registry junto al fichero de config', () => {
  const root = tmpDir();
  const { file } = writeConfigFile(root);
  const cfg = loadConfig(file);
  assert.equal(cfg.backupsDir, path.join(root, 'backups'));
  assert.equal(cfg.logsDir, path.join(root, 'logs'));
  assert.equal(cfg.registryFile, path.join(root, 'registry.json'));
  assert.equal(cfg.basePort, 6430);
});

test('loadConfig falla con mensaje claro si falta una clave', () => {
  const root = tmpDir();
  const file = path.join(root, 'config.json');
  writeFileSync(file, JSON.stringify({ projectsRoot: 'x', vaultProjectsDir: 'P', nlmProfile: 'hq', basePort: 6430, backupsDir: 'b' }));
  assert.throws(() => loadConfig(file), /falta "vaultPath"/);
});

test('loadConfig rechaza puertos inválidos', () => {
  const root = tmpDir();
  const { file } = writeConfigFile(root);
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  raw.basePort = 80;
  writeFileSync(file, JSON.stringify(raw));
  assert.throws(() => loadConfig(file), /basePort/);
});

test('loadConfig falla si el fichero no existe', () => {
  assert.throws(() => loadConfig(path.join(tmpDir(), 'nope.json')), /no se pudo leer/);
});

test('dataDir absoluto fija registry, logs y backups (relativo) en esa carpeta', () => {
  const root = tmpDir();
  const { file } = writeConfigFile(root);
  const data = path.join(tmpDir(), 'datos');
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  raw.dataDir = data;
  writeFileSync(file, JSON.stringify(raw));
  const cfg = loadConfig(file);
  assert.equal(cfg.dataDir, data);
  assert.equal(cfg.registryFile, path.join(data, 'registry.json'));
  assert.equal(cfg.logsDir, path.join(data, 'logs'));
  assert.equal(cfg.backupsDir, path.join(data, 'backups'));
});

test('dataDir relativo lanza; sin dataDir cfg.dataDir es undefined', () => {
  const root = tmpDir();
  const { file } = writeConfigFile(root);
  assert.equal(loadConfig(file).dataDir, undefined);
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  raw.dataDir = 'relativo/datos';
  writeFileSync(file, JSON.stringify(raw));
  assert.throws(() => loadConfig(file), /"dataDir" debe ser una ruta absoluta/);
});

test('loadConfig expone eventsDir, stateDir y eventsRetentionDays', () => {
  const root = tmpDir();
  const { file } = writeConfigFile(root);
  const cfg = loadConfig(file);
  assert.equal(cfg.eventsDir, path.join(root, 'events'));
  assert.equal(cfg.stateDir, path.join(root, 'state'));
  assert.equal(cfg.eventsRetentionDays, 7);
});

test('con dataDir, eventsDir y stateDir cuelgan de dataDir y la retención es configurable', () => {
  const root = tmpDir();
  const data = tmpDir();
  const { file } = writeConfigFile(root);
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  raw.dataDir = data;
  raw.eventsRetentionDays = 3;
  writeFileSync(file, JSON.stringify(raw));
  const cfg = loadConfig(file);
  assert.equal(cfg.eventsDir, path.join(data, 'events'));
  assert.equal(cfg.stateDir, path.join(data, 'state'));
  assert.equal(cfg.eventsRetentionDays, 3);
});

test('eventsRetentionDays inválido lanza un error claro', () => {
  for (const bad of [0, 400, 1.5, 'x']) {
    const root = tmpDir();
    const { file } = writeConfigFile(root);
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    raw.eventsRetentionDays = bad;
    writeFileSync(file, JSON.stringify(raw));
    assert.throws(() => loadConfig(file), /eventsRetentionDays/, String(bad));
  }
});

test('loadConfig: claves del vault personal opcionales y validadas', async () => {
  const { writeFileSync } = await import('node:fs');
  const path = (await import('node:path')).default;
  const root = tmpDir();
  const base = JSON.parse(readFileSync(writeConfigFile(root).file, 'utf8'));
  const escribir = (extra) => {
    const f = path.join(root, 'c2.json');
    writeFileSync(f, JSON.stringify({ ...base, ...extra }));
    return f;
  };
  const sin = loadConfig(escribir({}));
  assert.equal(sin.conocimientoDir, 'Conocimiento');
  assert.equal(sin.conocimientoPath, path.join(base.vaultPath, 'Conocimiento'));
  const con = loadConfig(escribir({ vaultPersonalOrigen: path.join(root, 'a'), vaultPersonalDestino: path.join(root, 'b'), conocimientoDir: 'Saber' }));
  assert.equal(con.conocimientoDir, 'Saber');
  assert.throws(() => loadConfig(escribir({ vaultPersonalOrigen: 'relativa' })), /vaultPersonalOrigen/);
  assert.throws(() => loadConfig(escribir({ vaultPersonalDestino: 'relativa' })), /vaultPersonalDestino/);
  assert.throws(() => loadConfig(escribir({ conocimientoDir: '../x' })), /conocimientoDir/);
});

test('sin HQ_CONFIG usa ~/.project-hq/config.json si existe y si no, el config.json junto al código', async () => {
  const { defaultConfigFile, USER_CONFIG, HQ_ROOT } = await import('../lib/config.mjs');
  const antes = process.env.HQ_CONFIG;
  delete process.env.HQ_CONFIG;
  try {
    const esperado = existsSync(USER_CONFIG) ? USER_CONFIG : path.join(HQ_ROOT, 'config.json');
    assert.equal(defaultConfigFile(), esperado);
    process.env.HQ_CONFIG = 'X:\otra\config.json';
    assert.equal(defaultConfigFile(), 'X:\otra\config.json');
  } finally {
    if (antes === undefined) delete process.env.HQ_CONFIG; else process.env.HQ_CONFIG = antes;
  }
});
