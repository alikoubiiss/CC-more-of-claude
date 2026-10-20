# SDD ledger — plan: docs/plans/2026-10-08-terminal-a-plan.md

Spec: docs/specs/2026-10-08-terminal-hq-design.md (leido; autoridad). Rama: feat/terminal-a (base master 6ad73f6). Suite inicial: 121 tests.

## Preflight scan
| Par / tarea | Productor -> consumidor | Hallazgo |
|---|---|---|
| T1 -> T5,T6 | cfg.eventsDir/stateDir/eventsRetentionDays; makeCfg actualizado | coherente |
| T2 -> T3,T4 | parseTask/readTasks/readMilestones (milestone = ID m-0) | coherente; fases resuelve titulo<->id |
| T3 -> T4,T7 | projectPhases/activePhase/setFases; writeTask/writeMilestone en helpers | coherente; helpers se anade en T3 y se usa en T4 |
| T4 -> T5 | activeTasks (ahora via readTasks) usado por statusline | coherente |
| T5 -> T6 | sid8, modelKey, readSessionState | coherente |
| T6 | hooks.json: Stop conserva stop.mjs primero (test previo [0].hooks[0]) | coherente |
| T7 -> T3 | prompts referencian scripts/fases.mjs (plugin.test escanea scripts existentes) | T3 antes que T7 |
| T8 | buildWtArgs: ';' x5, ruta x4 (corregido en el plan) | coherente |
| T10 | requiere aprobacion del usuario (actualizar plugin, settings.json) | NO delegable |
Autoconsistencia por tarea: sin contradicciones tests/codigo detectadas tras trazar T1-T8 (se corrigieron en el plan: regex Authorization y conteos de wt).

## Rulings
- Ruling: rama feat/terminal-a (sin worktree) — mismo criterio que el Nucleo — coste: renombrar rama.
- Ruling: T10 la ejecuta el controlador con el usuario; T9 (version+README) tambien por el controlador salvo que convenga delegar — coste: ninguno.
- Ruling: modelos: implementadores sonnet (tareas con integracion y Windows: T2,T3,T4,T6,T7,T8) y haiku solo para T1 y T9; revisores sonnet; revision final opus. Trailer Co-Authored-By refleja el modelo que escribe.
Task 1: implemented (commits 6ad73f6..8ef9006), awaiting review
Task 1: review: Approved (0 Critical/Important).
Task 1: minor (deferred -> final review): retencion null se trata como 7 (??); tests sin null/negativo/'7'/limites 1 y 365; eventsDir/stateDir relativos si HQ_CONFIG relativo (coherente con registryFile)
Task 1: complete (commits 6ad73f6..8ef9006, review clean)
Task 2: implemented (commits 8ef9006..d48c592), awaiting review
Task 2: review: Approved (0 Critical; 2 Important plan-mandated, ruled below).
- Ruling: Task 2 Important (1) omision silenciosa de tarjetas ilegibles en readTasks: se acepta (lector de arranque que nunca debe lanzar) — coste: una tarjeta rota no se cuenta sin aviso; (2) solo se lee backlog/tasks, no completed/archive: se acepta por ahora (las tarjetas Hecho siguen en tasks/, verificado en demo-hq) — coste: si el usuario ejecuta `backlog cleanup`, las tarjetas movidas dejan de contar en las fases (hechas/total bajaria y una fase 'esperando' podria volver a 'activa'); REVISAR en la revision final.
Task 2: minor (deferred -> final review): lista inline con comas dentro de comillas; lista en bloque sin sangria; comentario con linea '---' truncado; subtareas TASK-3.1 sin orden estable; fence con espacios finales; sin tests para ids no numericos/subtareas/hito sin id/DoD
Task 2: complete (commits 8ef9006..d48c592, review clean)
Task 3: implemented (commits d48c592..abf9c34), awaiting review
Task 3: review: Approved (0 Critical/Important por el revisor). 
- Ruling: controlador eleva a Important el hallazgo "un agente con Bash puede ejecutar fases.mjs approve" (viola el requisito de puerta humana) y lo ARREGLA en una ronda: (1) el subcomando approve del CLI exige terminal interactiva (stdin y stdout TTY); la aprobacion desde Plan B/hq sera interactiva por diseno; (2) setFases rechaza nombres no-string, que empiecen por '-' o '.', terminen en '.', o con caracteres de control; (3) U+FEFF literal -> ﻿ en scripts/fases.mjs; (4) existencia de hitos sin distinguir mayusculas; (5) JSDoc de force (solo recuperacion manual, permite fuera de orden) y de que renombrar una fase pierde su aprobacion; (6) mensaje de set parcial sugiere re-ejecutar. APLAZAR resto de minors.
Task 3: minor (deferred -> final review): aprobacion fuera de orden con force; read-modify-write sin lock; lista de hitos duplicados; stdin en TTY para set; JSON invalido da SyntaxError crudo; spec dice 3-6 fases y setFases admite 1-8
Task 3: fix round 1/5 dispatched (base abf9c34)
Task 3: fix round 1/5 implemented (commits abf9c34..3c62d24), awaiting scoped re-review
Task 3: fix round 1/5 (5 addressed, 0 open; commits abf9c34..3c62d24)
Task 3: complete (commits d48c592..3c62d24, review clean after 1 fix round)
- Ruling (amendment): el guard TTY NO es frontera de seguridad (revisor lo confirma: pty, node -e con la lib, editar fases.json). Para que la puerta humana sea real frente a agentes se AÑADE una "Task 7b" tras Task 7: hooks/gate.mjs (PreToolUse sobre Bash, sincrono, deny con permissionDecision) que bloquea comandos con `-s "Hecho"`/`--status Hecho` en backlog task edit y `fases.mjs approve`, y escrituras a .hq/fases.json, cuando ocurren dentro de un proyecto HQ; solo si la llamada viene de la sesion/agentes (los comandos que escribe el usuario con `!` no pasan por hooks). Se escribira el detalle en el plan (docs/plans) antes de implementarla y se contrastara el formato real de deny de hooks con la documentacion. Coste si falla: falsos positivos que bloqueen comandos legitimos (mitigar con regex estrictas y test).
Task 4: implemented (commits 3c62d24..56ada31), awaiting review
Task 4: review: Approved (0 Critical/Important).
Task 4: minor (deferred -> final review / plan B): el texto "esperando tu aprobacion en hq" apunta a hq que no existe hasta Plan B; el tope de 1200 corta primero Tablero/decisiones y puede ocultar "-> /revisar"; cada arranque parsea las tarjetas hasta 3 veces; faltan tests de combinaciones (Esperando+Por revisar, fases daniado+Verificando, que la linea de fase sobreviva al tope)
Task 4: complete (commits 3c62d24..56ada31, review clean)
Task 5: implemented (commits 56ada31..9abc414), awaiting review
Task 5: review: Approved with 3 Important (plan-mandated) + minors.
- Ruling: Task 5 ARREGLAR (1) sanear caracteres de control (C0/C1, ESC, \n) en TODAS las partes de formatStatusline antes de recortar, con test (inyeccion de secuencias de escape desde titulos de tarjeta); (2) writeSessionState usa temporal unico (`${file}.${pid}.tmp`) y limpia el temporal si el rename falla; (3) pruneSessionStates solo borra *.json y *.tmp (no otros ficheros futuros en state/). APLAZAR: coste por refresco, aleatoriedad de la poda, coercion de tipos en el estado, formato de numeros, tests de campos ausentes/JSON null. Nota para Task 6 y fases.saveFases: mismo patron .tmp fijo (revisar en revision final).
Task 5: fix round 1/5 dispatched (base 9abc414)
Task 5: fix round 1/5 implemented (commits 9abc414..94a3dc8), awaiting scoped re-review
Task 5: fix round 1/5 (3 addressed, 0 open; commits 9abc414..94a3dc8)
Task 5: complete (commits 56ada31..94a3dc8, review clean after 1 fix round)
- Ruling (carry a Task 6): clip() de lib/events.mjs tambien debe sustituir caracteres de control C0/C1 por espacio (los targets de eventos se mostraran en el feed del terminal) — mismo riesgo que la statusline; con test.
Task 6: implemented (commits 94a3dc8..ac3dd7b), awaiting review
Task 6: review: Needs fixes (2 Important plan-mandated: redactor deja pasar secretos cortos; summarize lanza con entradas no-string).
- Ruling: Task 6 ARREGLAR TODO lo Important + 3 endurecimientos: (1) redact() con patrones extra (credenciales en URL user:pass@ y token@, Authorization Basic/Token, cabeceras x-api-key/cookie, --password/--token/--secret/--api-key, mysql -pSECRET, sshpass -p, curl -u user:pass, NAME=valor con key/secret/token/pass/pwd sin distinguir mayusculas); (2) guardas de tipo en summarize/targetOf (tool_input null/array/string, campos no-string, tool_name/agent_type objeto) sin lanzar ni escribir "[object Object]"; (3) rutas fuera del proyecto: solo "…/ultimos-dos-segmentos" (evita exponer usuario/carpetas); (4) CONTROL_RUN tambien quita bidi/zero-width (U+200B-U+200F, U+202A-U+202E, U+2066-U+2069); (5) maybePrune escribe el marcador aunque la poda falle (evita reintentos en cada evento). APLAZAR: DST en retencion, log al alcanzar el tope de tamaño, tests de eventos Stop/tool_fail por subproceso, directorio de eventos de solo lectura. Nota: PostModelSwitch SI figura en la lista de eventos de la documentacion de hooks (comprobado con WebFetch) — el revisor dudaba.
Task 6: fix round 1/5 dispatched (base ac3dd7b)
Task 6: fix round 1/5 implemented (commits ac3dd7b..6a9487b), awaiting scoped re-review
Task 6: fix round 1/5: 3 de 5 sin abrir; abiertos: Authorization esquemas (ApiKey/Digest) y --password "con espacios" y u:p@ss@h; bidi con caracteres literales (no escapes); NUEVO: ReDoS cuadratico en regex de credenciales de URL (100k x '://a:' = 43 s) en un hook que corre en cada herramienta.
- Ruling: ronda 2 ARREGLAR: (1) Authorization: redactar todo tras 'authorization:' (esquema opcional + token); (2) valores entre comillas en flags de secreto (--password "my secret", 'x y'); (3) password con '@' (greedy hasta el ultimo @ del token) acotando cuantificadores; (4) tope de entrada en redact (primeros 400 caracteres antes de aplicar patrones) y cuantificadores acotados en TODAS las regex nuevas; test de rendimiento (100k repeticiones < 200 ms); (5) rango bidi con escapes \u (no literales); extras baratos: --user user:pass, --passphrase. APLAZAR: -p con espacio, docker login -p, -uadmin:pass, openssl -k, sid8/modelKey con String() de objetos raros (el try/catch del hook lo absorbe).
Task 6: fix round 2/5 dispatched (base 6a9487b)
Task 6: fix round 2/5 implemented (commits 6a9487b..842b292), awaiting scoped re-review
Task 6: fix round 2/5 (todo abierto resuelto; ReDoS lineal medido <3 ms; commits 6a9487b..842b292)
Task 6: complete (commits 94a3dc8..842b292, review clean after 2 fix rounds)
- Nota: avisos automaticos de seguridad sobre lib/events.mjs reconocidos; tratados en 2 rondas (redactor ampliado, tope 400, tiempo lineal, rutas fuera del proyecto recortadas). Riesgo residual: la redaccion por patrones nunca es total; eventos locales (dataDir fuera de OneDrive) y purgados a 7 dias. Mencionarlo en el informe final.
- Plan ampliado: Task 11 (hook de puerta) commiteada en el plan (0c915e5). Orden: 7, 11, 8, 9, 10.
Task 7: dispatching (base 842b292)
Task 7: implemented (commits 0c915e5..c1c33c6; helper allMd renombrado a allMdDisk por colision), awaiting review
Task 7: review: Approved (0 Critical; 2 Important plan-mandated).
- Ruling: Task 7 ARREGLAR (solo prompts+tests): (1) vias manuales mientras hq no exista: en /revisar, /ejecutar y planificar decir que el usuario puede hacerlo a mano escribiendolo el con "!" (backlog task edit <id> --status Hecho / node scripts/fases.mjs approve f1) SIN usar el literal -s "Hecho" (el test lo prohibe) y aclarando que lo escribe la persona, no Claude; (2) /revisar sin argumento: descartar tarjetas que ya llevan la etiqueta revisada (mirar Labels en `backlog task <id> --plain`); (3) /ejecutar: con fase en estado esperando `activa` apunta a esa fase (no seguir al paso 2); elegir por orden de id; comprobar el Milestone de la tarjeta (-m es por coincidencia aproximada) y que es de la fase activa. APLAZAR resto de minors.
Task 7: fix round 1/5 dispatched (base c1c33c6)
Task 7: fix round 1/5 implemented (commits c1c33c6..f3cd318), awaiting scoped re-review
Task 7: fix round 1/5 (3 addressed, 0 open; commits c1c33c6..f3cd318)
Task 7: complete (commits 0c915e5..f3cd318, review clean after 1 fix round)
Task 7: minor (deferred -> final review): approve f1 hardcodeado en prompts; sin accion si Milestone no coincide; prohibicion de Claude lejos del comando de fase en ejecutar.md; sin test de "approve f1" en planificar.md
Task 11: implemented (commits f3cd318..4bbf63b), awaiting review
Task 11: review: Needs fixes (6 Important plan-mandated: hueco de cwd; ; | & dentro de comillas; relleno >4000; falsos positivos fases.json lectura/copia; resumen de /guardar que cita el comando; approvePhase suelto). Avisos automaticos de seguridad (3: authorization-bypass x2, validator-differential) = los mismos hallazgos.
- Ruling: Task 11 ronda 1: REESCRIBIR lib/gate.mjs con analizador de comandos en vez de regex sobre texto plano: (a) quitar cuerpos de heredoc; (b) dividir en segmentos por separadores NO entrecomillados (; && || | & salto de linea); (c) tokenizar respetando comillas y quitarlas; (d) saltar asignaciones VAR=x y envoltorios npx/-y, bash|sh -c "<cadena>"/cmd /c/powershell -Command (analizar la cadena, profundidad<=3); (e) reglas por programa: backlog|backlog.md|backlog.cmd con task edit|create y -s/--status/-sValor/--status=Valor = hecho|done (sin distinguir mayusculas, recortando espacios); node ... fases.mjs ... approve; node -e/--eval con approvePhase; escrituras a fases.json SOLO si fases.json es el DESTINO (redireccion > >> &>, tee, cp/mv/install/ln ultimo argumento, rm/del/Remove-Item, sed -i/perl -i, Set-Content/Out-File/Add-Content/New-Item/Copy-Item/Move-Item, python/py/perl/ruby/node con -c/-e cuya cadena contenga fases.json + verbo de escritura); y lo mismo para backlog/tasks con 'hecho' (sed -i, redireccion, python/node -e); (f) entrada acotada a 500000 caracteres (no a 4000) y lineal; (g) hueco de cwd: tras una coincidencia, denegar si el cwd esta en un proyecto registrado O la llamada menciona la ruta (normalizada: minusculas, barras /) de algun proyecto registrado (comando completo, o file_path de Write/Edit); (h) NO denegar menciones en texto (echo, git commit -m, heredocs, grep, cat de lectura). APLAZAR: archive/cleanup, variables ($S), ofuscacion, relativos cd ..\demo, NotebookEdit.
Task 11: fix round 1/5 dispatched (base 4bbf63b)
Task 11: fix round 1/5 implemented (commits 4bbf63b..8c5022e), awaiting scoped re-review
Task 11: fix round 1/5: findings 1-5 resueltos; NUEVO hallazgo (envoltorios/subshells/sustitucion) NO implementado porque se pidio a la re-revision y no al implementador (error mio del encargo); + redireccion pegada x>file se escapa; if/then/do; backslash fuera de comillas.
- Ruling: Task 11 ronda 2 ARREGLAR: (1) quitar al inicio de comando "(", "{", "!" y palabras clave if/then/else/elif/do/while/until/time; (2) recursion (profundidad<=3) en $(...), comillas invertidas y (...) con balanceo; (3) envoltorios: command, exec, builtin, nice[-n N], timeout[opciones] DURACION, xargs, stdbuf, ionice, doas, watch, call, start["titulo"], sudo con -u/-g/-E, env con -i/-u NAME/-S "cadena", eval "cadena"; (4) redireccion pegada x>file / x>>file (partir tokens en el > sin comillas); (5) barra invertida fuera de comillas SOLO escapa ' " y salto de linea (NO romper rutas Windows .hq\fases.json); (6) bash|sh|zsh <<EOF: analizar el cuerpo del heredoc como comandos (resto de heredocs siguen siendo datos). NO añadir regex gruesa de respaldo (reintroduce falsos positivos en resumenes de /guardar). APLAZAR: $VAR, ofuscacion b\acklog, archive/cleanup, cd relativo.
Task 11: fix round 2/5 dispatched (base 8c5022e)
Task 11: fix round 2/5 implemented (commits 8c5022e..156dbb8; nuevo implementador porque el anterior fue detenido por error del usuario), awaiting scoped re-review
Task 11: round 2 (8c5022e..156dbb8) + round 3 (156dbb8..1c11d0d): cerrados envoltorios/subshells/sustituciones, pipes a shell, <<<, -lc, mas ejecutores, >|, comentarios, profundidad agotada falla cerrado (solo si hay backlog/fases/approvePhase).
- Ruling (ahorro de tokens pedido por el usuario): no se lanza otro subagente revisor tras la ronda 3; verificacion propia: 48 cadenas DENY y 31 ALLOW, 0 fallos; suite 214/214; tiempos 1e6 chars <150 ms salvo pares de backticks repetidos (~300 ms, entrada irreal). Riesgo residual documentado: defensa en profundidad; fuera de alcance: $VAR, ofuscacion, python -c os.system, Invoke-Expression/iex/Start-Process, dd/truncate/sponge/[IO.File], $'..', tag de heredoc dentro de comillas, >&archivo, archive/cleanup, cd relativo, NotebookEdit.
Task 11: complete (commits f3cd318..1c11d0d)
- Ruling (ahorro de tokens): Tasks 8 y 9 (transcripcion de codigo completo del plan) con implementador haiku y revision propia del diff (leer diff + tests) en vez de subagente revisor; si hay hallazgos se devuelven al implementador.
Task 8: complete (commits 1c11d0d..1c90b2e): codigo identico al plan (verificado), dry-run real correcto; el lanzamiento real de wt.exe se valida en Task 10. Revision propia (ahorro de tokens).
Task 9: la hace el controlador (version 0.2.0 + README).
Task 9: complete (commit 2f616bd): version 0.2.0 + README. Siguiente: Task 10 (instalacion/prueba real con el usuario).
Task 9: correccion: plugin.json 0.2.0 en commit aparte (e865c47)

## Prueba real (Task 10, parcial, 2026-10-09)
- Fases con backlog real en demo-hq: activa -> esperando (2/2) -> aprobada (via libreria) -> la siguiente activa; la CLI `approve` rechaza sin terminal interactiva.
- Contexto de arranque (hook real): `Fase activa: Construcción (0/1)`.
- Plugin actualizado 0.1.0 -> 0.2.0 (cache con event.mjs y gate.mjs; requiere reiniciar sesion).
- Statusline activada en ~/.claude/settings.json (copia en backups/). Salida real: `demo-hq · TASK-1 Conectar NotebookLM · Sonnet · $0,42 · ctx 8%`.
- Pendiente (necesita sesion nueva con el plugin 0.2.0): eventos reales en events/, gate real, validacion de wt.exe.
