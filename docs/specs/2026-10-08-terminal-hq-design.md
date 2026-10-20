# Project HQ — Subsistema 3: HQ en la terminal (spec de diseño)

Fecha: 2026-10-08 · Autor: Ali + Claude · Estado: pendiente de revisión
Sustituye al "Dashboard en vivo" web del spec del Núcleo (§ subsistema 3). Los mockups web (`docs/mockups/`) se conservan como referencia visual.

## 1. Contexto y objetivo

Ali quiere **trabajar todo en la terminal**: Claude Code, el tablero de tarjetas, el feed de lo que hace el agente y las notas de Obsidian, en paneles de una misma ventana (idea tomada de GoRex, un emulador con paneles). Las tarjetas se actualizan solas y **Ali decide cuándo se da por buena una tarjeta o una fase**; nada avanza solo.

### Criterios de éxito
- `hq open <proyecto>` abre en menos de 5 s una pestaña de Windows Terminal con Claude Code, tablero y feed ya repartidos.
- El estado del proyecto se entiende de un vistazo en el tablero, sin leer el historial de Claude.
- Ninguna tarjeta pasa a «Hecho» ni ninguna fase se da por cerrada sin una acción explícita de Ali.
- Los paneles no añaden latencia perceptible a Claude Code ni tokens al contexto.

### Fuera de alcance
- UI web y acceso desde el móvil (queda para más adelante; los mockups siguen en `docs/mockups/`).
- XP, niveles, rachas, logros y presupuesto de tokens (subsistema 4).
- Emulador de terminal propio y sesiones persistentes estilo GoRex.
- Reestructuración del vault Personal (subsistema 2).

## 2. Decisiones

1. **Contenedor: Windows Terminal 1.24** (ya instalado) con paneles divididos lanzados por `wt.exe`. No se escribe emulador.
2. **Paneles propios en Python + Textual**, instalados con `uv tool install --editable` (da el comando `hq`). Es la opción con mejor resultado visual y menos código propio. Segundo lenguaje junto al Node del Núcleo, con contratos de datos explícitos entre ambos (§4).
3. **Estética «Flujo»** (la elegida en los mockups): lienzo de nodos, tarjetas como cajas con puertos y dependencias como cables dibujados con caracteres de línea. Paleta en color verdadero: lienzo `#1E2230`, nodo `#272D3F`, iris `#8B7CFF`, ámbar `#FFC86B`, Opus `#C58BFF`, Sonnet `#6EA8FF`, Haiku `#5ED3C2`, hito `#FF7A8A`.
4. **Sin servidor ni red.** Los hooks escriben ficheros y los paneles los leen. Se elimina la superficie de ataque local de la versión web.
5. **Los paneles solo leen; las escrituras pasan por las herramientas de siempre**: `backlog` para tarjetas, `scripts/fases.mjs` y `scripts/vault-cli.mjs` para fases y vault. Backlog.md sigue siendo la única fuente de verdad de las tarjetas.
6. **Doble puerta de aprobación humana** (§6): por tarjeta y por fase.

## 3. Estructura

```
project-hq/
  tui/                         app Python (pyproject.toml, src/hq/)
    hq/cli.py                  comandos: hq, hq board|feed|notes|open
    hq/data/                   lectura: registry, backlog_md, events, state, vault, fases
    hq/widgets/                flow_canvas (cables), card, phase_strip, feed, md_viewer
    hq/screens/                global, board, feed, notes
    hq/theme.py                paleta y estilos (TCSS)
    tests/                     pytest + pilot de Textual
  hooks/event.mjs              hook asíncrono de eventos (nuevo)
  scripts/statusline.mjs       statusline de Claude Code (nuevo)
  scripts/fases.mjs            lee/escribe .hq/fases.json (nuevo)
  scripts/hq-open.mjs          construye y lanza el comando de wt.exe (nuevo)
<dataDir>/events/<slug>/<AAAA-MM-DD>.jsonl     eventos (nuevo)
<dataDir>/state/<session8>.json                modelo, coste y contexto por sesión (nuevo)
<proyecto>/.hq/fases.json                      fases y aprobaciones (nuevo)
```
`dataDir` ya existe en `config.json` (fuera de OneDrive). `hq` localiza la configuración con `HQ_CONFIG` o, por defecto, `C:\proyectos personales\project-hq\config.json`.

## 4. Contratos de datos

### 4.1 Eventos (`hooks/event.mjs`)
Hook registrado en `hooks/hooks.json` con `"async": true` (no retrasa a Claude) para: `PreToolUse`, `PostToolUseFailure`, `SubagentStart`, `SubagentStop`, `PostModelSwitch`, `UserPromptSubmit`, `Stop`. Resuelve el proyecto con `findByPath(cwd)`; fuera de un proyecto registrado no hace nada. Siempre sale con 0; errores a `logs/hooks.log`.

Línea JSONL (una por evento):
```json
{"t":"2026-10-08T15:41:12.123Z","sid":"abc12345","slug":"demo-hq","kind":"tool|tool_fail|subagent_start|subagent_stop|model|prompt|stop",
 "tool":"Edit","target":"lib/state.mjs","agent":"ejecutor","model":"sonnet"}
```
- `target`: ruta relativa, patrón de búsqueda o primeros 60 caracteres del comando, sin variables de entorno ni cabeceras. Cadenas de ≥32 caracteres alfanuméricos se sustituyen por `…`.
- **Nunca** se guardan respuestas de herramientas, contenido de ficheros ni el texto de los prompts (`prompt` solo registra que hubo uno).
- `agent` viene de `agent_type`/`agent_id`; `model` de un mapa fijo (`arquitecto=opus`, `ejecutor=sonnet`, `revisor=sonnet`, `explorador=haiku`, `investigador=sonnet`, `skill-scout=haiku`) y, para la sesión principal, del estado de §4.2.
- Un fichero por día y proyecto, máximo 5 MB; `hq` borra lo que tenga más de 7 días al arrancar.

### 4.2 Estado de sesión (`scripts/statusline.mjs`)
Claude Code ejecuta la statusline con JSON por stdin (`session_id`, `model.display_name`, `workspace.current_dir`, `cost.total_cost_usd`, `context_window.{total_input_tokens,total_output_tokens,used_percentage}`). El script:
1. Imprime una línea corta: `proyecto · tarjeta activa · modelo · coste · contexto %`. Fuera de un proyecto imprime solo modelo y coste.
2. Escribe (atómicamente) `state/<session8>.json` con `{t, slug, model, cost, ctx_pct, tokens_in, tokens_out}`.
Se activa en `~/.claude/settings.json` (`statusLine`), que es configuración de usuario, no de plugin: **requiere tu aprobación al instalarla**.

### 4.3 Tarjetas
`hq` lee `backlog/tasks/*.md`: frontmatter (`id`, `title`, `status`, `milestone`, `dependencies`, `labels`) y casillas de criterios de aceptación (`- [x]`/`- [ ]`). Convenciones sobre etiquetas (editables con la CLI de Backlog): `modelo:<opus|sonnet|haiku>`, `skill:<nombre>` (las pone el `arquitecto`/`skill-scout`), `revisada` (la pone el `revisor` al aprobar). El formato exacto se comprueba contra tarjetas reales al empezar la construcción.

### 4.4 Fases (`.hq/fases.json`)
```json
{"fases":[{"id":"f1","nombre":"Diseño","milestone":"Diseño","aprobada":"2026-10-08"},
          {"id":"f2","nombre":"Construcción","milestone":"Construcción","aprobada":null}]}
```
- Solo guarda **orden y aprobaciones**. El estado visible se deriva: `pendiente` (la anterior no está aprobada), `activa`, `esperando` (activa y todas sus tarjetas en «Hecho») y `aprobada`.
- Escritura atómica (temporal + renombrado) por `scripts/fases.mjs` (Node: comandos `/planificar` y `/ejecutar`) y por `hq` (Python); mismo esquema, nunca a la vez en la práctica (acciones manuales).
- Un proyecto sin `fases.json` se comporta como hasta ahora (sin puerta de fase).

## 5. Pantallas y teclas

| Comando | Qué muestra |
|---|---|
| `hq` | Todos los proyectos: progreso en forma de pipeline de nodos, tarjeta activa, última actividad. Enter abre el proyecto (`hq open`). |
| `hq board <slug>` | **Lienzo «Flujo»**: franja de fases arriba; columnas Ideas, Planificado, En curso, Verificando, Hecho; tarjetas con modelo, skill, criterios (n/m) y cables de dependencia entre ellas. |
| `hq feed <slug>` | «Ahora mismo»: eventos con icono/color de modelo; cabecera con modelo de la sesión, contexto % y coste. |
| `hq notes <slug>` | Árbol del vault del proyecto (Índice, Decisiones, Sesiones) y visor de Markdown. `o` abre la nota en Obsidian (`obsidian://open`), `e` en el editor por defecto. |
| `hq open <slug>` | Lanza Windows Terminal con el reparto de §7. |

**Teclas del tablero:** flechas/`hjkl` mover selección · Enter abrir detalle de la tarjeta (criterios, notas, dependencias, modelo/skill) · `a` aprobar · `m` mejorar · `A` aprobar fase · `M` mejorar fase · `r` refrescar · `?` ayuda · `q` salir. El ratón selecciona y arrastra tarjetas entre columnas **salvo hacia «Hecho»**, que siempre pasa por la puerta.
Las pantallas se refrescan solas al cambiar los ficheros (vigilancia con sondeo corto como respaldo).

## 6. Puertas de aprobación

### 6.1 Tarjeta
1. El `ejecutor` termina y deja la tarjeta en «Verificando».
2. El `revisor` verifica contra los criterios. **Ya no mueve a «Hecho»**: si pasa, añade la etiqueta `revisada` y un comentario «Revisión: PASA (n/n)» y la deja en «Verificando»; si falla, la devuelve a «En curso» con el motivo (como hasta ahora).
3. En el tablero esa tarjeta se ve como *revisada, esperando tu visto bueno*.
4. **`a`** → pide confirmación y ejecuta `backlog task edit <id> -s "Hecho"`. **`m`** → pide el texto «qué falta», añade el comentario `Falta: …`, quita `revisada` y devuelve la tarjeta a «En curso». El `ejecutor` lee ese comentario en la siguiente vuelta.
5. Una tarjeta nunca llega a «Hecho» por otra vía desde los comandos y agentes del HQ.

### 6.2 Fase
1. `/planificar` define de 3 a 6 fases y asigna cada tarjeta a una (`milestone` de Backlog.md), guardándolo con `scripts/fases.mjs`.
2. Solo la fase **activa** admite trabajo: `/ejecutar siguiente` elige tarjetas de «Planificado» de esa fase (con dependencias cumplidas).
3. Cuando todas las tarjetas de la fase activa están en «Hecho», la fase pasa a **esperando** y el tablero lo muestra.
4. **`A`** aprueba: se anota la fecha, la fase pasa a `aprobada` y se activa la siguiente. **`M`** pide qué falta y crea una tarjeta «Mejorar: …» en «Planificado» de esa misma fase, que vuelve a `activa`.
5. Aprobar o mejorar una fase queda registrado como decisión en el vault (`vault-cli decision`).

## 7. Lanzador (`hq open`)
`scripts/hq-open.mjs` construye (función pura, testeada) y lanza un único comando de `wt.exe`:
```
wt -w 0 new-tab --title <slug> -d <repo> <claude>   ;
   split-pane -V -s 0.42 -d <repo> hq board <slug>   ;
   split-pane -H -s 0.5  -d <repo> hq feed <slug>    ;
   new-tab --title "Notas <slug>" hq notes <slug>
```
Disposición: Claude Code a la izquierda (58 %), tablero y feed a la derecha, notas en una segunda pestaña. El comando exacto (separadores `;`, ventana, foco) se valida en Windows Terminal real al construir. `/nuevo-proyecto` termina ejecutando `hq open` si `hq` está instalado (si no, mantiene el comportamiento actual con el tablero de Backlog.md).

## 8. Cambios en el Núcleo
- `hooks/hooks.json`: añade el hook `event.mjs` (async) para los eventos de §4.1.
- `agents/revisor.md`, `commands/revisar.md`: ya no mueven a «Hecho»; etiqueta `revisada` + comentario.
- `commands/ejecutar.md`: respeta la fase activa; lee los comentarios `Falta:` de la tarjeta.
- `commands/planificar.md`, `agents/arquitecto.md`: definen fases y etiquetas `modelo:`/`skill:`.
- `lib/state.mjs`: el contexto de SessionStart añade la fase activa y «Esperando tu visto bueno».
- `commands/nuevo-proyecto.md`, `scripts/new-project.mjs`: abre `hq open` al terminar si está disponible.
- `config.json`: `eventsRetentionDays` (por defecto 7).
- Tests nuevos de Node para el hook, la statusline, `fases.mjs` y el constructor del comando de `wt`.

## 9. Errores, privacidad y seguridad
- Hook y statusline nunca bloquean ni rompen la sesión; errores a `logs/hooks.log`.
- Sin red ni puertos. Todo en `dataDir` y en los repos, fuera de OneDrive.
- Privacidad de eventos: solo resúmenes cortos y redactados (§4.1).
- Si falta un fichero o está corrupto, el panel lo indica en pantalla sin cerrarse (nunca un traceback).
- Instalaciones que requieren tu visto bueno: `uv tool install --editable ./tui` (Textual y dependencias) y la entrada `statusLine` en `~/.claude/settings.json`.

## 10. Pruebas
- **Python (pytest):** lectura de tarjetas con casos reales (CRLF, etiquetas, criterios), máquina de estados de fases, lectura y redacción de eventos, mapeo de modelos. Pilotos de Textual para: mover selección, aprobar, mejorar, aprobar fase, refresco al cambiar un fichero.
- **Node (`node --test`):** hook `event.mjs` por subproceso con `HQ_CONFIG` temporal (silencio fuera de proyecto, redacción, límite de tamaño, no escribe prompts), `statusline.mjs`, `fases.mjs`, y el constructor de `hq-open`.
- **Manual en Windows Terminal real:** lanzar `hq open demo-hq`, comprobar reparto, refresco en vivo y las dos puertas con tarjetas reales.

## 11. Riesgos y qué comprobar primero
1. Dibujo de cables con caracteres de línea y rendimiento/parpadeo de Textual en Windows Terminal. *Prototipo del lienzo antes de nada.*
2. Sintaxis de `wt.exe` con varios paneles lanzada desde Node (separadores, orden de foco).
3. Banderas reales de Backlog.md 1.53 para hito (`milestone`), etiquetas y comentarios: comprobar con `--help` antes de fijarlas.
4. Campos reales de `SubagentStart`, `SubagentStop` y `PostModelSwitch`; efecto de `"async": true`.
5. La statusline solo se muestra tras aceptar la confianza en el espacio de trabajo.
6. Codificación UTF-8 en consola de Windows para los caracteres de línea (forzar `PYTHONUTF8=1`).
