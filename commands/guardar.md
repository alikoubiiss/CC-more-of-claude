---
description: Guarda el resumen de la sesión en el vault y prepara el cierre
model: sonnet
---
Guarda la sesión actual. Ejecuta estos bloques con la herramienta Bash (Git Bash), nunca con PowerShell.

1. Redacta un resumen de máximo 10 líneas: qué se hizo, qué quedó pendiente, decisiones tomadas.
2. Guárdalo con este heredoc:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/vault-cli.mjs" session <<'EOF'
{"summary":"<resumen>","activeTask":"<id y título o ninguna>"}
EOF
```
3. Por cada decisión nueva, un heredoc como este:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/vault-cli.mjs" decision <<'EOF'
{"title":"...","context":"...","decision":"...","why":"..."}
EOF
```
El JSON debe ser válido: escapa las comillas dobles y los saltos de línea dentro de los textos (\" y \n). Usa siempre el heredoc con 'EOF' entre comillas simples; nunca echo con el JSON entre comillas simples.
4. Actualiza el estado del proyecto con el subcomando `estado` y un payload `{"estado":"<idea|planificado|en-curso|hecho>"}`, eligiendo el valor que corresponda a la situación real:
   - `en-curso` si hay tarjetas en "En curso" o en "Verificando" (`backlog task list -s "En curso" --plain` y `backlog task list -s "Verificando" --plain`).
   - `hecho` solo si todas las tarjetas están en "Hecho".
   - `planificado` si hay tarjetas pero ninguna empezada (en el resto de casos, incluido "Hecho" mezclado con "Planificado").
   - `idea` si no hay tarjetas.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/vault-cli.mjs" estado <<'EOF'
{"estado":"<valor elegido>"}
EOF
```
5. Confirma las rutas guardadas y el estado elegido, y sugiere /clear.
