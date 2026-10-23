# Project HQ — Subsistema 1: Núcleo (spec de diseño)

Fecha: 2026-10-08 · Autor: el autor + Claude · Estado: pendiente de revisión

## 1. Contexto y objetivo

el usuario (automatizaciones, n8n, Arduino, servidores propios) quiere un "cuartel general" para proyectos personales que conecte **NotebookLM + Obsidian + Claude Code**, separado por proyecto, barato en tokens y clonable más adelante para trabajo.

Este spec cubre solo el **Núcleo**. El sistema completo se divide en 4 subsistemas, cada uno con su spec y plan:

1. **Núcleo** (este documento): scaffolding de proyecto, tareas, memoria, comandos, subagentes, hooks mínimos.
2. **Vault**: reestructuración y migración segura del vault Personal (conserva el contenido, cambia la estructura).
3. **Dashboard en vivo**: tablero propio, feed de eventos por hooks, statusline, 2–3 mockups a elegir.
4. **Gamificación y medición de tokens**: XP, niveles, logros, comparativa con/sin herramientas.

### Criterios de éxito (del sistema completo; el Núcleo debe habilitar los tres primeros)
- Proyecto nuevo con interfaz abierta en < 1 minuto.
- Retomar días después sin re-explicar nada.
- Saber qué pasa mirando el tablero, sin leer la terminal.
- Reducción medible de tokens frente a una sesión sin el sistema (subsistema 4).

## 2. Entorno verificado (2026-10-08)

Windows 11 Pro · Node 22.23 · npm 10.9 · Python 3.12 · Git 2.55 · Claude Code 2.1.294 · modelo `opusplan` ya activo. **Faltan** `uv`, `gh`, `bun`. Sin MCPs globales en la config de Claude Code. Plugins activos relevantes: superpowers, feature-dev, frontend-design, context7, hookify.

Vault: `%USERPROFILE%\la nube sincronizada\Bovedas\Personal` (89 notas, 5 MB, plugin Local REST API, usa Bases). **Está en la nube sincronizada**: no escribir eventos en alta frecuencia ni poner `.git` dentro.

### Verificación de repos (§8 del prompt maestro)
| Repo | Estado | Decisión |
|---|---|---|
| PleasePrompto/notebooklm-mcp | Archivado | Descartado |
| jacob-bd/gemini-notebook-mcp-cli (antes notebooklm-mcp-cli) | 6.2k★, push 2026-10-06, 0 issues, CLI `nlm` + MCP + skill | **Elegido** (no oficial: cuenta Google secundaria) |
| roomi-fields/notebooklm-mcp | 190★, vivo | Plan B |
| MrLesk/Backlog.md | 7k★, push 2026-10-07, MCP + web | **Elegido** (tareas) |
| BloopAI/vibe-kanban | "Sunsetting" | Descartado |
| 7P3ng/Claude-Code-Agent-Monitor | 2★ | Descartado |
| simple10/agents-observe | 695★, vivo | Referencia para captura por hooks (subsistema 3) |
| breferrari/obsidian-mind | 4.9k★, vivo | Inspiración de estructura/hooks de memoria |
| lucasrosati/claude-code-memory-setup | 1k★, vivo | Guía de ahorro de tokens |
| maxtechera/memory | 2★ | Descartado |
| oraios/serena · rtk-ai/rtk · Graphify · caveman | Vivos y populares | Fuera del Núcleo; se miden en subsistema 4 |

## 3. Decisiones

1. **Tareas: viven en el repo del proyecto** (`backlog/`, Backlog.md). Una sola fuente de verdad, versionada en git. El vault guarda un espejo ligero (nota índice con enlaces; una Base puede listar las tarjetas).
2. **Empaquetado: plugin de Claude Code** (`project-hq`), con comandos, subagentes y hooks una sola vez a nivel usuario. Los proyectos solo llevan `backlog/`, `CLAUDE.md` corto y `.hq/project.json`.
3. **Memoria en el vault escrita por script** (ficheros, no MCP): no gasta tokens y no depende de que la REST API esté abierta. Se escribe una vez por sesión, nunca en bucle.
4. **Interfaz inicial: `backlog browser`** (kanban web con drag & drop) en un puerto fijo por proyecto. El dashboard propio (subsistema 3) la sustituye, con ruta `/p/<proyecto>`.
5. **Obsidian: Bases + plantillas**, sin plugin propio.
6. **Documentos pesados en NotebookLM**; el agente `investigador` pregunta y devuelve conclusiones con fuente.

## 4. Estructura

```
project-hq/                       plugin + repo git propio
  config.json                     vaultPath, projectsRoot, vaultProjectsDir, nlmProfile, basePort
  .claude-plugin/plugin.json
  commands/   nuevo-proyecto idea planificar ejecutar revisar guardar retomar
  agents/     arquitecto(opus) ejecutor(sonnet) revisor(sonnet)
              explorador(haiku) investigador(sonnet) skill-scout(haiku)
  hooks/      hooks.json + session-start.mjs, pre-compact.mjs, stop.mjs
  scripts/    new-project.mjs, vault.mjs, hq-state.mjs, doctor.mjs
  templates/  CLAUDE.md, nota-proyecto.md, decision.md, sesion.md
  registry.json                   proyectos: nombre, ruta, notebookId, puerto
  docs/specs/ docs/plans/

<proyectosRoot>/<nombre>/         <projectsRoot>\<nombre>
  backlog/                        tarjetas (fuente de verdad)
  docs/ARQUITECTURA.md
  .hq/project.json                notebookId, notaVault, puerto, creado
  CLAUDE.md                       índice + reglas, ≤ 25 líneas

<vault>/<vaultProjectsDir>/<nombre>/
  Índice.md                       frontmatter: estado, repo, notebook, puerto, nivel
  Decisiones/AAAA-MM-DD-titulo.md
  Sesiones/AAAA-MM-DD-hhmm.md
```
**Vault de HQ nuevo y dedicado: `<vaultPath>`** (fuera de la nube sincronizada), con su propio plugin Local REST API (HTTPS 27145, HTTP local 27124; el vault Personal usa 27144/27123). `vaultProjectsDir` = `Proyectos`. El vault Personal (la nube sincronizada) no se toca en el Núcleo; su reestructuración y la migración de contenido útil pertenecen al subsistema 2.

Todos los scripts son Node ESM sin dependencias externas (Windows nativo, sin bash).

## 5. Comandos

| Comando | Modelo | Acción |
|---|---|---|
| `/nuevo-proyecto <nombre>` | Sonnet | Valida nombre → crea carpeta → `git init` → `backlog init` (columnas Ideas, Planificado, En curso, Verificando, Hecho) → `CLAUDE.md` y `.hq/project.json` desde plantilla → nota índice en el vault → `nlm notebook create` → registra → arranca `backlog browser --port N` y abre el navegador. Si falla NotebookLM, continúa y crea la tarjeta "Conectar NotebookLM". Idempotente: si algo ya existe, lo reutiliza y no lo pisa. |
| `/idea` | Opus | Volcado libre; entrevista con el agente `arquitecto`, máx. 5 preguntas por ronda; guarda la idea en el vault. |
| `/planificar` | Opus (plan mode) | `ARQUITECTURA.md`, decisiones en el vault, tarjetas con criterios de aceptación, dependencias, estimación y recomendación de `skill-scout`. |
| `/ejecutar [id\|siguiente]` | Sonnet | Delega en `ejecutor`: una tarjeta, implementa, prueba, actualiza tarjeta y columna. Una tarjeta por sesión; sugiere `/clear` al terminar. |
| `/revisar` | Sonnet (Opus si crítica) | `revisor` en contexto limpio: ve criterios y diff, no la implementación. Aprueba o devuelve la tarjeta. |
| `/guardar` | Sonnet | Resumen de sesión al vault, actualiza estado, sugiere `/clear`. |
| `/retomar` | Sonnet | Carga solo: índice del proyecto, tarjeta activa, últimas 3 decisiones. |

## 6. Subagentes (cada uno con `model:` explícito)

- `arquitecto` — Opus: diseño y división en tarjetas.
- `ejecutor` — Sonnet: implementa una tarjeta.
- `revisor` — Sonnet: verificación independiente.
- `explorador` — Haiku: búsquedas en código/docs, devuelve conclusiones, no volcados.
- `investigador` — Sonnet: consulta NotebookLM (`nlm`/MCP) y la web; resúmenes cortos con fuente.
- `skill-scout` — Haiku: al planificar, revisa skills/MCPs/plugins instalados y busca mejores; propone lista corta con motivo, coste en tokens y riesgo; lo anota en la tarjeta. **Nunca instala sin aprobación.**
- `disenador-ui` (Opus) se crea en el subsistema 3.

El agente principal delega lecturas masivas en `explorador`/`investigador`.

### 6.1 Modelo y esfuerzo por tarjeta (2026-10-13)
El `model:` del frontmatter de `ejecutor` y `revisor` es solo el valor por defecto: `/ejecutar` y `/revisar` pasan `model` y `effort` explícitos por llamada a partir de las etiquetas de la tarjeta (`modelo:<opus|sonnet>`, `esfuerzo:<medium|high|xhigh>`, `riesgo:<bajo|medio|alto>`, `est:<minutos>`), calculados por `scripts/modelo-tarjeta.mjs` (`lib/modelo-tarjeta.mjs`). Ejecutar y revisar solo con Opus (tope) y Sonnet; Haiku solo para `explorador` y `skill-scout`.

| Tipo de tarea | Ejecutor | Revisor |
|---|---|---|
| Arquitectura, seguridad, concurrencia, migraciones/datos irreversibles | opus / xhigh | opus / high (+ tarjeta `Verificar TASK-n`) |
| Lógica compleja, integraciones externas, rendimiento | opus / high | opus / high |
| Interfaz con criterio visual, refactor amplio (>5 ficheros) | opus / medium | opus / high (regla: nunca más débil que la tarjeta) |
| Funcionalidad corriente, tests, refactor mecánico acotado | sonnet / high | sonnet / high |
| Docs, configuración, cambios triviales | sonnet / medium | sonnet / medium |

Rúbrica (+2 por señal: seguridad/datos, concurrencia, >3 criterios, >5 ficheros, criterio ambiguo, ≥2 dependientes): 0-1 sonnet, 2-5 opus/high, ≥6 o `riesgo:alto` opus/xhigh. Escalera: cada comentario `Falta:` sube un peldaño (nivel de la tarjeta → opus/high → opus/xhigh); tras 2 rechazos en opus/xhigh, `parar`. `scripts/lint-tarjetas.mjs` valida las tarjetas en el paso 4 de `/planificar`. Rastro: comentario `Modelo: <alias>/<esfuerzo> intento <n>` del ejecutor y del revisor.

## 7. Hooks (Núcleo)

- **SessionStart**: si el cwd es un proyecto registrado, inyecta ≤ 300 tokens: nombre, tarjeta activa, 3 últimas decisiones, comandos útiles. Si no, no inyecta nada.
- **PreCompact** y **Stop**: escriben/actualizan el resumen de sesión en el vault (máx. una escritura por evento, con debounce).
- Los hooks Pre/PostToolUse hacia el dashboard pertenecen al subsistema 3.

## 8. Estrategia de tokens (Núcleo)

CLAUDE.md global y de proyecto como índices (≤ 25 líneas). Detalle en el vault, cargado bajo demanda. Documentos largos a NotebookLM. Exploración a Haiku. `/clear` entre tarjetas. Registro de tokens por tarjeta/sesión: subsistema 4. Serena, RTK, Graphify y caveman no se instalan en el Núcleo.

## 9. Errores y seguridad

- NotebookLM caído o login caducado: degradación elegante (ver `/nuevo-proyecto`); `doctor.mjs` comprueba `nlm login --check`.
- Credenciales `nlm` en modo *protected*, perfil con cuenta Google secundaria.
- Escritura al vault: solo bajo `vaultProjectsDir/<proyecto>/`; nunca sobrescribe notas existentes sin copia `.bak`.
- Instalaciones (cada una requiere visto bueno): `uv`, `backlog.md`, `notebooklm-mcp-cli`, `claude mcp add backlog`, el plugin `project-hq`.
- **Nada de HQ en la nube sincronizada** (el almacenamiento es limitado; por eso HQ tiene su propio vault en `<vaultPath>`): el plugin, los repos de proyecto, `node_modules`, logs, datos del dashboard y las copias de seguridad viven bajo `<projectsRoot>\` (fuera de la nube sincronizada). Al vault HQ solo se escriben notas `.md` pequeñas (índice, decisiones, resúmenes de sesión). Nunca adjuntos, logs ni binarios. Las copias `.bak` y las copias previas a migrar el vault van a `<repo-project-hq>\backups\` (en `.gitignore`).
- Puertos por proyecto asignados desde `basePort` y guardados en `registry.json`.

## 10. Pruebas

- `doctor.mjs`: verifica Node, `backlog`, `nlm`, vault accesible, config válida.
- Tests de Node (`node --test`) para: validación de nombre, generación de plantillas, asignación de puertos, escritura idempotente al vault, composición del contexto de SessionStart (límite de tamaño).
- Prueba de punta a punta: `/nuevo-proyecto demo-hq` en un directorio real, comprobando carpeta, backlog, nota en vault, cuaderno y puerto; después `/retomar` en sesión nueva.

## 11. Fuera de alcance del Núcleo

Dashboard y feed en vivo, statusline, gamificación, medición de tokens, reestructuración del vault, instalación de Serena/RTK/Graphify, remoto en GitHub.
