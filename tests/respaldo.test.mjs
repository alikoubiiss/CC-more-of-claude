import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { copiarConHashes, hashArbol, verificarCopia } from '../lib/respaldo.mjs';
import { crearGuardia } from '../lib/vp-rutas.mjs';
import { tmpDir } from './helpers.mjs';

function arbol() {
  const root = tmpDir();
  const o = path.join(root, 'origen');
  mkdirSync(path.join(o, 'Sub carpeta', 'ñandú'), { recursive: true });
  writeFileSync(path.join(o, 'a.md'), 'hola');
  writeFileSync(path.join(o, 'vacio.md'), '');
  writeFileSync(path.join(o, 'Sub carpeta', 'ñandú', 'Índice básico.md'), 'contenido ñ');
  writeFileSync(path.join(o, 'img.bin'), Buffer.from([0, 1, 2, 255]));
  return { root, o, d: path.join(root, 'copia') };
}

test('copiarConHashes copia el árbol y devuelve un hash por fichero', () => {
  const { o, d } = arbol();
  const g = crearGuardia([d]);
  const r = copiarConHashes(o, d, g);
  assert.equal(r.ficheros.length, 4);
  const a = r.ficheros.find((f) => f.rel === 'a.md');
  assert.match(a.sha256, /^[0-9a-f]{64}$/);
  assert.equal(a.bytes, 4);
  assert.equal(readFileSync(path.join(d, 'Sub carpeta', 'ñandú', 'Índice básico.md'), 'utf8'), 'contenido ñ');
  assert.deepEqual(readFileSync(path.join(d, 'img.bin')), Buffer.from([0, 1, 2, 255]));
});

test('verificarCopia: ok, distintos y faltan', () => {
  const { o, d } = arbol();
  copiarConHashes(o, d, crearGuardia([d]));
  assert.deepEqual(verificarCopia(o, d), { ok: true, faltan: [], distintos: [] });
  writeFileSync(path.join(d, 'a.md'), 'holA');
  rmSync(path.join(d, 'vacio.md'));
  const v = verificarCopia(o, d);
  assert.equal(v.ok, false);
  assert.deepEqual(v.distintos, ['a.md']);
  assert.deepEqual(v.faltan, ['vacio.md']);
});

test('el destino debe estar dentro de la guardia y el origen no cambia', () => {
  const { root, o, d } = arbol();
  const antes = hashArbol(o);
  assert.throws(() => copiarConHashes(o, path.join(root, 'otra'), crearGuardia([d])), /ruta no permitida/);
  copiarConHashes(o, d, crearGuardia([d]));
  assert.deepEqual(hashArbol(o), antes);
  assert.equal(statSync(path.join(o, 'a.md')).size, 4);
});

test('origen inexistente da un error claro', () => {
  const { root } = arbol();
  assert.throws(() => copiarConHashes(path.join(root, 'no-existe'), path.join(root, 'd'), crearGuardia([path.join(root, 'd')])), /origen/);
});
