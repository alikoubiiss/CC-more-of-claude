import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { exportar } from '../lib/exportar-hq.mjs';
import { regenerarIndice, revisar } from '../lib/vp-indice.mjs';
import { crearGuardia } from '../lib/vp-rutas.mjs';
import { parseFrontmatter, serializarFrontmatter } from '../lib/vp-frontmatter.mjs';
import { tmpDir } from './helpers.mjs';

const AHORA = new Date(2026, 9, 9, 19, 0, 0);

function nuevo() {
  const root = tmpDir();
  return { root, d: path.join(root, 'Personal'), k: path.join(root, 'ProjectHQ', 'Conocimiento') };
}

function nota(d, rel, datos, cuerpo = 'Cuerpo útil.') {
  const f = path.join(d, ...rel.split('/'));
  mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(f, `${serializarFrontmatter(datos)}\n${cuerpo}\n`);
  return f;
}
const leer = (f) => readFileSync(f, 'utf8');
const fm = (f) => parseFrontmatter(leer(f)).datos;
const ok = { tipo: 'tema', estado: 'revisada', compartir: 'hq', etiquetas: ['a'], fuentes: ['[[2026-03-16 Chat]]'] };

test('exporta revisada+hq limpia: sin fuentes, enlaces a no exportadas quitados y las exportadas conservadas', () => {
  const { d, k } = nuevo();
  nota(d, 'Wiki/Temas/Interés.md', { ...ok, titulo: 'Interés' }, 'Ver [[2026-03-16 Chat]] y [[Otro tema|el otro]] y [[Privada]].');
  nota(d, 'Wiki/Temas/Otro tema.md', { ...ok, titulo: 'Otro tema' });
  nota(d, 'Wiki/Temas/Privada.md', { ...ok, titulo: 'Privada', compartir: 'privado' });
  const r = exportar({ destino: d, conocimiento: k, ahora: AHORA });
  assert.deepEqual(r.exportadas.sort(), ['Temas/Interés.md', 'Temas/Otro tema.md']);
  const f = path.join(k, 'Temas', 'Interés.md');
  const datos = fm(f);
  assert.deepEqual([datos.titulo, datos.tipo, datos.origen, datos.exportada], ['Interés', 'tema', 'wiki-personal', '2026-10-09']);
  assert.equal(datos.fuentes, undefined);
  assert.equal(datos.compartir, undefined);
  assert.match(leer(f), /Ver 2026-03-16 Chat y \[\[Otro tema\|el otro\]\] y Privada\./);
  const indice = leer(path.join(k, 'index.md'));
  assert.match(indice, /\[\[Interés\]\]/);
  assert.doesNotMatch(indice, /\[\[Privada\]\]/);
  assert.match(indice, /Ver 2026-03-16 Chat y el otro y Privada/);
});

test('no exporta borradores, privadas, con revisar-privacidad: true, ni nada fuera de Wiki', () => {
  const { d, k } = nuevo();
  nota(d, 'Wiki/Temas/Borrador.md', { ...ok, titulo: 'B', estado: 'borrador' });
  nota(d, 'Wiki/Temas/Pendiente.md', { ...ok, titulo: 'P', 'revisar-privacidad': true });
  nota(d, 'Fuentes/Recursos/Contexto.md', { ...ok, titulo: 'C' });
  nota(d, 'Fuentes/Chats/2026/Chat.md', { ...ok, titulo: 'Chat' });
  const r = exportar({ destino: d, conocimiento: k, ahora: AHORA });
  assert.deepEqual(r.exportadas, []);
  assert.ok(r.retenidas.some((x) => /Pendiente/.test(x.rel)));
  assert.ok(!existsSync(path.join(k, 'Temas')));
});

test('con datos personales: se retiene y se marca; tras limpiar o revisar se exporta', () => {
  const { d, k } = nuevo();
  const f = nota(d, 'Wiki/Temas/Contacto.md', { ...ok, titulo: 'Contacto' }, 'Escribe a usuario@correo.example.com');
  let r = exportar({ destino: d, conocimiento: k, ahora: AHORA });
  assert.deepEqual(r.exportadas, []);
  assert.match(r.retenidas[0].motivo, /correo/);
  assert.equal(fm(f)['revisar-privacidad'], true);
  r = exportar({ destino: d, conocimiento: k, ahora: AHORA });
  assert.deepEqual(r.exportadas, []);
  // el usuario quita la marca pero el correo sigue: se vuelve a retener
  nota(d, 'Wiki/Temas/Contacto.md', { ...ok, titulo: 'Contacto' }, 'Escribe a usuario@correo.example.com');
  assert.deepEqual(exportar({ destino: d, conocimiento: k, ahora: AHORA }).exportadas, []);
  // el usuario limpia el texto
  nota(d, 'Wiki/Temas/Contacto.md', { ...ok, titulo: 'Contacto' }, 'Escribe a quien corresponda');
  assert.deepEqual(exportar({ destino: d, conocimiento: k, ahora: AHORA }).exportadas, ['Temas/Contacto.md']);
});

test('revisar-privacidad: false significa «ya lo he revisado»: se exporta redactado', () => {
  const { d, k } = nuevo();
  nota(d, 'Wiki/Temas/Revisada.md', { ...ok, titulo: 'Revisada', 'revisar-privacidad': false }, 'Trabajo en Acme; correo usuario@correo.example.com');
  const r = exportar({ destino: d, conocimiento: k, terminos: ['Acme'], ahora: AHORA });
  assert.deepEqual(r.exportadas, ['Temas/Revisada.md']);
  const t = leer(path.join(k, 'Temas', 'Revisada.md'));
  assert.doesNotMatch(t, /Acme|usuario@correo/);
  assert.match(t, /\[redactado\]/);
});

test('los términos de la lista retienen la nota aunque no haya otros datos', () => {
  const { d, k } = nuevo();
  nota(d, 'Wiki/Temas/Empresa.md', { ...ok, titulo: 'Empresa' }, 'Trabajo en acme');
  const r = exportar({ destino: d, conocimiento: k, terminos: ['Acme'], ahora: AHORA });
  assert.deepEqual(r.exportadas, []);
  assert.match(r.retenidas[0].motivo, /termino/);
});

test('la carpeta de conocimiento no puede estar dentro del vault personal ni al revés', () => {
  const { d } = nuevo();
  nota(d, 'Wiki/Temas/X.md', { ...ok, titulo: 'X' });
  assert.throws(() => exportar({ destino: d, conocimiento: path.join(d, 'Conocimiento'), ahora: AHORA }), /dentro/);
  assert.throws(() => exportar({ destino: d, conocimiento: path.dirname(d), ahora: AHORA }), /dentro/);
});

test('si el destino ya tiene otra versión se guarda .bak; lo que ya no se comparte se lista como obsoleta', () => {
  const { d, k } = nuevo();
  const f = nota(d, 'Wiki/Temas/Uno.md', { ...ok, titulo: 'Uno' }, 'versión 1');
  exportar({ destino: d, conocimiento: k, ahora: AHORA });
  nota(d, 'Wiki/Temas/Uno.md', { ...ok, titulo: 'Uno' }, 'versión 2');
  exportar({ destino: d, conocimiento: k, ahora: AHORA });
  assert.match(leer(path.join(k, 'Temas', 'Uno.md')), /versión 2/);
  assert.match(leer(path.join(k, 'Temas', 'Uno.md.bak')), /versión 1/);
  nota(d, 'Wiki/Temas/Uno.md', { ...ok, titulo: 'Uno', compartir: 'privado' });
  const r = exportar({ destino: d, conocimiento: k, ahora: AHORA });
  assert.deepEqual(r.obsoletas, ['Temas/Uno.md']);
  assert.ok(existsSync(path.join(k, 'Temas', 'Uno.md')));
  assert.ok(f);
});

test('revisar: huérfanas, enlaces rotos y borradores antiguos', () => {
  const { d } = nuevo();
  nota(d, 'Wiki/Temas/Enlazada.md', { tipo: 'tema', estado: 'revisada', titulo: 'E' }, 'Ver [[Rota]] y [[2026-03-16 Chat]].');
  nota(d, 'Wiki/Temas/Huerfana.md', { tipo: 'tema', estado: 'revisada', titulo: 'H' });
  nota(d, 'Wiki/Temas/Vieja.md', { tipo: 'tema', estado: 'borrador', titulo: 'V', creada: '2026-09-01' });
  nota(d, 'Fuentes/Chats/2026/2026-03-16 Chat.md', { tipo: 'chat-claude', titulo: 'Chat' }, 'Habla de [[Enlazada]] y [[Vieja]].');
  const r = revisar({ destino: d, ahora: AHORA });
  assert.deepEqual(r.huerfanas, ['Wiki/Temas/Huerfana.md']);
  assert.deepEqual(r.rotos, [{ rel: 'Wiki/Temas/Enlazada.md', destino: 'Rota' }]);
  assert.deepEqual(r.borradoresAntiguos, ['Wiki/Temas/Vieja.md']);
});

test('regenerarIndice lista la Wiki por tipo con su estado', () => {
  const { d } = nuevo();
  nota(d, 'Wiki/Temas/Uno.md', { tipo: 'tema', estado: 'revisada', titulo: 'Uno' }, 'Primera línea útil del tema.');
  nota(d, 'Wiki/Decisiones/Dos.md', { tipo: 'decision', estado: 'borrador', titulo: 'Dos' });
  regenerarIndice(d, crearGuardia([path.join(d, 'index.md')]));
  const t = leer(path.join(d, 'index.md'));
  assert.match(t, /## Temas[\s\S]*\[\[Uno\]\] — Primera línea útil/);
  assert.match(t, /## Decisiones[\s\S]*\[\[Dos\]\].*borrador/);
});
