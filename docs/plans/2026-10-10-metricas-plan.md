# Control de gasto de tokens y gamificación — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. **Plan ligero:** código completo solo en lo delicado (delta/throttle, clasificación `mem`, estado de presupuesto); el resto lleva interfaces exactas y casos de test.

**Goal:** Registrar el gasto real por sesión/tarjeta/modelo, avisar al acercarse al presupuesto (sin bloquear), mostrarlo en `hq stats` con uso de memoria y una gamificación ligera calculada al leer.

**Architecture:** Node escribe (`lib/metrics.mjs`, llamado desde la statusline, el hook de eventos y SessionStart); Python lee y calcula (`tui/hq/stats.py`, `gamificacion.py`) y muestra (`screens/stats.py`, cabecera del tablero). Historial en `<dataDir>\metrics\<slug>\AAAA-MM-DD.jsonl` solo con números.

**Tech Stack:** Node ≥ 22 (`node:test`), Python 3.12 + Textual (`unittest`, venv `tui/.venv`). Sin dependencias nuevas.

**Spec:** `docs/specs/2026-10-10-metricas-design.md` (autoridad).

## Global Constraints

- Rama `feat/metricas`; commits con `Co-Authored-By: Claude <modelo> <noreply@anthropic.com>`. `npm test` (323) y `cd tui && PYTHONUTF8=1 .venv/Scripts/python.exe -m unittest discover -s tests -t .` (96) deben seguir en verde.
- La **statusline nunca puede romperse ni tardar**: todo lo nuevo va en try/catch y escribe una sola línea.
- Solo números, nombre de modelo, `TASK-n` y slug en las métricas. Nada de texto de prompts/respuestas. Slug con `/^[a-z0-9-]+$/` (fuera de proyecto: `sin-proyecto`).
- Todo texto que venga de ficheros y llegue a la terminal se limpia (`limpiar` en Python; en Node la statusline ya limpia caracteres de control **antes** de añadir colores ANSI).
- La gamificación solo da XP por acciones verificadas por el usuario (tarjeta «Hecho», fase aprobada) y por gasto real; nunca por eventos que Claude pueda generar solo.

## Review Focus

1. Doble conteo de gasto (sesión que cruza medianoche, primera foto con coste alto, reinicio de sesión) — Task 1.
2. Tarjeta equivocada atribuida; cambio de tarjeta entre fotos — Tasks 1–2.
3. Statusline lenta o rota si falla el disco, el historial está corrupto o la config de presupuesto es inválida — Tasks 1–2.
4. Inyección: colores ANSI/caracteres de control vía nombre de tarjeta o proyecto — Tasks 2, 6.
5. XP o logros que se puedan obtener sin acción del usuario — Task 5.

---

### Task 1: Núcleo de métricas y presupuesto

**Files:** Create `lib/metrics.mjs`, `tests/metrics.test.mjs`. Modify `lib/config.mjs` (+`presupuesto`, `metricsDir`), `tests/config.test.mjs`, `tests/helpers.mjs` (`makeCfg` añade `metricsDir`), `config.json` (`presupuesto: {diaUsd: 50, tarjetaUsd: 15}`).

**Interfaces — Produces:**
- `loadConfig` devuelve `metricsDir = <dir>/metrics` y `presupuesto = {diaUsd, tarjetaUsd}|null` (números > 0 o error `config: "presupuesto.diaUsd" debe ser un número > 0`).
- `metricsFile(cfg, slug, date)`, `appendMetric(cfg, slug, linea, now)` (una línea JSON; límite 5 MB por fichero; slug inválido → error), `readMetrics(cfg, slug, {desde, hasta})` (líneas válidas, ignora corruptas), `pruneMetrics(cfg, now, days = 400)`.
- `planSnapshot(rec, snap, now) -> { escribir: boolean, delta: number }`:

```js
export function planSnapshot(rec, snap, now) {
  // rec = {t, cost, model, card} de la última foto escrita de esta sesión (o null); snap = {cost, model, card}
  const cost = Number.isFinite(snap.cost) ? snap.cost : null;
  if (cost === null) return { escribir: false, delta: 0 };
  let delta;
  if (!rec || !Number.isFinite(rec.cost)) delta = cost <= 0.5 ? cost : 0;   // sesión ya en marcha: no arrastra lo anterior
  else if (cost < rec.cost) delta = cost;                                    // sesión reiniciada
  else delta = cost - rec.cost;
  const cambio = !rec || delta >= 0.01 || snap.model !== rec.model || snap.card !== rec.card
    || now.getTime() - new Date(rec.t).getTime() >= 5 * 60 * 1000;
  return { escribir: cambio, delta: Math.round(delta * 1e6) / 1e6 };
}
```
- `appendSnapshot(cfg, slug, snap, delta, now)` escribe la línea `snap` y actualiza `tarjetas.json` (`{TASK-n: usd}`; sin tarjeta no suma) de forma atómica; `totalesTarjetas(cfg, slug)`; `gastoDia(cfg, date) -> usd` (suma `delta` de `snap` de hoy, todos los proyectos); `estadoPresupuesto(usado, limite) -> {pct, estado: 'ok'|'aviso'|'pasado'|'sin'}` (aviso ≥ 80, pasado ≥ 100, sin límite → `sin`).

- [ ] **Step 1: Tests:** `planSnapshot` (primera foto 0,2 → delta 0,2; primera foto 108 → delta 0 y escribe; delta < 0,01 sin cambios y < 5 min → no escribe; cambio de modelo/tarjeta → escribe aunque delta 0; coste menor que el anterior → delta = coste; ≥ 5 min → escribe; coste null → no escribe); `appendSnapshot` + `readMetrics` ida y vuelta; **sesión que cruza la medianoche suma una sola vez** (dos ficheros, `gastoDia` de cada día suma solo sus `delta`); `tarjetas.json` suma por tarjeta y no se rompe con JSON corrupto (se reconstruye); línea corrupta ignorada; slug inválido rechazado; fichero lleno (5 MB) no escribe y no lanza; `pruneMetrics` borra > 400 días; `estadoPresupuesto` en 79/80/99/100/150 % y sin límite; config: presupuesto inválido/ausente.
- [ ] **Step 2–4:** fallar, implementar, pasar. **Step 5: Commit** `feat(metricas): registro del gasto y presupuesto`.

---

### Task 2: Integración con la statusline

**Files:** Modify `lib/statusline.mjs`, `scripts/statusline.mjs`, `lib/session-state.mjs` (campos `rec_*`, `presupuesto` en el estado), `tests/statusline.test.mjs`.

**Interfaces:** `formatStatusline({..., presupuesto})` donde `presupuesto = {dia: {pct, estado}, tarjeta: {id, pct, estado}}|null`: añade `⚠ día 82%` y/o `⚠ TASK-3 104%` solo en `aviso`/`pasado`, coloreados (`\x1b[33m` ámbar, `\x1b[31m` rojo, `\x1b[0m`) **después** de limpiar el texto. El script: lee el estado previo, `planSnapshot`; si `escribir`, `appendSnapshot`, recalcula presupuestos (día con `gastoDia`, tarjeta con `totalesTarjetas`) y guarda `rec_t/rec_cost/rec_model/rec_card/presupuesto` en el estado de sesión; si no escribe, reutiliza el `presupuesto` guardado. Todo lo de métricas en su propio `try/catch` (un fallo no cambia la línea ni el código de salida).

- [ ] **Step 1: Tests:** formato con aviso/pasado/ok/sin presupuesto; un nombre de tarjeta con `\x1b[31m` no mete colores ni controles; script de punta a punta con `spawnSync` y `HQ_CONFIG` temporal: primera ejecución escribe foto y devuelve la línea; segunda con el mismo coste no escribe; con `metricsDir` imposible de crear (fichero en su lugar) la línea sale igual y el código es 0; presupuesto inválido en config → línea normal.
- [ ] **Step 2–4:** fallar, implementar, pasar. **Step 5: Commit** `feat(metricas): la statusline registra el gasto y avisa del presupuesto`.

---

### Task 3: Uso de la memoria (mem) e inicio de sesión

**Files:** Modify `lib/events.mjs` (`summarize(input, {now, mainModel, vaultPath, conocimientoPath})` añade `mem`), `hooks/event.mjs`, `hooks/session-start.mjs`, `tests/events.test.mjs`, `tests/event-hook.test.mjs`, `tests/hooks.test.mjs`.

**Interfaces:** `claseMem(tool, ti, {vaultPath, conocimientoPath}) -> 'nlm'|'vault'|'conocimiento'|null`: `Read` con `file_path` dentro de `conocimientoPath` → `conocimiento`; dentro de `vaultPath` → `vault` (la comprobación de `conocimiento` va primero porque está dentro del vault HQ); `Bash` con comando que empieza (tras espacios) por `nlm` y contiene `query` → `nlm`; inicio del subagente `investigador` (`kind: subagent_start`) → `nlm`. `evt.mem` solo cuando no es `null`. El hook de eventos añade a las métricas `{t, sid, kind:"mem", mem}`; SessionStart añade `{t, sid, kind:"inicio", chars}` (longitud del contexto inyectado).

- [ ] **Step 1: Tests:** clasificación (rutas con barras de Windows, mayúsculas distintas, prefijo parecido `ProjectHQ2` no cuenta, `nlm notebook query`, `nlm login` no cuenta, `Bash` con `echo nlm query` no cuenta); `summarize` sin rutas configuradas no falla; el hook escribe la línea `mem` y no escribe nada si no hay proyecto; SessionStart escribe `inicio` solo si hay contexto; un fallo de escritura no rompe el hook (código 0).
- [ ] **Step 2–4:** fallar, implementar, pasar. **Step 5: Commit** `feat(metricas): uso de la memoria e inicio de sesion`.

---

### Task 4: Lectura y resumen de gasto (Python)

**Files:** Create `tui/hq/stats.py`, `tui/tests/test_stats.py`. Modify `tui/hq/config.py` (+`metrics_dir`, `presupuesto`).

**Interfaces — Produces:** `leer(metrics_dir, slug=None, desde=None) -> list[dict]` (ignora corruptas, limpia `card`/`model`/`slug` con `limpiar`); `resumen(lineas, hoy: date, presupuesto) -> Resumen` con `hoy_usd`, `semana_usd` (últimos 7 días incl. hoy), `mes_usd` (mes natural), `por_proyecto`, `por_tarjeta` (orden descendente, `sin tarjeta` incluida), `por_modelo`, `tendencia: list[(date, usd)]` (14 días, ceros incluidos), `dia: Estado`, `memoria: {nlm, vault, conocimiento, inicio_medio_chars}`, `n_datos`; `estado(usado, limite)` con los mismos umbrales que Node. Suma `delta` de `snap` (nunca `cost`).

- [ ] **Step 1: Tests (mismos casos que Node para umbrales y para la medianoche):** totales hoy/semana/mes con fechas fijas; por tarjeta/modelo/proyecto; tendencia con huecos; memoria cuenta `mem` y media de `inicio`; vacío → `n_datos == 0`; línea corrupta y `delta` no numérico ignorados; nombres con escapes limpiados; `estado` en 79/80/99/100 %.
- [ ] **Step 2–4:** fallar, implementar, pasar. **Step 5: Commit** `feat(tui): lectura y resumen de gasto`.

---

### Task 5: Gamificación (Python)

**Files:** Create `tui/hq/gamificacion.py`, `tui/tests/test_gamificacion.py`. Modify `tui/hq/tasks.py` (+`updated: str` desde `updated_date`, limpiado; `Task.updated` fecha `AAAA-MM-DD` o `''`) y su test.

**Interfaces:** `calcular(tareas_hechas: list[(fecha, id)], fases_aprobadas: list[fecha], gasto_por_dia: dict[date,float], gasto_por_tarjeta: dict[str,float], memoria: dict, decisiones: int, hoy: date, presupuesto) -> Estado` con `xp`, `nivel` (1–10), `xp_siguiente`, `racha`, `logros: list[(id, nombre, conseguido: bool)]`. Reglas exactas del spec §4 (umbrales de nivel `[0,20,50,100,180,300,480,720,1050,1500]`; racha termina hoy o ayer; «dentro de presupuesto» solo si hay límite configurado). Sin `presupuesto`, no hay XP ni logros de presupuesto.

- [ ] **Step 1: Tests (fechas fijas):** XP de tarjetas (+10, +5 si gasto > 0 y ≤ límite, nada de +5 sin límite o sin gasto), fases +50, días bajo presupuesto +5 (día sin gasto no cuenta), niveles en los umbrales (19/20, 1499/1500), racha (hoy, solo ayer, hueco), cada logro conseguido y no conseguido, `tasks.updated` desde el frontmatter real de Backlog.md y con valores raros, **ningún XP sin tarjeta «Hecho»** aunque haya muchos eventos `mem`.
- [ ] **Step 2–4:** fallar, implementar, pasar. **Step 5: Commit** `feat(tui): gamificacion ligera`.

---

### Task 6: Pantalla `hq stats`, CLI y cabecera del tablero

**Files:** Create `tui/hq/screens/stats.py`, `tui/tests/test_stats_screen.py`. Modify `tui/hq/cli.py` (`stats [slug]`), `tui/hq/app.py` (modo `stats`), `tui/hq/screens/board.py` (línea de nivel/XP y color de presupuesto en la cabecera), `tui/tests/test_cli.py`, `tui/tests/test_board_screen.py`.

**Comportamiento:** pantalla solo lectura con los bloques del spec §4 (`Static`/`DataTable` con `markup=False` y `Text`); barras de gasto frente al presupuesto con color por estado; sin datos → «Sin datos todavía: el gasto se registra mientras trabajas en Claude Code»; `r` refresca; `q` sale; refresco cada 5 s solo si cambió el mtime de la carpeta de métricas. Sin presupuesto: «Sin presupuesto configurado (config.json → presupuesto)». Cabecera del tablero: `Nivel N · XP · racha D días` y el gasto del día coloreado si hay presupuesto.

- [ ] **Step 1: Tests pilot:** pantalla con historial sintético (aparece gasto, tarjeta cara, memoria, logros), vacía, sin presupuesto, con nombres hostiles (`\x1b[31m`, markup `[red]`), `hq stats` y `hq stats demo` en la CLI, slug inexistente (código 2), el tablero sigue funcionando sin carpeta de métricas y con ella.
- [ ] **Step 2–4:** fallar, implementar, pasar. **Step 5: Commit** `feat(tui): pantalla hq stats y cabecera con nivel y presupuesto`.

---

### Task 7: Docs, doctor y versión

**Files:** Modify `README.md`, `lib/checks.mjs` (+test), `.claude-plugin/plugin.json` (`0.5.0`); Create `docs/registro-metricas.md`.

- [ ] **Step 1:** `doctor` informa del presupuesto y de la carpeta de métricas (informativo, nunca falla; test). README: sección «Gasto de tokens» (qué se registra, `hq stats`, presupuesto, límites: modelo principal, sesión en curso al activar). Registro con rulings y menores. Versión 0.5.0. `npm test` y la suite Python en verde.
- [ ] **Step 2: Commit** `feat(metricas): doctor, README y plugin 0.5.0`.

---

### Task 8: Prueba real y cierre (controlador)

- [ ] Sesión real: statusline escribe fotos en `metrics\`; `hq stats` las muestra; revisión final con Opus; arreglos con TDD; merge a `master`; actualizar el plugin a 0.5.0 y reinstalar `hq` si hace falta (`uv tool install --editable`).

## Self-review

- **Cobertura del spec:** §2 → Tasks 1–3; §3 → Tasks 1–2, 6; §4 → Tasks 4–6; §5 → tests de cada tarea y Task 8.
- **Tipos coherentes:** `planSnapshot`/`estadoPresupuesto` (Task 1) los usa Task 2; los umbrales de Python (Task 4) repiten los de Node y se prueban con los mismos casos; `Resumen`/`gasto_por_*` (Task 4) alimentan `calcular` (Task 5) y la pantalla (Task 6).
