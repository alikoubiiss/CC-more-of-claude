---
description: Carga solo el índice del proyecto, la tarjeta activa y las últimas decisiones
model: sonnet
---
Ejecuta `node "${CLAUDE_PLUGIN_ROOT}/scripts/hq-state.mjs"` con la herramienta Bash (Git Bash) y muestra el resultado.

1. Resumen de la sesión anterior: si hay "Último resumen (/guardar)", lee solo ese fichero. Lee el "Último auto-snapshot" únicamente si no hay resumen manual o si el auto-snapshot es de un día posterior al del resumen manual (la fecha va al principio del nombre del fichero). No leas ambos enteros por defecto.
2. Lee el Índice solo si falta contexto. No leas más del vault. Si el resultado trae la línea "Conocimiento: <ruta>" y la tarea toca un tema que podría estar ahí, lee solo ese `index.md` y, de él, únicamente la nota que encaje; nunca la carpeta entera.
3. El tablero y las aprobaciones están en `cc` (terminal): no arranques ningún servidor web. Si el usuario quiere verlo, dile que ejecute `cc start` en una terminal.
4. Termina diciendo cuál es la siguiente acción recomendada (tarjeta activa, "Por revisar" con /revisar, o /ejecutar siguiente).
