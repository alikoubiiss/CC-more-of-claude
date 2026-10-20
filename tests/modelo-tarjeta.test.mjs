import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTask } from '../lib/backlog-task.mjs';
import {
  criterioAmbiguo, contarFalta, etiquetas, modeloRegistrado, modeloTarjeta, rubrica, textoRegistro,
} from '../lib/modelo-tarjeta.mjs';

const crit = (...t) => ({ done: 0, total: t.length, items: t.map((text, i) => ({ n: i + 1, text, done: false })) });
const OK2 = crit('`npm test` pasa', 'el endpoint devuelve 200');
const falta = (n, author = '@revisor') => Array.from({ length: n }, (_, i) => ({ author, created: `2026-10-1${i} 10:00`, text: `Falta: fallo ${i + 1}` }));
const tarjeta = ({ labels = [], comments = [], criteria = OK2, title = 'Tarea', description = 'Hace algo concreto', id = 'TASK-1', dependencies = [] } = {}) =>
  ({ id, title, description, labels, comments, criteria, dependencies });
const par = (r) => `${r.model}/${r.effort}`;
const rev = (r) => `${r.revisorModel}/${r.revisorEffort}`;

test('etiquetas: lee clave:valor del sistema y respeta la primera aparición', () => {
  assert.deepEqual(etiquetas(['modelo:Opus', 'esfuerzo:high', 'riesgo:alto', 'est:45', 'skill:tdd', 'modelo:sonnet', 'backend']),
    { modelo: 'opus', esfuerzo: 'high', riesgo: 'alto', est: '45', skill: 'tdd' });
  assert.deepEqual(etiquetas([]), { modelo: null, esfuerzo: null, riesgo: null, est: null, skill: null });
});

test('tabla por etiqueta: ejecutor y revisor según modelo y esfuerzo', () => {
  const casos = [
    [['modelo:opus', 'esfuerzo:xhigh', 'riesgo:alto'], 'opus/xhigh', 'opus/high'],
    [['modelo:opus', 'esfuerzo:high', 'riesgo:medio'], 'opus/high', 'opus/high'],
    [['modelo:opus', 'esfuerzo:medium'], 'opus/medium', 'opus/high'],
    [['modelo:sonnet', 'esfuerzo:high'], 'sonnet/high', 'sonnet/high'],
    [['modelo:sonnet', 'esfuerzo:medium', 'riesgo:bajo'], 'sonnet/medium', 'sonnet/medium'],
  ];
  for (const [labels, ejecutor, revisor] of casos) {
    const r = modeloTarjeta(tarjeta({ labels }));
    assert.equal(par(r), ejecutor, labels.join(','));
    assert.equal(rev(r), revisor, labels.join(','));
    assert.deepEqual([r.intento, r.escalada, r.parar, r.fuente], [1, false, false, 'etiquetas']);
  }
});

test('el revisor nunca es más débil que la tarjeta ni que el ejecutor escalado', () => {
  const RANGO = { sonnet: 0, opus: 1 };
  for (const modelo of ['sonnet', 'opus']) {
    for (const esfuerzo of ['medium', 'high', 'xhigh']) {
      for (const riesgo of ['bajo', 'medio', 'alto']) {
        for (let n = 0; n <= 4; n++) {
          const r = modeloTarjeta(tarjeta({ labels: [`modelo:${modelo}`, `esfuerzo:${esfuerzo}`, `riesgo:${riesgo}`], comments: falta(n) }));
          assert.ok(RANGO[r.revisorModel] >= RANGO[modelo], `${modelo}/${esfuerzo}/${riesgo}/${n}`);
          assert.ok(RANGO[r.revisorModel] >= RANGO[r.model], `${modelo}/${esfuerzo}/${riesgo}/${n}`);
          if (riesgo === 'alto') assert.equal(rev(r), 'opus/high');
          assert.ok(['sonnet', 'opus'].includes(r.model) && ['sonnet', 'opus'].includes(r.revisorModel));
        }
      }
    }
  }
});

test('riesgo:alto con modelo inferior se sube a opus/xhigh', () => {
  const r = modeloTarjeta(tarjeta({ labels: ['modelo:sonnet', 'esfuerzo:medium', 'riesgo:alto'] }));
  assert.equal(par(r), 'opus/xhigh');
  assert.match(r.ajustes.join(' '), /riesgo:alto/);
});

test('escalera completa desde sonnet: sonnet/medium → sonnet/high → opus/high → opus/xhigh ×2 → parar', () => {
  const pasos = [0, 1, 2, 3, 4, 5].map((n) => modeloTarjeta(tarjeta({ labels: ['modelo:sonnet', 'esfuerzo:medium'], comments: falta(n) })));
  assert.deepEqual(pasos.map(par), ['sonnet/medium', 'sonnet/high', 'opus/high', 'opus/xhigh', 'opus/xhigh', 'opus/xhigh']);
  assert.deepEqual(pasos.map((r) => r.intento), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(pasos.map((r) => r.escalada), [false, true, true, true, true, true]);
  assert.deepEqual(pasos.map((r) => r.parar), [false, false, false, false, false, true]);
  assert.deepEqual(pasos.map(rev), ['sonnet/medium', 'sonnet/high', 'opus/high', 'opus/high', 'opus/high', 'opus/high']);
  assert.match(pasos[5].mensaje, /divide la tarjeta o pregunta al usuario/);
});

test('escalera desde el tope: opus/xhigh se para tras 2 rechazos', () => {
  const pasos = [0, 1, 2].map((n) => modeloTarjeta(tarjeta({ labels: ['modelo:opus', 'esfuerzo:xhigh', 'riesgo:alto'], comments: falta(n) })));
  assert.deepEqual(pasos.map(par), ['opus/xhigh', 'opus/xhigh', 'opus/xhigh']);
  assert.deepEqual(pasos.map((r) => r.parar), [false, false, true]);
  assert.deepEqual(pasos.map((r) => r.escalada), [false, false, false]);
});

test('escalera desde opus/high: un rechazo sube a xhigh y dos más paran', () => {
  const pasos = [0, 1, 2, 3].map((n) => modeloTarjeta(tarjeta({ labels: ['modelo:opus', 'esfuerzo:high'], comments: falta(n) })));
  assert.deepEqual(pasos.map(par), ['opus/high', 'opus/xhigh', 'opus/xhigh', 'opus/xhigh']);
  assert.deepEqual(pasos.map((r) => r.parar), [false, false, false, true]);
});

test('solo cuentan los comentarios que empiezan por Falta: (del revisor o del usuario)', () => {
  const comments = [
    { author: '@ejecutor', created: 'x', text: 'Modelo: sonnet/high intento 1' },
    { author: '@revisor', created: 'x', text: 'Revisión: PASA (2/2)' },
    { author: '@usuario', created: 'x', text: 'Falta: el botón no responde' },
    { author: '@revisor', created: 'x', text: 'falta: test de borde' },
    { author: '@revisor', created: 'x', text: 'Nota: Falta: no cuenta en medio' },
  ];
  assert.equal(contarFalta(comments), 2);
});

test('tarjeta sin etiquetas: se calcula con la rúbrica', () => {
  const simple = modeloTarjeta(tarjeta());
  assert.deepEqual([par(simple), simple.fuente, simple.rubrica.puntos], ['haiku/medium', 'rubrica', 0]);

  const seguridad = modeloTarjeta(tarjeta({ title: 'Rotar el token de la API', description: 'Guarda el secreto cifrado' }));
  assert.deepEqual([par(seguridad), seguridad.rubrica.puntos], ['sonnet/high', 2]);
  assert.deepEqual(seguridad.rubrica.senales, ['seguridad o datos']);

  const grande = modeloTarjeta(tarjeta({
    title: 'Migración de datos con hilos en paralelo',
    criteria: crit('`a` pasa', '`b` pasa', '`c` pasa', 'queda bien'),
  }));
  assert.equal(par(grande), 'opus/high');
  assert.ok(grande.rubrica.puntos >= 6);
});

test('rúbrica: ficheros, dependientes y criterios ambiguos', () => {
  const files = 'Toca a.mjs, b.mjs, c.mjs, d.py, e.md y f.json';
  assert.deepEqual(rubrica(tarjeta({ description: files })).senales, ['más de 5 ficheros']);
  assert.deepEqual(rubrica(tarjeta({ description: 'Afecta a 7 ficheros' })).senales, ['más de 5 ficheros']);
  assert.deepEqual(rubrica(tarjeta(), { dependientes: 2 }).senales, ['2 o más tarjetas dependen de ella']);
  const r = modeloTarjeta(tarjeta({ id: 'TASK-1' }), { allTasks: [{ dependencies: ['task-1'] }, { dependencies: ['TASK-1', 'TASK-9'] }] });
  assert.deepEqual(r.rubrica.senales, ['2 o más tarjetas dependen de ella']);
  assert.equal(criterioAmbiguo('La interfaz queda bonita'), true);
  assert.equal(criterioAmbiguo('`npm test` pasa'), false);
  assert.equal(criterioAmbiguo('Devuelve 404 si no existe'), false);
  assert.equal(criterioAmbiguo('Funciona adecuadamente'), true);
});

test('riesgo:alto sin modelo cae en opus/xhigh por rúbrica; etiquetas parciales se completan', () => {
  assert.equal(par(modeloTarjeta(tarjeta({ labels: ['riesgo:alto'] }))), 'opus/xhigh');
  const solo = modeloTarjeta(tarjeta({ labels: ['modelo:opus'] }));
  assert.deepEqual([par(solo), solo.fuente], ['opus/high', 'mixta']);
  assert.equal(par(modeloTarjeta(tarjeta({ labels: ['modelo:sonnet', 'esfuerzo:xhigh'] }))), 'opus/xhigh');
});

test('modelo:haiku es un modelo válido y siempre va con esfuerzo medium', () => {
  const r = modeloTarjeta(tarjeta({ labels: ['modelo:haiku'] }));
  assert.deepEqual([r.model, r.effort, r.revisorModel, r.revisorEffort], ['haiku', 'medium', 'sonnet', 'medium']);
  assert.match(r.ajustes.join(' '), /haiku/);
  const claro = modeloTarjeta(tarjeta({ labels: ['modelo:haiku', 'esfuerzo:medium'] }));
  assert.deepEqual([claro.model, claro.revisorModel, claro.revisorEffort], ['haiku', 'sonnet', 'medium']);
  const sube = modeloTarjeta(tarjeta({ labels: ['modelo:haiku', 'esfuerzo:medium'], comments: falta(1) }));
  assert.equal(par(sube), 'sonnet/high');
  const raro = modeloTarjeta(tarjeta({ labels: ['modelo:gpt', 'esfuerzo:medium'] }));
  assert.equal(raro.model, 'haiku'); // valor no reconocido: modelo por rúbrica (tarjeta mínima)
});

test('textoRegistro y modeloRegistrado: rastro Modelo: en la tarjeta', () => {
  assert.equal(textoRegistro('opus', 'high', 2), 'Modelo: opus/high intento 2');
  const t = tarjeta({ comments: [
    { author: '@ejecutor', created: '1', text: 'Modelo: sonnet/high intento 1' },
    { author: '@revisor', created: '2', text: 'Modelo: opus/high intento 1' },
    { author: '@ejecutor', created: '3', text: 'Modelo: opus/xhigh intento 2' },
  ] });
  assert.deepEqual(modeloRegistrado(t, 'project-hq:ejecutor'), { model: 'opus', effort: 'xhigh', created: '3' });
  assert.deepEqual(modeloRegistrado(t, 'revisor'), { model: 'opus', effort: 'high', created: '2' });
  assert.equal(modeloRegistrado(tarjeta(), 'ejecutor'), null);
});

test('integración con parseTask: descripción, etiquetas y comentarios del formato real', () => {
  const md = `---
id: TASK-7
title: Webhook de alertas
status: En curso
labels:
  - 'modelo:sonnet'
  - 'esfuerzo:high'
  - 'est:40'
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Envía alertas
a Telegram
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 \`npm test\` pasa
- [ ] #2 Devuelve 200
<!-- AC:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @revisor
created: 2026-10-10 10:00
---
Falta: no reintenta
---

author: @usuario
created: 2026-10-10 11:00
---
Falta: sin test de error
---
<!-- COMMENTS:END -->
`;
  const t = parseTask(md);
  assert.equal(t.description, 'Envía alertas\na Telegram');
  const r = modeloTarjeta(t);
  assert.deepEqual([par(r), r.intento, r.rechazos], ['opus/xhigh', 3, 2]);
});
