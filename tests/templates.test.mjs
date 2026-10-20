import test from 'node:test';
import assert from 'node:assert/strict';
import { render, loadTemplate } from '../lib/templates.mjs';

test('render sustituye variables y lanza si falta alguna', () => {
  assert.equal(render('Hola {{a}} y {{b}}', { a: 1, b: 'x' }), 'Hola 1 y x');
  assert.throws(() => render('{{a}} {{falta}}', { a: 1 }), /falta la variable "falta"/);
});

test('la plantilla CLAUDE.md del proyecto tiene como máximo 25 líneas', () => {
  const lines = loadTemplate('CLAUDE.md').split('\n').filter((l, i, arr) => !(i === arr.length - 1 && l === ''));
  assert.ok(lines.length <= 25, `tiene ${lines.length} líneas`);
});

const VARS = {
  sesion: { slug: 'demo', date: '2026-10-17', time: '10:00', sessionId: 's1', activeTask: 'TASK-1 X', changes: 'a.mjs', summary: 'Hecho.' },
  decision: { slug: 'demo', date: '2026-10-17', title: 'Usar SQLite', context: 'c', decision: 'd', why: 'w' },
  'nota-proyecto': { slug: 'demo', display: 'Demo', repoPath: 'C:\repo', port: 6430, notebookId: 'nb', date: '2026-10-17' },
};
const hechas = (n) => render(loadTemplate(`${n}.md`), VARS[n]);
const frontmatter = (t) => t.match(/^---\n([\s\S]*?)\n---\n/)[1];
const primerH = (t) => t.replace(/^---\n[\s\S]*?\n---\n/, '').match(/^#{1,6} .+$/m)[0];

for (const n of Object.keys(VARS)) {
  test(`render de ${n}.md con solo sus variables permitidas no lanza error`, () => {
    const out = hechas(n);
    assert.doesNotMatch(out, /\{\{/);
    assert.match(frontmatter(out), new RegExp(`^proyecto: demo$`, 'm'));
  });
}

for (const n of ['sesion', 'decision']) {
  test(`${n}.md: cssclasses, indice, H1 primero y enlace de vuelta al Índice`, () => {
    const out = hechas(n);
    const fm = frontmatter(out);
    assert.ok(fm.split('\n').includes(`cssclasses: [hq-${n}]`));
    assert.match(fm, /^indice: "\[\[Proyectos\/demo\/Índice\|demo\]\]"$/m);
    assert.match(primerH(out), /^# /);
    const cuerpo = out.replace(/^---\n[\s\S]*?\n---\n/, '');
    assert.match(cuerpo, /^Volver a \[\[Proyectos\/demo\/Índice\|demo\]\]$/m);
  });
}

test('sesion.md conserva el literal "Tarjeta activa: "', () => {
  assert.match(hechas('sesion'), /Tarjeta activa: TASK-1 X/);
});

test('nota-proyecto.md: 2 bloques base con file.inFolder, callout y Conocimiento relacionado', () => {
  const out = hechas('nota-proyecto');
  const fm = frontmatter(out);
  assert.match(fm, /^cssclasses: \[hq-proyecto\]$/m);
  assert.match(fm, /^estado: idea$/m);
  assert.match(fm, /^proyecto: demo$/m);
  const bases = [...out.matchAll(/```base\n([\s\S]*?)```/g)].map((m) => m[1]);
  assert.equal(bases.length, 2);
  assert.ok(bases.some((b) => b.includes('file.inFolder("Proyectos/demo/Sesiones")')));
  assert.ok(bases.some((b) => b.includes('file.inFolder("Proyectos/demo/Decisiones")')));
  assert.match(out, /^## Conocimiento relacionado$/m);
  assert.match(out, /^> \[!/m);
  assert.match(primerH(out), /^# Demo$/);
});
