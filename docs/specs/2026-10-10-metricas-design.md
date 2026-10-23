# Subsistema 4: control de gasto de tokens y gamificación ligera

Fecha: 2026-10-10 · Estado: aprobado de palabra por el usuario (leerá el spec más adelante) · Depende de: Núcleo (statusline, eventos, estado de sesión), Terminal (`hq`), Vault (`Conocimiento`).

## 1. Objetivo y alcance

el usuario quiere **controlar y reducir el gasto de tokens**. Decisiones tomadas en la conversación:
- Solo **gasto real**, sin estimaciones de ahorro (no existe una ejecución «sin HQ» con la que comparar).
- **Presupuesto con avisos, sin bloquear nada.**
- **Gamificación ligera** (XP, niveles, racha, logros) como refuerzo.
- Un bloque de **uso de la memoria** real (consultas a NotebookLM, notas del vault y de `Conocimiento` leídas, contexto inyectado al empezar) para ver si se usa la memoria y si baja el coste por tarjeta.

Fuera de alcance: estimaciones de ahorro, bloqueo por presupuesto, notificaciones/sonidos, presupuestos por proyecto (solo global), comparativa A/B.

## 2. Registro del gasto (Node)

Historial nuevo en `<dataDir>\metrics\<slug>\AAAA-MM-DD.jsonl` (`<slug>` = `sin-proyecto` fuera de proyectos), una línea JSON por hecho, **solo números e identificadores** (nunca texto de prompts ni respuestas). Tipos de línea:
- `snap`: `{t, sid, kind:"snap", model, card, cost, delta, tokens_in, tokens_out, ctx_pct}`. `cost` es el coste acumulado de la sesión; `delta` es el gasto desde la foto anterior de esa sesión (así sumar `delta` nunca cuenta dos veces aunque la sesión cruce la medianoche).
- `mem`: `{t, sid, kind:"mem", mem:"nlm"|"vault"|"conocimiento"}`.
- `inicio`: `{t, sid, kind:"inicio", chars}` (caracteres de contexto inyectados por SessionStart).

**Cuándo se escribe una foto (la hace la statusline):** si el coste cambió ≥ 0,01 USD, o cambió el modelo o la tarjeta activa, o pasaron ≥ 5 minutos desde la última. La última foto escrita se recuerda en el estado de sesión existente (`rec_t`, `rec_cost`, `rec_model`, `rec_card`).
**`delta`:** `cost − rec_cost`; si no hay `rec_cost` (primera foto de la sesión) vale `cost` solo si `cost ≤ 0,50`, y 0 si es mayor (una sesión que ya estaba en marcha al activar el sistema no arrastra su gasto anterior); si `cost < rec_cost` (sesión reiniciada) vale `cost`.
**`card`:** la tarjeta «En curso» del proyecto en ese momento (`TASK-n`) o `null`.
**Totales por tarjeta:** `metrics/<slug>/tarjetas.json` (`{"TASK-3": usd}`) se actualiza al escribir cada foto, para saber al instante cuánto lleva una tarjeta; se puede reconstruir sumando `delta` del historial.
**Robustez:** escribir es una sola línea añadida; cualquier fallo se ignora (se anota en el log) y la statusline sigue. Se aplican los mismos límites de tamaño que a los eventos (5 MB por fichero). Retención 400 días (`pruneMetrics`, con la misma poda probabilística que los estados).

**Uso de la memoria (`mem`):** `summarize` de eventos clasifica cada herramienta: `Read` de un fichero dentro de `vaultPath` → `vault`; dentro de `conocimientoPath` → `conocimiento`; `Bash` cuyo comando empieza por `nlm` y contiene `query`, o inicio del subagente `investigador` → `nlm`. El hook de eventos añade además una línea `mem` al historial de métricas (los eventos solo se guardan 7 días; las métricas 400). SessionStart añade la línea `inicio`.

## 3. Presupuestos y avisos

`config.json` (opcional): `presupuesto: {diaUsd, tarjetaUsd}`, números > 0; valores inválidos → error de config claro. Valores iniciales propuestos: `diaUsd: 50`, `tarjetaUsd: 15` (los cambia el usuario).
- **Día:** suma de `delta` de hoy de todos los proyectos. **Tarjeta:** acumulado de `tarjetas.json`.
- **Estado:** `ok` (< 80 %), `aviso` (≥ 80 %), `pasado` (≥ 100 %). Sin presupuesto configurado no hay avisos.
- **Statusline:** añade `⚠ día 82%` / `⚠ TASK-3 104%` (ámbar en `aviso`, rojo en `pasado`, con colores ANSI aplicados después de limpiar caracteres de control). El porcentaje se recalcula solo al escribir una foto y se guarda en el estado de sesión (`presupuesto`), así que la statusline no relee historiales en cada refresco.
- **`hq`:** la cabecera del tablero y `hq stats` usan los mismos umbrales y colores. Nada se bloquea.

## 4. Panel `hq stats` y gamificación (Python)

Nuevo comando **`hq stats [proyecto]`** (sin proyecto, todos). Pantalla Textual solo lectura con: gasto hoy / esta semana / este mes y barra frente al presupuesto; gasto por proyecto, por tarjeta (las más caras primero, con su total acumulado), por modelo (**modelo principal de la sesión**: los subagentes cuentan dentro de la sesión pero Claude Code no da su coste aparte, y el panel lo dice); tendencia de 14 días; coste medio por tarjeta aprobada; bloque **uso de la memoria** (consultas a NotebookLM, lecturas de vault y de `Conocimiento`, media de contexto inyectado al empezar); y la gamificación.

**Gamificación** (`hq/gamificacion.py`), calculada **al leer**, sin base de datos propia:
- **XP:** tarjeta aprobada (estado «Hecho», fecha = `updated_date` de la tarjeta) +10, y +5 más si tuvo gasto > 0 y su total ≤ `tarjetaUsd`; fase aprobada (fecha de `fases.json`) +50; día con gasto > 0 y ≤ `diaUsd` +5.
- **Niveles 1–10:** umbrales de XP `[0, 20, 50, 100, 180, 300, 480, 720, 1050, 1500]`.
- **Racha:** días consecutivos (terminando hoy o ayer) con ≥ 1 tarjeta aprobada.
- **Logros:** `primera-tarjeta`, `primera-fase`, `racha-3`, `racha-7`, `bajo-presupuesto-5` (5 tarjetas aprobadas dentro de presupuesto), `semana-sin-pasarte` (7 días seguidos con gasto ≤ `diaUsd`), `primera-consulta-nlm`, `conocimiento-10` (10 lecturas de `Conocimiento`), `memoria-activa` (≥ 1 `mem` en 7 días seguidos), `decisiones-10` (10 notas en `Decisiones` de los proyectos).
- **Dónde se ve:** una línea en la cabecera del tablero (`Nivel 3 · 85 XP · racha 4 días`) y la lista completa en `hq stats`.

## 5. Seguridad, errores y pruebas

- Solo se guardan números, el nombre del modelo, `TASK-n` y el slug; todo se limpia con las funciones existentes (`limpiar`, `SLUG_RE`). Rutas de escritura validadas contra `metricsDir`.
- Líneas corruptas se ignoran; un historial vacío o ausente muestra «sin datos todavía»; presupuestos inválidos no rompen la statusline (aviso en el log y sin avisos de presupuesto).
- Tests: historiales sintéticos (cambio de tarjeta, reinicio de sesión, sesión que cruza la medianoche, primera foto con coste alto, días sin actividad, presupuesto al 79/80/99/100 %), cálculo de XP/nivel/racha/logros con fechas fijas, clasificación `mem`, la statusline sigue respondiendo si el disco falla, y pantallas Textual con datos vacíos.
- Review focus: doble conteo de gasto, atribución a la tarjeta equivocada, statusline lenta o rota por un fallo de disco, texto de usuario en los ficheros de métricas, colores ANSI inyectables por nombres de tarjeta/proyecto, gamificación que dé XP por acciones no verificadas por el usuario.
