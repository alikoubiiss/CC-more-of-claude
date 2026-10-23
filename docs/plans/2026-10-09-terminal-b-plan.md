# HQ en la terminal — Plan B: la interfaz Textual (`hq`)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. **Plan ligero:** el código completo está solo en las partes delicadas (lectores que deben coincidir con Node, acciones con la puerta humana); el resto lleva interfaces exactas, comportamiento y tests, y se apoya en el prototipo `tui/hq/canvas.py`.

**Goal:** El comando `hq` (Textual) con las pantallas `hq` (todos los proyectos), `hq board`, `hq feed`, `hq notes` y `hq open`, leyendo los datos que ya produce el plan A y con las puertas humanas (`a`/`m` tarjeta, `A`/`M` fase).

**Architecture:** Paquete Python `hq` en `tui/` (Python 3.12, solo `textual`). Capa de datos pura y testeable (`config`, `registry`, `tasks`, `fases`, `events`, `session`, `notes`), capa de acciones (`actions`, único sitio que escribe, vía la CLI `backlog` y `fases.json` atómico), capa visual (`canvas`, widgets, pantallas). Las pantallas solo leen; las escrituras pasan por `actions`. Refresco por sondeo de ficheros cada segundo.

**Tech Stack:** Python 3.12, Textual 8.2 (ya en `tui/.venv`), pytest (dependencia de desarrollo), `uv tool install --editable` para el comando `hq`.

**Spec:** `docs/specs/2026-10-08-terminal-hq-design.md` (§5 pantallas y teclas, §6 puertas). Plan A (datos y hooks): `docs/plans/2026-10-08-terminal-a-plan.md` (ya en master). Prototipo: `tui/hq/canvas.py`, (prototipos ya eliminados).

## Global Constraints

- Ejecutar siempre con `tui/.venv/Scripts/python.exe` y `PYTHONUTF8=1`. Tests: `cd tui && PYTHONUTF8=1 .venv/Scripts/python.exe -m pytest -q`. Los tests de Textual usan `asyncio.run(...)` + `App.run_test()` (sin plugins asyncio). Instalar `pytest` en `tui/.venv` pidiendo visto bueno (dependencia de desarrollo).
- **Contrato con Node (plan A), no se rompe:** `config.json` (`vaultPath`, `projectsRoot`, `vaultProjectsDir`, `dataDir` opcional; registro en `<dataDir ó dir de config>/registry.json`), eventos `<dataDir>/events/<slug>/AAAA-MM-DD.jsonl` (líneas `{t,sid,kind,tool,target,agent,model,slug}`), estado de sesión `<dataDir>/state/<sid8>.json` (`{t,sid,slug,model,model_name,cost,ctx_pct,tokens_in,tokens_out}`), tarjetas de Backlog.md (frontmatter YAML con listas en bloque, `milestone: m-0` = ID, criterios entre `<!-- AC:BEGIN/END -->`, comentarios entre `<!-- COMMENTS:BEGIN/END -->`, hitos `backlog/milestones/m-0 - x.md` con `id` y `title`), fases `.hq/fases.json` `{"fases":[{id,nombre,milestone,aprobada}]}` con estados derivados `pendiente|activa|esperando|aprobada` (misma regla que `lib/fases.mjs`). Los tests de Python usan los MISMOS fixtures de texto que los tests de Node (copiados literalmente) para fijar el contrato.
- **Solo lectura salvo `actions.py`.** Ninguna pantalla ni widget escribe ficheros ni ejecuta `backlog`.
- **Puerta humana:** pasar una tarjeta a «Hecho» y aprobar una fase solo ocurren desde una acción explícita del usuario en una pantalla (`a`/`A`) tras un diálogo de confirmación. Nada en el código llama a esas acciones sin pasar por la confirmación. El hook de puerta de Node bloquea a los agentes; `hq` corre en la terminal del usuario.
- **Seguridad de texto libre:** todo texto escrito por el usuario que acabe como argumento de `backlog` (motivo de «mejorar», etc.) se sanea con `actions.sanear_texto` (sin `& | < > ^ % " ' \` $`, saltos de línea ni caracteres de control; máx. 200 caracteres) porque en Windows `backlog` es un `.cmd`. Todo texto que viene de ficheros (títulos, comentarios, eventos) se limpia de caracteres de control C0/C1 y bidi antes de mostrarse (inyección de secuencias de escape).
- Nada de red. Sin dependencias nuevas en producción (solo `textual`). UTF-8. Commits con `Co-Authored-By: Claude <modelo> <noreply@anthropic.com>`.
- Ahorro de tokens: tareas de transcripción con Haiku, integración con Sonnet; revisión del diff por el controlador salvo tareas de seguridad (4) y pantallas con acciones (6), que llevan un revisor.

## Review Focus

1. Divergencia Python/Node: tarjetas con listas YAML en bloque, comillas, CRLF/BOM, sin criterios ni comentarios, ficheros ilegibles; hitos por ID o título; fase sin tarjetas; fase aprobada con tarjetas reabiertas (Tasks 1–2).
2. Texto hostil: títulos/comentarios/eventos con secuencias de escape o bidi; motivo de «mejorar» con metacaracteres de `cmd` (Tasks 3–4, 6).
3. La puerta: ningún camino llega a `Hecho`/aprobar sin confirmación; cancelar el diálogo no cambia nada; un fallo de `backlog` se muestra y no deja estado a medias (Tasks 4, 6).
4. Terminal estrecha (60–200 columnas), proyecto sin tarjetas, sin fases, sin eventos, sin sesión, registro vacío o dañado: la pantalla lo dice, no se cierra con traceback (Tasks 5–9).
5. Rendimiento: refresco por sondeo no relee todo si nada cambió; lienzo con 200 tarjetas (Tasks 5–6).

---

## File Structure

```
tui/
  pyproject.toml   .gitignore   tests/
  hq/
    config.py      rutas y config (HQ_CONFIG / por defecto)
    textos.py      limpiar(): control/bidi; recortar()
    registry.py    registro de proyectos, find_by_path
    tasks.py       parse_task, read_tasks, read_milestones   (puerto de lib/backlog-task.mjs)
    fases.py       load/save/derive/approve                  (puerto de lib/fases.mjs)
    events.py      leer eventos recientes de un proyecto
    session.py     estado de sesión más reciente del proyecto
    notes.py       árbol de notas del vault y lectura
    actions.py     ÚNICO sitio que escribe: backlog + fases.json (puerta humana)
    canvas.py      lienzo Flujo (ya existe; se amplía)
    widgets.py     Lienzo (ScrollView), Detalle, FranjaFases, Cabecera, Dialogos
    screens/       board.py feed.py notes.py global_.py
    app.py         HQApp(modo, slug)
    cli.py         hq | board | feed | notes | open
```

---

### Task 1: Config, textos, registro y lector de tarjetas (puerto de Node)

**Files:** Create `tui/hq/config.py`, `textos.py`, `registry.py`, `tasks.py`, `tui/tests/test_data_basic.py`, `tui/tests/conftest.py`.

**Interfaces — Produces:**
- `config.load_config(path: Path|None=None) -> Config` con `Config(vault_path, projects_root, vault_projects_dir, data_dir, registry_file, events_dir, state_dir, config_file)`; ruta por defecto `HQ_CONFIG` o `<raíz de project-hq>/config.json`; `data_dir` = `dataDir` o carpeta del config; lanza `ConfigError` con mensaje claro si falta o es inválido.
- `textos.limpiar(s) -> str` (sustituye C0/C1 y bidi `U+200B–200F, U+202A–202E, U+2066–2069` por espacio, colapsa espacios, recorta); `textos.recortar(s, n) -> str` (con `…`).
- `registry.load_registry(file) -> list[Project]` (`Project(slug, display, path, port, notebook_id)`; ausente → `[]`; dañado → `RegistryError`); `registry.find_by_path(projects, cwd) -> Project|None` (sin distinguir mayúsculas, `/` o `\`, sin confundir `demo` con `demo-2`).
- `tasks.parse_task(text) -> Task` (`Task(id,title,status,milestone,labels,dependencies,criteria_done,criteria_total,criteria_items,comments,file)`), `tasks.read_tasks(repo) -> list[Task]` (orden por número de id, ilegibles omitidos), `tasks.read_milestones(repo) -> list[Milestone]` (`id,title`).

- [ ] **Step 1: Tests que fallan** (`tests/test_data_basic.py`, con `conftest.py` que define `tmp_repo()`): copiar LITERALMENTE de `tests/backlog-task.test.mjs` los fixtures `TASK3` y `TASK1` y reproducir sus aserciones: TASK3 → `id TASK-3`, `status Verificando`, `milestone m-0`, `labels ['modelo:sonnet','skill:n8n','revisada']`, `dependencies ['TASK-2']`, criterios 1/2 con items `(1,'Flujo importado',True)`, `(2,'Prueba con 3 mensajes',False)`, un comentario `@revisor | 2026-10-08 15:48 | Revisión: PASA (2/2)`; igual con CRLF y con BOM; TASK1 mínima (`labels []`, `dependencies []`, sin criterios ni comentarios); comillas `'it''s fine'` → `it's fine` y `"Hecho"` → `Hecho`; `read_tasks` ordena `task-2` antes que `task-10`, omite un directorio llamado `x.md` y un `notas.txt`, y devuelve `[]` si no hay carpeta; `read_milestones` lee `id`/`title` con acentos. `textos.limpiar('\x1b[31mRojo\nL2\u202e')` no contiene caracteres de control ni bidi. `find_by_path`: `C:/Proyectos Personales/DEMO/src` encuentra `<projectsRoot>\demo`; `demo-2` no se confunde con `demo`; cwd vacío → `None`. `load_registry` con JSON dañado → `RegistryError`. `load_config` con `dataDir` relativo → `ConfigError`.
- [ ] **Step 2: Ejecutar y ver que falla** (`pytest -q` → ImportError).
- [ ] **Step 3: Implementar.** `tasks.py` (puerto exacto de `lib/backlog-task.mjs`):

```python
from __future__ import annotations
import re
from dataclasses import dataclass, field
from pathlib import Path
from .textos import limpiar


@dataclass
class Task:
    id: str = ""
    title: str = ""
    status: str = ""
    milestone: str = ""
    labels: list[str] = field(default_factory=list)
    dependencies: list[str] = field(default_factory=list)
    criteria_done: int = 0
    criteria_total: int = 0
    criteria_items: list[tuple[int, str, bool]] = field(default_factory=list)
    comments: list[tuple[str, str, str]] = field(default_factory=list)  # (autor, fecha, texto)
    file: str = ""


def _unquote(v: str) -> str:
    s = v.strip()
    if len(s) >= 2 and s[0] == "'" and s[-1] == "'":
        return s[1:-1].replace("''", "'")
    if len(s) >= 2 and s[0] == '"' and s[-1] == '"':
        return s[1:-1].replace('\\"', '"')
    return s


def _frontmatter(text: str):
    clean = text.lstrip("\ufeff")
    m = re.match(r"---\r?\n(.*?)\r?\n---\r?\n?", clean, re.S)
    if not m:
        return {}, clean
    data: dict = {}
    key = None
    for line in m.group(1).splitlines():
        item = re.match(r"\s+-\s*(.*)$", line)
        if item and key is not None:
            data[key].append(_unquote(item.group(1)))
            continue
        kv = re.match(r"([\w-]+):\s*(.*)$", line)
        if not kv:
            continue
        k, raw = kv.groups()
        inline = re.match(r"^\[(.*)\]$", raw)
        if raw == "":
            data[k] = []
            key = k
        elif inline:
            data[k] = [x for x in (_unquote(p) for p in inline.group(1).split(",")) if x]
            key = None
        else:
            data[k] = _unquote(raw)
            key = None
    return data, clean[m.end():]


def _scalar(v) -> str:
    return (v[0] if v else "") if isinstance(v, list) else (v or "")


def _lista(v) -> list[str]:
    return v if isinstance(v, list) else ([v] if v else [])


def parse_task(text: str) -> Task:
    data, body = _frontmatter(text)
    items = []
    ac = re.search(r"<!-- AC:BEGIN -->(.*?)<!-- AC:END -->", body, re.S)
    if ac:
        for line in ac.group(1).splitlines():
            m = re.match(r"^- \[( |x|X)\] #(\d+)\s+(.*)$", line)
            if m:
                items.append((int(m.group(2)), limpiar(m.group(3)), m.group(1) != " "))
    comments = []
    cm = re.search(r"<!-- COMMENTS:BEGIN -->(.*?)<!-- COMMENTS:END -->", body, re.S)
    if cm:
        for r in re.finditer(r"author:\s*(.*?)\r?\ncreated:\s*(.*?)\r?\n---\r?\n(.*?)\r?\n---", cm.group(1), re.S):
            comments.append((limpiar(r.group(1)), r.group(2).strip(), limpiar(r.group(3))))
    return Task(
        id=_scalar(data.get("id")), title=limpiar(_scalar(data.get("title"))), status=_scalar(data.get("status")),
        milestone=_scalar(data.get("milestone")), labels=_lista(data.get("labels")), dependencies=_lista(data.get("dependencies")),
        criteria_done=sum(1 for i in items if i[2]), criteria_total=len(items), criteria_items=items, comments=comments,
    )


def _num(id_: str) -> int:
    m = re.search(r"(\d+)", id_)
    return int(m.group(1)) if m else 10**15


def read_tasks(repo: str | Path) -> list[Task]:
    d = Path(repo, "backlog", "tasks")
    out: list[Task] = []
    try:
        files = sorted(d.glob("*.md"))
    except OSError:
        return []
    for f in files:
        try:
            t = parse_task(f.read_text(encoding="utf8"))
        except (OSError, UnicodeDecodeError):
            continue
        t.id = t.id or f.name
        t.title = t.title or f.name
        t.file = f.name
        out.append(t)
    return sorted(out, key=lambda t: _num(t.id))


@dataclass
class Milestone:
    id: str
    title: str


def read_milestones(repo: str | Path) -> list[Milestone]:
    d = Path(repo, "backlog", "milestones")
    out: list[Milestone] = []
    try:
        files = sorted(d.glob("*.md"))
    except OSError:
        return []
    for f in files:
        try:
            data, _ = _frontmatter(f.read_text(encoding="utf8"))
        except (OSError, UnicodeDecodeError):
            continue
        if _scalar(data.get("id")):
            out.append(Milestone(_scalar(data["id"]), limpiar(_scalar(data.get("title")))))
    return sorted(out, key=lambda m: _num(m.id))
```
`textos.py`:

```python
import re

_CONTROL = re.compile("[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]+")


def limpiar(s) -> str:
    return re.sub(r" {2,}", " ", _CONTROL.sub(" ", str(s if s is not None else ""))).strip()


def recortar(s: str, n: int) -> str:
    return s if len(s) <= n else s[: max(n - 1, 0)] + "…"
```
`config.py`, `registry.py`: ports directos de `lib/config.mjs` / `lib/registry.mjs` (misma normalización: minúsculas, `\`→`/`, sin barra final, prefijo con `/`); excepciones `ConfigError`, `RegistryError`.
- [ ] **Step 4: Ejecutar y ver que pasa.** `pytest -q` → verde.
- [ ] **Step 5: Commit** `feat(tui): config, textos, registro y lector de tarjetas`.

---

### Task 2: Fases en Python (derivación y aprobación atómica)

**Files:** Create `tui/hq/fases.py`, `tui/tests/test_fases.py`.

**Interfaces — Produces:** `load_fases(repo) -> list[dict]` (ausente → `[]`; dañado → `FasesError`); `derive(fases, tasks, milestones) -> list[Fase]` (`Fase(id,nombre,milestone,aprobada,estado,total,hechas)`); `active(derived) -> Fase|None`; `approve(repo, fase_id, fecha, force=False) -> Fase` (escribe `.hq/fases.json` con temporal + `os.replace`, esquema idéntico al de Node, error si no está `esperando`); `reabrir_fase` NO existe (mejorar una fase crea una tarjeta, ver Task 4).

- [ ] **Step 1: Tests** (mismos escenarios que `tests/fases.test.mjs`): derivación `esperando` (2/2) + `pendiente`; `activa` con tarjeta en curso; fase sin tarjetas `activa`; hito por título; `approve` solo si `esperando` (error con mensaje `no está lista (0/1 …)`), `force`, ya aprobada, id desconocido; aprobada sigue aprobada aunque se reabran tarjetas; **compatibilidad:** un `fases.json` escrito por Node (fixture literal) se lee y un `fases.json` escrito por Python lo lee `node -e` de `lib/fases.mjs` (`loadFases`) sin error (test que invoca `node` si está disponible).
- [ ] **Step 2–4:** fallar, implementar (misma regla que `derivePhases`: primera fase no aprobada es candidata → `esperando` si `total>0 and hechas==total` si no `activa`; las siguientes `pendiente`; las aprobadas `aprobada`), pasar.
- [ ] **Step 5: Commit** `feat(tui): fases (derivacion y aprobacion atomica)`.

---

### Task 3: Eventos, estado de sesión y notas

**Files:** Create `tui/hq/events.py`, `session.py`, `notes.py`, `tui/tests/test_feed_notes_data.py`.

**Interfaces — Produces:**
- `events.read_recent(events_dir, slug, limit=200, hoy=None) -> list[Evento]` (`Evento(t, hora, kind, tool, target, agent, model, texto)`): lee los ficheros de hoy y de ayer, ignora líneas corruptas, ordena por `t`, limpia con `textos.limpiar`; `texto` es la frase en español (`Lee lib/state.mjs`, `Edita …`, `Ejecuta npm test`, `Busca …`, `Subagente ejecutor empieza`, `Cambia a Opus`, `Mensaje del usuario`, `Termina el turno`) según `kind`/`tool`.
- `session.latest(state_dir, slug) -> SesionEstado|None` (la más reciente por mtime con `slug` igual; campos de `state/<sid8>.json`).
- `notes.tree(vault_path, vault_projects_dir, slug) -> list[Nota]` (`Nota(ruta, titulo, tipo)` en `Índice.md`, `Decisiones/*`, `Sesiones/*`, más reciente primero) y `notes.read(ruta) -> str`; `notes.obsidian_uri(vault_path, ruta) -> str` (`obsidian://open?vault=<nombre del vault>&file=<ruta relativa sin .md, URL-encoded>`).

- [ ] **Step 1: Tests:** eventos con una línea corrupta en medio; límite; orden; frases por herramienta (`Read`→Lee, `Edit|Write|MultiEdit`→Edita, `Bash`→Ejecuta, `Grep|Glob`→Busca, desconocida → `Usa <tool>`); `texto` sin caracteres de control aunque el `target` los traiga; carpeta ausente → `[]`. Sesión: elige la más reciente del proyecto e ignora otras y ficheros corruptos. Notas: orden e identificación de tipos; nombre con acentos (`Índice.md`) y espacios; `obsidian_uri` correcto y codificado.
- [ ] **Step 2–4:** fallar, implementar, pasar. **Step 5: Commit** `feat(tui): lectores de eventos, sesion y notas`.

---

### Task 4: Acciones con la puerta humana (seguridad) — lleva revisor

**Files:** Create `tui/hq/actions.py`, `tui/tests/test_actions.py`.

**Interfaces — Produces:** `sanear_texto(s, max=200) -> str`; `class Backlog` con runner inyectable `run(args: list[str], cwd) -> (status, stdout, stderr)`; acciones, todas devuelven `Resultado(ok: bool, mensaje: str)` y nunca lanzan:
- `mover(repo, task_id, estado)` — mueve a cualquier columna **excepto «Hecho»** (rechaza `Hecho`/`Done`: usar `aprobar_tarjeta`).
- `aprobar_tarjeta(repo, task_id)` — `backlog task edit <id> -s "Hecho"` + `--remove-label revisada` en la misma llamada.
- `mejorar_tarjeta(repo, task_id, motivo)` — `backlog task edit <id> -s "En curso" --remove-label revisada --comment "Falta: <motivo saneado>" --comment-author @usuario`; motivo vacío tras sanear → error sin ejecutar.
- `aprobar_fase(repo, fase_id, fecha)` — llama a `fases.approve`.
- `mejorar_fase(repo, fase, motivo)` — `backlog task create "Mejorar: <motivo saneado>" -m "<milestone de la fase>" -s "Planificado"`.
- `validar_id(task_id)`: solo `^[A-Za-z]+-\d+(\.\d+)?$`; `estado` ∈ columnas conocidas; el milestone de una fase pasa por la misma validación de nombre que `lib/fases.mjs`.
Ejecución real: `shutil.which('backlog')` (en Windows `backlog.cmd`) con `subprocess.run([ruta, *args], cwd=repo, capture_output=True, text=True, timeout=30, shell=False)`; si `which` falla → `Resultado(False, 'backlog no está instalado')`. **No se usa `shell=True`.**

- [ ] **Step 1: Tests (con runner falso que registra argumentos):** `sanear_texto('a & b | c "d" `x` $y %z% ^ \n \x1b[0m')` no contiene ninguno de `& | < > ^ % " ' \` $`, ni saltos de línea ni control; recorta a 200; `mover(...,'Hecho')` y `mover(...,'done')` → `ok False` y **el runner no se llama**; `mover(...,'En curso')` llama con `['task','edit','TASK-3','-s','En curso']`; `aprobar_tarjeta` genera exactamente `['task','edit','TASK-3','-s','Hecho','--remove-label','revisada']`; `mejorar_tarjeta` con motivo `'falta la firma & el test'` envía `Falta: falta la firma el test` (saneado) y los flags exactos, y con motivo `'&|<>'` (vacío tras sanear) no ejecuta; ids inválidos (`'TASK-3; rm'`, `'../x'`, `''`) rechazados sin ejecutar; fallo del runner (status≠0) → `Resultado(False, <stderr recortado>)` sin excepción; `aprobar_fase` solo funciona si la fase está `esperando` (usa un repo temporal con `fases.json`) y deja el fichero intacto si falla; `mejorar_fase` crea la tarjeta con `-m <hito>`; ninguna acción acepta `cwd` inexistente (error claro).
- [ ] **Step 2–4:** fallar, implementar, pasar. **Step 5: Commit** `feat(tui): acciones con puerta humana y saneado de texto`.

---

### Task 5: Lienzo Flujo (ampliar el prototipo) y franja de fases

**Files:** Modify `tui/hq/canvas.py`; Create `tui/hq/widgets.py` (clase `Lienzo`), `tui/tests/test_canvas.py`.

**Interfaces:** `disenar(cards, ancho_card, hueco, alto_card, seleccion=None, compacto=False, plegar_vacias=True) -> (Grid, pos)`: la tarjeta con `id == seleccion` lleva borde `#8B7CFF` doble (`╔═╗║╚╝`); columnas vacías (salvo «En curso») se pliegan a un hueco de 5 columnas con su inicial; modo compacto (`ancho_card=22, hueco=6, alto_card=4`: sin línea de skill). Acepta `Card` construidas desde `tasks.Task` (`card_de_task(task, milestones)`). `franja_fases(fases, ancho) -> str` (líneas de la franja: nodos `●` aprobada, `◉` activa, `◎` esperando (ámbar), `○` pendiente, unidos por `─`, con `n/m`). `widgets.Lienzo(ScrollView)` (basado en un prototipo inicial): `set_cards(...)`, `mover_seleccion(dx, dy)`, `seleccionada -> Card|None`, desplazamiento horizontal automático para mantener visible la tarjeta seleccionada, recalcula al cambiar de ancho.

- [ ] **Step 1: Tests (puros, sin Textual):** posiciones de columnas y tarjetas; la misma-columna produce `┴/├` y no hay caracteres fuera del lienzo; el cable cruza otro con `┼`; plegado de columnas vacías reduce el ancho; compacto es más estrecho; selección marcada con `╔`; 200 tarjetas se diseñan en < 500 ms; caracteres de control en títulos no llegan al grid. **Pilot:** `Lienzo` con 3 tarjetas, `pilot.press('right','down')` mueve la selección y hace scroll hasta mostrarla; no lanza con 0 tarjetas.
- [ ] **Step 2–4:** fallar, implementar, pasar. **Step 5: Commit** `feat(tui): lienzo Flujo con seleccion, plegado y modo compacto`.

---

### Task 6: Pantalla del tablero con detalle y diálogos de aprobación — lleva revisor

**Files:** Create `tui/hq/screens/board.py`, `tui/hq/screens/__init__.py`, `tui/hq/app.py` (esqueleto `HQApp(modo, slug)`), `tui/tests/test_board_screen.py`.

**Comportamiento (spec §5–§6):** cabecera con proyecto, % de progreso, fase activa (franja) y modelo/contexto/coste de la sesión (si hay); lienzo; panel de detalle al pulsar Enter (criterios con ✓/·, comentarios, dependencias, modelo/skill, `revisada`). Teclas: flechas/`hjkl` mover; Enter detalle; `a` aprobar tarjeta (solo si está en «Verificando» y tiene `revisada`; si no, mensaje explicando por qué); `m` mejorar (pide motivo en un `Input`); `A` aprobar fase (solo si `esperando`); `M` mejorar fase (pide motivo); `c` compacto; `r` refrescar; `?` ayuda; `q` salir. Toda aprobación pasa por un `ModalScreen` de confirmación («¿Apruebas <id> <título>? [s/N]»; Esc/n cancela y no ejecuta nada). Arrastrar con el ratón mueve entre columnas **salvo hacia «Hecho»**, que muestra «pasa por la puerta: usa `a`». Resultado de cada acción (ok/error) en una barra de estado inferior. Refresco por sondeo cada 1 s comparando mtimes (tarjetas, `fases.json`); si nada cambió no relee.

- [ ] **Step 1: Tests pilot con un repo temporal y un `Backlog` falso inyectado en la app:** (1) `a` sobre una tarjeta `Verificando`+`revisada` abre el diálogo; `n`/Esc → **el runner no se llama**; `s` → llama `aprobar_tarjeta` una vez. (2) `a` sobre tarjeta sin `revisada` o fuera de «Verificando» → mensaje, runner no llamado. (3) `m` pide motivo; Enter con `falta test & firma` llama `mejorar_tarjeta` con texto saneado; Esc cancela. (4) `A` solo con fase `esperando`; confirma; invoca `fases.approve`; con la fase `activa` → mensaje. (5) arrastrar/mover hacia «Hecho» no llama a `backlog`. (6) refresco: tras escribir una tarjeta nueva en disco, en ≤ 2 s aparece sin reiniciar. (7) proyecto sin tarjetas / sin fases / registro vacío → mensajes, sin traceback. (8) un `backlog` que falla muestra el error en la barra y el estado no cambia. (9) títulos con `\x1b[31m` no llegan a pantalla (inspeccionar `app.export_screenshot()` o el grid).
- [ ] **Step 2–4:** fallar, implementar, pasar. **Step 5: Commit** `feat(tui): pantalla del tablero con puertas de aprobacion`.

---

### Task 7: Pantalla del feed «Ahora mismo»

**Files:** Create `tui/hq/screens/feed.py`, `tui/tests/test_feed_screen.py`.

Cabecera (modelo con color Opus `#C58BFF` / Sonnet `#6EA8FF` / Haiku `#5ED3C2`, contexto %, coste, tokens) leída de `session.latest`; lista de eventos de `events.read_recent` (hora, punto de color del modelo, frase); se actualiza cada segundo añadiendo solo los nuevos; se mantiene pegado al final salvo que el usuario haya subido con el ratón/teclas (`End` vuelve); sin eventos → «Sin actividad todavía: abre una sesión de Claude Code en este proyecto». Test pilot: añadir una línea al `.jsonl` y verla aparecer; línea corrupta ignorada; sin sesión → cabecera con «sin sesión»; eventos con secuencias de escape saneados; 500 eventos no ralentizan (< 300 ms por refresco). Commit `feat(tui): pantalla del feed`.

---

### Task 8: Pantalla de notas

**Files:** Create `tui/hq/screens/notes.py`, `tui/tests/test_notes_screen.py`.

Lista de notas (Índice, Decisiones, Sesiones) a la izquierda y `textual.widgets.Markdown` a la derecha; `o` abre la nota en Obsidian (`os.startfile(obsidian_uri)` en Windows; en el test se inyecta una función falsa y se comprueba la URI), `e` abre el fichero con el editor por defecto (`os.startfile(ruta)`, inyectable), `r` refresca; sin notas → mensaje; nota enorme (> 200 KB) se recorta con aviso; frontmatter se muestra como bloque aparte. Tests pilot con vault temporal. Commit `feat(tui): pantalla de notas`.

---

### Task 9: Pantalla global, CLI y `hq open`

**Files:** Create `tui/hq/screens/global_.py`, `tui/hq/cli.py`, `tui/tests/test_cli.py`, `tui/tests/test_global_screen.py`.

`hq` sin argumentos: lista de proyectos del registro con pipeline de progreso (hechas/total), fase activa, tarjeta en curso y última actividad (último evento); Enter ejecuta `open_proyecto` (inyectable; por defecto `node <HQ_ROOT>/scripts/hq-open.mjs <slug>` con `subprocess.Popen` sin shell). `hq board|feed|notes [slug]`: slug por defecto = proyecto del cwd (`find_by_path`); si no hay → lista y error claro (código 2). `hq open <slug>`. `--config RUTA`. Errores de configuración → mensaje en una línea y código 1 (sin traceback). Tests: parseo de argumentos, slug por defecto desde cwd, proyecto inexistente, config dañada, `open` llama al lanzador con los argumentos correctos (runner inyectado), pantalla global con 0, 1 y 20 proyectos. Commit `feat(tui): pantalla global y CLI hq`.

---

### Task 10: Instalación, integración y prueba real (la hace el controlador con el usuario; CON PARADAS)

- [ ] **Step 1 (pide permiso):** instalar `pytest` en `tui/.venv`; ejecutar toda la suite de `tui` y `npm test`.
- [ ] **Step 2 (pide permiso):** `uv tool install --editable "<repo-project-hq>\tui"` (da `hq.exe` en `~\.local\bin`, que ya está en el PATH de usuario). Comprobar `hq --help` y `hq board demo-hq` dentro de Windows Terminal real: lienzo, desplazamiento, modo compacto.
- [ ] **Step 3:** abrir `node scripts/hq-open.mjs demo-hq` (reparto real con paneles que ya funcionan) y revisar con el usuario lo que ve; ajustar `buildWtArgs` si hace falta (tamaños, foco).
- [ ] **Step 4:** probar las puertas con el usuario en `demo-hq` (tarjeta `revisada` → `a`/`m`; fase `esperando` → `A`/`M`) y comprobar que el hook de puerta bloquea el mismo cambio hecho por Claude.
- [ ] **Step 5 (Node, pequeño):** `scripts/new-project.mjs` y `commands/nuevo-proyecto.md`: al terminar, si `hq` está en el PATH, ejecutar `hq open <slug>` en lugar de solo abrir `backlog browser`; tests de Node con `open` inyectable; subir `version` del plugin a `0.3.0` y actualizar con permiso.
- [ ] **Step 6:** README (sección «HQ en la terminal» pasa de «en construcción» a uso diario), registro de decisiones, merge a `master`.

---

## Self-review

**Spec (`2026-10-08-terminal-hq-design.md`):** §5 pantallas `hq`, `board`, `feed`, `notes`, `open` → Tasks 5–9; teclas `a/m/A/M`, Enter, `c`, `r`, `?`, `q`, ratón sin llegar a «Hecho» → Task 6; refresco automático → Tasks 6–7; paleta de modelos → Tasks 5, 7; §6.1 puerta de tarjeta y §6.2 de fase → Tasks 2, 4, 6; seguridad de texto (control/bidi/metacaracteres) → Tasks 1, 4; riesgos 1 (cables) retirado por el prototipo, 6 (UTF-8) cubierto con `PYTHONUTF8=1`; instalación con `uv` y statusline ya hecha → Task 10. **Fuera de este plan:** XP/niveles/logros y presupuesto de tokens (subsistema 4), web/móvil.
**Placeholders:** ninguno; los widgets y pantallas se describen por comportamiento y tests exactos y se apoyan en el prototipo, a propósito (plan ligero).
**Tipos:** `Task` (Task 1) usada en `fases.derive` (Task 2), `canvas.card_de_task` (Task 5) y pantallas; `Resultado` (Task 4) usado por la pantalla (Task 6); `Evento`/`SesionEstado` (Task 3) por el feed (Task 7).
