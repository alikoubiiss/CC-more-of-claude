import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isMain } from '../lib/cli.mjs';
import { tmpDir, writeConfigFile } from './helpers.mjs';

const here = fileURLToPath(import.meta.url);

test('isMain: misma ruta es true', () => {
  assert.equal(isMain(pathToFileURL(here).href, here), true);
});
test('isMain: variante en mayúsculas es true en win32', { skip: process.platform !== 'win32' }, () => {
  assert.equal(isMain(pathToFileURL(here).href, here.toUpperCase()), true);
});
test('isMain: otro archivo es false', () => {
  assert.equal(isMain(pathToFileURL(here).href, path.join(path.dirname(here), 'helpers.mjs')), false);
});
test('isMain: argv1 vacío es false', () => {
  assert.equal(isMain(pathToFileURL(here).href, ''), false);
});

test('CLI con ruta en otra capitalización se ejecuta y reporta el error', { skip: process.platform !== 'win32' }, () => {
  const { file, cfg } = writeConfigFile(tmpDir());
  const script = path.resolve(path.dirname(here), '..', 'scripts', 'new-project.mjs');
  const r = spawnSync(process.execPath, [path.join(path.dirname(script).toUpperCase(), path.basename(script)), 'CON'], { env: { ...process.env, HQ_CONFIG: file }, encoding: 'utf8' });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /Error:/);
  assert.match(r.stderr, /reservado/);
  assert.equal(existsSync(cfg.projectsRoot), false);
});
