---
description: Crea un proyecto HQ completo (repo, tablero Backlog.md, nota en Obsidian, cuaderno NotebookLM) y abre el tablero
argument-hint: <nombre>
model: sonnet
---
Crea el proyecto "$ARGUMENTS".

1. Valida el nombre ANTES de ejecutar nada: solo puede contener letras (incluidas las acentuadas y la ñ), dígitos, espacios, guion y guion bajo, con un máximo de 60 caracteres. Si contiene cualquier otra cosa (comillas, `$`, acentos graves, `;`, `&`, `|`, `<`, `>`, `(`, `)`, `*`, `?`, `\`, `#` o saltos de línea), no lo ejecutes: recházalo y pide otro nombre. Si está vacío, pregúntalo y detente.
2. Ejecuta con el nombre ya validado entre comillas simples: `node "${CLAUDE_PLUGIN_ROOT}/scripts/new-project.mjs" '<nombre>'`. Lánzalo con la herramienta Bash usando un timeout de 300000 ms (crear el proyecto puede tardar varios minutos). La validación garantiza que no hay ninguna comilla simple dentro del nombre.
3. Muestra el informe (una línea por paso). No hay tablero web: el tablero y las aprobaciones están en `cc` (terminal).
4. Si algún paso salió ✗, explica la causa en una frase y cómo arreglarlo. El proyecto nace **sin tarjetas**: no crees ninguna; las tarjetas se definen después del primer prompt del usuario con /idea y /planificar. No reintentes en bucle.
5. Si todo salió bien y el comando `cc` está instalado (`where cc` lo encuentra), abre los paneles con `cc open <slug>` (el slug es el nombre en minúsculas con guiones, el mismo que aparece en el informe) y avisa de que se abrió una ventana de Windows Terminal. Si `cc` no está instalado, sugiere instalarlo (`uv tool install --editable <ruta de project-hq>\tui`).
6. Termina diciendo: abre una sesión en la carpeta del proyecto y usa /idea.
