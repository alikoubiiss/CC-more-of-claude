// Pruebas negativas y casos límite de vault-enlazar (TASK-15).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { hashArbol } from '../lib/respaldo.mjs';
import { loadTemplate, render } from '../lib/templates.mjs';
import { enlaceIndice, retocarNota } from '../lib/vault-enlazar.mjs';
import { parseFrontmatter } from '../lib/vp-frontmatter.mjs';
import { runVaultEnlazar } from '../scripts/vault-enlazar.mjs';
import { makeCfg, tmpDir } from './helpers.mjs';

const MTIME = new Date('2026-10-13T09:58:00Z');
const AHORA = new Date(2026, 9, 17, 15, 30);
const COPIA = 'vault-enlazar-2026-10-17-1530';

const sesionVieja = (slug = 'demo') => [
  '---', 'tipo: sesion', `proyecto: ${slug}`, 'fecha: 2026-10-13', 'sesion: 111f0a23', '---',
  '# Sesión 2026-10-13 11:58', '', '- Tarjeta activa: ninguna', '',
].join('\n');
const DECISION_VIEJA = [
  '---', 'tipo: decision', 'proyecto: demo', 'fecha: 2026-10-13', '---', '# Usar SQLite', '', '**Contexto:** c', '',
].join('\n');
const INDICE_VIEJO = ['---', 'tipo: proyecto', 'proyecto: demo', 'estado: en-curso', '---', '# Demo', ''].join('\n');

// Bóveda falsa: { 'ruta/desde/la/bóveda.md': texto }. Todas las notas con la misma fecha de modificación.
function boveda(notas) {
  const root = tmpDir();
  const cfg = makeCfg(root);
  for (const [rel, texto] of Object.entries(notas)) {
    const f = path.join(cfg.vaultPath, ...rel.split('/'));
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, texto);
    utimesSync(f, MTIME, MTIME);
  }
  const abs = (rel) => path.join(cfg.vaultPath, ...rel.split('/'));
  return { cfg, abs, leer: (rel) => readFileSync(abs(rel), 'utf8') };
}

// rel -> "sha256 mtime" de cada fichero (sin seguir enlaces): cambia si cambia un byte o la fecha.
function huella(dir) {
  return Object.fromEntries(hashArbol(dir).map((f) => [f.rel, `${f.sha256} ${Math.round(statSync(path.join(dir, ...f.rel.split('/'))).mtimeMs)}`]));
}
const distintos = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]).sort();
const copiados = (cfg) => hashArbol(path.join(cfg.backupsDir, COPIA)).map((f) => f.rel).sort();
const veces = (texto, re) => (texto.match(re) ?? []).length;
const lineasFm = (t) => parseFrontmatter(t).valido && t.replace(/\r\n/g, '\n').match(/^\uFEFF?---\n([\s\S]*?)\n---/)[1].split('\n');

// --- Criterio 1: sin frontmatter o YAML no válido -> aviso y 0 bytes cambiados -------------------

const ROTAS = {
  'Proyectos/demo/Sesiones/sin-fm.md': ['# Suelta\n\nSin frontmatter.\n', /sin frontmatter: se deja intacta/],
  'Proyectos/demo/Sesiones/sin-fm-bom-crlf.md': ['\uFEFF# Suelta\r\n\r\nTexto.\r\n', /sin frontmatter: se deja intacta/],
  'Proyectos/demo/Sesiones/item-suelto.md': ['---\ntipo: sesion\n  - suelto\n---\n# X\n', /frontmatter no válido: se deja intacta/],
  'Proyectos/demo/Decisiones/sin-cierre.md': ['---\ntipo: decision\nproyecto: demo\n# Sin cierre\n\nTexto.\n', /frontmatter no válido: se deja intacta/],
  'Proyectos/demo/Decisiones/linea-rota.md': ['---\ntipo: decision\nesto no es yaml\n---\n# X\n', /frontmatter no válido: se deja intacta/],
  'Proyectos/demo/Decisiones/clave-con-acento.md': ['---\ntipo: decision\ncategoría: x\n---\n# X\n', /frontmatter no válido: se deja intacta/],
  'Proyectos/otro/Índice.md': ['# Otro\n\nÍndice sin frontmatter.\n', /sin frontmatter: se deja intacta/],
};

test('criterio 1: notas sin frontmatter o con YAML no válido se avisan en --simular y en la ejecución real, y quedan con 0 bytes cambiados', () => {
  const { cfg } = boveda({
    ...Object.fromEntries(Object.entries(ROTAS).map(([rel, [texto]]) => [rel, texto])),
    'Proyectos/demo/Sesiones/vieja.md': sesionVieja(),
  });
  const antes = huella(cfg.vaultPath);

  const sim = runVaultEnlazar({ argv: ['--simular'], cfg });
  assert.equal(sim.codigo, 0);
  assert.match(sim.lineas[0], /: 1 cambios /);
  for (const [rel, [, aviso]] of Object.entries(ROTAS)) {
    const linea = sim.lineas.find((l) => l.startsWith(`  - ${rel.replace('Proyectos/', '')}: `));
    assert.ok(linea, `falta el aviso de ${rel}`);
    assert.match(linea, aviso);
  }
  assert.deepEqual(huella(cfg.vaultPath), antes);

  const r = runVaultEnlazar({ argv: [], cfg, ahora: AHORA });
  assert.equal(r.codigo, 0, r.lineas.join('\n'));
  assert.match(r.lineas[0], /1 cambios aplicados/);
  assert.match(r.lineas.join('\n'), new RegExp(`Avisos: ${Object.keys(ROTAS).length}\\b`));
  for (const [rel, [, aviso]] of Object.entries(ROTAS)) {
    assert.match(r.lineas.join('\n'), new RegExp(`${rel.replace('Proyectos/', '').replace(/[.]/g, '\\.')}: ${aviso.source}`));
  }
  assert.deepEqual(distintos(antes, huella(cfg.vaultPath)), ['Proyectos/demo/Sesiones/vieja.md']);
  assert.deepEqual(copiados(cfg), ['demo/Sesiones/vieja.md']);
});

test('criterio 1: retocarNota devuelve el mismo texto (mismo objeto de bytes) en cada nota rota', () => {
  for (const [rel, [texto, aviso]] of Object.entries(ROTAS)) {
    const tipo = rel.endsWith('Índice.md') ? 'proyecto' : rel.includes('/Sesiones/') ? 'sesion' : 'decision';
    const r = retocarNota(texto, { tipo, slug: 'demo' });
    assert.equal(r.texto, texto, rel);
    assert.equal(Buffer.compare(Buffer.from(r.texto), Buffer.from(texto)), 0, rel);
    assert.deepEqual(r.cambios, [], rel);
    assert.equal(r.avisos.length, 1, rel);
    assert.match(r.avisos[0], aviso, rel);
  }
});

// --- Criterio 2: notas que ya tienen indice y cssclasses no se duplican --------------------------

const ENLACE = enlaceIndice('demo');
const VUELTA = `Volver a ${ENLACE}`;

test('criterio 2: las notas hechas con las plantillas nuevas (sesion, decision, nota-proyecto) dan 0 cambios y 0 avisos', () => {
  const casos = [
    ['sesion', render(loadTemplate('sesion.md'), { slug: 'demo', date: '2026-10-17', time: '10:00', sessionId: 's1', activeTask: 'TASK-1', changes: 'n/d', summary: 'x' })],
    ['decision', render(loadTemplate('decision.md'), { slug: 'demo', date: '2026-10-17', title: 'Usar SQLite', context: 'c', decision: 'd', why: 'w' })],
    ['proyecto', render(loadTemplate('nota-proyecto.md'), { slug: 'demo', display: 'Demo', repoPath: 'C:\\r', port: 6432, notebookId: 'nb', date: '2026-10-17' })],
  ];
  for (const [tipo, texto] of casos) {
    const r = retocarNota(texto, { tipo, slug: 'demo' });
    assert.deepEqual(r.cambios, [], tipo);
    assert.deepEqual(r.avisos, [], tipo);
    assert.equal(r.texto, texto, tipo);
  }
});

const YA_HECHAS = {
  // cssclasses en lista de bloque, indice entre comillas simples y línea de vuelta: nada que hacer.
  'bloque.md': ['---', 'tipo: sesion', 'proyecto: demo', 'cssclasses:', '  - hq-sesion', `indice: '${ENLACE}'`, '---', '# S', '', VUELTA, ''].join('\n'),
  // Ya tiene las dos claves (con otra clase además) pero no la línea: solo se añade la línea.
  'sin-linea.md': ['---', 'tipo: sesion', 'proyecto: demo', 'cssclasses: [otra, hq-sesion]', `indice: "${ENLACE}"`, '---', '# S', '', 'Texto.', ''].join('\n'),
  // cssclasses sin hq-sesion e indice distinto: avisos, nunca una segunda clave.
  'distintas.md': ['---', 'tipo: sesion', 'proyecto: demo', 'cssclasses: [otra]', 'indice: "[[Proyectos/viejo/Índice|viejo]]"', '---', '# S', '', VUELTA, ''].join('\n'),
  // indice sin comillas (YAML lo lee como lista): aviso, nunca una segunda clave.
  'sin-comillas.md': ['---', 'tipo: sesion', 'proyecto: demo', 'cssclasses: [hq-sesion]', `indice: ${ENLACE}`, '---', '# S', '', VUELTA, ''].join('\n'),
  // Solo cssclasses: se añade indice y nada más en el frontmatter.
  'solo-css.md': ['---', 'tipo: sesion', 'proyecto: demo', 'cssclasses: [hq-sesion]', '---', '# S', '', VUELTA, ''].join('\n'),
  // Solo indice: se añade cssclasses.
  'solo-indice.md': ['---', 'tipo: sesion', 'proyecto: demo', `indice: "${ENLACE}"`, '---', '# S', '', VUELTA, ''].join('\n'),
  // cssclasses vacío (lista sin elementos): cuenta como presente, aviso y sin duplicar.
  'css-vacio.md': ['---', 'tipo: sesion', 'proyecto: demo', 'cssclasses:', `indice: "${ENLACE}"`, '---', '# S', '', VUELTA, ''].join('\n'),
};

test('criterio 2: retocarNota no duplica cssclasses, indice ni la línea de vuelta', () => {
  const esperado = {
    'bloque.md': [[], []],
    'sin-linea.md': [['+ línea de vuelta al Índice'], []],
    'distintas.md': [[], [/cssclasses sin hq-sesion/, /indice distinto/]],
    'sin-comillas.md': [[], [/indice distinto/]],
    'solo-css.md': [['+ indice'], []],
    'solo-indice.md': [['+ cssclasses'], []],
    'css-vacio.md': [[], [/cssclasses sin hq-sesion/]],
  };
  for (const [nombre, texto] of Object.entries(YA_HECHAS)) {
    const r = retocarNota(texto, { tipo: 'sesion', slug: 'demo' });
    const [cambios, avisos] = esperado[nombre];
    assert.deepEqual(r.cambios, cambios, nombre);
    assert.equal(r.avisos.length, avisos.length, `${nombre}: ${r.avisos}`);
    avisos.forEach((a, i) => assert.match(r.avisos[i], a, nombre));
    if (!cambios.length) assert.equal(r.texto, texto, nombre);
    const fm = lineasFm(r.texto);
    assert.equal(fm.filter((l) => /^cssclasses:/.test(l)).length, 1, nombre);
    assert.equal(fm.filter((l) => /^indice:/.test(l)).length, 1, nombre);
    assert.equal(veces(r.texto, /^Volver a /gm), 1, nombre);
    assert.deepEqual(retocarNota(r.texto, { tipo: 'sesion', slug: 'demo' }).cambios, [], `${nombre}: segunda pasada`);
  }
});

test('criterio 2: una carpeta con el slug en NFD (copiada desde macOS) no duplica la línea de vuelta ni avisa del indice NFC', () => {
  const nfc = 'Café';
  const nfd = nfc.normalize('NFD');
  const enlace = `[[Proyectos/${nfc}/Índice|${nfc}]]`;
  const t = ['---', 'tipo: sesion', `proyecto: ${nfc}`, 'cssclasses: [hq-sesion]', `indice: "${enlace}"`, '---', '# S', '', `Volver a ${enlace}`, ''].join('\n');
  const r = retocarNota(t, { tipo: 'sesion', slug: nfd });
  assert.deepEqual(r.cambios, []);
  assert.deepEqual(r.avisos, []);
  assert.equal(r.texto, t);
});

test('criterio 2: en la bóveda, dos ejecuciones seguidas no duplican nada y la segunda no escribe', () => {
  const notas = Object.fromEntries(Object.entries(YA_HECHAS).map(([n, t]) => [`Proyectos/demo/Sesiones/${n}`, t]));
  const { cfg, leer } = boveda({
    ...notas,
    'Proyectos/demo/Índice.md': `${INDICE_VIEJO.replace('---\n#', 'cssclasses: [hq-proyecto]\n---\n#')}`,
  });
  const antes = huella(cfg.vaultPath);
  const r = runVaultEnlazar({ argv: [], cfg, ahora: AHORA });
  assert.equal(r.codigo, 0, r.lineas.join('\n'));
  assert.deepEqual(distintos(antes, huella(cfg.vaultPath)), [
    'Proyectos/demo/Sesiones/sin-linea.md', 'Proyectos/demo/Sesiones/solo-css.md', 'Proyectos/demo/Sesiones/solo-indice.md',
  ]);
  for (const rel of Object.keys(notas)) {
    const t = leer(rel);
    assert.equal(veces(t, /^cssclasses:/gm), 1, rel);
    assert.equal(veces(t, /^indice:/gm), 1, rel);
    assert.equal(veces(t, /^Volver a /gm), 1, rel);
  }
  assert.equal(veces(leer('Proyectos/demo/Índice.md'), /^cssclasses:/gm), 1);

  const despues = huella(cfg.vaultPath);
  const r2 = runVaultEnlazar({ argv: [], cfg, ahora: new Date(2026, 9, 17, 15, 31) });
  assert.match(r2.lineas[0], /^0 cambios/);
  assert.deepEqual(huella(cfg.vaultPath), despues);
  assert.deepEqual(readdirSync(cfg.backupsDir), [COPIA]);
});

// --- Criterio 3: slug con espacios y acentos -------------------------------------------------------

const SLUG = 'Café con leche ñandú';

test('criterio 3: un slug con espacios y acentos genera [[Proyectos/<slug>/Índice|<slug>]] válido', () => {
  const enlace = `[[Proyectos/${SLUG}/Índice|${SLUG}]]`;
  assert.equal(enlaceIndice(SLUG), enlace);
  const { cfg, leer, abs } = boveda({
    [`Proyectos/${SLUG}/Índice.md`]: INDICE_VIEJO.replace(/demo/g, SLUG),
    [`Proyectos/${SLUG}/Sesiones/2026-10-13-a.md`]: sesionVieja(SLUG),
    [`Proyectos/${SLUG}/Decisiones/2026-10-13-b.md`]: DECISION_VIEJA.replace('proyecto: demo', `proyecto: ${SLUG}`),
  });
  const r = runVaultEnlazar({ argv: [], cfg, ahora: AHORA });
  assert.equal(r.codigo, 0, r.lineas.join('\n'));
  assert.match(r.lineas.join('\n'), /Avisos: 0/);

  for (const rel of [`Proyectos/${SLUG}/Sesiones/2026-10-13-a.md`, `Proyectos/${SLUG}/Decisiones/2026-10-13-b.md`]) {
    const t = leer(rel);
    const fm = parseFrontmatter(t);
    assert.ok(fm.valido, rel);
    assert.equal(fm.datos.indice, enlace, rel);
    assert.ok(lineasFm(t).includes(`indice: "${enlace}"`), rel);
    assert.equal(fm.datos.proyecto, SLUG, rel);
    assert.ok(t.split('\n').includes(`Volver a ${enlace}`), rel);
    // Enlace válido para Obsidian: ruta y alias sin [ ] | # ^, y la ruta lleva a un Índice.md que existe.
    const m = fm.datos.indice.match(/^\[\[([^[\]|#^]+)\|([^[\]|#^]+)\]\]$/);
    assert.ok(m, rel);
    assert.equal(m[2], SLUG);
    assert.equal(m[1], m[1].normalize('NFC'));
    assert.ok(existsSync(abs(`${m[1]}.md`)), `${m[1]}.md no existe`);
  }
  assert.ok(lineasFm(leer(`Proyectos/${SLUG}/Índice.md`)).includes('cssclasses: [hq-proyecto]'));

  const despues = huella(cfg.vaultPath);
  assert.match(runVaultEnlazar({ argv: [], cfg, ahora: AHORA }).lineas[0], /^0 cambios/);
  assert.deepEqual(huella(cfg.vaultPath), despues);
});

test('criterio 3: la plantilla de sesión con ese slug y el script coinciden (0 cambios, 0 avisos)', () => {
  const t = render(loadTemplate('sesion.md'), { slug: SLUG, date: '2026-10-17', time: '10:00', sessionId: 's1', activeTask: 'n', changes: 'n', summary: 'x' });
  const r = retocarNota(t, { tipo: 'sesion', slug: SLUG });
  assert.deepEqual(r.cambios, []);
  assert.deepEqual(r.avisos, []);
});

test('criterio 3: un slug con caracteres que rompen el wikilink (# [ ^) se avisa y no se toca', () => {
  const notas = {};
  for (const slug of ['C# avanzado', 'notas [viejas]', 'x^y']) notas[`Proyectos/${slug}/Sesiones/a.md`] = sesionVieja(slug);
  const { cfg } = boveda({ ...notas, 'Proyectos/demo/Sesiones/a.md': sesionVieja() });
  const antes = huella(cfg.vaultPath);
  const r = runVaultEnlazar({ argv: [], cfg, ahora: AHORA });
  assert.equal(r.codigo, 0);
  const salida = r.lineas.join('\n');
  for (const slug of ['C# avanzado', 'notas [viejas]', 'x^y']) {
    assert.ok(salida.includes(`  - ${slug}: el nombre de la carpeta no vale en un wikilink`), slug);
  }
  assert.deepEqual(distintos(antes, huella(cfg.vaultPath)), ['Proyectos/demo/Sesiones/a.md']);
});

// --- Criterio 4: notas fuera de Proyectos/ y Conocimiento/ no se tocan -----------------------------

test('criterio 4: solo cambian las notas candidatas de Proyectos/<slug>/; el resto de la bóveda queda byte a byte', () => {
  const tentadora = sesionVieja();
  const { cfg } = boveda({
    'Proyectos/demo/Sesiones/vieja.md': sesionVieja(),
    'Proyectos/demo/Decisiones/vieja.md': DECISION_VIEJA,
    // Fuera de Proyectos/ y de Conocimiento/:
    'Inicio.md': INDICE_VIEJO,
    'Índice.md': INDICE_VIEJO,
    'Plantillas/sesion.md': tentadora,
    'Personal/demo/Sesiones/x.md': tentadora,
    'Proyectos archivados/demo/Sesiones/x.md': tentadora,
    'Sesiones/x.md': tentadora,
    // Conocimiento/ tampoco lo toca este script:
    'Conocimiento/Temas/x.md': tentadora,
    'Conocimiento/Sesiones/x.md': tentadora,
    'Conocimiento/demo/Sesiones/x.md': tentadora,
    // Dentro de Proyectos/ pero fuera de Índice.md, Sesiones/*.md y Decisiones/*.md:
    'Proyectos/suelta.md': tentadora,
    'Proyectos/Índice.md': INDICE_VIEJO,
    'Proyectos/demo/Otra.md': tentadora,
    'Proyectos/demo/Sesiones/sub/anidada.md': tentadora,
    'Proyectos/demo/Sesiones/nota.txt': tentadora,
    'Proyectos/demo/Archivo/Sesiones/x.md': tentadora,
  });
  const antes = huella(cfg.vaultPath);
  const sim = runVaultEnlazar({ argv: ['--simular'], cfg });
  assert.match(sim.lineas[0], /: 2 cambios /);
  assert.deepEqual(huella(cfg.vaultPath), antes);

  const r = runVaultEnlazar({ argv: [], cfg, ahora: AHORA });
  assert.equal(r.codigo, 0, r.lineas.join('\n'));
  assert.deepEqual(distintos(antes, huella(cfg.vaultPath)), ['Proyectos/demo/Decisiones/vieja.md', 'Proyectos/demo/Sesiones/vieja.md']);
  assert.deepEqual(copiados(cfg), ['demo/Decisiones/vieja.md', 'demo/Sesiones/vieja.md']);
});

test('criterio 4: una carpeta Sesiones o Decisiones que es junction hacia Conocimiento/ se avisa y no se toca', () => {
  const { cfg, abs } = boveda({
    'Proyectos/demo/Índice.md': INDICE_VIEJO,
    'Conocimiento/Sesiones/x.md': sesionVieja(),
    'Conocimiento/Decisiones/y.md': DECISION_VIEJA,
    'Conocimiento/fuera/Sesiones/z.md': sesionVieja('fuera'),
  });
  symlinkSync(abs('Conocimiento/Sesiones'), abs('Proyectos/demo/Sesiones'), 'junction');
  symlinkSync(abs('Conocimiento/Decisiones'), abs('Proyectos/demo/Decisiones'), 'junction');
  symlinkSync(abs('Conocimiento/fuera'), abs('Proyectos/fuera'), 'junction');
  const conocimiento = abs('Conocimiento');
  const antes = huella(conocimiento);

  const sim = runVaultEnlazar({ argv: ['--simular'], cfg });
  const s = sim.lineas.join('\n');
  assert.match(sim.lineas[0], /: 1 cambios /);
  assert.doesNotMatch(s, /x\.md|y\.md|z\.md/);
  assert.match(s, /demo\/Sesiones: enlace simbólico o junction: no se toca/);
  assert.match(s, /demo\/Decisiones: enlace simbólico o junction: no se toca/);
  assert.match(s, /fuera: enlace simbólico o junction: no se toca/);

  const r = runVaultEnlazar({ argv: [], cfg, ahora: AHORA });
  assert.equal(r.codigo, 0, r.lineas.join('\n'));
  assert.match(r.lineas[0], /1 cambios aplicados/);
  assert.deepEqual(huella(conocimiento), antes);
  assert.deepEqual(copiados(cfg), ['demo/Índice.md']);
});
