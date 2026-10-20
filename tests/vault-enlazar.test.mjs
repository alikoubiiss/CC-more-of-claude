import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { hashArbol } from '../lib/respaldo.mjs';
import { loadTemplate, render } from '../lib/templates.mjs';
import { retocarNota } from '../lib/vault-enlazar.mjs';
import { runVaultEnlazar } from '../scripts/vault-enlazar.mjs';
import { tmpDir, writeConfigFile } from './helpers.mjs';

const HQ = path.resolve(import.meta.dirname, '..');
const ENLACE = '[[Proyectos/demo/Índice|demo]]';

const INDICE_VIEJO = [
  '---', 'tipo: proyecto', 'proyecto: demo', 'estado: en-curso', 'repo: C:\\proyectos personales\\demo',
  'notebook: nb-1', 'puerto: 6432', 'nivel: 1', 'creado: 2026-10-13', '---', '# Demo', '',
  '## Qué es', 'Pendiente: ejecuta /idea.', '', '## Decisiones', 'Ver la carpeta `Decisiones/`.', '',
].join('\n');
const SESION_VIEJA = [
  '---', 'tipo: sesion', 'proyecto: demo', 'fecha: 2026-10-13', 'sesion: 111f0a23', '---',
  '# Sesión 2026-10-13 11:58', '', '- Tarjeta activa: ninguna', '- Cambios: 2 files changed', '',
  '## Resumen', 'Auto-snapshot (Stop).', '',
].join('\n');
const DECISION_VIEJA = [
  '---', 'tipo: decision', 'proyecto: demo', 'fecha: 2026-10-13', 'estado: superada', '---',
  '# Usar SQLite', '', '**Contexto:** c', '', '**Decisión:** d', '', '**Motivo:** w', '',
].join('\n');
const SESION_NUEVA = render(loadTemplate('sesion.md'), {
  slug: 'demo', date: '2026-10-17', time: '10:00', sessionId: 'manual-1', activeTask: 'TASK-1 X', changes: 'n/d', summary: 'Hecho.',
});

const MTIME = new Date('2026-10-13T09:58:00Z');

// Bóveda falsa con un proyecto "demo" en formato viejo y una sesión ya en formato nuevo.
function entorno() {
  const root = tmpDir();
  const { file, cfg } = writeConfigFile(root);
  const p = path.join(cfg.vaultPath, 'Proyectos', 'demo');
  const notas = {
    'Índice.md': INDICE_VIEJO,
    'Sesiones/2026-10-13-111f0a23.md': SESION_VIEJA,
    'Decisiones/2026-10-13-usar-sqlite.md': DECISION_VIEJA,
    'Sesiones/2026-10-17-manual-1.md': SESION_NUEVA,
  };
  for (const [rel, texto] of Object.entries(notas)) {
    const f = path.join(p, ...rel.split('/'));
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, texto);
    utimesSync(f, MTIME, MTIME);
  }
  const leer = (rel) => readFileSync(path.join(p, ...rel.split('/')), 'utf8');
  return { root, file, cfg, p, leer };
}

const frontmatter = (t) => t.match(/^---\n([\s\S]*?)\n---\n/)[1].split('\n');
const sinInsertadas = (t) => t
  .replace(/^cssclasses: \[hq-\w+\]\n/m, '')
  .replace(/^indice: ".*"\n/m, '')
  .replace(/\n\nVolver a \[\[Proyectos\/demo\/Índice\|demo\]\]\n/, '\n');

test('retocarNota añade cssclasses, indice y la línea de vuelta a una sesión vieja', () => {
  const r = retocarNota(SESION_VIEJA, { tipo: 'sesion', slug: 'demo' });
  assert.deepEqual(r.cambios, ['+ cssclasses', '+ indice', '+ línea de vuelta al Índice']);
  assert.deepEqual(r.avisos, []);
  const fm = frontmatter(r.texto);
  assert.ok(fm.includes('cssclasses: [hq-sesion]'));
  assert.ok(fm.includes(`indice: "${ENLACE}"`));
  assert.match(r.texto, /\n---\n# Sesión 2026-10-13 11:58\n\nVolver a \[\[Proyectos\/demo\/Índice\|demo\]\]\n\n- Tarjeta activa: ninguna\n/);
  assert.equal(sinInsertadas(r.texto), SESION_VIEJA);
});

test('retocarNota es idempotente y deja igual una nota ya hecha con la plantilla nueva', () => {
  for (const [texto, tipo] of [[SESION_VIEJA, 'sesion'], [DECISION_VIEJA, 'decision'], [INDICE_VIEJO, 'proyecto']]) {
    const una = retocarNota(texto, { tipo, slug: 'demo' }).texto;
    const dos = retocarNota(una, { tipo, slug: 'demo' });
    assert.deepEqual(dos.cambios, []);
    assert.equal(dos.texto, una);
  }
  const hecha = retocarNota(SESION_NUEVA, { tipo: 'sesion', slug: 'demo' });
  assert.deepEqual(hecha.cambios, []);
  assert.equal(hecha.texto, SESION_NUEVA);
});

test('retocarNota conserva CRLF y BOM', () => {
  const crlf = `\uFEFF${DECISION_VIEJA.replace(/\n/g, '\r\n')}`;
  const r = retocarNota(crlf, { tipo: 'decision', slug: 'demo' });
  assert.equal(r.cambios.length, 3);
  assert.ok(r.texto.startsWith('\uFEFF---\r\n'));
  assert.doesNotMatch(r.texto.replace(/\r\n/g, ''), /\n/);
  assert.match(r.texto, /\r\nVolver a \[\[Proyectos\/demo\/Índice\|demo\]\]\r\n/);
});

test('retocarNota deja intacta una nota sin frontmatter y lo avisa', () => {
  const texto = '# Suelta\n\nSin frontmatter.\n';
  const r = retocarNota(texto, { tipo: 'decision', slug: 'demo' });
  assert.equal(r.texto, texto);
  assert.deepEqual(r.cambios, []);
  assert.match(r.avisos[0], /sin frontmatter/);
});

test('bóveda falsa: añade cssclasses, indice y la línea de vuelta sin cambiar proyecto: ni estado:', () => {
  const { cfg, leer } = entorno();
  const r = runVaultEnlazar({ argv: [], cfg, ahora: new Date(2026, 9, 17, 15, 30) });
  assert.equal(r.codigo, 0, r.lineas.join('\n'));

  const sesion = leer('Sesiones/2026-10-13-111f0a23.md');
  assert.ok(frontmatter(sesion).includes('cssclasses: [hq-sesion]'));
  assert.ok(frontmatter(sesion).includes(`indice: "${ENLACE}"`));
  assert.match(sesion, /^Volver a \[\[Proyectos\/demo\/Índice\|demo\]\]$/m);
  assert.equal(sinInsertadas(sesion), SESION_VIEJA);

  const decision = leer('Decisiones/2026-10-13-usar-sqlite.md');
  assert.ok(frontmatter(decision).includes('cssclasses: [hq-decision]'));
  assert.ok(frontmatter(decision).includes('proyecto: demo'));
  assert.ok(frontmatter(decision).includes('estado: superada'));
  assert.equal(sinInsertadas(decision), DECISION_VIEJA);

  const indice = leer('Índice.md');
  const fm = frontmatter(indice);
  assert.ok(fm.includes('cssclasses: [hq-proyecto]'));
  assert.ok(fm.includes('proyecto: demo'));
  assert.ok(fm.includes('estado: en-curso'));
  assert.ok(fm.includes('repo: C:\\proyectos personales\\demo'));
  assert.ok(!fm.some((l) => l.startsWith('indice:')));
  assert.doesNotMatch(indice, /Volver a/);
  assert.equal(sinInsertadas(indice), INDICE_VIEJO);

  assert.equal(leer('Sesiones/2026-10-17-manual-1.md'), SESION_NUEVA);
});

test('reescribir una nota conserva su fecha de modificación (lastSession la usa)', () => {
  const { cfg, p } = entorno();
  runVaultEnlazar({ argv: [], cfg, ahora: new Date(2026, 9, 17, 15, 30) });
  const st = statSync(path.join(p, 'Sesiones', '2026-10-13-111f0a23.md'));
  assert.equal(Math.round(st.mtimeMs), MTIME.getTime());
});

test('--simular lista los cambios por nota y no escribe nada', () => {
  const { cfg, p } = entorno();
  const antes = hashArbol(p);
  const r = runVaultEnlazar({ argv: ['--simular'], cfg });
  assert.equal(r.codigo, 0);
  const salida = r.lineas.join('\n');
  assert.match(r.lineas[0], /Simulación \(no se ha escrito nada\): 3 cambios/);
  assert.match(salida, /demo\/Sesiones\/2026-10-13-111f0a23\.md: \+ cssclasses, \+ indice, \+ línea de vuelta al Índice/);
  assert.match(salida, /demo\/Decisiones\/2026-10-13-usar-sqlite\.md: \+ cssclasses, \+ indice, \+ línea de vuelta al Índice/);
  assert.match(salida, /demo\/Índice\.md: \+ cssclasses$/m);
  assert.doesNotMatch(salida, /manual-1/);
  assert.deepEqual(hashArbol(p), antes);
  assert.ok(!existsSync(cfg.backupsDir));
});

test('antes de escribir guarda backup de cada nota en backupsDir; la segunda ejecución informa 0 cambios', () => {
  const { cfg, p } = entorno();
  const r = runVaultEnlazar({ argv: [], cfg, ahora: new Date(2026, 9, 17, 15, 30) });
  const dirs = readdirSync(cfg.backupsDir);
  assert.deepEqual(dirs, ['vault-enlazar-2026-10-17-1530']);
  const copia = path.join(cfg.backupsDir, dirs[0]);
  assert.match(r.lineas.join('\n'), new RegExp(`Copia de seguridad: ${copia.replace(/\\/g, '\\\\')}`));
  assert.equal(readFileSync(path.join(copia, 'demo', 'Índice.md'), 'utf8'), INDICE_VIEJO);
  assert.equal(readFileSync(path.join(copia, 'demo', 'Sesiones', '2026-10-13-111f0a23.md'), 'utf8'), SESION_VIEJA);
  assert.equal(readFileSync(path.join(copia, 'demo', 'Decisiones', '2026-10-13-usar-sqlite.md'), 'utf8'), DECISION_VIEJA);
  assert.deepEqual(hashArbol(copia).map((f) => f.rel).sort(), [
    'demo/Decisiones/2026-10-13-usar-sqlite.md', 'demo/Sesiones/2026-10-13-111f0a23.md', 'demo/Índice.md',
  ].sort());

  const despues = hashArbol(p);
  const r2 = runVaultEnlazar({ argv: [], cfg, ahora: new Date(2026, 9, 17, 15, 31) });
  assert.equal(r2.codigo, 0);
  assert.match(r2.lineas[0], /^0 cambios/);
  assert.deepEqual(hashArbol(p), despues);
  assert.deepEqual(readdirSync(cfg.backupsDir), ['vault-enlazar-2026-10-17-1530']);
});

test('si la copia de seguridad falla no se escribe ninguna nota', () => {
  const { cfg, p } = entorno();
  writeFileSync(cfg.backupsDir, 'no soy una carpeta');
  const antes = hashArbol(p);
  assert.throws(() => runVaultEnlazar({ argv: [], cfg, ahora: new Date(2026, 9, 17, 15, 30) }));
  assert.deepEqual(hashArbol(p), antes);
});

test('errores de uso claros y el script sale con código 1 y una línea en stderr', () => {
  const { cfg, file } = entorno();
  assert.throws(() => runVaultEnlazar({ argv: ['--borrar'], cfg }), /argumento desconocido: --borrar/);
  const r = spawnSync(process.execPath, ['scripts/vault-enlazar.mjs', '--nope'], { cwd: HQ, encoding: 'utf8', env: { ...process.env, HQ_CONFIG: file } });
  assert.equal(r.status, 1);
  assert.equal(r.stderr.trim().split('\n').length, 1);
  assert.match(r.stderr, /argumento desconocido/);
});

test('node scripts/vault-enlazar.mjs --simular sobre la bóveda de HQ_CONFIG no escribe nada', () => {
  const { file, cfg, p } = entorno();
  const antes = hashArbol(p);
  const r = spawnSync(process.execPath, ['scripts/vault-enlazar.mjs', '--simular'], {
    cwd: HQ, encoding: 'utf8', env: { ...process.env, HQ_CONFIG: file },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Simulación \(no se ha escrito nada\): 3 cambios/);
  assert.match(r.stdout, /demo\/Sesiones\/2026-10-13-111f0a23\.md: \+ cssclasses/);
  assert.deepEqual(hashArbol(p), antes);
  assert.ok(!existsSync(cfg.backupsDir));
});
