import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontmatter, serializarFrontmatter } from '../lib/vp-frontmatter.mjs';
import { limpiarChat, normalizarParaComparar, RUIDO } from '../lib/chat-limpiar.mjs';

const RUIDO_TXT = '```\nThis block is not supported on your current device yet.\n```\n';
const CHAT = `---
titulo: "Cómo funciona el interés compuesto"
tipo: chat-claude
fecha: 2026-03-16
categoria: Finanzas
mensajes: 14
tags: [personal, finanzas]
uuid: d8c78c94-ddf0-4157-8a31-4b88ad155bac
---

# Cómo funciona el interés compuesto

### Tú

Muéstrame cómo funciona

### Claude

Voy a crear una visualización.
${RUIDO_TXT}
Ahora la explicación.
${RUIDO_TXT}
Final.
${RUIDO_TXT}`;

test('parseFrontmatter: claves, comillas, números, listas en línea y en bloque', () => {
  const r = parseFrontmatter('---\na: 1\nb: "x: y"\nc: [p, q]\nd:\n  - u\n  - v\ne: texto libre\n---\ncuerpo\n');
  assert.equal(r.valido, true);
  assert.deepEqual(r.datos, { a: 1, b: 'x: y', c: ['p', 'q'], d: ['u', 'v'], e: 'texto libre' });
  assert.equal(r.cuerpo, 'cuerpo\n');
});

test('parseFrontmatter: BOM, CRLF, ausente y roto', () => {
  const r = parseFrontmatter('﻿---\r\na: 1\r\n---\r\nhola');
  assert.equal(r.datos.a, 1);
  assert.equal(r.cuerpo, 'hola');
  assert.deepEqual(parseFrontmatter('sin frontmatter'), { datos: {}, cuerpo: 'sin frontmatter', valido: true });
  const roto = parseFrontmatter('---\na: 1\nsin cierre');
  assert.equal(roto.valido, false);
  assert.equal(roto.cuerpo, '---\na: 1\nsin cierre');
  assert.equal(parseFrontmatter('---\nlinea ilegible\n---\nx').valido, false);
});

test('serializarFrontmatter: ida y vuelta con valores especiales', () => {
  const datos = { titulo: 'Qué: es #esto', n: 14, lista: ['a b', 'c:d'], vacio: '', f: '2026-03-16' };
  const t = serializarFrontmatter(datos);
  assert.match(t, /^---\n/);
  assert.deepEqual(parseFrontmatter(`${t}cuerpo`).datos, datos);
});

test('limpiarChat quita solo el bloque exacto de ruido y cuenta cuántos', () => {
  const r = limpiarChat(CHAT, { nombreFichero: '2026-03-16 Cómo funciona el interés compuesto.md' });
  assert.equal(r.quitados, 3);
  assert.doesNotMatch(r.texto, /not supported/);
  assert.match(r.texto, /Ahora la explicación\./);
  assert.match(r.texto, /Final\./);
});

test('limpiarChat no toca un bloque de código del usuario parecido pero distinto', () => {
  const propio = '```\nThis block is not supported by my compiler\n```\n';
  const r = limpiarChat(`---\ntipo: chat-claude\n---\n${propio}`, { nombreFichero: '2026-01-01 x.md' });
  assert.equal(r.quitados, 0);
  assert.match(r.texto, /not supported by my compiler/);
});

test('limpiarChat conserva el texto de la conversación y los campos clave', () => {
  const r = limpiarChat(CHAT, { nombreFichero: '2026-03-16 Cómo funciona el interés compuesto.md' });
  const { datos, cuerpo } = parseFrontmatter(r.texto);
  assert.equal(datos.tipo, 'chat-claude');
  assert.equal(datos.categoria, 'Finanzas');
  assert.equal(datos.fecha, '2026-03-16');
  assert.equal(datos.mensajes, 14);
  assert.equal(datos.uuid, 'd8c78c94-ddf0-4157-8a31-4b88ad155bac');
  assert.equal(datos.titulo, 'Cómo funciona el interés compuesto');
  assert.equal(datos.compartir, 'privado');
  assert.ok(datos.etiquetas.includes('claude-chat') && datos.etiquetas.includes('finanzas'));
  const original = parseFrontmatter(CHAT).cuerpo;
  assert.equal(normalizarParaComparar(cuerpo), normalizarParaComparar(original));
});

test('limpiarChat: fecha desde el nombre cuando falta, y categoría sin acentos en la etiqueta', () => {
  const r = limpiarChat('---\ntitulo: T\ncategoria: Imágenes y prompts\n---\ncuerpo', { nombreFichero: '2025-09-07 T.md' });
  const { datos } = parseFrontmatter(r.texto);
  assert.equal(datos.fecha, '2025-09-07');
  assert.ok(datos.etiquetas.includes('imagenes-y-prompts'));
});

test('limpiarChat: frontmatter roto avisa, reconstruye y no pierde el cuerpo', () => {
  const r = limpiarChat('---\nlinea ilegible\n---\n# Mi título\n\ntexto importante', { nombreFichero: '2026-02-02 Mi título.md' });
  assert.ok(r.avisos.length >= 1);
  const { datos, cuerpo } = parseFrontmatter(r.texto);
  assert.equal(datos.fecha, '2026-02-02');
  assert.equal(datos.titulo, 'Mi título');
  assert.match(cuerpo, /texto importante/);
});

test('limpiarChat: BOM + CRLF y título con dos puntos', () => {
  const t = '﻿---\r\ntitulo: "Plan: fase 1"\r\ntipo: chat-claude\r\n---\r\nhola\r\n\r\n\r\n\r\nfin';
  const r = limpiarChat(t, { nombreFichero: '2026-01-01 Plan.md' });
  assert.doesNotMatch(r.texto, /\r/);
  assert.equal(parseFrontmatter(r.texto).datos.titulo, 'Plan: fase 1');
  assert.doesNotMatch(r.texto, /\n{3,}/);
});

test('limpiarChat: un chat de 140 KB en menos de 200 ms', () => {
  const grande = `---\ntipo: chat-claude\n---\n${('linea de conversación\n' + RUIDO_TXT).repeat(3000)}`;
  const t0 = performance.now();
  limpiarChat(grande, { nombreFichero: '2026-01-01 g.md' });
  assert.ok(performance.now() - t0 < 200);
});

test('RUIDO es global y normalizarParaComparar es idempotente', () => {
  assert.ok(RUIDO.global);
  const n = normalizarParaComparar(`a\r\n\r\n\r\n\r\nb${RUIDO_TXT}`);
  assert.equal(normalizarParaComparar(n), n);
});
