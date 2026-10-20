---
description: Implementa una tarjeta (id o "siguiente") con el subagente ejecutor
argument-hint: [id | siguiente]
model: sonnet
---
Tarjeta a ejecutar: "$ARGUMENTS" (vacío o "siguiente" = la próxima). Ejecuta estos bloques con la herramienta Bash (Git Bash), nunca con PowerShell.

1. Mira las fases: `node "${CLAUDE_PLUGIN_ROOT}/scripts/fases.mjs" status`. Si `fases` está vacío, el proyecto no usa fases: trabaja como siempre. Si `activa` es null con fases definidas, todas están aprobadas. Si la fase indicada en `activa` está en estado `esperando`, no sigas al paso 2 (todas sus tarjetas están hechas): dile al usuario que la apruebe en `cc` (tecla `A`) o indique qué falta (tecla `M`); si aún no tienes `cc`, abre tu propia terminal y ejecuta `node "<ruta de project-hq>/scripts/fases.mjs" approve f1`.
2. Si es "siguiente": `backlog task list -s "Planificado" -m "<nombre de la fase activa>" --ready --plain` (sin `-m` si no hay fases) y elige la primera por orden de id; comprueba que la línea `Milestone:` de la tarjeta (`backlog task <id> --plain`) es la fase activa: `-m` filtra por coincidencia aproximada. Si el usuario pasa el id de una tarjeta de otra fase, avísale de que esa fase aún no está activa y pregunta antes de seguir.
3. Calcula el modelo y el esfuerzo de la tarjeta: `node "${CLAUDE_PLUGIN_ROOT}/scripts/modelo-tarjeta.mjs" <id>`. Imprime un JSON. Si el comando falla, para y muestra el error. Si `parar` es `true`, NO ejecutes: muestra `mensaje` y pide al usuario que divida la tarjeta o decida qué hacer.
4. Delega con la herramienta Agent, copiando del JSON sin cambiarlos: `subagent_type` = `project-hq:ejecutor` (o `ejecutor` si así aparece en tu lista de agentes), `model` = el valor de `model` y `effort` = el valor de `effort`. Pasa siempre `model` y `effort`, aunque coincidan con los del agente. En el prompt pon solo: el id de la tarjeta, la línea `Modelo: <model>/<effort> intento <intento>` y, si `rechazos` es mayor que 0, que trate primero los comentarios que empiezan por `Falta:`. No le cuentes nada más.
5. Resume el resultado del subagente en 5 líneas máximo.
6. Sugiere /revisar. La tarjeta solo pasa a "Hecho" cuando el usuario la aprueba en `cc` (si aún no tienes `cc`, escribe tú mismo `! backlog task edit <id> --status Hecho`). Claude no debe ejecutar estos comandos: son tuyos. Al terminar, /guardar y /clear. Una tarjeta por sesión.
