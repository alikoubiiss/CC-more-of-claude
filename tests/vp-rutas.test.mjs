import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { crearGuardia, dentro, nombreSeguro } from '../lib/vp-rutas.mjs';
import { tmpDir } from './helpers.mjs';

test('dentro: rutas con .., hermanas, prefijos parecidos y mayúsculas', () => {
  const base = path.join(tmpDir(), 'b');
  assert.equal(dentro(base, path.join(base, 'x', 'y.md')), true);
  assert.equal(dentro(base, path.join(base, '..', 'otro')), false);
  assert.equal(dentro(base, base + 'c'), false);
  assert.equal(dentro(base, base), false);
  assert.equal(dentro(base, base, { incluirBase: true }), true);
  assert.equal(dentro(base, path.join(base, 'a', '..', '..', 'zzz')), false);
  if (process.platform === 'win32') assert.equal(dentro(base, path.join(base.toUpperCase(), 'x')), true);
});

test('guardia: escribe dentro de las raíces y rechaza lo demás', () => {
  const root = tmpDir();
  const permitida = path.join(root, 'nuevo');
  const origen = path.join(root, 'viejo');
  mkdirSync(origen);
  const g = crearGuardia([permitida]);
  g.mkdir(path.join(permitida, 'a'));
  g.escribir(path.join(permitida, 'a', 'x.md'), 'hola');
  assert.equal(readFileSync(path.join(permitida, 'a', 'x.md'), 'utf8'), 'hola');
  assert.throws(() => g.escribir(path.join(origen, 'x.md'), 'no'), /ruta no permitida/);
  assert.throws(() => g.escribir(path.join(permitida, '..', 'viejo', 'x.md'), 'no'), /ruta no permitida/);
  assert.throws(() => g.mkdir(path.join(root, 'fuera')), /ruta no permitida/);
  assert.equal(existsSync(path.join(origen, 'x.md')), false);
  assert.equal(g.permitida(path.join(permitida, 'q')), true);
  assert.equal(g.permitida(path.join(root, 'q')), false);
});

test('guardia: copiar valida el destino', () => {
  const root = tmpDir();
  const o = path.join(root, 'o.md');
  writeFileSync(o, 'dato');
  const g = crearGuardia([path.join(root, 'd')]);
  mkdirSync(path.join(root, 'd'));
  g.copiar(o, path.join(root, 'd', 'o.md'));
  assert.equal(readFileSync(path.join(root, 'd', 'o.md'), 'utf8'), 'dato');
  assert.throws(() => g.copiar(o, path.join(root, 'o2.md')), /ruta no permitida/);
});

test('guardia: rechaza escribir a través de un enlace simbólico', (t) => {
  const root = tmpDir();
  const permitida = path.join(root, 'nuevo');
  const fuera = path.join(root, 'fuera');
  mkdirSync(permitida);
  mkdirSync(fuera);
  try {
    symlinkSync(fuera, path.join(permitida, 'enlace'), 'junction');
  } catch {
    return t.skip('no se pueden crear enlaces en este sistema');
  }
  const g = crearGuardia([permitida]);
  assert.throws(() => g.escribir(path.join(permitida, 'enlace', 'x.md'), 'no'), /ruta no permitida|enlace/);
  assert.equal(existsSync(path.join(fuera, 'x.md')), false);
});

test('nombreSeguro: caracteres, reservados, largo y vacío', () => {
  assert.equal(nombreSeguro('a: b?'), 'a- b');
  assert.equal(nombreSeguro('CON'), '_CON');
  assert.equal(nombreSeguro('com1.txt'), '_com1.txt');
  assert.equal(nombreSeguro('...'), 'sin-titulo');
  assert.equal(nombreSeguro('  '), 'sin-titulo');
  assert.equal(nombreSeguro('x'.repeat(300)).length, 120);
  assert.equal(nombreSeguro('Cómo funciona el "interés" <compuesto>'), 'Cómo funciona el interés -compuesto-');
  assert.equal(nombreSeguro('fin. '), 'fin');
  assert.doesNotMatch(nombreSeguro('a\x01b\\c/d'), /[\x00-\x1f\\/]/);
});

test('guardia: borrar solo dentro de las raíces', () => {
  const root = tmpDir();
  const permitida = path.join(root, 'nuevo');
  const g = crearGuardia([permitida]);
  g.escribir(path.join(permitida, 'x.md'), 'a');
  g.borrar(path.join(permitida, 'x.md'));
  assert.equal(existsSync(path.join(permitida, 'x.md')), false);
  writeFileSync(path.join(root, 'fuera.md'), 'b');
  assert.throws(() => g.borrar(path.join(root, 'fuera.md')), /ruta no permitida/);
  assert.equal(existsSync(path.join(root, 'fuera.md')), true);
});
