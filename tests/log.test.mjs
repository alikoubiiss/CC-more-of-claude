import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { logError, fallbackLogsDir } from '../lib/log.mjs';
import { tmpDir } from './helpers.mjs';

function withConfig(raw, fn) {
  const root = tmpDir();
  const file = path.join(root, 'config.json');
  writeFileSync(file, typeof raw === 'string' ? raw : JSON.stringify(raw));
  const prev = process.env.HQ_CONFIG;
  process.env.HQ_CONFIG = file;
  try { return fn(root); } finally {
    if (prev === undefined) delete process.env.HQ_CONFIG; else process.env.HQ_CONFIG = prev;
  }
}

test('sin cfg, el log cae en <dataDir>/logs si la config tiene dataDir', () => {
  const data = tmpDir();
  withConfig({ dataDir: data }, () => {
    assert.equal(fallbackLogsDir(), path.join(data, 'logs'));
    logError(null, 'prueba');
    assert.ok(existsSync(path.join(data, 'logs', 'hooks.log')));
  });
});

test('sin cfg ni dataDir, el log cae junto a HQ_CONFIG; config ilegible no lanza', () => {
  withConfig({ vaultPath: 'x' }, (root) => assert.equal(fallbackLogsDir(), path.join(root, 'logs')));
  withConfig('{no json', (root) => {
    assert.equal(fallbackLogsDir(), path.join(root, 'logs'));
    assert.doesNotThrow(() => logError(null, 'x'));
  });
});
