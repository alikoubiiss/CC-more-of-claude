import test from 'node:test';
import assert from 'node:assert/strict';
import { extraerEnlaces, reescribirBase, reescribirEnlaces } from '../lib/enlaces.mjs';

const mapa = { a: 'A nuevo', 'chat uno': '2026-03-16 chat uno', 'nota b': 'Nota B' };
const resolver = (d) => mapa[d.split('/').pop().toLowerCase()] ?? null;

test('extraerEnlaces: destino, ancla, alias y embed', () => {
  const r = extraerEnlaces('x [[a]] y [[a|alias]] z [[a#sec]] w [[a#sec|alias]] ![[img.png]] [[carpeta/a.md]]');
  assert.deepEqual(r.map((e) => [e.destino, e.ancla, e.alias, e.embed]), [
    ['a', '', '', false], ['a', '', 'alias', false], ['a', '#sec', '', false], ['a', '#sec', 'alias', false],
    ['img.png', '', '', true], ['carpeta/a.md', '', '', false],
  ]);
});

test('reescribirEnlaces: las cinco formas y rutas con carpeta o .md', () => {
  const r = reescribirEnlaces('[[a]] [[a|x]] [[a#s]] [[a#s|x]] [[06 - Chats/Finanzas/Chat Uno.md]]', resolver);
  assert.equal(r.texto, '[[A nuevo]] [[A nuevo|x]] [[A nuevo#s]] [[A nuevo#s|x]] [[2026-03-16 chat uno]]');
  assert.deepEqual(r.rotos, []);
});

test('reescribirEnlaces: embeds y ficheros que no son notas quedan intactos y no son rotos', () => {
  const r = reescribirEnlaces('![[foto.png]] [[doc.pdf]] [[a]]', resolver);
  assert.equal(r.texto, '![[foto.png]] [[doc.pdf]] [[A nuevo]]');
  assert.deepEqual(r.rotos, []);
});

test('reescribirEnlaces: no toca bloques de código ni código en línea', () => {
  const t = 'antes [[a]]\n```\n[[a]]\n```\nuna `[[a]]` aquí y [[a]]\n~~~\n[[a]]\n~~~\n';
  const r = reescribirEnlaces(t, resolver);
  assert.equal(r.texto, 'antes [[A nuevo]]\n```\n[[a]]\n```\nuna `[[a]]` aquí y [[A nuevo]]\n~~~\n[[a]]\n~~~\n');
});

test('reescribirEnlaces: desconocido queda igual y se lista como roto (único y ordenado)', () => {
  const r = reescribirEnlaces('[[zeta]] [[beta|x]] [[zeta]] [[a]]', resolver);
  assert.equal(r.texto, '[[zeta]] [[beta|x]] [[zeta]] [[A nuevo]]');
  assert.deepEqual(r.rotos, ['beta', 'zeta']);
});

test('reescribirEnlaces: varios por línea y texto sin enlaces idéntico', () => {
  assert.equal(reescribirEnlaces('[[a]], [[Nota B]] y [[a]].', resolver).texto, '[[A nuevo]], [[Nota B]] y [[A nuevo]].');
  const plano = 'nada que ver [ ] [[ ]] ]] [[';
  assert.equal(reescribirEnlaces(plano, resolver).texto, plano);
});

test('reescribirBase: solo cambia el argumento de inFolder', () => {
  const base = `filters:\n  and:\n    - 'tipo == "proyecto"'\n    - '!file.inFolder("Plantillas")'\n    - 'file.inFolder("06 - Chats de Claude")'\nformulas:\n  portada: 'if(categoria == "Finanzas", "#2e9e6b", "#6c7a89")'\n`;
  const r = reescribirBase(base, { '06 - Chats de Claude': 'Fuentes/Chats', Plantillas: 'Plantillas' });
  assert.equal(r, base.replace('06 - Chats de Claude', 'Fuentes/Chats'));
  assert.equal(reescribirBase(base, {}), base);
});

test('reescribirBase: una Base sin inFolder queda byte a byte igual', () => {
  const base = "filters:\n  and:\n    - 'tipo == \"chat-claude\"'\nviews:\n  - type: cards\n    name: Recientes\n";
  assert.equal(reescribirBase(base, { X: 'Y' }), base);
});

test('desenlazar: quita los enlaces que no se conservan, deja el texto y respeta el código', async () => {
  const { desenlazar } = await import('../lib/enlaces.mjs');
  const t = '[[a]] [[b|texto]] ![[img.png]] [[c#sec]] `[[b]]`\n```\n[[b]]\n```\n';
  assert.equal(desenlazar(t, (d) => d === 'a'), '[[a]] texto  c `[[b]]`\n```\n[[b]]\n```\n');
});
