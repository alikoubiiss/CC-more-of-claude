import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ejecutar, planificar, verificar } from '../lib/vp-migrar.mjs';
import { hashArbol } from '../lib/respaldo.mjs';
import { parseFrontmatter } from '../lib/vp-frontmatter.mjs';
import { tmpDir } from './helpers.mjs';

const AHORA = new Date(2026, 9, 9, 17, 0, 0);
const RUIDO = '```\nThis block is not supported on your current device yet.\n```\n';

function chat(titulo, fecha, extra = '') {
  return `---\ntitulo: "${titulo}"\ntipo: chat-claude\nfecha: ${fecha}\ncategoria: Finanzas\nmensajes: 2\ntags: [personal, finanzas]\nuuid: u-${titulo.length}\n---\n\n# ${titulo}\n\n### Tú\n\nhola\n\n### Claude\n\nrespuesta ${RUIDO}\n${extra}`;
}

function fixture() {
  const root = tmpDir();
  const o = path.join(root, 'viejo');
  const w = (rel, contenido) => {
    const f = path.join(o, ...rel.split('/'));
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, contenido);
  };
  for (const d of ['01 - Diario', '02 - Notas', '04 - Salud y Habitos', '99 - Archivo']) mkdirSync(path.join(o, d), { recursive: true });
  w('.obsidian/app.json', '{}');
  w('00 - Entrada/Sin título.base', 'views: []\n');
  w('03 - Proyectos/Viaje.md', '---\ntipo: proyecto\nestado: activo\n---\n# Viaje\n[[2026-03-16 Chat Uno]]\n');
  w('05 - Recursos/Contexto guardado por Claude.md', '---\ntipo: contexto\n---\n# Contexto\n');
  mkdirSync(path.join(o, '05 - Recursos', 'Adjuntos'), { recursive: true });
  writeFileSync(path.join(o, '05 - Recursos', 'Adjuntos', 'foto.png'), Buffer.from([137, 80, 78, 71, 0, 255]));
  w('06 - Chats de Claude/000 Índice de chats — Personal.md', '# Índice\n[[2026-03-16 Chat Uno]]\n');
  w('06 - Chats de Claude/Finanzas/2026-03-16 Chat Uno.md', chat('Chat Uno', '2026-03-16'));
  w('06 - Chats de Claude/Finanzas/2026-03-16 Tracker.md', chat('Tracker', '2026-03-16'));
  w('06 - Chats de Claude/Finanzas/2026-03-16 Tracker (2).md', chat('Tracker', '2026-03-16'));
  w('06 - Chats de Claude/Viajes/2026-02-01 Plan fase 1.md', chat('Plan: fase 1', '2026-02-01'));
  w('06 - Chats de Claude/Viajes/2026-02-02 Roto.md', '---\nlinea ilegible\n---\n# Roto\n\ntexto importante\n');
  mkdirSync(path.join(o, '06 - Chats de Claude', 'Viajes'), { recursive: true });
  writeFileSync(path.join(o, '06 - Chats de Claude', 'Viajes', '2026-02-03 Binario.md'), Buffer.from([0x23, 0x20, 0xff, 0xfe, 0x0a]));
  w('07 - Temas/000 Índice de temas.md', '# Temas\n');
  w('07 - Temas/Finanzas personales.md', '---\ntipo: tema\ntags: [personal]\n---\n# Finanzas\n[[2026-02-01 Plan fase 1#sec|x]] y [[2026-03-16 Chat Uno|alias]] y [[no existe]]\n```\n[[Chat Uno]]\n```\n');
  w('08 - Panel/Chats.base', 'filters:\n  and:\n    - \'tipo == "chat-claude"\'\n    - \'file.inFolder("06 - Chats de Claude")\'\n');
  w('Plantillas/Idea.md', '---\ntipo: idea\n---\n# {{title}}\n');
  w('Inicio.md', '# Inicio viejo\n[[Panel]]\n');
  w('Panel.md', '# Panel viejo\n');
  return { root, o, d: path.join(root, 'Personal'), backupsDir: path.join(root, 'backups') };
}

const base = (f, extra = {}) => ({ origen: f.o, destino: f.d, backupsDir: f.backupsDir, ahora: AHORA, ...extra });
const leer = (f, rel) => readFileSync(path.join(f.d, ...rel.split('/')), 'utf8');

test('migración: estructura, nombres, frontmatter, enlaces y Bases', () => {
  const f = fixture();
  const inf = ejecutar(base(f));
  assert.equal(inf.verificacion.ok, true, JSON.stringify(inf.verificacion));
  for (const rel of ['Fuentes/Chats/2026/2026-03-16 Chat Uno.md', 'Fuentes/Chats/2026/2026-03-16 Tracker.md',
    'Fuentes/Chats/2026/2026-03-16 Tracker (2).md', 'Fuentes/Chats/2026/2026-02-01 Plan- fase 1.md',
    'Fuentes/Chats/2026/2026-02-02 Roto.md', 'Wiki/Temas/Finanzas personales.md', 'Proyectos/Viaje.md',
    'Plantillas/Idea.md', 'Paneles/Chats.base', 'Fuentes/Recursos/Contexto guardado por Claude.md',
    'Fuentes/Recursos/Adjuntos/foto.png', 'Fuentes/Recursos/Inicio (antiguo).md', 'Notas/Sin clasificar/00 - Entrada/Sin título.base',
    'Inicio.md', 'CLAUDE.md', 'index.md', 'log.md', '_migracion/mapa.json', '_migracion/informe.md']) {
    assert.ok(existsSync(path.join(f.d, ...rel.split('/'))), `falta ${rel}`);
  }
  for (const d of ['Diario', 'Notas', 'Salud y Habitos', 'Wiki/Decisiones', 'Wiki/Recetas']) assert.ok(existsSync(path.join(f.d, ...d.split('/'))), d);
  assert.ok(!existsSync(path.join(f.d, '.obsidian')));
  // chat limpio: sin ruido, con frontmatter unificado
  const c = leer(f, 'Fuentes/Chats/2026/2026-03-16 Chat Uno.md');
  assert.doesNotMatch(c, /not supported/);
  const fm = parseFrontmatter(c).datos;
  assert.deepEqual([fm.tipo, fm.categoria, fm.compartir], ['chat-claude', 'Finanzas', 'privado']);
  // tema: borrador y enlaces reescritos (alias/ancla), código intacto, roto conservado
  const tema = leer(f, 'Wiki/Temas/Finanzas personales.md');
  assert.equal(parseFrontmatter(tema).datos.estado, 'borrador');
  assert.match(tema, /\[\[2026-02-01 Plan- fase 1#sec\|x\]\]/);
  assert.match(tema, /\[\[2026-03-16 Chat Uno\|alias\]\]/);
  assert.match(tema, /\[\[no existe\]\]/);
  assert.match(tema, /```\n\[\[Chat Uno\]\]\n```/);
  assert.ok(inf.rotos.includes('no existe'));
  // proyecto con enlace reescrito; Base con carpeta nueva; plantilla literal
  assert.match(leer(f, 'Proyectos/Viaje.md'), /\[\[2026-03-16 Chat Uno\]\]/);
  assert.match(leer(f, 'Paneles/Chats.base'), /inFolder\("Fuentes\/Chats"\)/);
  assert.equal(leer(f, 'Plantillas/Idea.md'), readFileSync(path.join(f.o, 'Plantillas', 'Idea.md'), 'utf8'));
  // chat con frontmatter roto: aviso y texto conservado
  assert.match(leer(f, 'Fuentes/Chats/2026/2026-02-02 Roto.md'), /texto importante/);
  assert.ok(inf.avisos.some((a) => /Roto/.test(a.rel ?? a)));
});

test('migración: UTF-8 inválido se copia tal cual con aviso y el resto sigue', () => {
  const f = fixture();
  const inf = ejecutar(base(f));
  const hallado = readdirSync(path.join(f.d, 'Fuentes', 'Chats')).flatMap((d) => readdirSync(path.join(f.d, 'Fuentes', 'Chats', d)));
  assert.ok(hallado.some((n) => /Binario/.test(n)));
  assert.ok(inf.avisos.some((a) => /utf-?8/i.test(a.error ?? a)));
  const b = readFileSync(path.join(f.d, 'Fuentes', 'Chats', 'sin-fecha', '2026-02-03 Binario.md'));
  assert.deepEqual([...b], [0x23, 0x20, 0xff, 0xfe, 0x0a]);
});

test('migración: mapa.json con hashes y estados, copia de seguridad verificada, origen intacto', () => {
  const f = fixture();
  const antes = hashArbol(f.o);
  const inf = ejecutar(base(f));
  assert.deepEqual(hashArbol(f.o), antes);
  const mapa = JSON.parse(leer(f, '_migracion/mapa.json'));
  const e = mapa.find((m) => m.origen === '06 - Chats de Claude/Finanzas/2026-03-16 Chat Uno.md');
  assert.equal(e.destino, 'Fuentes/Chats/2026/2026-03-16 Chat Uno.md');
  assert.match(e.sha256Origen, /^[0-9a-f]{64}$/);
  assert.equal(e.estado, 'migrada');
  assert.equal(mapa.find((m) => m.origen === 'Inicio.md').estado, 'reemplazada');
  assert.equal(mapa.find((m) => m.origen === '07 - Temas/000 Índice de temas.md').estado, 'regenerada');
  assert.equal(mapa.find((m) => m.origen === '.obsidian/app.json').estado, 'omitida');
  const dirs = readdirSync(f.backupsDir);
  assert.equal(dirs.length, 1);
  assert.match(dirs[0], /^vault-personal-2026-10-09/);
  assert.deepEqual(hashArbol(path.join(f.backupsDir, dirs[0])), antes);
  assert.equal(inf.backup.dir, path.join(f.backupsDir, dirs[0]));
});

test('dry-run no crea nada y resume el plan', () => {
  const f = fixture();
  const inf = ejecutar(base(f, { dryRun: true }));
  assert.ok(!existsSync(f.d));
  assert.ok(!existsSync(f.backupsDir));
  assert.equal(inf.dryRun, true);
  assert.equal(inf.porTipo.chat, 6);
  assert.equal(inf.porTipo.tema, 1);
});

test('destino existente: error sin forzar; con forzar es idempotente', () => {
  const f = fixture();
  ejecutar(base(f));
  assert.throws(() => ejecutar(base(f)), /ya existe/);
  const antes = hashArbol(f.d).filter((x) => !/^(_migracion|log\.md)/.test(x.rel));
  const inf = ejecutar(base(f, { forzarExistente: true }));
  assert.equal(inf.verificacion.ok, true);
  assert.deepEqual(hashArbol(f.d).filter((x) => !/^(_migracion|log\.md)/.test(x.rel)), antes);
});

test('destino dentro del origen u origen dentro del destino: error', () => {
  const f = fixture();
  assert.throws(() => ejecutar(base(f, { destino: path.join(f.o, 'nuevo') })), /dentro/);
  assert.throws(() => ejecutar(base(f, { destino: f.root })), /dentro/);
  assert.ok(!existsSync(f.backupsDir));
});

test('planificar: sin escribir, con duplicados y nombres saneados', () => {
  const f = fixture();
  const p = planificar(f.o);
  const destinos = p.items.filter((i) => i.tipo === 'chat').map((i) => i.destinoRel);
  assert.ok(destinos.includes('Fuentes/Chats/2026/2026-03-16 Tracker (2).md'));
  assert.ok(destinos.includes('Fuentes/Chats/2026/2026-02-01 Plan- fase 1.md'));
  assert.equal(new Set(destinos.map((d) => d.toLowerCase())).size, destinos.length);
  assert.ok(!existsSync(f.d));
});

test('verificar detecta una nota migrada que falta en el destino', () => {
  const f = fixture();
  const inf = ejecutar(base(f));
  rmSync(path.join(f.d, 'Proyectos', 'Viaje.md'));
  const v = verificar({ origen: f.o, destino: f.d, mapa: JSON.parse(leer(f, '_migracion/mapa.json')) });
  assert.equal(v.ok, false);
  assert.ok(v.detalles.some((x) => /Viaje/.test(x)));
  assert.equal(inf.verificacion.ok, true);
});
