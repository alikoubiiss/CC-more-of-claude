import test from 'node:test';
import assert from 'node:assert/strict';
import { redactar } from '../lib/redactor.mjs';

const R = '[redactado]';
const tipos = (r) => Object.fromEntries(r.coincidencias.map((c) => [c.tipo, c.cantidad]));

test('correo: simple y con +', () => {
  const r = redactar('Escribe a ali.k+hq@correo.example.com o a otro@a.es.');
  assert.equal(r.texto, `Escribe a ${R} o a ${R}.`);
  assert.deepEqual(tipos(r), { correo: 2 });
});

test('IBAN español, con y sin espacios', () => {
  assert.equal(redactar('Cuenta ES91 2100 0418 4502 0005 1332 ok').texto, `Cuenta ${R} ok`);
  assert.equal(redactar('ES9121000418450200051332').texto, R);
});

test('tarjeta: solo con Luhn válido', () => {
  assert.equal(redactar('Tarjeta 4111 1111 1111 1111 caduca').texto, `Tarjeta ${R} caduca`);
  assert.equal(redactar('4111-1111-1111-1111').texto, R);
  const falsa = 'Número 1234 5678 9012 3456 de pedido';
  assert.equal(redactar(falsa).texto, falsa);
});

test('teléfono: español con y sin prefijo', () => {
  assert.equal(redactar('Llama al 612 345 678 ya').texto, `Llama al ${R} ya`);
  assert.equal(redactar('Llama al +34 612 345 678 ya').texto, `Llama al ${R} ya`);
  assert.equal(redactar('Tel: 612345678.').texto, `Tel: ${R}.`);
});

test('token: GitHub, OpenAI, AWS y JWT', () => {
  const gh = `ghp_${'a1B2'.repeat(9)}`;
  const sk = `sk-${'Z9y8'.repeat(6)}`;
  const aws = 'AKIAIOSFODNN7EXAMPLE';
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
  for (const t of [gh, sk, aws, jwt]) assert.equal(redactar(`clave ${t} fin`).texto, `clave ${R} fin`, t);
});

test('clave: conserva el nombre y redacta el valor', () => {
  const r = redactar('password: hunter2\nAPI_KEY=abc123xyz\ncontraseña = miSecreto');
  assert.equal(r.texto, `password: ${R}\nAPI_KEY=${R}\ncontraseña = ${R}`);
  assert.equal(tipos(r).clave, 3);
});

test('falsos positivos: fechas, versiones, números largos que no son tarjeta, hashes cortos, precios', () => {
  const t = 'Fecha 2026-03-16, versión 1.2.3.4, hash a1b2c3d4, precio 1.234,56 €, ref 1234 5678 9012 3456, ver 3.11.9';
  const r = redactar(t);
  assert.equal(r.texto, t);
  assert.deepEqual(r.coincidencias, []);
});

test('términos de la lista: sin distinguir mayúsculas y mínimo 3 caracteres', () => {
  const r = redactar('Trabajo en Farmhispania y en FARMHISPANIA SL; ok de Al.', { terminos: ['Farmhispania', 'Al'] });
  assert.equal(r.texto, `Trabajo en ${R} y en ${R} SL; ok de Al.`);
  assert.deepEqual(tipos(r), { termino: 2 });
});

test('un término con caracteres de regex se trata como literal', () => {
  const r = redactar('cuenta (a+b)* pública', { terminos: ['(a+b)*'] });
  assert.equal(r.texto, `cuenta ${R} pública`);
});

test('varios tipos a la vez se cuentan bien', () => {
  const r = redactar('a@b.es, 612 345 678, ES9121000418450200051332 y 4111 1111 1111 1111');
  assert.deepEqual(tipos(r), { correo: 1, iban: 1, tarjeta: 1, telefono: 1 });
});

test('teléfono dentro de un bloque de código con lenguaje no se toca', () => {
  const t = 'Texto 612 345 678\n```js\nconst n = "612 345 678";\n```\n';
  assert.equal(redactar(t).texto, `Texto ${R}\n\`\`\`js\nconst n = "612 345 678";\n\`\`\`\n`);
});

test('vacío y no-cadenas', () => {
  assert.deepEqual(redactar(''), { texto: '', coincidencias: [] });
  assert.deepEqual(redactar(undefined), { texto: '', coincidencias: [] });
});

test('rendimiento: 1 MB de correos y de dígitos en tiempo razonable (< 1,5 s con la suite en paralelo)', () => {
  for (const t of ['a@a.'.repeat(250_000), '1234567890'.repeat(100_000), `${'a'.repeat(1_000_000)}`, '1 '.repeat(500_000)]) {
    const t0 = performance.now();
    redactar(t);
    assert.ok(performance.now() - t0 < 1500, `tardó ${performance.now() - t0} ms`);
  }
});

test('identificadores con guiones (modelos, versiones) no se toman por teléfonos', () => {
  const t = 'modelo claude-sonnet-4-5-20250929 y build v2024-10-09-123456 y gpt-4-0613-1106';
  assert.equal(redactar(t).texto, t);
  assert.equal(redactar('Llama al 612-345-678 ya').texto, `Llama al ${R} ya`);
  assert.equal(redactar('tel:612345678').texto, `tel:${R}`);
});
