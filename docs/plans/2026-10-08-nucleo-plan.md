# Project HQ — Núcleo: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un plugin de Claude Code (`project-hq`) que con `/nuevo-proyecto <nombre>` monta repo + Backlog.md + nota en el vault + cuaderno NotebookLM + tablero, y da los comandos `/idea /planificar /ejecutar /revisar /guardar /retomar`, 6 subagentes con modelo explícito y hooks de memoria.

**Architecture:** Lógica en módulos Node ESM sin dependencias (`lib/`), con un *runner* de procesos inyectable para poder testear sin `backlog`/`nlm` reales. Scripts finos (`scripts/`, `hooks/`) llaman a `lib/`. Comandos y agentes son Markdown que invocan esos scripts. Memoria en el vault por ficheros; tareas en el repo del proyecto.

**Tech Stack:** Node 22 (`node:test`, ESM), Backlog.md CLI, `nlm` (gemini-notebook-mcp-cli), Git, plugin de Claude Code.

**Spec:** `docs/specs/2026-10-08-nucleo-design.md` (leer antes de empezar).

## Global Constraints

- Windows 11, Node 22.23, Python 3.12. Sin dependencias npm (solo módulos `node:`). Tests con `node --test`.
- Vault de HQ: `<vaultPath>` (fuera de la nube sincronizada); `vaultProjectsDir` = `Proyectos`. Repos de proyecto en `<projectsRoot>\<slug>`.
- **Nada de HQ en la nube sincronizada.** Al vault solo notas `.md` pequeñas; copias `.bak` en `project-hq\backups\`.
- `CLAUDE.md` de proyecto ≤ 25 líneas. SessionStart inyecta ≤ 1200 caracteres (~300 tokens).
- Cada subagente lleva `model:` explícito: arquitecto=opus, ejecutor=sonnet, revisor=sonnet, explorador=haiku, investigador=sonnet, skill-scout=haiku.
- Cerrar el contrato de nombres: el *slug* (minúsculas, sin acentos, `a-z0-9-`, ≤ 40) es el nombre de carpeta, de nota en el vault y del cuaderno. El nombre original solo se guarda como `display`.
- Un hook nunca rompe la sesión: siempre `exit 0`; los errores van a `logs/hooks.log`.
- La clave de Obsidian REST solo se lee de la variable de entorno `HQ_OBSIDIAN_KEY`. Nunca en ficheros ni en git.
- No instalar nada sin visto bueno del usuario (Task 12 tiene paradas explícitas).
- Todos los commits terminan con la línea `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Desviaciones menores respecto al spec: la lógica va en `lib/` y el CLI del vault es `scripts/vault-cli.mjs` (en vez de `scripts/vault.mjs`). **El MCP de Backlog y el de NotebookLM no se registran** (los agentes usan las CLIs `backlog` y `nlm` por Bash): evita pagar el esquema de herramientas MCP en cada sesión. Es reversible (Task 12, paso opcional).

## Review Focus

Entradas y condiciones que el spec implica pero que no son el camino feliz (cada una tiene su test en la tarea indicada):

1. Nombres con acentos, espacios, mayúsculas, `..` o nombres reservados de Windows (`CON`, `NUL`, `COM1`…) → slug seguro o error claro (Task 2).
2. Rutas con espacios (`<projectsRoot>`) y argumentos con espacios al llamar a `backlog`/`nlm` desde Windows (Task 5).
3. Volver a ejecutar `/nuevo-proyecto` sobre un proyecto existente: no pisa `CLAUDE.md` editado, no recrea cuaderno ni backlog, no duplica la tarjeta "Conectar NotebookLM", mismo puerto (Task 6).
4. Hooks fuera de un proyecto, en una subcarpeta del proyecto, con `registry.json` dañado o con tarjetas con saltos de línea CRLF: silenciosos, `exit 0`, salida ≤ 1200 caracteres (Tasks 7 y 8).
5. `registry.json` corrupto: error claro, copia `.corrupt-*`, nunca se sobrescribe ni se pierde (Task 3). Y un `rel` con `..` en el vault nunca escribe fuera de la carpeta del proyecto (Task 4).

---

## File Structure

```
project-hq/
  package.json  .gitignore  config.json  README.md
  .claude-plugin/plugin.json  .claude-plugin/marketplace.json
  lib/    config.mjs names.mjs dates.mjs registry.mjs templates.mjs vault.mjs
          tools.mjs state.mjs snapshot.mjs hookio.mjs log.mjs checks.mjs
  scripts/ new-project.mjs vault-cli.mjs hq-state.mjs doctor.mjs
  hooks/   hooks.json session-start.mjs pre-compact.mjs stop.mjs
  templates/ CLAUDE.md nota-proyecto.md decision.md sesion.md
  agents/  arquitecto.md ejecutor.md revisor.md explorador.md investigador.md skill-scout.md
  commands/ nuevo-proyecto.md idea.md planificar.md ejecutar.md revisar.md guardar.md retomar.md
  tests/   helpers.mjs *.test.mjs
```
Responsabilidades: `config` carga/valida config; `names` valida y crea slugs; `registry` lista de proyectos y puertos; `templates` renderiza `{{var}}`; `vault` único punto que escribe en el vault; `tools` envuelve `git`/`backlog`/`nlm` y el tablero; `state` construye el contexto de SessionStart; `snapshot` guarda resúmenes automáticos; `hookio`/`log` utilidades de hooks; `checks` diagnóstico.

---

### Task 1: Esqueleto del repo, config y helpers de test

**Files:**
- Create: `package.json`, `.gitignore`, `config.json`, `lib/config.mjs`, `lib/log.mjs`, `lib/dates.mjs`, `.claude-plugin/plugin.json`, `tests/helpers.mjs`, `tests/config.test.mjs`

**Interfaces:**
- Produces: `loadConfig(file?: string): Cfg` donde `Cfg = {vaultPath, projectsRoot, vaultProjectsDir, nlmProfile, basePort, backupsDir, logsDir, registryFile}` (rutas absolutas; el fichero por defecto es `process.env.HQ_CONFIG ?? <HQ_ROOT>/config.json`; `backupsDir`, `logsDir` y `registryFile` se resuelven junto al fichero de config). `HQ_ROOT: string`. `logError(cfg|null, msg: string): void`. `ymd(d: Date): string` (`2026-10-08`), `hm(d: Date): string` (`15:42`). Helpers de test: `tmpDir()`, `makeCfg(root)`, `writeConfigFile(root) -> {file, cfg}`, `fakeRunner(opts) -> run` con `run.calls`.

- [ ] **Step 1: Crear `package.json`, `.gitignore`, `config.json`, `plugin.json`**

`package.json`:
```json
{
  "name": "project-hq",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": { "test": "node --test \"tests/**/*.test.mjs\"" }
}
```
`.gitignore`:
```
node_modules/
backups/
logs/
registry.json
*.tmp
*.corrupt-*
```
`config.json`:
```json
{
  "vaultPath": "C:\\Bovedas\\ProjectHQ",
  "projectsRoot": "<projectsRoot>",
  "vaultProjectsDir": "Proyectos",
  "nlmProfile": "hq",
  "basePort": 6430,
  "backupsDir": "backups"
}
```
`.claude-plugin/plugin.json`:
```json
{
  "name": "project-hq",
  "description": "Project HQ: proyectos con tablero Backlog.md, memoria en Obsidian y NotebookLM, y orquestación Opus/Sonnet/Haiku",
  "version": "0.1.0",
  "author": { "name": "el usuario" }
}
```

- [ ] **Step 2: Escribir helpers de test**

`tests/helpers.mjs`:
```js
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function tmpDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'hq-test-'));
}

export function makeCfg(root) {
  return {
    vaultPath: path.join(root, 'vault'),
    projectsRoot: path.join(root, 'mis proyectos'),
    vaultProjectsDir: 'Proyectos',
    nlmProfile: 'hq',
    basePort: 6430,
    backupsDir: path.join(root, 'backups'),
    logsDir: path.join(root, 'logs'),
    registryFile: path.join(root, 'registry.json'),
  };
}

export function writeConfigFile(root) {
  const cfg = makeCfg(root);
  const file = path.join(root, 'config.json');
  writeFileSync(file, JSON.stringify({
    vaultPath: cfg.vaultPath, projectsRoot: cfg.projectsRoot, vaultProjectsDir: cfg.vaultProjectsDir,
    nlmProfile: 'hq', basePort: 6430, backupsDir: 'backups',
  }));
  return { file, cfg };
}

// Runner falso: registra llamadas y simula los efectos de git/backlog/nlm.
export function fakeRunner({ nlmFails = false } = {}) {
  const calls = [];
  const run = (cmd, args, { cwd } = {}) => {
    calls.push({ cmd, args, cwd });
    if (cmd === 'git' && args[0] === 'init') mkdirSync(path.join(cwd, '.git'), { recursive: true });
    if (cmd === 'git' && args[0] === 'diff') return { status: 0, stdout: ' 2 files changed, 10 insertions(+)\n', stderr: '' };
    if (cmd === 'backlog' && args[0] === 'init') {
      mkdirSync(path.join(cwd, 'backlog', 'tasks'), { recursive: true });
      writeFileSync(path.join(cwd, 'backlog', 'config.yml'),
        'project_name: "x"\nstatuses: ["To Do", "In Progress", "Done"]\ndefault_status: "To Do"\n');
    }
    if (cmd === 'nlm') {
      if (nlmFails) return { status: 1, stdout: '', stderr: 'auth expired' };
      return { status: 0, stdout: '{"id":"11111111-2222-3333-4444-555555555555","title":"x"}', stderr: '' };
    }
    return { status: 0, stdout: '', stderr: '' };
  };
  run.calls = calls;
  return run;
}
```

- [ ] **Step 3: Escribir el test que falla**

`tests/config.test.mjs`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../lib/config.mjs';
import { tmpDir, writeConfigFile } from './helpers.mjs';

test('loadConfig resuelve backups, logs y registry junto al fichero de config', () => {
  const root = tmpDir();
  const { file } = writeConfigFile(root);
  const cfg = loadConfig(file);
  assert.equal(cfg.backupsDir, path.join(root, 'backups'));
  assert.equal(cfg.logsDir, path.join(root, 'logs'));
  assert.equal(cfg.registryFile, path.join(root, 'registry.json'));
  assert.equal(cfg.basePort, 6430);
});

test('loadConfig falla con mensaje claro si falta una clave', () => {
  const root = tmpDir();
  const file = path.join(root, 'config.json');
  writeFileSync(file, JSON.stringify({ projectsRoot: 'x', vaultProjectsDir: 'P', nlmProfile: 'hq', basePort: 6430, backupsDir: 'b' }));
  assert.throws(() => loadConfig(file), /falta "vaultPath"/);
});

test('loadConfig rechaza puertos inválidos', () => {
  const root = tmpDir();
  const { file } = writeConfigFile(root);
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  raw.basePort = 80;
  writeFileSync(file, JSON.stringify(raw));
  assert.throws(() => loadConfig(file), /basePort/);
});

test('loadConfig falla si el fichero no existe', () => {
  assert.throws(() => loadConfig(path.join(tmpDir(), 'nope.json')), /no se pudo leer/);
});

```

- [ ] **Step 4: Ejecutar y ver que falla**

Run: `cd "<repo-project-hq>" && node --test tests/config.test.mjs`
Expected: FAIL (`Cannot find module '../lib/config.mjs'`).

- [ ] **Step 5: Implementar `lib/config.mjs`, `lib/log.mjs`, `lib/dates.mjs`**

`lib/config.mjs`:
```js
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const HQ_ROOT = path.resolve(import.meta.dirname, '..');
const REQUIRED = ['vaultPath', 'projectsRoot', 'vaultProjectsDir', 'nlmProfile', 'basePort', 'backupsDir'];

export function loadConfig(file = process.env.HQ_CONFIG ?? path.join(HQ_ROOT, 'config.json')) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`config: no se pudo leer ${file}: ${e.message}`);
  }
  for (const key of REQUIRED) {
    if (raw[key] === undefined || raw[key] === '') throw new Error(`config: falta "${key}" en ${file}`);
  }
  if (!Number.isInteger(raw.basePort) || raw.basePort < 1024 || raw.basePort > 65000) {
    throw new Error('config: "basePort" debe ser un entero entre 1024 y 65000');
  }
  const dir = path.dirname(file);
  return {
    ...raw,
    backupsDir: path.resolve(dir, raw.backupsDir),
    logsDir: path.resolve(dir, 'logs'),
    registryFile: path.join(dir, 'registry.json'),
  };
}
```
`lib/log.mjs`:
```js
import { appendFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HQ_ROOT } from './config.mjs';

export function logError(cfg, msg) {
  try {
    const dir = cfg?.logsDir ?? path.join(HQ_ROOT, 'logs');
    mkdirSync(dir, { recursive: true });
    appendFileSync(path.join(dir, 'hooks.log'), `${new Date().toISOString()} ${msg}\n`);
  } catch {
    // Último recurso: si ni el log funciona, no romper la sesión.
    process.stderr.write(`[hq] ${msg} (host: ${os.hostname()})\n`);
  }
}
```
`lib/dates.mjs`:
```js
const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
```

- [ ] **Step 6: Ejecutar y ver que pasa**

Run: `node --test tests/config.test.mjs`
Expected: 4 tests PASS.

- [ ] **Step 7: Commit**

```bash
cd "<repo-project-hq>"
git add -A
git commit -m "feat: esqueleto, config y helpers de test" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Validación de nombres y slugs

**Files:**
- Create: `lib/names.mjs`, `tests/names.test.mjs`

**Interfaces:**
- Produces: `slugify(raw: string): string`; `validateName(raw): {ok:true, slug, display} | {ok:false, error}`.

- [ ] **Step 1: Test que falla**

`tests/names.test.mjs`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { slugify, validateName } from '../lib/names.mjs';

test('slugify quita acentos, espacios y mayúsculas', () => {
  assert.equal(slugify('Bot de Telegram'), 'bot-de-telegram');
  assert.equal(slugify('Árduíno ñandú'), 'arduino-nandu');
  assert.equal(slugify('  --Mi_Proyecto!!  '), 'mi-proyecto');
});

test('validateName conserva el nombre original como display', () => {
  const v = validateName('  Bot de Telegram  ');
  assert.deepEqual(v, { ok: true, slug: 'bot-de-telegram', display: 'Bot de Telegram' });
});

test('validateName neutraliza intentos de path traversal', () => {
  const v = validateName('..\\..\\Windows');
  assert.equal(v.ok, true);
  assert.equal(v.slug, 'windows');
});

test('validateName rechaza vacío, solo símbolos, largo y reservados de Windows', () => {
  assert.equal(validateName('').ok, false);
  assert.equal(validateName(undefined).ok, false);
  assert.equal(validateName('!!!').ok, false);
  assert.equal(validateName('a'.repeat(41)).ok, false);
  for (const r of ['CON', 'nul', 'COM1', 'lpt9', 'project-hq']) {
    const v = validateName(r);
    assert.equal(v.ok, false, r);
    assert.match(v.error, /reservado/);
  }
});
```

- [ ] **Step 2: Ejecutar y ver que falla**

Run: `node --test tests/names.test.mjs` → Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implementar `lib/names.mjs`**

```js
const RESERVED = new Set([
  'con', 'prn', 'aux', 'nul', 'project-hq',
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
]);

export function slugify(raw) {
  return String(raw)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function validateName(raw) {
  const slug = slugify(raw ?? '');
  if (!slug) return { ok: false, error: 'El nombre no contiene letras ni números' };
  if (slug.length > 40) return { ok: false, error: 'El nombre es demasiado largo (máx. 40 caracteres)' };
  if (RESERVED.has(slug)) return { ok: false, error: `"${slug}" es un nombre reservado` };
  return { ok: true, slug, display: String(raw).trim() };
}
```

- [ ] **Step 4: Ejecutar y ver que pasa**

Run: `node --test tests/names.test.mjs` → Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/names.mjs tests/names.test.mjs
git commit -m "feat: validacion de nombres y slugs" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Registro de proyectos y puertos

**Files:**
- Create: `lib/registry.mjs`, `tests/registry.test.mjs`

**Interfaces:**
- Produces: `loadRegistry(file): {projects: Project[]}` (fichero ausente → vacío; dañado → copia `.corrupt-<ts>` y lanza), `saveRegistry(file, reg)` (atómico), `allocatePort(reg, basePort): number`, `upsertProject(reg, project): reg`, `findByPath(reg, cwd): Project|null`. `Project = {slug, display, path, port, notebookId, created}`.

- [ ] **Step 1: Test que falla**

`tests/registry.test.mjs`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadRegistry, saveRegistry, allocatePort, upsertProject, findByPath } from '../lib/registry.mjs';
import { tmpDir } from './helpers.mjs';

test('loadRegistry devuelve vacío si no existe y guarda/lee ida y vuelta', () => {
  const file = path.join(tmpDir(), 'registry.json');
  assert.deepEqual(loadRegistry(file), { projects: [] });
  const reg = upsertProject({ projects: [] }, { slug: 'a', port: 6430, path: 'C:\\x\\a' });
  saveRegistry(file, reg);
  assert.equal(loadRegistry(file).projects[0].slug, 'a');
  assert.equal(existsSync(`${file}.tmp`), false);
});

test('registry dañado: lanza, conserva el original y deja copia .corrupt', () => {
  const root = tmpDir();
  const file = path.join(root, 'registry.json');
  writeFileSync(file, '{oops');
  assert.throws(() => loadRegistry(file), /dañado/);
  assert.equal(readFileSync(file, 'utf8'), '{oops');
  assert.ok(readdirSync(root).some((f) => f.startsWith('registry.json.corrupt-')));
});

test('allocatePort devuelve el primer puerto libre desde basePort', () => {
  const reg = { projects: [{ port: 6430 }, { port: 6431 }, { port: 6433 }] };
  assert.equal(allocatePort(reg, 6430), 6432);
  assert.equal(allocatePort({ projects: [] }, 6430), 6430);
});

test('upsertProject reemplaza por slug sin duplicar y conserva el puerto', () => {
  let reg = upsertProject({ projects: [] }, { slug: 'a', port: 6430, notebookId: 'pendiente' });
  reg = upsertProject(reg, { slug: 'a', notebookId: 'abc' });
  assert.equal(reg.projects.length, 1);
  assert.deepEqual([reg.projects[0].port, reg.projects[0].notebookId], [6430, 'abc']);
});

test('findByPath encuentra el proyecto desde subcarpetas, sin confundir prefijos', () => {
  const reg = { projects: [
    { slug: 'demo', path: '<projectsRoot>\\demo' },
    { slug: 'demo-2', path: '<projectsRoot>\\demo-2' },
  ] };
  assert.equal(findByPath(reg, '<projectsRoot>\\demo').slug, 'demo');
  assert.equal(findByPath(reg, 'c:\\PROYECTOS PERSONALES\\demo\\src\\x').slug, 'demo');
  assert.equal(findByPath(reg, '<projectsRoot>\\demo-2\\src').slug, 'demo-2');
  assert.equal(findByPath(reg, '<projectsRoot>\\otro'), null);
  assert.equal(findByPath(reg, ''), null);
});
```

- [ ] **Step 2: Ejecutar y ver que falla**

Run: `node --test tests/registry.test.mjs` → Expected: FAIL.

- [ ] **Step 3: Implementar `lib/registry.mjs`**

```js
import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export function loadRegistry(file) {
  if (!existsSync(file)) return { projects: [] };
  try {
    const reg = JSON.parse(readFileSync(file, 'utf8'));
    if (!Array.isArray(reg.projects)) throw new Error('falta "projects"');
    return reg;
  } catch (e) {
    copyFileSync(file, `${file}.corrupt-${Date.now()}`);
    throw new Error(`registry: ${file} está dañado (${e.message}); copia guardada como .corrupt-*`);
  }
}

export function saveRegistry(file, reg) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(reg, null, 2) + '\n', 'utf8');
  renameSync(tmp, file);
}

export function allocatePort(reg, basePort) {
  const used = new Set(reg.projects.map((p) => p.port));
  let port = basePort;
  while (used.has(port)) port++;
  return port;
}

export function upsertProject(reg, project) {
  const i = reg.projects.findIndex((p) => p.slug === project.slug);
  if (i >= 0) reg.projects[i] = { ...reg.projects[i], ...project };
  else reg.projects.push(project);
  return reg;
}

const norm = (p) => path.resolve(p).toLowerCase();

export function findByPath(reg, cwd) {
  if (!cwd) return null;
  const here = norm(cwd);
  return reg.projects.find((p) => {
    const root = norm(p.path);
    return here === root || here.startsWith(root + path.sep);
  }) ?? null;
}
```
Nota: en Windows `path.resolve('C:\\x')` mantiene la unidad; los tests usan rutas Windows y el proyecto es solo Windows.

- [ ] **Step 4: Ejecutar y ver que pasa**

Run: `node --test tests/registry.test.mjs` → Expected: 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/registry.mjs tests/registry.test.mjs
git commit -m "feat: registro de proyectos y puertos" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Plantillas y escritura segura en el vault

**Files:**
- Create: `lib/templates.mjs`, `lib/vault.mjs`, `templates/CLAUDE.md`, `templates/nota-proyecto.md`, `templates/decision.md`, `templates/sesion.md`, `tests/templates.test.mjs`, `tests/vault.test.mjs`

**Interfaces:**
- Consumes: `Cfg` (Task 1), `slugify` (Task 2), `ymd/hm` (Task 1).
- Produces:
  - `render(tpl: string, vars: object): string` (lanza si falta variable); `loadTemplate(name, dir?)`.
  - `projectDir(cfg, slug): string`
  - `writeNote(cfg, slug, rel, content, {mode: 'create'|'backup'|'replace'}): {written: boolean, path}`
  - `createProjectIndex(cfg, project): {written, path}` con `project = {slug, display, path, port, notebookId}` (usa `Índice.md`, modo `create`)
  - `addDecision(cfg, slug, {title, context, decision, why}, now?): {written, path}`
  - `listDecisions(cfg, slug, n=3): {file, title, date}[]` (más reciente primero; carpeta ausente → `[]`)
  - `writeSession(cfg, slug, {sessionId, activeTask, changes, summary}, now?): {written, path}` (modo `replace`)
  - `lastSession(cfg, slug): string|null` (ruta de la nota más reciente)

- [ ] **Step 1: Crear las plantillas**

`templates/CLAUDE.md`:
```
# {{display}}

Proyecto HQ `{{slug}}` · tablero http://localhost:{{port}} · repo {{repoPath}}

## Reglas
- Tareas: CLI `backlog` (`backlog instructions overview`). Una tarjeta por sesión.
- Al empezar: /retomar. Al terminar: /revisar, /guardar y luego /clear.
- Memoria y decisiones: nota del vault `{{vaultNote}}`. Léela bajo demanda, no entera.
- Documentos largos: pregunta al agente `investigador` (cuaderno NotebookLM `{{notebookId}}`); no los leas.
- Exploración amplia de código: delega en el agente `explorador`.
- Arquitectura: docs/ARQUITECTURA.md.
```
`templates/nota-proyecto.md`:
```
---
tipo: proyecto
proyecto: {{slug}}
estado: idea
repo: {{repoPath}}
notebook: {{notebookId}}
puerto: {{port}}
nivel: 1
creado: {{date}}
---
# {{display}}

## Qué es
Pendiente: ejecuta /idea.

## Enlaces
- Tablero: http://localhost:{{port}}
- Repo: `{{repoPath}}`
- NotebookLM: `{{notebookId}}`

## Decisiones
Ver la carpeta `Decisiones/`.
```
`templates/decision.md`:
```
---
tipo: decision
proyecto: {{slug}}
fecha: {{date}}
---
# {{title}}

**Contexto:** {{context}}

**Decisión:** {{decision}}

**Motivo:** {{why}}
```
`templates/sesion.md`:
```
---
tipo: sesion
proyecto: {{slug}}
fecha: {{date}}
sesion: {{sessionId}}
---
# Sesión {{date}} {{time}}

- Tarjeta activa: {{activeTask}}
- Cambios: {{changes}}

## Resumen
{{summary}}
```

- [ ] **Step 2: Tests que fallan**

`tests/templates.test.mjs`:
```js
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
```
`tests/vault.test.mjs`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { projectDir, writeNote, createProjectIndex, addDecision, listDecisions, writeSession, lastSession } from '../lib/vault.mjs';
import { makeCfg, tmpDir } from './helpers.mjs';

const project = { slug: 'demo', display: 'Demo', path: 'C:\\x\\demo', port: 6430, notebookId: 'nb1' };

test('createProjectIndex crea la nota con frontmatter y no pisa ediciones del usuario', () => {
  const cfg = makeCfg(tmpDir());
  const a = createProjectIndex(cfg, project);
  assert.equal(a.written, true);
  assert.match(readFileSync(a.path, 'utf8'), /proyecto: demo/);
  writeFileSync(a.path, 'editado por el usuario');
  const b = createProjectIndex(cfg, project);
  assert.equal(b.written, false);
  assert.equal(readFileSync(a.path, 'utf8'), 'editado por el usuario');
});

test('writeNote nunca escribe fuera de la carpeta del proyecto', () => {
  const cfg = makeCfg(tmpDir());
  assert.throws(() => writeNote(cfg, 'demo', '../evil.md', 'x'), /fuera del proyecto/);
  assert.throws(() => writeNote(cfg, 'demo', '..\\..\\evil.md', 'x'), /fuera del proyecto/);
  assert.throws(() => writeNote(cfg, 'demo', 'C:\\evil.md', 'x'), /fuera del proyecto/);
  assert.throws(() => writeNote(cfg, '../demo', 'a.md', 'x'), /slug inválido/);
});

test('writeNote en modo backup copia el original a backupsDir', () => {
  const cfg = makeCfg(tmpDir());
  writeNote(cfg, 'demo', 'N.md', 'v1');
  writeNote(cfg, 'demo', 'N.md', 'v2', { mode: 'backup' });
  assert.equal(readFileSync(path.join(projectDir(cfg, 'demo'), 'N.md'), 'utf8'), 'v2');
  const baks = readdirSync(path.join(cfg.backupsDir, 'demo'));
  assert.equal(baks.length, 1);
  assert.match(baks[0], /N\.md\.bak$/);
});

test('writeNote rechaza modos desconocidos', () => {
  const cfg = makeCfg(tmpDir());
  assert.throws(() => writeNote(cfg, 'demo', 'N.md', 'x', { mode: 'raro' }), /modo/);
});

test('decisiones: la más reciente primero, con título; carpeta ausente → []', () => {
  const cfg = makeCfg(tmpDir());
  assert.deepEqual(listDecisions(cfg, 'demo'), []);
  addDecision(cfg, 'demo', { title: 'Usar SQLite', context: 'c', decision: 'd', why: 'w' }, new Date(2026, 9, 1));
  addDecision(cfg, 'demo', { title: 'Sin framework', context: 'c', decision: 'd', why: 'w' }, new Date(2026, 9, 5));
  const list = listDecisions(cfg, 'demo', 3);
  assert.deepEqual(list.map((d) => d.title), ['Sin framework', 'Usar SQLite']);
  assert.equal(list[0].date, '2026-10-05');
});

test('addDecision exige todos los campos', () => {
  const cfg = makeCfg(tmpDir());
  assert.throws(() => addDecision(cfg, 'demo', { title: 'x' }), /context/);
});

test('writeSession reemplaza la misma sesión sin crear duplicados y lastSession la encuentra', () => {
  const cfg = makeCfg(tmpDir());
  const now = new Date(2026, 9, 8, 15, 42);
  writeSession(cfg, 'demo', { sessionId: 'abc12345', activeTask: 'T1', changes: 'n', summary: 'uno' }, now);
  writeSession(cfg, 'demo', { sessionId: 'abc12345', activeTask: 'T1', changes: 'n', summary: 'dos' }, now);
  const dir = path.join(projectDir(cfg, 'demo'), 'Sesiones');
  assert.equal(readdirSync(dir).length, 1);
  assert.match(readFileSync(path.join(dir, readdirSync(dir)[0]), 'utf8'), /dos/);
  assert.equal(existsSync(lastSession(cfg, 'demo')), true);
  assert.equal(lastSession(makeCfg(tmpDir()), 'otro'), null);
});
```

- [ ] **Step 3: Ejecutar y ver que fallan**

Run: `node --test tests/templates.test.mjs tests/vault.test.mjs` → Expected: FAIL (módulos no existen).

- [ ] **Step 4: Implementar `lib/templates.mjs` y `lib/vault.mjs`**

`lib/templates.mjs`:
```js
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { HQ_ROOT } from './config.mjs';

export function render(tpl, vars) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    if (!(k in vars)) throw new Error(`plantilla: falta la variable "${k}"`);
    return String(vars[k]);
  });
}

export function loadTemplate(name, dir = path.join(HQ_ROOT, 'templates')) {
  return readFileSync(path.join(dir, name), 'utf8');
}
```
`lib/vault.mjs`:
```js
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { hm, ymd } from './dates.mjs';
import { slugify } from './names.mjs';
import { loadTemplate, render } from './templates.mjs';

const SLUG_RE = /^[a-z0-9-]+$/;
const MODES = new Set(['create', 'backup', 'replace']);

export const projectDir = (cfg, slug) => path.join(cfg.vaultPath, cfg.vaultProjectsDir, slug);

function resolveInside(cfg, slug, rel) {
  if (!SLUG_RE.test(slug)) throw new Error(`vault: slug inválido: ${slug}`);
  const base = projectDir(cfg, slug);
  const full = path.resolve(base, rel);
  if (full !== base && !full.startsWith(base + path.sep)) throw new Error(`vault: ruta fuera del proyecto: ${rel}`);
  return full;
}

export function writeNote(cfg, slug, rel, content, { mode = 'create' } = {}) {
  if (!MODES.has(mode)) throw new Error(`vault: modo desconocido: ${mode}`);
  const full = resolveInside(cfg, slug, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  if (existsSync(full)) {
    if (mode === 'create') return { written: false, path: full };
    if (mode === 'backup') {
      const dir = path.join(cfg.backupsDir, slug);
      mkdirSync(dir, { recursive: true });
      copyFileSync(full, path.join(dir, `${Date.now()}-${path.basename(full)}.bak`));
    }
  }
  writeFileSync(full, content, 'utf8');
  return { written: true, path: full };
}

export function createProjectIndex(cfg, project, now = new Date()) {
  const content = render(loadTemplate('nota-proyecto.md'), {
    slug: project.slug, display: project.display, repoPath: project.path,
    port: project.port, notebookId: project.notebookId, date: ymd(now),
  });
  return writeNote(cfg, project.slug, 'Índice.md', content, { mode: 'create' });
}

export function addDecision(cfg, slug, d, now = new Date()) {
  for (const k of ['title', 'context', 'decision', 'why']) {
    if (typeof d?.[k] !== 'string' || !d[k].trim()) throw new Error(`decisión: falta el campo "${k}"`);
  }
  const content = render(loadTemplate('decision.md'), { slug, date: ymd(now), ...d });
  const name = `${ymd(now)}-${slugify(d.title) || 'decision'}.md`;
  return writeNote(cfg, slug, `Decisiones/${name}`, content, { mode: 'create' });
}

export function listDecisions(cfg, slug, n = 3) {
  const dir = path.join(projectDir(cfg, slug), 'Decisiones');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .reverse()
    .slice(0, n)
    .map((file) => {
      const text = readFileSync(path.join(dir, file), 'utf8');
      const title = text.match(/^# (.+)$/m)?.[1]?.trim() ?? file;
      return { file, title, date: file.slice(0, 10) };
    });
}

export function writeSession(cfg, slug, s, now = new Date()) {
  const content = render(loadTemplate('sesion.md'), {
    slug, date: ymd(now), time: hm(now), sessionId: s.sessionId,
    activeTask: s.activeTask, changes: s.changes, summary: s.summary,
  });
  return writeNote(cfg, slug, `Sesiones/${ymd(now)}-${s.sessionId}.md`, content, { mode: 'replace' });
}

export function lastSession(cfg, slug) {
  const dir = path.join(projectDir(cfg, slug), 'Sesiones');
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
  return files.length ? path.join(dir, files[files.length - 1]) : null;
}
```

- [ ] **Step 5: Ejecutar y ver que pasan**

Run: `node --test tests/templates.test.mjs tests/vault.test.mjs` → Expected: 9 PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/templates.mjs lib/vault.mjs templates tests/templates.test.mjs tests/vault.test.mjs
git commit -m "feat: plantillas y escritura segura en el vault" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Adaptador de herramientas externas (git, backlog, nlm, tablero)

**Files:**
- Create: `lib/tools.mjs`, `tests/tools.test.mjs`

**Interfaces:**
- Produces:
  - `quoteArg(a: string): string`
  - `realRunner(cmd, args, {cwd}): {status, stdout, stderr}` (en Windows ejecuta una cadena con shell y argumentos citados; en otros SO sin shell)
  - `STATUSES = ['Ideas','Planificado','En curso','Verificando','Hecho']`
  - `gitInit(run, dir): {skipped}`; `backlogInit(run, dir, slug, port): {skipped}`; `setStatuses(dir, statuses=STATUSES): void`; `createNotebook(run, slug, profile): string`; `extractNotebookId(stdout): string`; `createTask(run, dir, title, description): boolean`
  - `isPortOpen(port, host?, timeout?): Promise<boolean>`; `startBoard(dir, port): Promise<{started}>`; `openUrl(url): void`
- Todas las funciones que ejecutan procesos reciben `run` por parámetro (inyectable).

- [ ] **Step 1: Test que falla**

`tests/tools.test.mjs`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { quoteArg, extractNotebookId, setStatuses, backlogInit, gitInit, createNotebook, createTask, isPortOpen, STATUSES } from '../lib/tools.mjs';
import { fakeRunner, tmpDir } from './helpers.mjs';

test('quoteArg cita argumentos con espacios y escapa comillas, sin tocar los simples', () => {
  assert.equal(quoteArg('--json'), '--json');
  assert.equal(quoteArg('Conectar NotebookLM'), '"Conectar NotebookLM"');
  assert.equal(quoteArg('di "hola"'), '"di \\"hola\\""');
  assert.equal(quoteArg(''), '""');
});

test('extractNotebookId entiende JSON plano, anidado y texto con UUID', () => {
  assert.equal(extractNotebookId('{"id":"abc"}'), 'abc');
  assert.equal(extractNotebookId('{"notebook":{"notebook_id":"n-9"}}'), 'n-9');
  assert.equal(extractNotebookId('Notebook Created\nID: 11111111-2222-3333-4444-555555555555\n'), '11111111-2222-3333-4444-555555555555');
  assert.throws(() => extractNotebookId('nada util'), /no se encontró el ID/);
});

test('setStatuses reemplaza las claves existentes y las añade si faltan', () => {
  const dir = tmpDir();
  mkdirSync(path.join(dir, 'backlog'));
  const cfg = path.join(dir, 'backlog', 'config.yml');
  writeFileSync(cfg, 'project_name: "x"\nstatuses: ["To Do", "Done"]\ndefault_status: "To Do"\n');
  setStatuses(dir);
  let t = readFileSync(cfg, 'utf8');
  assert.match(t, /^statuses: \["Ideas","Planificado","En curso","Verificando","Hecho"\]$/m);
  assert.match(t, /^default_status: "Ideas"$/m);
  assert.equal((t.match(/^statuses:/gm) ?? []).length, 1);
  writeFileSync(cfg, 'project_name: "x"\n');
  setStatuses(dir);
  t = readFileSync(cfg, 'utf8');
  assert.match(t, /statuses: \[/);
  assert.match(t, /default_status: "Ideas"/);
});

test('setStatuses falla con mensaje claro si no hay config de backlog', () => {
  assert.throws(() => setStatuses(tmpDir()), /config.yml/);
});

test('backlogInit usa los flags correctos y es idempotente', () => {
  const dir = tmpDir();
  const run = fakeRunner();
  assert.deepEqual(backlogInit(run, dir, 'demo', 6431), { skipped: false });
  assert.deepEqual(run.calls[0].args, [
    'init', 'demo', '--defaults', '--integration-mode', 'cli', '--agent-instructions', 'none',
    '--web-port', '6431', '--auto-open-browser', 'false',
  ]);
  assert.deepEqual(backlogInit(run, dir, 'demo', 6431), { skipped: true });
  assert.equal(run.calls.length, 1);
});

test('gitInit es idempotente', () => {
  const dir = tmpDir();
  const run = fakeRunner();
  assert.equal(gitInit(run, dir).skipped, false);
  assert.equal(gitInit(run, dir).skipped, true);
});

test('createNotebook pasa el perfil y devuelve el ID; si nlm falla, lanza con el stderr', () => {
  const run = fakeRunner();
  assert.equal(createNotebook(run, 'demo', 'hq'), '11111111-2222-3333-4444-555555555555');
  assert.deepEqual(run.calls[0].args, ['notebook', 'create', 'demo', '--json', '--profile', 'hq']);
  assert.throws(() => createNotebook(fakeRunner({ nlmFails: true }), 'demo', 'hq'), /auth expired/);
});

test('createTask devuelve false (sin lanzar) si backlog falla', () => {
  const ok = (cmd, args) => ({ status: 0, stdout: '', stderr: '' });
  const bad = () => ({ status: 1, stdout: '', stderr: 'boom' });
  assert.equal(createTask(ok, tmpDir(), 'Conectar NotebookLM', 'desc'), true);
  assert.equal(createTask(bad, tmpDir(), 'Conectar NotebookLM', 'desc'), false);
});

test('isPortOpen detecta un servidor local y un puerto cerrado', async () => {
  const server = net.createServer().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const { port } = server.address();
  assert.equal(await isPortOpen(port), true);
  await new Promise((r) => server.close(r));
  assert.equal(await isPortOpen(port), false);
});

test('STATUSES tiene las 5 columnas en orden', () => {
  assert.deepEqual(STATUSES, ['Ideas', 'Planificado', 'En curso', 'Verificando', 'Hecho']);
});
```

- [ ] **Step 2: Ejecutar y ver que falla**

Run: `node --test tests/tools.test.mjs` → Expected: FAIL.

- [ ] **Step 3: Implementar `lib/tools.mjs`**

```js
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';

export const STATUSES = ['Ideas', 'Planificado', 'En curso', 'Verificando', 'Hecho'];
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export function quoteArg(a) {
  if (a === '') return '""';
  return /[\s"&|<>^%]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a;
}

// En Windows backlog/nlm son shims .cmd: hace falta shell, y con shell hay que citar los argumentos.
export function realRunner(cmd, args, { cwd } = {}) {
  const r = process.platform === 'win32'
    ? spawnSync([cmd, ...args.map(quoteArg)].join(' '), { cwd, encoding: 'utf8', shell: true, windowsHide: true })
    : spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr || r.error?.message || '' };
}

function must(r, what) {
  if (r.status !== 0) throw new Error(`${what} falló: ${(r.stderr || r.stdout).trim().slice(0, 300)}`);
  return r;
}

export function gitInit(run, dir) {
  if (existsSync(path.join(dir, '.git'))) return { skipped: true };
  must(run('git', ['init'], { cwd: dir }), 'git init');
  return { skipped: false };
}

export function backlogInit(run, dir, slug, port) {
  if (existsSync(path.join(dir, 'backlog'))) return { skipped: true };
  must(run('backlog', [
    'init', slug, '--defaults', '--integration-mode', 'cli', '--agent-instructions', 'none',
    '--web-port', String(port), '--auto-open-browser', 'false',
  ], { cwd: dir }), 'backlog init');
  return { skipped: false };
}

function setYamlLine(text, key, line) {
  const re = new RegExp(`^${key}:.*$`, 'm');
  if (re.test(text)) return text.replace(re, line);
  return text.replace(/\n*$/, '\n') + line + '\n';
}

export function setStatuses(dir, statuses = STATUSES) {
  const file = path.join(dir, 'backlog', 'config.yml');
  if (!existsSync(file)) throw new Error(`backlog: no existe ${file} (¿falló backlog init?)`);
  let text = readFileSync(file, 'utf8');
  text = setYamlLine(text, 'statuses', `statuses: ${JSON.stringify(statuses)}`);
  text = setYamlLine(text, 'default_status', `default_status: ${JSON.stringify(statuses[0])}`);
  writeFileSync(file, text, 'utf8');
}

function findId(v, depth = 0) {
  if (!v || typeof v !== 'object' || depth > 3) return null;
  for (const k of ['id', 'notebook_id', 'notebookId']) if (typeof v[k] === 'string' && v[k]) return v[k];
  for (const child of Object.values(v)) {
    const f = findId(child, depth + 1);
    if (f) return f;
  }
  return null;
}

export function extractNotebookId(stdout) {
  try {
    const id = findId(JSON.parse(stdout));
    if (id) return id;
  } catch {
    // no era JSON: se intenta con el UUID del texto
  }
  const m = stdout.match(UUID);
  if (m) return m[0];
  throw new Error(`nlm: no se encontró el ID del cuaderno en la salida: ${stdout.slice(0, 200)}`);
}

export function createNotebook(run, slug, profile) {
  const r = must(run('nlm', ['notebook', 'create', slug, '--json', '--profile', profile]), 'nlm notebook create');
  return extractNotebookId(r.stdout);
}

export function createTask(run, dir, title, description) {
  return run('backlog', ['task', 'create', title, '-d', description], { cwd: dir }).status === 0;
}

export function isPortOpen(port, host = '127.0.0.1', timeout = 500) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host });
    const done = (ok) => { s.destroy(); resolve(ok); };
    s.setTimeout(timeout, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}

export async function startBoard(dir, port) {
  if (await isPortOpen(port)) return { started: false };
  const child = spawn('backlog', ['browser', '--port', String(port), '--no-open'], {
    cwd: dir, detached: true, stdio: 'ignore', shell: process.platform === 'win32', windowsHide: true,
  });
  child.unref();
  return { started: true };
}

export function openUrl(url) {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}
```

- [ ] **Step 4: Ejecutar y ver que pasa**

Run: `node --test tests/tools.test.mjs` → Expected: 10 PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/tools.mjs tests/tools.test.mjs
git commit -m "feat: adaptador de git, backlog, nlm y tablero" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Orquestador `/nuevo-proyecto` (`scripts/new-project.mjs`)

**Files:**
- Create: `scripts/new-project.mjs`, `tests/new-project.test.mjs`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: `newProject({name, cfg, run?, now?, board?, open?}): Promise<{slug, repo, port, notebookId, url, steps: {step, status: 'ok'|'skipped'|'failed', detail}[]}>`. CLI: `node scripts/new-project.mjs <nombre...>` imprime una línea por paso y `Tablero: <url>`. Solo NotebookLM y el tablero pueden quedar en `failed` sin abortar; el resto lanza.

- [ ] **Step 1: Test que falla**

`tests/new-project.test.mjs`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { newProject } from '../scripts/new-project.mjs';
import { loadRegistry } from '../lib/registry.mjs';
import { fakeRunner, makeCfg, tmpDir } from './helpers.mjs';

const stubs = () => {
  const s = { boards: [], opened: [] };
  s.board = async (dir, port) => { s.boards.push([dir, port]); return { started: true }; };
  s.open = (url) => s.opened.push(url);
  return s;
};

test('crea repo, backlog con 5 columnas, CLAUDE.md, nota de vault, registro y abre el tablero', async () => {
  const cfg = makeCfg(tmpDir());
  const run = fakeRunner();
  const s = stubs();
  const r = await newProject({ name: 'Bot de Telegram', cfg, run, board: s.board, open: s.open });
  assert.equal(r.slug, 'bot-de-telegram');
  assert.equal(r.repo, path.join(cfg.projectsRoot, 'bot-de-telegram'));
  assert.equal(r.port, 6430);
  assert.equal(r.url, 'http://localhost:6430');
  assert.ok(r.steps.every((x) => x.status === 'ok'), JSON.stringify(r.steps));
  assert.match(readFileSync(path.join(r.repo, 'backlog', 'config.yml'), 'utf8'), /"Verificando"/);
  const claude = readFileSync(path.join(r.repo, 'CLAUDE.md'), 'utf8');
  assert.ok(claude.split('\n').length <= 26);
  assert.match(claude, /11111111-2222-3333-4444-555555555555/);
  assert.equal(JSON.parse(readFileSync(path.join(r.repo, '.hq', 'project.json'), 'utf8')).slug, 'bot-de-telegram');
  assert.ok(existsSync(path.join(cfg.vaultPath, 'Proyectos', 'bot-de-telegram', 'Índice.md')));
  assert.equal(loadRegistry(cfg.registryFile).projects[0].display, 'Bot de Telegram');
  assert.deepEqual(s.opened, ['http://localhost:6430']);
  assert.deepEqual(s.boards[0], [r.repo, 6430]);
});

test('dos proyectos reciben puertos distintos', async () => {
  const cfg = makeCfg(tmpDir());
  const run = fakeRunner();
  const s = stubs();
  const a = await newProject({ name: 'uno', cfg, run, board: s.board, open: s.open });
  const b = await newProject({ name: 'dos', cfg, run, board: s.board, open: s.open });
  assert.deepEqual([a.port, b.port], [6430, 6431]);
});

test('volver a ejecutar es idempotente: no recrea nada ni pisa CLAUDE.md editado', async () => {
  const cfg = makeCfg(tmpDir());
  const run = fakeRunner();
  const s = stubs();
  const a = await newProject({ name: 'demo', cfg, run, board: s.board, open: s.open });
  writeFileSync(path.join(a.repo, 'CLAUDE.md'), 'editado');
  const before = run.calls.length;
  const b = await newProject({ name: 'demo', cfg, run, board: s.board, open: s.open });
  assert.equal(b.port, a.port);
  assert.equal(b.notebookId, a.notebookId);
  assert.equal(readFileSync(path.join(a.repo, 'CLAUDE.md'), 'utf8'), 'editado');
  const newCalls = run.calls.slice(before).filter((c) => (c.cmd === 'nlm') || (c.cmd === 'backlog' && c.args[0] === 'init') || (c.cmd === 'git' && c.args[0] === 'init'));
  assert.deepEqual(newCalls, []);
  assert.equal(loadRegistry(cfg.registryFile).projects.length, 1);
});

test('si NotebookLM falla, el resto sigue, notebookId=pendiente y la tarjeta se crea una sola vez', async () => {
  const cfg = makeCfg(tmpDir());
  const run = fakeRunner({ nlmFails: true });
  const s = stubs();
  const a = await newProject({ name: 'demo', cfg, run, board: s.board, open: s.open });
  assert.equal(a.notebookId, 'pendiente');
  assert.equal(a.steps.find((x) => x.step === 'notebooklm').status, 'failed');
  assert.ok(a.steps.filter((x) => x.step !== 'notebooklm').every((x) => x.status === 'ok'));
  await newProject({ name: 'demo', cfg, run, board: s.board, open: s.open });
  const taskCreates = run.calls.filter((c) => c.cmd === 'backlog' && c.args[0] === 'task');
  assert.equal(taskCreates.length, 1);
  assert.equal(taskCreates[0].args[2], 'Conectar NotebookLM');
});

test('si el tablero no arranca, el proyecto se crea igualmente', async () => {
  const cfg = makeCfg(tmpDir());
  const r = await newProject({ name: 'demo', cfg, run: fakeRunner(), board: async () => { throw new Error('puerto ocupado'); }, open: () => {} });
  assert.equal(r.steps.find((x) => x.step === 'tablero').status, 'failed');
  assert.ok(existsSync(path.join(r.repo, 'backlog')));
});

test('nombre inválido lanza antes de crear nada', async () => {
  const cfg = makeCfg(tmpDir());
  await assert.rejects(() => newProject({ name: 'CON', cfg, run: fakeRunner() }), /reservado/);
  assert.equal(existsSync(cfg.projectsRoot), false);
});
```

- [ ] **Step 2: Ejecutar y ver que falla**

Run: `node --test tests/new-project.test.mjs` → Expected: FAIL.

- [ ] **Step 3: Implementar `scripts/new-project.mjs`**

```js
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ymd } from '../lib/dates.mjs';
import { loadConfig } from '../lib/config.mjs';
import { validateName } from '../lib/names.mjs';
import { allocatePort, loadRegistry, saveRegistry, upsertProject } from '../lib/registry.mjs';
import { loadTemplate, render } from '../lib/templates.mjs';
import * as tools from '../lib/tools.mjs';
import { createProjectIndex } from '../lib/vault.mjs';

export async function newProject({ name, cfg, run = tools.realRunner, now = new Date(), board = tools.startBoard, open = tools.openUrl }) {
  const v = validateName(name);
  if (!v.ok) throw new Error(v.error);
  const { slug, display } = v;
  const steps = [];
  const step = (s, status, detail = '') => steps.push({ step: s, status, detail });

  const repo = path.join(cfg.projectsRoot, slug);
  mkdirSync(repo, { recursive: true });

  const reg = loadRegistry(cfg.registryFile);
  const known = reg.projects.find((p) => p.slug === slug);
  const port = known?.port ?? allocatePort(reg, cfg.basePort);
  const hqFile = path.join(repo, '.hq', 'project.json');
  const prev = existsSync(hqFile) ? JSON.parse(readFileSync(hqFile, 'utf8')) : {};

  step('git', tools.gitInit(run, repo).skipped ? 'skipped' : 'ok');
  step('backlog', tools.backlogInit(run, repo, slug, port).skipped ? 'skipped' : 'ok');
  tools.setStatuses(repo);
  step('columnas', 'ok', tools.STATUSES.join(' → '));

  let notebookId = prev.notebookId && prev.notebookId !== 'pendiente' ? prev.notebookId : null;
  if (notebookId) {
    step('notebooklm', 'skipped', notebookId);
  } else {
    try {
      notebookId = tools.createNotebook(run, slug, cfg.nlmProfile);
      step('notebooklm', 'ok', notebookId);
    } catch (e) {
      notebookId = 'pendiente';
      step('notebooklm', 'failed', e.message);
      if (prev.notebookId !== 'pendiente') {
        tools.createTask(run, repo, 'Conectar NotebookLM',
          `Ejecutar nlm login --profile ${cfg.nlmProfile}, crear el cuaderno y actualizar notebookId en .hq/project.json`);
      }
    }
  }

  const vaultNote = path.join(cfg.vaultProjectsDir, slug, 'Índice.md');
  mkdirSync(path.dirname(hqFile), { recursive: true });
  writeFileSync(hqFile, JSON.stringify({
    slug, display, port, notebookId, vaultNote, created: prev.created ?? ymd(now),
  }, null, 2) + '\n', 'utf8');

  const claudeFile = path.join(repo, 'CLAUDE.md');
  if (!existsSync(claudeFile)) {
    writeFileSync(claudeFile, render(loadTemplate('CLAUDE.md'), {
      display, slug, port, repoPath: repo, vaultNote, notebookId,
    }), 'utf8');
  }
  const archFile = path.join(repo, 'docs', 'ARQUITECTURA.md');
  if (!existsSync(archFile)) {
    mkdirSync(path.dirname(archFile), { recursive: true });
    writeFileSync(archFile, `# Arquitectura de ${display}\n\nPendiente: ejecuta /planificar.\n`, 'utf8');
  }
  step('archivos', 'ok', 'CLAUDE.md, docs/ARQUITECTURA.md, .hq/project.json');

  const idx = createProjectIndex(cfg, { slug, display, path: repo, port, notebookId }, now);
  step('vault', idx.written ? 'ok' : 'skipped', idx.path);

  upsertProject(reg, { slug, display, path: repo, port, notebookId, created: prev.created ?? ymd(now) });
  saveRegistry(cfg.registryFile, reg);
  step('registro', 'ok');

  const url = `http://localhost:${port}`;
  try {
    await board(repo, port);
    open(url);
    step('tablero', 'ok', url);
  } catch (e) {
    step('tablero', 'failed', e.message);
  }
  return { slug, repo, port, notebookId, url, steps };
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  try {
    const report = await newProject({ name: process.argv.slice(2).join(' '), cfg: loadConfig() });
    const icon = { ok: '✓', skipped: '·', failed: '✗' };
    for (const s of report.steps) console.log(`${icon[s.status]} ${s.step}${s.detail ? ' — ' + s.detail : ''}`);
    console.log(`Tablero: ${report.url}\nRepo: ${report.repo}`);
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
}
```

- [ ] **Step 4: Ejecutar y ver que pasa**

Run: `node --test tests/new-project.test.mjs` → Expected: 6 PASS.
Si "idempotente" falla por el orden de las llamadas, no relajes el test: corrige la lógica de `newProject`.

- [ ] **Step 5: Commit**

```bash
git add scripts/new-project.mjs tests/new-project.test.mjs
git commit -m "feat: orquestador de /nuevo-proyecto" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Estado del proyecto y hook SessionStart

**Files:**
- Create: `lib/state.mjs`, `lib/hookio.mjs`, `hooks/session-start.mjs`, `scripts/hq-state.mjs`, `tests/state.test.mjs`, `tests/hooks.test.mjs`

**Interfaces:**
- Consumes: `findByPath`, `projectDir`, `listDecisions`, `lastSession`, `loadConfig`, `loadRegistry`, `logError`.
- Produces: `parseFrontmatter(text): {data, body}`; `activeTasks(repoPath): {id, title}[]` (columna "En curso"); `buildSessionContext(cfg, reg, cwd): string|null` (≤ 1200 caracteres); `readHookInput(): Promise<object>`; `contextOutput(eventName, text): string`.
- CLI `scripts/hq-state.mjs`: imprime el contexto del proyecto del cwd más `Índice: <ruta>` y `Última sesión: <ruta>`; fuera de proyecto imprime `No estás dentro de un proyecto HQ.`

- [ ] **Step 1: Tests que fallan**

`tests/state.test.mjs`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseFrontmatter, activeTasks, buildSessionContext } from '../lib/state.mjs';
import { addDecision, createProjectIndex } from '../lib/vault.mjs';
import { makeCfg, tmpDir } from './helpers.mjs';

function setup() {
  const root = tmpDir();
  const cfg = makeCfg(root);
  const repo = path.join(root, 'mis proyectos', 'demo');
  mkdirSync(path.join(repo, 'backlog', 'tasks'), { recursive: true });
  const project = { slug: 'demo', display: 'Demo', path: repo, port: 6430, notebookId: 'nb' };
  createProjectIndex(cfg, project);
  return { cfg, repo, reg: { projects: [project] } };
}

test('parseFrontmatter lee claves, quita comillas y tolera CRLF y BOM', () => {
  const { data, body } = parseFrontmatter('\uFEFF---\r\nid: task-1\r\ntitle: "Hola mundo"\r\n---\r\ncuerpo');
  assert.deepEqual(data, { id: 'task-1', title: 'Hola mundo' });
  assert.equal(body, 'cuerpo');
  assert.deepEqual(parseFrontmatter('sin frontmatter').data, {});
});

test('activeTasks devuelve solo las tarjetas En curso (también con CRLF)', () => {
  const { repo } = setup();
  const t = path.join(repo, 'backlog', 'tasks');
  writeFileSync(path.join(t, 'task-1 - A.md'), '---\nid: task-1\ntitle: A\nstatus: En curso\n---\n');
  writeFileSync(path.join(t, 'task-2 - B.md'), '---\r\nid: task-2\r\ntitle: B\r\nstatus: En curso\r\n---\r\n');
  writeFileSync(path.join(t, 'task-3 - C.md'), '---\nid: task-3\ntitle: C\nstatus: Hecho\n---\n');
  assert.deepEqual(activeTasks(repo).map((x) => x.id).sort(), ['task-1', 'task-2']);
  assert.deepEqual(activeTasks(path.join(repo, 'no-existe')), []);
});

test('buildSessionContext: null fuera de proyecto; con proyecto incluye estado, tarjeta y decisiones', () => {
  const { cfg, repo, reg } = setup();
  assert.equal(buildSessionContext(cfg, reg, path.join(repo, '..', 'otro')), null);
  writeFileSync(path.join(repo, 'backlog', 'tasks', 'task-1 - A.md'), '---\nid: task-1\ntitle: Parser\nstatus: En curso\n---\n');
  addDecision(cfg, 'demo', { title: 'Usar SQLite', context: 'c', decision: 'd', why: 'w' }, new Date(2026, 9, 1));
  const text = buildSessionContext(cfg, reg, path.join(repo, 'src'));
  assert.match(text, /\[Project HQ\] Demo \(demo\) · estado: idea/);
  assert.match(text, /Tarjeta activa: task-1 Parser/);
  assert.match(text, /2026-10-01 Usar SQLite/);
  assert.match(text, /localhost:6430/);
});

test('buildSessionContext nunca supera 1200 caracteres', () => {
  const { cfg, repo, reg } = setup();
  const long = 'x'.repeat(400);
  for (let i = 1; i <= 5; i++) {
    writeFileSync(path.join(repo, 'backlog', 'tasks', `task-${i}.md`), `---\nid: task-${i}\ntitle: ${long}\nstatus: En curso\n---\n`);
    addDecision(cfg, 'demo', { title: long + i, context: 'c', decision: 'd', why: 'w' }, new Date(2026, 9, i));
  }
  const text = buildSessionContext(cfg, reg, repo);
  assert.ok(text.length <= 1200, `longitud ${text.length}`);
});
```
`tests/hooks.test.mjs`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { HQ_ROOT } from '../lib/config.mjs';
import { saveRegistry } from '../lib/registry.mjs';
import { tmpDir, writeConfigFile } from './helpers.mjs';

function env() {
  const root = tmpDir();
  const { file, cfg } = writeConfigFile(root);
  const repo = path.join(root, 'mis proyectos', 'demo');
  mkdirSync(path.join(repo, 'src'), { recursive: true });
  saveRegistry(cfg.registryFile, { projects: [{ slug: 'demo', display: 'Demo', path: repo, port: 6430 }] });
  return { root, file, cfg, repo };
}
function runHook(name, e, input) {
  return spawnSync(process.execPath, [path.join(HQ_ROOT, 'hooks', name)], {
    input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, HQ_CONFIG: e.file },
  });
}

test('SessionStart dentro de una subcarpeta del proyecto inyecta contexto', () => {
  const e = env();
  const r = runHook('session-start.mjs', e, { cwd: path.join(e.repo, 'src'), hook_event_name: 'SessionStart' });
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(out.hookSpecificOutput.additionalContext, /\[Project HQ\] Demo/);
});

test('SessionStart fuera de un proyecto no imprime nada y sale con 0', () => {
  const e = env();
  const r = runHook('session-start.mjs', e, { cwd: e.root });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('SessionStart con registry dañado: exit 0, sin salida y error en el log', () => {
  const e = env();
  writeFileSync(e.cfg.registryFile, '{oops');
  const r = runHook('session-start.mjs', e, { cwd: e.repo });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.match(readFileSync(path.join(e.cfg.logsDir, 'hooks.log'), 'utf8'), /registry/);
});

test('SessionStart con stdin vacío o inválido no rompe', () => {
  const e = env();
  const r = spawnSync(process.execPath, [path.join(HQ_ROOT, 'hooks', 'session-start.mjs')], {
    input: 'esto no es json', encoding: 'utf8', env: { ...process.env, HQ_CONFIG: e.file },
  });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});
```

- [ ] **Step 2: Ejecutar y ver que fallan**

Run: `node --test tests/state.test.mjs tests/hooks.test.mjs` → Expected: FAIL.

- [ ] **Step 3: Implementar `lib/state.mjs`, `lib/hookio.mjs`, `hooks/session-start.mjs`, `scripts/hq-state.mjs`**

`lib/state.mjs`:
```js
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { findByPath } from './registry.mjs';
import { lastSession, listDecisions, projectDir } from './vault.mjs';

export const MAX_CONTEXT = 1200;

export function parseFrontmatter(text) {
  const m = text.replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { data: {}, body: text };
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (kv) data[kv[1]] = kv[2].replace(/^["']|["']$/g, '').trim();
  }
  return { data, body: text.replace(/^\uFEFF/, '').slice(m[0].length) };
}

export function activeTasks(repoPath) {
  const dir = path.join(repoPath, 'backlog', 'tasks');
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.md')) continue;
    const { data } = parseFrontmatter(readFileSync(path.join(dir, f), 'utf8'));
    if ((data.status ?? '').toLowerCase() === 'en curso') out.push({ id: data.id ?? f, title: data.title ?? f });
  }
  return out;
}

export function buildSessionContext(cfg, reg, cwd) {
  const project = findByPath(reg, cwd);
  if (!project) return null;
  let estado = 'desconocido';
  const idx = path.join(projectDir(cfg, project.slug), 'Índice.md');
  if (existsSync(idx)) estado = parseFrontmatter(readFileSync(idx, 'utf8')).data.estado || estado;
  const active = activeTasks(project.path);
  const decisions = listDecisions(cfg, project.slug, 3);
  const text = [
    `[Project HQ] ${project.display} (${project.slug}) · estado: ${estado}`,
    active.length ? `Tarjeta activa: ${active.map((t) => `${t.id} ${t.title}`).join(' | ')}` : 'Sin tarjeta activa: usa /ejecutar siguiente',
    decisions.length ? `Últimas decisiones: ${decisions.map((d) => `${d.date} ${d.title}`).join(' · ')}` : 'Sin decisiones registradas',
    `Tablero: http://localhost:${project.port} · Comandos: /retomar /ejecutar /revisar /guardar`,
  ].join('\n');
  return text.length > MAX_CONTEXT ? text.slice(0, MAX_CONTEXT - 3) + '...' : text;
}

export function projectPaths(cfg, reg, cwd) {
  const project = findByPath(reg, cwd);
  if (!project) return null;
  return { project, index: path.join(projectDir(cfg, project.slug), 'Índice.md'), lastSession: lastSession(cfg, project.slug) };
}
```
`lib/hookio.mjs`:
```js
export async function readHookInput() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    return {};
  }
}

export function contextOutput(eventName, text) {
  return JSON.stringify({ hookSpecificOutput: { hookEventName: eventName, additionalContext: text } });
}
```
`hooks/session-start.mjs`:
```js
import { loadConfig } from '../lib/config.mjs';
import { contextOutput, readHookInput } from '../lib/hookio.mjs';
import { logError } from '../lib/log.mjs';
import { loadRegistry } from '../lib/registry.mjs';
import { buildSessionContext } from '../lib/state.mjs';

let cfg = null;
try {
  const input = await readHookInput();
  cfg = loadConfig();
  const ctx = buildSessionContext(cfg, loadRegistry(cfg.registryFile), input.cwd ?? process.cwd());
  if (ctx) process.stdout.write(contextOutput('SessionStart', ctx));
} catch (e) {
  logError(cfg, `session-start: ${e.message}`);
}
process.exit(0);
```
`scripts/hq-state.mjs`:
```js
import { loadConfig } from '../lib/config.mjs';
import { loadRegistry } from '../lib/registry.mjs';
import { buildSessionContext, projectPaths } from '../lib/state.mjs';

try {
  const cfg = loadConfig();
  const reg = loadRegistry(cfg.registryFile);
  const cwd = process.cwd();
  const ctx = buildSessionContext(cfg, reg, cwd);
  if (!ctx) {
    console.log('No estás dentro de un proyecto HQ.');
  } else {
    const p = projectPaths(cfg, reg, cwd);
    console.log(ctx);
    console.log(`Índice: ${p.index}`);
    console.log(`Última sesión: ${p.lastSession ?? 'ninguna'}`);
  }
} catch (e) {
  console.error(`Error: ${e.message}`);
  process.exit(1);
}
```

- [ ] **Step 4: Ejecutar y ver que pasan**

Run: `node --test tests/state.test.mjs tests/hooks.test.mjs` → Expected: 8 PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/state.mjs lib/hookio.mjs hooks/session-start.mjs scripts/hq-state.mjs tests/state.test.mjs tests/hooks.test.mjs
git commit -m "feat: estado de proyecto y hook SessionStart" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Hooks PreCompact/Stop (snapshot de sesión) y `hooks.json`

**Files:**
- Create: `lib/snapshot.mjs`, `hooks/pre-compact.mjs`, `hooks/stop.mjs`, `hooks/hooks.json`, `tests/snapshot.test.mjs`
- Modify: `tests/hooks.test.mjs` (añadir 2 tests)

**Interfaces:**
- Consumes: `findByPath`, `activeTasks`, `writeSession`, `Runner`.
- Produces: `snapshotSession({cfg, reg, input, run, now?, stateDir?, force?, event?}): {written: boolean, reason?: 'sin-proyecto'|'debounce'}`; `DEBOUNCE_MS = 600000`.

- [ ] **Step 1: Tests que fallan**

`tests/snapshot.test.mjs`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { snapshotSession, DEBOUNCE_MS } from '../lib/snapshot.mjs';
import { projectDir } from '../lib/vault.mjs';
import { fakeRunner, makeCfg, tmpDir } from './helpers.mjs';

function setup() {
  const root = tmpDir();
  const cfg = makeCfg(root);
  const repo = path.join(root, 'mis proyectos', 'demo');
  mkdirSync(repo, { recursive: true });
  const reg = { projects: [{ slug: 'demo', display: 'Demo', path: repo, port: 6430 }] };
  return { root, cfg, repo, reg };
}

test('escribe una nota de sesión con el resumen de cambios de git', () => {
  const { root, cfg, repo, reg } = setup();
  const r = snapshotSession({ cfg, reg, input: { cwd: repo, session_id: 'abcdef123456' }, run: fakeRunner(), stateDir: root, now: new Date(2026, 9, 8, 15, 0) });
  assert.equal(r.written, true);
  const dir = path.join(projectDir(cfg, 'demo'), 'Sesiones');
  const text = readFileSync(path.join(dir, readdirSync(dir)[0]), 'utf8');
  assert.match(text, /2 files changed/);
  assert.match(text, /sesion: abcdef12/);
});

test('debounce: una segunda llamada dentro de 10 min no escribe, salvo con force', () => {
  const { root, cfg, repo, reg } = setup();
  const args = { cfg, reg, input: { cwd: repo, session_id: 'abcdef123456' }, run: fakeRunner(), stateDir: root };
  const t0 = new Date(2026, 9, 8, 15, 0);
  assert.equal(snapshotSession({ ...args, now: t0 }).written, true);
  const soon = new Date(t0.getTime() + DEBOUNCE_MS - 1000);
  assert.deepEqual(snapshotSession({ ...args, now: soon }), { written: false, reason: 'debounce' });
  assert.equal(snapshotSession({ ...args, now: soon, force: true }).written, true);
  const later = new Date(t0.getTime() + DEBOUNCE_MS + 5000);
  assert.equal(snapshotSession({ ...args, now: later }).written, true);
});

test('fuera de un proyecto no escribe', () => {
  const { root, cfg, reg } = setup();
  assert.deepEqual(snapshotSession({ cfg, reg, input: { cwd: root }, run: fakeRunner(), stateDir: root }), { written: false, reason: 'sin-proyecto' });
});

test('un session_id con caracteres peligrosos se sanea', () => {
  const { root, cfg, repo, reg } = setup();
  const r = snapshotSession({ cfg, reg, input: { cwd: repo, session_id: '../../x' }, run: fakeRunner(), stateDir: root });
  assert.equal(r.written, true);
  assert.ok(r.path.startsWith(projectDir(cfg, 'demo')));
});
```
Añadir al final de `tests/hooks.test.mjs`:
```js
test('hooks.json declara SessionStart, PreCompact y Stop apuntando a ficheros que existen', () => {
  const hooks = JSON.parse(readFileSync(path.join(HQ_ROOT, 'hooks', 'hooks.json'), 'utf8')).hooks;
  for (const ev of ['SessionStart', 'PreCompact', 'Stop']) {
    const cmd = hooks[ev][0].hooks[0].command;
    const file = cmd.match(/hooks\/([\w-]+\.mjs)/)[1];
    assert.ok(existsSync(path.join(HQ_ROOT, 'hooks', file)), `${ev} -> ${file}`);
  }
});

test('Stop dentro de un proyecto escribe una nota de sesión y sale con 0; fuera no escribe', () => {
  const e = env();
  const r = runHook('stop.mjs', e, { cwd: e.repo, session_id: `sess${Date.now()}` });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  const dir = path.join(e.cfg.vaultPath, 'Proyectos', 'demo', 'Sesiones');
  assert.ok(existsSync(dir));
  const r2 = runHook('stop.mjs', e, { cwd: e.root, session_id: `sess${Date.now()}x` });
  assert.equal(r2.status, 0);
});
```
Nota: el test de Stop usa el `os.tmpdir()` real para el debounce, por eso el `session_id` lleva `Date.now()` y no depende de ejecuciones anteriores.

- [ ] **Step 2: Ejecutar y ver que fallan**

Run: `node --test tests/snapshot.test.mjs tests/hooks.test.mjs` → Expected: FAIL.

- [ ] **Step 3: Implementar `lib/snapshot.mjs`, hooks y `hooks.json`**

`lib/snapshot.mjs`:
```js
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findByPath } from './registry.mjs';
import { activeTasks } from './state.mjs';
import { writeSession } from './vault.mjs';

export const DEBOUNCE_MS = 10 * 60 * 1000;

function lastWrite(file) {
  if (!existsSync(file)) return 0;
  try {
    return Number(JSON.parse(readFileSync(file, 'utf8')).at) || 0;
  } catch {
    return 0;
  }
}

export function snapshotSession({ cfg, reg, input, run, now = new Date(), stateDir = os.tmpdir(), force = false, event = 'Stop' }) {
  const project = findByPath(reg, input.cwd ?? '');
  if (!project) return { written: false, reason: 'sin-proyecto' };
  const sid = String(input.session_id ?? 'sin-id').replace(/[^\w-]/g, '').slice(0, 8) || 'sin-id';
  const stateFile = path.join(stateDir, `hq-snap-${sid}.json`);
  if (!force && now.getTime() - lastWrite(stateFile) < DEBOUNCE_MS) return { written: false, reason: 'debounce' };

  const diff = run('git', ['diff', '--shortstat'], { cwd: project.path });
  const changes = diff.status === 0 && diff.stdout.trim() ? diff.stdout.trim() : 'sin cambios';
  const activeTask = activeTasks(project.path).map((t) => `${t.id} ${t.title}`).join(' | ') || 'ninguna';
  const r = writeSession(cfg, project.slug, {
    sessionId: sid, activeTask, changes,
    summary: `Auto-snapshot (${event}). Para un resumen real usa /guardar.`,
  }, now);
  writeFileSync(stateFile, JSON.stringify({ at: now.getTime() }), 'utf8');
  return r;
}
```
`hooks/stop.mjs`:
```js
import { loadConfig } from '../lib/config.mjs';
import { readHookInput } from '../lib/hookio.mjs';
import { logError } from '../lib/log.mjs';
import { loadRegistry } from '../lib/registry.mjs';
import { snapshotSession } from '../lib/snapshot.mjs';
import { realRunner } from '../lib/tools.mjs';

let cfg = null;
try {
  const input = await readHookInput();
  cfg = loadConfig();
  snapshotSession({ cfg, reg: loadRegistry(cfg.registryFile), input, run: realRunner, event: 'Stop' });
} catch (e) {
  logError(cfg, `stop: ${e.message}`);
}
process.exit(0);
```
`hooks/pre-compact.mjs`: igual que `stop.mjs` con `event: 'PreCompact'`, `force: true` y el prefijo `pre-compact:` en el log.

`hooks/hooks.json`:
```json
{
  "hooks": {
    "SessionStart": [
      { "matcher": "startup|resume|clear|compact",
        "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/session-start.mjs\"" }] }
    ],
    "PreCompact": [
      { "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/pre-compact.mjs\"" }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/stop.mjs\"" }] }
    ]
  }
}
```

- [ ] **Step 4: Ejecutar y ver que pasan**

Run: `node --test tests/snapshot.test.mjs tests/hooks.test.mjs` → Expected: todos PASS (snapshot 4, hooks 6).

- [ ] **Step 5: Commit**

```bash
git add lib/snapshot.mjs hooks tests/snapshot.test.mjs tests/hooks.test.mjs
git commit -m "feat: hooks Stop y PreCompact con snapshot de sesion" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: CLI del vault (`/guardar` y decisiones)

**Files:**
- Create: `scripts/vault-cli.mjs`, `tests/vault-cli.test.mjs`

**Interfaces:**
- Consumes: `findByPath`, `writeSession`, `addDecision`.
- Produces: `runVaultCli({sub: 'session'|'decision', payload, cfg, reg, cwd, now?}): {written, path}`. CLI: `node scripts/vault-cli.mjs <session|decision>` lee un JSON por stdin. `session`: `{summary, activeTask?, changes?}`. `decision`: `{title, context, decision, why}`.

- [ ] **Step 1: Test que falla**

`tests/vault-cli.test.mjs`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runVaultCli } from '../scripts/vault-cli.mjs';
import { makeCfg, tmpDir } from './helpers.mjs';

const reg = (root) => ({ projects: [{ slug: 'demo', display: 'Demo', path: path.join(root, 'mis proyectos', 'demo'), port: 6430 }] });

test('session escribe una nota manual con el resumen', () => {
  const root = tmpDir();
  const cfg = makeCfg(root);
  const r = runVaultCli({ sub: 'session', payload: { summary: 'Hecho el parser' }, cfg, reg: reg(root), cwd: path.join(root, 'mis proyectos', 'demo'), now: new Date(2026, 9, 8, 15, 42) });
  assert.equal(r.written, true);
  assert.match(path.basename(r.path), /^2026-10-08-manual-1542\.md$/);
  assert.match(readFileSync(r.path, 'utf8'), /Hecho el parser/);
});

test('decision escribe la nota en Decisiones/', () => {
  const root = tmpDir();
  const cfg = makeCfg(root);
  const r = runVaultCli({ sub: 'decision', payload: { title: 'Usar SQLite', context: 'c', decision: 'd', why: 'w' }, cfg, reg: reg(root), cwd: path.join(root, 'mis proyectos', 'demo') });
  assert.match(r.path, /Decisiones/);
});

test('errores claros: fuera de proyecto, subcomando desconocido, resumen vacío', () => {
  const root = tmpDir();
  const cfg = makeCfg(root);
  assert.throws(() => runVaultCli({ sub: 'session', payload: { summary: 'x' }, cfg, reg: reg(root), cwd: root }), /proyecto registrado/);
  assert.throws(() => runVaultCli({ sub: 'raro', payload: {}, cfg, reg: reg(root), cwd: path.join(root, 'mis proyectos', 'demo') }), /desconocido/);
  assert.throws(() => runVaultCli({ sub: 'session', payload: { summary: '  ' }, cfg, reg: reg(root), cwd: path.join(root, 'mis proyectos', 'demo') }), /summary/);
});
```

- [ ] **Step 2: Ejecutar y ver que falla**

Run: `node --test tests/vault-cli.test.mjs` → Expected: FAIL.

- [ ] **Step 3: Implementar `scripts/vault-cli.mjs`**

```js
import path from 'node:path';
import { hm } from '../lib/dates.mjs';
import { loadConfig } from '../lib/config.mjs';
import { findByPath, loadRegistry } from '../lib/registry.mjs';
import { addDecision, writeSession } from '../lib/vault.mjs';

export function runVaultCli({ sub, payload, cfg, reg, cwd, now = new Date() }) {
  const project = findByPath(reg, cwd);
  if (!project) throw new Error('No estás dentro de un proyecto registrado en HQ');
  if (sub === 'session') {
    if (typeof payload?.summary !== 'string' || !payload.summary.trim()) throw new Error('session: falta "summary"');
    return writeSession(cfg, project.slug, {
      sessionId: `manual-${hm(now).replace(':', '')}`,
      activeTask: payload.activeTask ?? 'ninguna',
      changes: payload.changes ?? 'n/d',
      summary: payload.summary,
    }, now);
  }
  if (sub === 'decision') return addDecision(cfg, project.slug, payload, now);
  throw new Error(`Subcomando desconocido: ${sub}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  try {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    const cfg = loadConfig();
    const r = runVaultCli({ sub: process.argv[2], payload, cfg, reg: loadRegistry(cfg.registryFile), cwd: process.cwd() });
    console.log(r.written ? `Guardado: ${r.path}` : `Ya existía (no se sobrescribió): ${r.path}`);
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
}
```

- [ ] **Step 4: Ejecutar y ver que pasa**

Run: `node --test tests/vault-cli.test.mjs` → Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/vault-cli.mjs tests/vault-cli.test.mjs
git commit -m "feat: CLI del vault para sesiones y decisiones" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Subagentes y comandos (Markdown) con validación

**Files:**
- Create: `agents/arquitecto.md`, `agents/ejecutor.md`, `agents/revisor.md`, `agents/explorador.md`, `agents/investigador.md`, `agents/skill-scout.md`, `commands/nuevo-proyecto.md`, `commands/idea.md`, `commands/planificar.md`, `commands/ejecutar.md`, `commands/revisar.md`, `commands/guardar.md`, `commands/retomar.md`, `tests/plugin.test.mjs`

**Interfaces:**
- Consumes: scripts `new-project.mjs`, `vault-cli.mjs`, `hq-state.mjs`; `parseFrontmatter` (Task 7).
- Produces: 6 agentes y 7 comandos con frontmatter válido.

- [ ] **Step 1: Test que falla**

`tests/plugin.test.mjs`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { HQ_ROOT } from '../lib/config.mjs';
import { parseFrontmatter } from '../lib/state.mjs';

const read = (...p) => readFileSync(path.join(HQ_ROOT, ...p), 'utf8');

const AGENTS = { arquitecto: 'opus', ejecutor: 'sonnet', revisor: 'sonnet', explorador: 'haiku', investigador: 'sonnet', 'skill-scout': 'haiku' };
const COMMANDS = ['nuevo-proyecto', 'idea', 'planificar', 'ejecutar', 'revisar', 'guardar', 'retomar'];

test('cada subagente existe con name, description y model explícito correcto', () => {
  for (const [name, model] of Object.entries(AGENTS)) {
    const { data } = parseFrontmatter(read('agents', `${name}.md`));
    assert.equal(data.name, name);
    assert.equal(data.model, model, `${name}`);
    assert.ok(data.description.length > 20, `${name} sin descripción`);
  }
});

test('cada comando existe con description', () => {
  for (const c of COMMANDS) {
    assert.ok(existsSync(path.join(HQ_ROOT, 'commands', `${c}.md`)), c);
    assert.ok(parseFrontmatter(read('commands', `${c}.md`)).data.description?.length > 10, c);
  }
});

test('los comandos que ejecutan scripts apuntan a ficheros que existen', () => {
  for (const c of COMMANDS) {
    for (const m of read('commands', `${c}.md`).matchAll(/scripts\/([\w-]+\.mjs)/g)) {
      assert.ok(existsSync(path.join(HQ_ROOT, 'scripts', m[1])), `${c} -> ${m[1]}`);
    }
  }
});

test('plugin.json y marketplace.json son válidos', () => {
  const plugin = JSON.parse(read('.claude-plugin', 'plugin.json'));
  assert.equal(plugin.name, 'project-hq');
  const mp = JSON.parse(read('.claude-plugin', 'marketplace.json'));
  assert.equal(mp.plugins[0].name, 'project-hq');
});
```

- [ ] **Step 2: Ejecutar y ver que falla**

Run: `node --test tests/plugin.test.mjs` → Expected: FAIL (no existen los ficheros).

- [ ] **Step 3: Crear los 6 agentes**

`agents/arquitecto.md`:
```
---
name: arquitecto
description: Diseña la arquitectura del proyecto, entrevista al usuario y divide el trabajo en tarjetas de Backlog.md con criterios de aceptación. Úsalo en /idea y /planificar.
model: opus
tools: Read, Grep, Glob, Bash, WebSearch, WebFetch
---
Eres el arquitecto del proyecto actual (carpeta con `.hq/project.json`).

Reglas:
- Entrevista: máximo 5 preguntas por ronda, de una en una cuando dependan unas de otras. No propongas diseño hasta entender objetivo, restricciones y criterio de éxito.
- Propón 2-3 enfoques con una recomendación y su motivo. YAGNI.
- Escribe el diseño en `docs/ARQUITECTURA.md` (diagrama en texto, componentes, flujo de datos, riesgos).
- Registra cada decisión relevante con: `echo '{"title":"...","context":"...","decision":"...","why":"..."}' | node "${CLAUDE_PLUGIN_ROOT}/scripts/vault-cli.mjs" decision`
- Crea tarjetas con `backlog task create`. Antes de la primera tarjeta ejecuta `backlog task create --help` y usa los flags reales para descripción, criterios de aceptación, estado, dependencias y estimación. Cada tarjeta: título corto, un resultado verificable, 2-5 criterios de aceptación comprobables, dependencias, estimación y la skill/MCP recomendada por `skill-scout` (en la descripción). Estado inicial: "Planificado".
- Las tarjetas deben poder hacerse en una sola sesión. Si una es mayor, divídela.
- Responde al agente principal con un resumen de máximo 15 líneas, no con volcados.
```
`agents/ejecutor.md`:
```
---
name: ejecutor
description: Implementa UNA tarjeta de Backlog.md (código, tests, actualización de estado). Úsalo en /ejecutar.
model: sonnet
tools: Read, Edit, Write, Grep, Glob, Bash
---
Implementas exactamente la tarjeta que se te indica, nada más.

Pasos:
1. Lee la tarjeta: `backlog task <id> --plain`. Si no queda claro un criterio, devuélvelo con la pregunta en vez de adivinar.
2. Muévela a "En curso": `backlog task edit <id> -s "En curso"`.
3. Implementa con TDD cuando haya código: test que falla, implementación mínima, test que pasa.
4. Ejecuta los tests del proyecto y el comando de verificación de la tarjeta. Marca cada criterio cumplido (`backlog task edit --help` para el flag de criterios).
5. Si todo pasa, muévela a "Verificando". Nunca la pongas en "Hecho": lo decide `revisor`.
6. Haz commit con un mensaje claro.

Para lecturas amplias de código usa `explorador`. Responde con un resumen de máximo 10 líneas: qué cambió, qué se probó, qué queda.
```
`agents/revisor.md`:
```
---
name: revisor
description: Verifica de forma independiente una tarjeta contra sus criterios de aceptación, sin haber visto la implementación. Úsalo en /revisar.
model: sonnet
tools: Read, Grep, Glob, Bash
---
Eres el revisor. No viste cómo se implementó: juzga solo por la tarjeta y el resultado.

Pasos:
1. Lee la tarjeta: `backlog task <id> --plain`.
2. Mira el cambio: `git log --oneline -5` y `git diff` del commit de la tarjeta.
3. Ejecuta los tests y las comprobaciones. Para cada criterio de aceptación di PASA o FALLA con la evidencia (salida de comando o archivo:línea).
4. Si todos pasan: `backlog task edit <id> -s "Hecho"`.
5. Si alguno falla: `backlog task edit <id> -s "En curso"` y deja en la tarjeta qué falla y cómo reproducirlo.

No arregles el código. Responde con una tabla criterio/resultado y el veredicto en una línea.
```
`agents/explorador.md`:
```
---
name: explorador
description: Busca en el código o en los documentos del proyecto y devuelve solo conclusiones con referencias archivo:línea. Úsalo para lecturas amplias en lugar de leer en el contexto principal.
model: haiku
tools: Read, Grep, Glob
---
Respondes preguntas sobre el código o los documentos del proyecto.

- Busca primero con Grep/Glob; lee solo los fragmentos necesarios.
- Devuelve conclusiones, no volcados: máximo 15 líneas con referencias `ruta:línea`.
- Si no encuentras algo, dilo y di dónde buscaste. No inventes.
```
`agents/investigador.md`:
```
---
name: investigador
description: Consulta el cuaderno NotebookLM del proyecto y la web, y devuelve resúmenes cortos con fuente. Úsalo para documentos largos, datasheets, papers y documentación.
model: sonnet
tools: Bash, Read, WebSearch, WebFetch
---
Respondes preguntas usando el cuaderno NotebookLM del proyecto y, si hace falta, la web.

- El ID del cuaderno está en `.hq/project.json` (`notebookId`). Si es "pendiente", dilo y detente.
- Pregunta al cuaderno: `nlm notebook query <notebookId> "<pregunta>" --json --profile hq`. Añadir fuentes: `nlm source add <notebookId> --url "<url>" --json --profile hq`.
- Si `nlm` falla por login, indica `nlm login --profile hq` al usuario. No reintentes en bucle.
- Devuelve un resumen de máximo 15 líneas con la fuente de cada afirmación. No pegues el texto bruto de los documentos.
```
`agents/skill-scout.md`:
```
---
name: skill-scout
description: Recomienda skills, MCPs y plugins para un proyecto o tarjeta, con motivo, coste en tokens y riesgo. Nunca instala nada. Úsalo al planificar.
model: haiku
tools: Bash, Read, Glob, WebSearch, WebFetch
---
Recomiendas herramientas para la tarea indicada.

1. Mira lo ya instalado: `claude plugin list`, `claude mcp list` y las carpetas `~/.claude/skills` y `.claude/skills`.
2. Si algo instalado ya cubre la tarea, di cuál y no busques más.
3. Si no, busca en GitHub y en los registros de skills/MCP las opciones más recientes y mantenidas (último commit, estrellas, issues abiertos, compatibilidad con Windows).
4. Devuelve una lista corta (máx. 3) con: nombre, motivo, coste en tokens (esquemas MCP, tamaño de la skill) y riesgo (p. ej. automatiza el navegador, no oficial, sin mantenimiento).
5. NUNCA instales ni configures nada. La decisión es del usuario.
```

- [ ] **Step 4: Crear los 7 comandos**

`commands/nuevo-proyecto.md`:
```
---
description: Crea un proyecto HQ completo (repo, tablero Backlog.md, nota en Obsidian, cuaderno NotebookLM) y abre el tablero
argument-hint: <nombre>
model: sonnet
---
Crea el proyecto "$ARGUMENTS".

1. Si el nombre está vacío, pregúntalo y detente. Si contiene comillas, `$` o acentos graves, pide otro nombre.
2. Ejecuta: `node "${CLAUDE_PLUGIN_ROOT}/scripts/new-project.mjs" $ARGUMENTS`
3. Muestra el informe (una línea por paso) y la URL del tablero.
4. Si algún paso salió ✗, explica la causa en una frase y qué tarjeta quedó creada. No reintentes en bucle.
5. Termina diciendo: abre una sesión en la carpeta del proyecto y usa /idea.
```
`commands/idea.md`:
```
---
description: Vuelca una idea y deja que el arquitecto te entreviste (máx. 5 preguntas por ronda)
argument-hint: [idea en texto libre]
model: opus
---
Idea del usuario: $ARGUMENTS

1. Ejecuta /retomar solo si no has cargado el estado en esta sesión.
2. Delega en el subagente `arquitecto` la entrevista: máximo 5 preguntas por ronda, empezando por objetivo, para quién y criterio de éxito.
3. Cuando haya claridad, guarda un resumen de la idea con: `echo '{"summary":"<idea y decisiones iniciales>"}' | node "${CLAUDE_PLUGIN_ROOT}/scripts/vault-cli.mjs" session`
4. Propón pasar a /planificar. No escribas código.
```
`commands/planificar.md`:
```
---
description: Diseña la arquitectura y crea las tarjetas del backlog con criterios, dependencias y estimación
model: opus
---
Planifica el proyecto actual. Trabaja en modo plan: no escribas código del producto.

1. Carga el contexto: `node "${CLAUDE_PLUGIN_ROOT}/scripts/hq-state.mjs"`.
2. Delega en `arquitecto`: `docs/ARQUITECTURA.md`, decisiones en el vault y tarjetas en "Planificado".
3. Para cada tarjeta (o para el proyecto si son muchas), delega en `skill-scout` y anota sus recomendaciones en la tarjeta. No instales nada sin aprobación del usuario.
4. Presenta el plan (tarjetas, orden, dependencias) y espera aprobación antes de cualquier implementación.
5. Al aprobarse, actualiza el estado del proyecto en el vault y sugiere /ejecutar siguiente.
```
`commands/ejecutar.md`:
```
---
description: Implementa una tarjeta (id o "siguiente") con el subagente ejecutor
argument-hint: [id | siguiente]
model: sonnet
---
Tarjeta a ejecutar: "$ARGUMENTS" (vacío o "siguiente" = la próxima).

1. Si es "siguiente": `backlog task list -s "Planificado" --plain`, elige la primera sin dependencias pendientes.
2. Delega en el subagente `ejecutor` indicando solo el id de la tarjeta.
3. Resume el resultado del subagente en 5 líneas máximo.
4. Sugiere /revisar y, al terminar, /guardar y /clear. Una tarjeta por sesión.
```
`commands/revisar.md`:
```
---
description: Verificación independiente de una tarjeta contra sus criterios de aceptación
argument-hint: [id]
model: sonnet
---
Tarjeta a revisar: "$ARGUMENTS" (vacío = la que esté en "Verificando": `backlog task list -s "Verificando" --plain`).

Delega en el subagente `revisor` indicando solo el id. No le cuentes cómo se implementó. Muestra su tabla criterio/resultado y el veredicto.
```
`commands/guardar.md`:
```
---
description: Guarda el resumen de la sesión en el vault y prepara el cierre
model: sonnet
---
Guarda la sesión actual.

1. Redacta un resumen de máximo 10 líneas: qué se hizo, qué quedó pendiente, decisiones tomadas.
2. Guárdalo: `echo '{"summary":"<resumen>","activeTask":"<id y título o ninguna>"}' | node "${CLAUDE_PLUGIN_ROOT}/scripts/vault-cli.mjs" session`
3. Por cada decisión nueva: `echo '{"title":"...","context":"...","decision":"...","why":"..."}' | node "${CLAUDE_PLUGIN_ROOT}/scripts/vault-cli.mjs" decision`
4. Confirma las rutas guardadas y sugiere /clear.
```
`commands/retomar.md`:
```
---
description: Carga solo el índice del proyecto, la tarjeta activa y las últimas decisiones
model: sonnet
---
Ejecuta `node "${CLAUDE_PLUGIN_ROOT}/scripts/hq-state.mjs"` y muestra el resultado.

Si hay "Última sesión", lee solo ese fichero. Lee el Índice solo si falta contexto. No leas más del vault. Termina diciendo cuál es la siguiente acción recomendada (tarjeta activa o /ejecutar siguiente).
```

- [ ] **Step 5: Crear `.claude-plugin/marketplace.json`**

```json
{
  "name": "project-hq-local",
  "owner": { "name": "el usuario" },
  "plugins": [
    { "name": "project-hq", "source": "./", "description": "Project HQ: proyectos con Backlog.md, Obsidian y NotebookLM" }
  ]
}
```

- [ ] **Step 6: Ejecutar y ver que pasa**

Run: `node --test tests/plugin.test.mjs` → Expected: 4 PASS.

- [ ] **Step 7: Commit**

```bash
git add agents commands .claude-plugin tests/plugin.test.mjs
git commit -m "feat: subagentes, comandos y marketplace local" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Diagnóstico (`doctor`)

**Files:**
- Create: `lib/checks.mjs`, `scripts/doctor.mjs`, `tests/checks.test.mjs`

**Interfaces:**
- Consumes: `Cfg`, runner inyectable.
- Produces: `runChecks(cfg, run): {name, ok, detail}[]`. CLI `node scripts/doctor.mjs` imprime ✓/✗ por comprobación, hace un ping opcional a la REST API de Obsidian por HTTP local (`127.0.0.1:27124`, sin TLS, solo loopback) si existe `HQ_OBSIDIAN_KEY`, y sale con 1 si algo falla.

- [ ] **Step 1: Test que falla**

`tests/checks.test.mjs`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { runChecks } from '../lib/checks.mjs';
import { makeCfg, tmpDir } from './helpers.mjs';

const ok = () => ({ status: 0, stdout: 'v1.0\nmás', stderr: '' });

test('todo correcto → todas las comprobaciones ok', () => {
  const cfg = makeCfg(tmpDir());
  mkdirSync(cfg.vaultPath, { recursive: true });
  mkdirSync(cfg.projectsRoot, { recursive: true });
  const res = runChecks(cfg, ok);
  assert.ok(res.every((r) => r.ok), JSON.stringify(res.filter((r) => !r.ok)));
});

test('detecta herramienta ausente, login de nlm caducado y vault inexistente', () => {
  const cfg = makeCfg(tmpDir());
  const run = (cmd, args) => {
    if (cmd === 'backlog') return { status: 1, stdout: '', stderr: 'no encontrado' };
    if (cmd === 'nlm' && args[0] === 'login') return { status: 1, stdout: '', stderr: 'expired' };
    return ok();
  };
  const bad = runChecks(cfg, run).filter((r) => !r.ok).map((r) => r.name);
  assert.ok(bad.includes('backlog'));
  assert.ok(bad.some((n) => n.startsWith('nlm login')));
  assert.ok(bad.includes('vault accesible'));
});
```

- [ ] **Step 2: Ejecutar y ver que falla**

Run: `node --test tests/checks.test.mjs` → Expected: FAIL.

- [ ] **Step 3: Implementar `lib/checks.mjs` y `scripts/doctor.mjs`**

`lib/checks.mjs`:
```js
import { existsSync } from 'node:fs';

const firstLine = (r) => (r.stdout || r.stderr).trim().split('\n')[0];

export function runChecks(cfg, run) {
  const results = [];
  const add = (name, ok, detail = '') => results.push({ name, ok, detail });
  const major = Number(process.versions.node.split('.')[0]);
  add('Node >= 22', major >= 22, process.versions.node);
  for (const [name, args] of [['git', ['--version']], ['backlog', ['--version']], ['nlm', ['--version']], ['uv', ['--version']]]) {
    const r = run(name, args, {});
    add(name, r.status === 0, firstLine(r));
  }
  const login = run('nlm', ['login', '--check', '--profile', cfg.nlmProfile], {});
  add(`nlm login (${cfg.nlmProfile})`, login.status === 0, firstLine(login));
  add('vault accesible', existsSync(cfg.vaultPath), cfg.vaultPath);
  add('projectsRoot existe', existsSync(cfg.projectsRoot), cfg.projectsRoot);
  return results;
}
```
`scripts/doctor.mjs`:
```js
import http from 'node:http';
import { loadConfig } from '../lib/config.mjs';
import { runChecks } from '../lib/checks.mjs';
import { realRunner } from '../lib/tools.mjs';

function pingObsidian(key) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: 27124, path: '/', timeout: 1500,
      headers: { Authorization: `Bearer ${key}` } }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try { resolve({ ok: JSON.parse(body).authenticated === true, detail: `HTTP ${res.statusCode}` }); }
        catch { resolve({ ok: false, detail: `respuesta no válida (HTTP ${res.statusCode})` }); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, detail: 'sin respuesta (¿Obsidian abierto con el vault ProjectHQ?)' }); });
    req.on('error', (e) => resolve({ ok: false, detail: e.message }));
  });
}

try {
  const cfg = loadConfig();
  const results = runChecks(cfg, realRunner);
  const key = process.env.HQ_OBSIDIAN_KEY;
  if (key) {
    const p = await pingObsidian(key);
    results.push({ name: 'Obsidian REST API (opcional)', ok: p.ok, detail: p.detail });
  } else {
    results.push({ name: 'Obsidian REST API (opcional)', ok: true, detail: 'HQ_OBSIDIAN_KEY no definida; se omite' });
  }
  for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
} catch (e) {
  console.error(`Error: ${e.message}`);
  process.exit(1);
}
```

- [ ] **Step 4: Ejecutar y ver que pasa; correr toda la suite**

Run: `node --test tests/checks.test.mjs` → Expected: 2 PASS.
Run: `npm test` → Expected: toda la suite en verde (≈ 50 tests, 0 fallos).

- [ ] **Step 5: Commit**

```bash
git add lib/checks.mjs scripts/doctor.mjs tests/checks.test.mjs
git commit -m "feat: doctor de diagnostico" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Instalación de herramientas y del plugin (CON PARADAS DE APROBACIÓN)

**Files:** ninguno del repo (instala software en la máquina del usuario).

> **Regla dura:** antes de CADA paso de esta tarea, pregunta al usuario y espera un "sí" explícito. Muéstrale el comando exacto. Si dice que no, salta ese paso y anótalo. No encadenes pasos.

- [ ] **Step 1: Estado inicial.** Ejecuta `node scripts/doctor.mjs` y muestra qué falta (esperado: `backlog`, `nlm`, `uv` en ✗).

- [ ] **Step 2: Instalar `uv`** (pide permiso). Comando: `winget install --id astral-sh.uv -e`. Si `winget` no existe: `python -m pip install --user uv`. Verifica con `uv --version` (puede requerir abrir una terminal nueva; si no aparece, usa la ruta que indique el instalador).

- [ ] **Step 3: Instalar Backlog.md** (pide permiso). Comando: `npm i -g backlog.md`. Verifica con `backlog --version`.

- [ ] **Step 4: Instalar la CLI de NotebookLM** (pide permiso). Comando: `uv tool install notebooklm-mcp-cli`. Verifica con `nlm --version`. (El paquete conserva el nombre antiguo; el repositorio se llama `gemini-notebook-mcp-cli`.)

- [ ] **Step 5: Login con la cuenta secundaria** (lo hace el usuario; sugiérele `! nlm login --profile hq`). Debe elegir almacenamiento **Protected** si se le pregunta. Verifica con `nlm login --check --profile hq`.

- [ ] **Step 6: Guardar la clave de Obsidian como variable de entorno de usuario** (lo hace el usuario con su propia clave; sugiérele `! powershell -Command "[Environment]::SetEnvironmentVariable('HQ_OBSIDIAN_KEY','<clave>','User')"`). No pegues la clave en ningún fichero. Abrir una terminal nueva para que surta efecto.

- [ ] **Step 7: Instalar el plugin `project-hq`** (pide permiso). Comandos:
```
claude plugin marketplace add "<repo-project-hq>"
claude plugin install project-hq@project-hq
claude plugin list
```
Expected: `project-hq` aparece como instalado y habilitado. Si algún subcomando no existe en esta versión de Claude Code, usa `claude --help` / `claude plugin --help` y adapta; como alternativa temporal, probar con `claude --plugin-dir "<repo-project-hq>"`. Los comandos quedan como `/project-hq:nuevo-proyecto` (el prefijo puede omitirse si no hay conflicto).

- [ ] **Step 8 (OPCIONAL, por defecto NO hacer): registrar el MCP de Backlog.** Solo si el usuario lo pide: `claude mcp add backlog --scope user -- backlog mcp start`. Coste: el esquema de herramientas se carga en cada sesión.

- [ ] **Step 9: Verificación final.** `node scripts/doctor.mjs` → todo ✓ (salvo el ping de Obsidian si Obsidian está cerrado).

---

### Task 13: Prueba de punta a punta y README

**Files:**
- Create: `README.md`
- (El proyecto de prueba `demo-hq` se crea fuera del repo, en `<projectsRoot>\demo-hq`.)

- [ ] **Step 1: Crear el proyecto de prueba con el script real.**

Run: `node scripts/new-project.mjs demo-hq`
Expected: líneas ✓ para git, backlog, columnas, notebooklm, archivos, vault, registro y tablero; `Tablero: http://localhost:6430`; se abre el navegador con el kanban de Backlog.md.
Si `backlog init` rechaza un flag: ejecuta `backlog init --help`, corrige **solo** `backlogInit` en `lib/tools.mjs` (y su test) y repite. Si `nlm notebook create --json` no devuelve un ID reconocible, ajusta `extractNotebookId` y añade el caso al test.

- [ ] **Step 2: Verificar con los ojos y con comandos.**
```
dir "<projectsRoot>\demo-hq"
type "<projectsRoot>\demo-hq\.hq\project.json"
type "<vaultPath>\Proyectos\demo-hq\Índice.md"
backlog board   (desde la carpeta demo-hq: debe mostrar las 5 columnas Ideas…Hecho)
```
Expected: carpeta con `backlog/`, `docs/`, `CLAUDE.md` (≤ 25 líneas), `.hq/`; nota en el vault; kanban con 5 columnas. Si `backlog board` muestra columnas distintas (la clave `statuses` en `config.yml` no es la que Backlog.md lee), corrige `setStatuses` según el `config.yml` real generado por `backlog init` y actualiza su test.

- [ ] **Step 3: Probar la memoria entre sesiones.** Crea una tarjeta y una decisión de prueba:
```
cd "<projectsRoot>\demo-hq"
backlog task create "Tarjeta de prueba" -d "probar HQ"
backlog task edit 1 -s "En curso"
echo {"title":"Usar SQLite","context":"prueba","decision":"SQLite","why":"simple"} | node "<repo-project-hq>\scripts\vault-cli.mjs" decision
```
(En PowerShell usa comillas simples alrededor del JSON.) Abre una sesión NUEVA de Claude Code dentro de `demo-hq`. Expected: al arrancar aparece el contexto `[Project HQ] demo-hq…` con la tarjeta activa y la decisión, sin que escribas nada. Ejecuta `/retomar` y comprueba que resume lo mismo.

- [ ] **Step 4: Probar guardado automático.** En esa sesión haz un cambio trivial y termina el turno. Expected: aparece `<vaultPath>\Proyectos\demo-hq\Sesiones\<fecha>-<id>.md`; un segundo turno dentro de 10 min no crea otro fichero.

- [ ] **Step 5: Probar la degradación.** Con `nlm` sin login válido (`nlm login --profile hq` caducado o perfil inexistente), `node scripts/new-project.mjs demo-fallo`. Expected: ✗ en notebooklm, el resto ✓, y una tarjeta "Conectar NotebookLM" en el backlog. Borra después `demo-fallo` (carpeta, nota del vault y su entrada en `registry.json`) **tras confirmarlo con el usuario**.

- [ ] **Step 6: Escribir `README.md`** (corto, ≤ 40 líneas): qué es, requisitos, instalación (remite al Task 12 del plan), los 7 comandos en una tabla, estructura de carpetas y cómo clonarlo para trabajo (copiar el repo, editar `config.json`: `vaultPath`, `projectsRoot`, `nlmProfile`, `basePort`, y hacer login `nlm` con el perfil de trabajo).

- [ ] **Step 7: Suite completa y commit final.**

Run: `npm test` → Expected: todo en verde.
```bash
git add README.md
git commit -m "docs: README y prueba end-to-end del Nucleo" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-review (hecho al escribir el plan)

**Cobertura del spec:** §4 estructura → Tasks 1-4, 10; §5 comandos → Tasks 6, 9, 10 (`/nuevo-proyecto` con script, `/idea /planificar /ejecutar /revisar` como comandos+agentes, `/guardar` y `/retomar` con scripts); §6 subagentes con `model:` → Task 10 (+ test que lo exige); `disenador-ui` queda para el subsistema 3 como indica el spec; §7 hooks → Tasks 7-8 (SessionStart ≤ 1200 caracteres, PreCompact y Stop con debounce); §9 errores/seguridad → degradación NLM (Task 6), `doctor` (Task 11), guardas del vault y `.bak` en `backups/` (Task 4), variable de entorno para la clave (Task 12), instalaciones con aprobación (Task 12), sin la nube sincronizada (restricción global); §10 pruebas → tests por tarea + e2e (Task 13). Los criterios de éxito "interfaz abierta en < 1 min" y "retomar sin re-explicar" se comprueban en Task 13 (pasos 1 y 3); el tercero ("saber qué pasa mirando el tablero") lo cubre `backlog browser` hasta el subsistema 3.

**Placeholders:** ninguno; los pasos que dependen de la salida real de `backlog`/`nlm` tienen una instrucción concreta de ajuste local (`backlogInit`, `setStatuses`, `extractNotebookId`), todos aislados en `lib/tools.mjs`.

**Consistencia de tipos:** `Cfg` (Task 1) con `backupsDir/logsDir/registryFile` usada en Tasks 3-11; `Project = {slug, display, path, port, notebookId, created}` igual en registry, vault, state y snapshot; `writeSession({sessionId, activeTask, changes, summary})` igual en Tasks 4, 8 y 9; runner `(cmd, args, {cwd}) => {status, stdout, stderr}` igual en Tasks 5, 6, 8, 11.
