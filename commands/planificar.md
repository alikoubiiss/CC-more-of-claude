---
description: Diseña la arquitectura y crea las tarjetas del backlog con criterios, dependencias y estimación
model: opus
---
Planifica el proyecto actual. Trabaja en modo plan: no escribas código del producto. Ejecuta estos bloques con la herramienta Bash (Git Bash), nunca con PowerShell.

1. Carga el contexto: `node "${CLAUDE_PLUGIN_ROOT}/scripts/hq-state.mjs"`. Si trae la línea "Conocimiento: <ruta>", consulta ese `index.md` y lee solo las notas que apliquen al proyecto (nunca la carpeta entera).
2. Delega en `arquitecto` el diseño: `docs/ARQUITECTURA.md`, decisiones en el vault, las **fases** del proyecto (3 a 6) y la **lista de tarjetas propuestas** (título, fase y resumen de una línea), todavía sin crearlas en Backlog.md.
3. Antes de crear ninguna tarjeta, delega en `skill-scout` con esa lista (por tarjeta, o para el proyecto si son muchas). Después vuelve a delegar en `arquitecto` pasándole sus recomendaciones para que cree las tarjetas en "Planificado", cada una en su fase, con las etiquetas `modelo:`, `esfuerzo:`, `riesgo:`, `est:` y `skill:` (y la tarjeta `Verificar TASK-n` de cada `riesgo:alto`). No instales nada sin aprobación del usuario.
4. Antes de presentar el plan ejecuta el lint de tarjetas: `node "${CLAUDE_PLUGIN_ROOT}/scripts/lint-tarjetas.mjs"`. Si sale con errores, devuelve la salida al `arquitecto` para que corrija esas tarjetas (`backlog task edit`) y repite el lint hasta que no haya errores; los avisos muéstralos al usuario. Después presenta el plan (fases, tarjetas por fase con su modelo/esfuerzo, orden, dependencias) y espera aprobación antes de cualquier implementación.
5. Al aprobarse, actualiza el estado del proyecto con el subcomando `estado` y el payload `{"estado":"planificado"}`:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/vault-cli.mjs" estado <<'EOF'
{"estado":"planificado"}
EOF
```
Las fases las aprueba el usuario en `cc` (tecla `A`); hasta entonces solo se trabaja la fase activa; si aún no tienes `cc`, abre tu propia terminal y ejecuta `node "<ruta de project-hq>/scripts/fases.mjs" approve f1`. Claude no debe ejecutar estos comandos: son tuyos.
Después sugiere /ejecutar siguiente.
