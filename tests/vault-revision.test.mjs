import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { redactar } from '../lib/redactor.mjs';
import { exportar } from '../lib/exportar-hq.mjs';
import { limpiarChat } from '../lib/chat-limpiar.mjs';
import { parseFrontmatter, serializarFrontmatter } from '../lib/vp-frontmatter.mjs';
import { nombreSeguro } from '../lib/vp-rutas.mjs';
import { ejecutar } from '../lib/vp-migrar.mjs';
import { tmpDir } from './helpers.mjs';

const AHORA = new Date(2026, 9, 9, 20, 0, 0);

test('H1 redactor: teléfonos internacionales, IBAN en minúsculas o con formato CCC, correos con acentos, DNI y NIE', () => {
  for (const t of ['+212 612 345 678', '+212612345678', '+44 20 7946 0958', '0034 612 345 678',
    'es91 2100 0418 4502 0005 1332', 'ES91 2100 0418 45 0200051332', 'josé@gmail.com', '12345678Z', 'X1234567L']) {
    const r = redactar(`dato ${t} fin`);
    assert.equal(r.texto, 'dato [redactado] fin', t);
  }
});

test('H1 redactor: sigue sin tocar referencias largas, fechas, versiones y DNI con letra incorrecta', () => {
  const t = 'ref 1234 5678 9012 3456, fecha 2026-03-16, v 3.11.9, id 12345678A, pedido 987654321012345';
  assert.equal(redactar(t).texto, t);
});

test('H2 exportar: una nota en la raíz de Wiki va a la carpeta de su tipo', () => {
  const root = tmpDir();
  const d = path.join(root, 'Personal');
  mkdirSync(path.join(d, 'Wiki'), { recursive: true });
  writeFileSync(path.join(d, 'Wiki', 'Raiz.md'), `${serializarFrontmatter({ titulo: 'Raiz', tipo: 'decision', estado: 'revisada', compartir: 'hq' })}\nCuerpo.\n`);
  const r = exportar({ destino: d, conocimiento: path.join(root, 'K'), ahora: AHORA });
  assert.deepEqual(r.exportadas, ['Decisiones/Raiz.md']);
  assert.ok(existsSync(path.join(root, 'K', 'Decisiones', 'Raiz.md')));
});

test('H3 chats: no se pierden claves del frontmatter y las etiquetas siguen siendo tags de Obsidian', () => {
  const t = '---\ntitulo: T\ntipo: chat-claude\ncategoria: Finanzas\ntags: [personal, finanzas]\naliases: [otro nombre]\nurl: "https://x.example/a"\nresumen: texto largo\n---\ncuerpo\n';
  const { datos } = parseFrontmatter(limpiarChat(t, { nombreFichero: '2026-01-01 T.md' }).texto);
  assert.deepEqual(datos.aliases, ['otro nombre']);
  assert.equal(datos.url, 'https://x.example/a');
  assert.equal(datos.resumen, 'texto largo');
  assert.ok(datos.tags.includes('personal') && datos.tags.includes('claude-chat') && datos.tags.includes('finanzas'));
});

function fixture(extra = () => {}) {
  const root = tmpDir();
  const o = path.join(root, 'viejo');
  const w = (rel, contenido) => {
    const f = path.join(o, ...rel.split('/'));
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, contenido);
  };
  w('06 - Chats de Claude/Salud/Salud.md', '---\ntitulo: Salud\ntipo: chat-claude\nfecha: 2024-01-01\ncategoria: Salud\n---\nchat\n');
  w('07 - Temas/Salud.md', '---\ntipo: tema\n---\n# Salud tema\n');
  w('07 - Temas/Resumen.md', '---\ntipo: tema\n---\nVer [[07 - Temas/Salud|tema]] y [[Salud|otro]]\n');
  extra(w, o);
  return { root, o, d: path.join(root, 'Personal'), backupsDir: path.join(root, 'backups') };
}
const base = (f, extra = {}) => ({ origen: f.o, destino: f.d, backupsDir: f.backupsDir, ahora: AHORA, ...extra });
const leer = (f, rel) => readFileSync(path.join(f.d, ...rel.split('/')), 'utf8');

test('H4 migración: un tema que no es UTF-8 se copia byte a byte y avisa', () => {
  const f = fixture((w, o) => {
    mkdirSync(path.join(o, '07 - Temas'), { recursive: true });
    writeFileSync(path.join(o, '07 - Temas', 'Latin.md'), Buffer.from('# Caf\xe9\n', 'latin1'));
  });
  const inf = ejecutar(base(f));
  assert.deepEqual([...readFileSync(path.join(f.d, 'Notas', 'Sin clasificar', '07 - Temas', 'Latin.md'))], [...Buffer.from('# Caf\xe9\n', 'latin1')]);
  assert.ok(inf.avisos.some((a) => /Latin/.test(a.rel) && /utf-?8/i.test(a.error)));
  assert.equal(inf.verificacion.ok, true);
});

test('H5 migración: un enlace con carpeta apunta a la nota de esa carpeta, no a otra del mismo nombre', () => {
  const f = fixture();
  ejecutar(base(f));
  const t = leer(f, 'Wiki/Temas/Resumen.md');
  assert.match(t, /\[\[Salud\|tema\]\]/);
  assert.doesNotMatch(t, /2024-01-01 Salud\|tema/);
});

test('H6 nombres: # [ ] ^ no se quedan en el nombre de fichero', () => {
  assert.equal(nombreSeguro('C# [avanzado]'), 'C (avanzado)');
  assert.equal(nombreSeguro('a^b'), 'ab');
  assert.doesNotMatch(nombreSeguro('x#y[z]^w'), /[#[\]^]/);
});

test('H7 migración: un enlace simbólico no migrado se avisa y la verificación no da por buena la migración', (t) => {
  const f = fixture((w, o) => {
    mkdirSync(path.join(o, 'fuera-real'), { recursive: true });
    writeFileSync(path.join(o, 'fuera-real', 'x.md'), 'x');
    try {
      symlinkSync(path.join(o, 'fuera-real'), path.join(o, '03 - Proyectos'), 'junction');
    } catch {
      t.skip('no se pueden crear enlaces');
    }
  });
  if (!existsSync(path.join(f.o, '03 - Proyectos'))) return;
  const inf = ejecutar(base(f));
  assert.ok(inf.avisos.some((a) => /03 - Proyectos/.test(a.rel) && /enlace/i.test(a.error)));
  assert.equal(inf.verificacion.ok, false);
  assert.ok(inf.verificacion.detalles.some((x) => /enlace/i.test(x)));
});

test('H8 --forzar-existente: lo que el usuario editó en el destino se guarda en .bak antes de reescribir', () => {
  const f = fixture();
  ejecutar(base(f));
  const rel = path.join(f.d, 'Wiki', 'Temas', 'Salud.md');
  writeFileSync(rel, '---\nestado: revisada\n---\nEDITADO por el usuario\n');
  ejecutar(base(f, { forzarExistente: true }));
  const baks = readdirSync(path.join(f.d, 'Wiki', 'Temas')).filter((n) => /^Salud\.md\.bak/.test(n));
  assert.equal(baks.length, 1);
  assert.match(readFileSync(path.join(f.d, 'Wiki', 'Temas', baks[0]), 'utf8'), /EDITADO por el usuario/);
});

test('S1 redactor: un IBAN con el checksum roto (typo) se redacta entero, como antes', () => {
  assert.equal(redactar('ES91 2100 0418 4502 0005 133').texto, '[redactado]');
  assert.equal(redactar('cuenta ES91 2100 0418 4502 0005 133 ok').texto, 'cuenta [redactado] ok');
});

test('S2 migración: un tema no UTF-8 con compartir: hq no entra en la Wiki (no puede saltarse la revisión)', () => {
  const f = fixture((w, o) => {
    mkdirSync(path.join(o, '07 - Temas'), { recursive: true });
    writeFileSync(path.join(o, '07 - Temas', 'Latin.md'), Buffer.from('---\nestado: revisada\ncompartir: hq\n---\nCaf\xe9\n', 'latin1'));
  });
  const inf = ejecutar(base(f));
  assert.ok(!existsSync(path.join(f.d, 'Wiki', 'Temas', 'Latin.md')));
  assert.ok(existsSync(path.join(f.d, 'Notas', 'Sin clasificar', '07 - Temas', 'Latin.md')));
  assert.ok(inf.avisos.some((a) => /Latin/.test(a.rel)));
  assert.equal(inf.verificacion.ok, true);
});
