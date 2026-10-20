---
description: Vuelca una idea y entrevista al usuario en rondas de máximo 5 preguntas
argument-hint: [idea en texto libre]
model: opus
---
Idea del usuario: $ARGUMENTS

Ejecuta estos bloques con la herramienta Bash (Git Bash), nunca con PowerShell.

1. Carga el estado con `node "${CLAUDE_PLUGIN_ROOT}/scripts/hq-state.mjs"` solo si no lo has cargado en esta sesión.
2. Eres tú, el agente principal, quien entrevista al usuario: haz rondas de máximo 5 preguntas, empezando por objetivo, para quién y criterio de éxito. Puedes consultar al subagente `arquitecto` para redactar la siguiente ronda o un borrador de diseño, pasándole las respuestas que tengas hasta ese momento.
3. Cuando haya claridad, guarda un resumen de la idea con este heredoc:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/vault-cli.mjs" session <<'EOF'
{"summary":"<idea y decisiones iniciales>"}
EOF
```
El JSON debe ser válido: escapa las comillas dobles y los saltos de línea dentro de los textos (\" y \n). Usa siempre el heredoc con 'EOF' entre comillas simples; nunca echo con el JSON entre comillas simples.
4. Cuando el usuario confirme que la idea está clara, pasa tú directamente al plan, sin pedirle que escriba /planificar: sigue los pasos de /planificar (delega en `arquitecto`, consulta a `skill-scout` antes de crear las tarjetas, crea las fases y las tarjetas en «Planificado» con sus criterios y etiquetas de modelo y esfuerzo, pasa el lint y presenta el plan) y espera su aprobación. Si aún faltan datos, sigue preguntando. No escribas código.
5. Recuerda al usuario cómo sigue el flujo: las fases y las tarjetas las aprueba él en `cc` (teclas `A` y `a`), y no se pasa a la siguiente fase hasta que dé su visto bueno; después, /ejecutar siguiente.
