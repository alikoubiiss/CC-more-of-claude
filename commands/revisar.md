---
description: Verificación independiente de una tarjeta contra sus criterios de aceptación
argument-hint: [id]
model: sonnet
---
Tarjeta a revisar: "$ARGUMENTS" (vacío = la que esté en "Verificando" sin la etiqueta `revisada`: `backlog task list -s "Verificando" --plain`). En ese caso, para cada candidata ejecuta `backlog task <id> --plain` y DESCARTA las tarjetas cuya línea `Labels:` contenga `revisada` (ya revisadas, esperando al usuario); si no queda ninguna, di que no hay nada que revisar.

Antes de delegar calcula el revisor de la tarjeta: `node "${CLAUDE_PLUGIN_ROOT}/scripts/modelo-tarjeta.mjs" <id>` (imprime un JSON; si falla, para y muestra el error). Delega con la herramienta Agent, copiando del JSON sin cambiarlos: `subagent_type` = `project-hq:revisor` (o `revisor` si así aparece en tu lista de agentes), `model` = el valor de `revisorModel` y `effort` = el valor de `revisorEffort`. Pasa siempre los dos. Si el usuario dice que la tarjeta es crítica, usa como mínimo `model` = `opus` y `effort` = `high`. En el prompt pon solo el id y la línea `Modelo: <revisorModel>/<revisorEffort> intento <intento>`: no le cuentes cómo se implementó ni le pases detalles de la implementación. Muestra su tabla criterio/resultado y el veredicto.

Si el revisor da el visto bueno, la tarjeta se queda en "Verificando" marcada como revisada: el usuario decide si pasa a "Hecho" (tecla `a` en `cc`) o si falta algo (tecla `m`). Díselo así y no muevas la tarjeta tú; si aún no tienes `cc`, escribe tú mismo en el prompt de Claude Code `! backlog task edit <id> --status Hecho`. Claude no debe ejecutar estos comandos: son tuyos.

