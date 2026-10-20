import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadRegistry, saveRegistry, allocatePort, upsertProject, findByPath } from '../lib/registry.mjs';
import { tmpDir } from './helpers.mjs';

test('loadRegistry devuelve vacío si no existe y guarda/lee ida y vuelta', () => {
  const file = path.join(tmpDir(), 'registry.json');
  assert.deepEqual(loadRegistry(file), { projects: [] });
  const reg = upsertProject({ projects: [] }, { slug: 'a', port: 6430, path: 'C:\\x\\a' });
  saveRegistry(file, reg);
  assert.equal(loadRegistry(file).projects[0].slug, 'a');
  assert.equal(existsSync(`${file}.tmp`), false);
});

test('registry dañado: lanza, conserva el original y deja copia .corrupt', () => {
  const root = tmpDir();
  const file = path.join(root, 'registry.json');
  writeFileSync(file, '{oops');
  assert.throws(() => loadRegistry(file), /dañado/);
  assert.equal(readFileSync(file, 'utf8'), '{oops');
  assert.ok(readdirSync(root).some((f) => f.startsWith('registry.json.corrupt-')));
});

test('allocatePort devuelve el primer puerto libre desde basePort', () => {
  const reg = { projects: [{ port: 6430 }, { port: 6431 }, { port: 6433 }] };
  assert.equal(allocatePort(reg, 6430), 6432);
  assert.equal(allocatePort({ projects: [] }, 6430), 6430);
});

test('upsertProject reemplaza por slug sin duplicar y conserva el puerto', () => {
  let reg = upsertProject({ projects: [] }, { slug: 'a', port: 6430, notebookId: 'pendiente' });
  reg = upsertProject(reg, { slug: 'a', notebookId: 'abc' });
  assert.equal(reg.projects.length, 1);
  assert.deepEqual([reg.projects[0].port, reg.projects[0].notebookId], [6430, 'abc']);
});

test('findByPath encuentra el proyecto desde subcarpetas, sin confundir prefijos', () => {
  const reg = { projects: [
    { slug: 'demo', path: 'C:\\proyectos personales\\demo' },
    { slug: 'demo-2', path: 'C:\\proyectos personales\\demo-2' },
  ] };
  assert.equal(findByPath(reg, 'C:\\proyectos personales\\demo').slug, 'demo');
  assert.equal(findByPath(reg, 'c:\\PROYECTOS PERSONALES\\demo\\src\\x').slug, 'demo');
  assert.equal(findByPath(reg, 'C:\\proyectos personales\\demo-2\\src').slug, 'demo-2');
  assert.equal(findByPath(reg, 'C:\\proyectos personales\\otro'), null);
  assert.equal(findByPath(reg, ''), null);
});

test('findByPath ignora entradas sin path válido sin lanzar', () => {
  const reg = { projects: [
    { slug: 'x' },
    { slug: 'demo', path: 'C:\\proyectos personales\\demo' },
  ] };
  assert.equal(findByPath(reg, 'C:\\proyectos personales\\demo\\src').slug, 'demo');
  assert.equal(findByPath(reg, 'C:\\proyectos personales\\otro'), null);
});

test('registry con forma incorrecta (JSON válido) cuenta como dañado y no se toca', () => {
  for (const content of ['{"foo":1}', 'null']) {
    const root = tmpDir();
    const file = path.join(root, 'registry.json');
    writeFileSync(file, content);
    assert.throws(() => loadRegistry(file), /dañado/);
    assert.equal(readFileSync(file, 'utf8'), content);
  }
});

test('error de lectura no es dañado: lanza error de lectura y no crea copia .corrupt', () => {
  const root = tmpDir();
  const dirAsFile = path.join(root, 'registry.json');
  mkdirSync(dirAsFile);
  assert.throws(() => loadRegistry(dirAsFile), /no se pudo leer/);
  assert.equal(readdirSync(root).some((f) => f.includes('.corrupt-')), false);
});

test('registry corrupto: no apila copias .corrupt si ya existe una idéntica', () => {
  const root = tmpDir();
  const file = path.join(root, 'registry.json');
  writeFileSync(file, '{oops');
  assert.throws(() => loadRegistry(file), /dañado/);
  assert.throws(() => loadRegistry(file), /dañado/);
  const copies = readdirSync(root).filter((f) => f.startsWith('registry.json.corrupt-'));
  assert.equal(copies.length, 1);
});

test('si no se puede guardar la copia, el error sigue diciendo dañado y añade el motivo de la copia', () => {
  const root = tmpDir();
  const file = path.join(root, 'registry.json');
  writeFileSync(file, '{oops');
  const realNow = Date.now;
  const fixed = 1234567890;
  mkdirSync(`${file}.corrupt-${fixed}`); // bloquea el destino de la copia
  Date.now = () => fixed;
  try {
    assert.throws(() => loadRegistry(file), (err) =>
      /dañado/.test(err.message) && /no se pudo guardar copia/.test(err.message));
  } finally {
    Date.now = realNow;
  }
});
