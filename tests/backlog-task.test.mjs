import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseTask, readTasks, readMilestones } from '../lib/backlog-task.mjs';
import { tmpDir } from './helpers.mjs';

const TASK3 = `---
id: TASK-3
title: Prototipo del flujo de moderación
status: Verificando
assignee: []
created_date: '2026-10-08 15:48'
updated_date: '2026-10-08 15:48'
labels:
  - 'modelo:sonnet'
  - 'skill:n8n'
  - revisada
milestone: m-0
dependencies:
  - TASK-2
ordinal: 3000
---

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Flujo importado
- [ ] #2 Prueba con 3 mensajes
<!-- AC:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @revisor
created: 2026-10-08 15:48
---
Revisión: PASA (2/2)
---
<!-- COMMENTS:END -->
`;

const TASK1 = `---
id: TASK-1
title: Conectar NotebookLM
status: En curso
assignee: []
created_date: '2026-10-08 15:20'
labels: []
dependencies: []
ordinal: 1000
---
`;

test('parseTask lee una tarjeta real con listas en bloque, criterios y comentarios', () => {
  const t = parseTask(TASK3);
  assert.equal(t.id, 'TASK-3');
  assert.equal(t.title, 'Prototipo del flujo de moderación');
  assert.equal(t.status, 'Verificando');
  assert.equal(t.milestone, 'm-0');
  assert.deepEqual(t.labels, ['modelo:sonnet', 'skill:n8n', 'revisada']);
  assert.deepEqual(t.dependencies, ['TASK-2']);
  assert.deepEqual(t.criteria, { done: 1, total: 2, items: [
    { n: 1, text: 'Flujo importado', done: true },
    { n: 2, text: 'Prueba con 3 mensajes', done: false },
  ] });
  assert.deepEqual(t.comments, [{ author: '@revisor', created: '2026-10-08 15:48', text: 'Revisión: PASA (2/2)' }]);
});

test('parseTask da el mismo resultado con CRLF y con BOM', () => {
  const base = parseTask(TASK3);
  assert.deepEqual(parseTask(TASK3.replace(/\n/g, '\r\n')), base);
  assert.deepEqual(parseTask('﻿' + TASK3), base);
});

test('parseTask con tarjeta mínima: listas vacías, sin hito, sin criterios ni comentarios', () => {
  const t = parseTask(TASK1);
  assert.deepEqual([t.id, t.status, t.milestone], ['TASK-1', 'En curso', '']);
  assert.deepEqual([t.labels, t.dependencies, t.comments], [[], [], []]);
  assert.deepEqual(t.criteria, { done: 0, total: 0, items: [] });
});

test('parseTask quita comillas simples (con \'\') y dobles', () => {
  const t = parseTask(`---\nid: TASK-9\ntitle: 'it''s fine'\nstatus: "Hecho"\n---\n`);
  assert.equal(t.title, "it's fine");
  assert.equal(t.status, 'Hecho');
});

test('readTasks ordena por número, omite entradas ilegibles y tolera carpeta ausente', () => {
  const repo = tmpDir();
  assert.deepEqual(readTasks(repo), []);
  const dir = path.join(repo, 'backlog', 'tasks');
  mkdirSync(path.join(dir, 'x.md'), { recursive: true }); // un directorio con nombre .md
  writeFileSync(path.join(dir, 'task-10 - Diez.md'), TASK1.replace('TASK-1', 'TASK-10'));
  writeFileSync(path.join(dir, 'task-2 - Dos.md'), TASK1.replace('TASK-1', 'TASK-2'));
  writeFileSync(path.join(dir, 'notas.txt'), 'no soy una tarjeta');
  const tasks = readTasks(repo);
  assert.deepEqual(tasks.map((t) => t.id), ['TASK-2', 'TASK-10']);
  assert.equal(tasks[0].file, 'task-2 - Dos.md');
});

test('readMilestones lee id y título, ordenados por id', () => {
  const repo = tmpDir();
  const dir = path.join(repo, 'backlog', 'milestones');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'm-1 - construcción.md'), '---\nid: m-1\ntitle: "Construcción"\n---\n\n## Description\n');
  writeFileSync(path.join(dir, 'm-0 - diseño.md'), '---\nid: m-0\ntitle: "Diseño"\n---\n\n## Description\n');
  assert.deepEqual(readMilestones(repo), [{ id: 'm-0', title: 'Diseño' }, { id: 'm-1', title: 'Construcción' }]);
  assert.deepEqual(readMilestones(tmpDir()), []);
});
