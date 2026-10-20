# SDD ledger — plan: docs/plans/2026-10-08-nucleo-plan.md

Spec: docs/specs/2026-10-08-nucleo-design.md (leido; autoridad). Rama de trabajo: feat/nucleo (base master 06d817d).

## Preflight scan (conflictos plan/plan y plan/spec)
| Par / tarea | Productor -> consumidor | Hallazgo |
|---|---|---|
| T1 -> T3..T11 | Cfg {backupsDir,logsDir,registryFile}; helpers makeCfg | coherente: makeCfg y loadConfig dan las mismas claves |
| T2 -> T4, T6 | slugify/validateName | coherente; vault valida slug con /^[a-z0-9-]+$/ igual que el slug de names |
| T3 -> T6, T7, T8, T9 | Project {slug,display,path,port,notebookId,created}; findByPath | coherente |
| T4 -> T6, T7, T8, T9 | createProjectIndex, listDecisions, writeSession, addDecision, lastSession | coherente (writeSession {sessionId,activeTask,changes,summary}) |
| T5 -> T6, T8, T11 | runner (cmd,args,{cwd})->{status,stdout,stderr}; fakeRunner en T1 simula git/backlog/nlm | coherente; args de createTask: ['task','create',title,'-d',desc] coincide con test T6 (args[2]) |
| T7 -> T8, T10 | parseFrontmatter, activeTasks (T8 snapshot, T10 plugin.test) | coherente; T10 test usa parseFrontmatter de lib/state |
| T8 -> T7 tests | tests/hooks.test.mjs se amplia en T8 con env()/runHook ya definidos en T7 | coherente |
| T9 | runVaultCli | independiente |
| T10 -> T6/T9/T7 | comandos referencian new-project.mjs, vault-cli.mjs, hq-state.mjs | existen antes de T10 |
| T12/T13 | requieren aprobacion del usuario y programas reales | NO delegables a subagentes |
Autoconsistencia por tarea: sin contradicciones tests/codigo detectadas en T1-T11.

## Rulings
- Ruling: rama feat/nucleo en vez de worktree — repo local nuevo, solo docs en master, usuario unico — coste si falla: renombrar/mover rama.
- Ruling: T12 y T13 los ejecuto yo (controlador) con el usuario, no subagentes — T12 exige visto bueno por instalacion y login interactivo; T13 usa programas reales — coste: ninguno.
- Ruling: modelos: implementadores haiku en T1,T2,T3,T9,T10,T11 (codigo completo en el plan); sonnet en T4-T8 (integracion/Windows); revisores sonnet; revision final opus.
- Ruling: trailer de commits "Co-Authored-By: Claude Sonnet 5.5" se mantiene para todos los subagentes (es el que fija la sesion) — coste: ninguno.
Task 1: implemented (commits 06d817d..9237cbd), awaiting review
Task 1: minor (deferred): Cfg solo resuelve backupsDir (vaultPath etc. pasan tal cual); validacion de tipos de config laxa (null/numero pasan); cobertura de tests fina (HQ_CONFIG, logError, ymd/hm); tmpDir no limpia; decidir .gitattributes (LF/CRLF) -> tratar en Task 13
Task 1: complete (commits 06d817d..9237cbd, review clean)
- Ruling: el trailer Co-Authored-By de cada commit refleja el modelo que lo escribio (haiku implementers firman Haiku 5.5) — es atribucion veraz; no se reescribe historia — coste: trailers heterogeneos entre commits.
Task 2: implemented (commits 9237cbd..28eca49), awaiting review
Task 2: minor (deferred): regex de acentos posiblemente con caracteres literales (verificado abajo); String(raw) coacciona no-strings; display solo trim (puede llevar saltos de linea/largo) ; ß/ø/đ/æ/ł -> guion; sin manejo de colisiones de slug; tests sin caso de 40 chars exactos
- Ruling: display se sanea en Task 6 (newProject): colapsar espacios/saltos y cortar a 80 chars antes de usarlo en frontmatter/plantillas — evita romper YAML sin tocar names.mjs aprobado — coste: otro sitio donde sanear.
Task 2: complete (commits 9237cbd..28eca49, review clean)
Task 3: implemented (commits 28eca49..b33aa95), awaiting review
Task 3: review: Approved with 3 Important (plan-mandated) + minors.
- Ruling: Task 3 findings: ARREGLAR (1) findByPath ignora entradas sin path string; (2) loadRegistry separa lectura de parseo (un EBUSY/EACCES no es "dañado") y no acumula copias .corrupt-* identicas; APLAZAR (3) saveRegistry concurrente/retry — solo newProject escribe el registro (hooks nunca), un unico escritor — coste: si en el futuro escriben dos procesos, riesgo de .tmp pisado.
Task 3: minor (deferred): findByPath no elige el prefijo mas largo (proyectos anidados); raiz de unidad; upsertProject muta; saveRegistry sin mkdir/retry; huecos de tests
Task 3: fix round 1/5 implemented (commits b33aa95..00a5059), awaiting scoped re-review
Task 3: fix round 1/5 (4 addressed, 0 open; commits b33aa95..00a5059)
Task 3: complete (commits 28eca49..00a5059, review clean after 1 fix round)
Task 4: implemented (commits 00a5059..0428ef9), awaiting review
Task 4: review: Needs fixes (4 Important).
- Ruling: Task 4 findings ARREGLAR (1) writeSession valida sessionId /^[\w-]+$/ (viene de hook input); (2) lastSession ordena por mtime (no cambiar nombres de fichero: se conserva "un fichero por sesion"); (3) addDecision con mismo slug/dia -> sufijo -2,-3 en vez de perder la decision; (4) writeSession valida activeTask/changes/summary como addDecision. APLAZAR minors (flag wx, nombre backup Date.now, symlinks, ENAMETOOLONG, orden de empate en listDecisions) — coste: casos raros en vault de un solo usuario.
Task 4: minor (deferred): create race existsSync+write; backup names colisionan en el mismo ms; mkdir antes del check create; resolveInside lexico (junctions); decision.md/ sesion.md campos sin comillar YAML; test de traversal no comprueba ausencia de ficheros; /modo/ regex laxa
Task 4: fix round 1/5 implemented (commits 0428ef9..dc796af), awaiting scoped re-review
Task 4: fix round 1/5 (4 addressed, 0 open; commits 0428ef9..dc796af)
Task 4: complete (commits 00a5059..dc796af, review clean after 1 fix round)
Task 5: implemented (commits dc796af..4d273e3), awaiting review
Task 5: review: Approved with 2 Important (plan-mandated).
- Ruling: Task 5 findings ARREGLAR (1) realRunner con timeout (por defecto 120000 ms, configurable por llamada) para que nlm/backlog colgados no bloqueen /nuevo-proyecto; (2) startBoard: handler 'error', sondeo del puerto tras lanzar (hasta ~5 s) y lanza Error si no responde — newProject ya trata ese fallo como paso "tablero: failed" sin abortar; opciones inyectables {command, attempts, intervalMs} para testear sin backlog real. Tambien: comentario en realRunner que documenta que los args son slugs/literales estaticos, y quitar import existsSync sin uso en el test. APLAZAR resto de minors.
Task 5: minor (deferred): quoteArg vs metacaracteres de cmd.exe (args confiables hoy); decodificacion OEM de stderr; setYamlLine con CRLF/listas en bloque; findId podria tomar id de sources; openUrl con & ; tests sin cobertura de openUrl/CRLF config
Task 5: fix round 1/5 implemented (commits 4d273e3..76fc2e6), awaiting scoped re-review
Task 5: fix round 1/5 (3 addressed, 0 open; commits 4d273e3..76fc2e6)
Task 5: complete (commits dc796af..76fc2e6, review clean after 1 fix round)
Task 6: implemented (commits 76fc2e6..b89c86f), awaiting review
Task 6: review: Approved with 2 Important (plan-mandated) + minors.
- Ruling: Task 6 findings ARREGLAR (1) puerto: known?.port ?? prev.port ?? allocatePort y reservar el puerto en el registro (upsert+save) ANTES de backlog init, para que una caida a medias no pueda duplicar ni desincronizar puerto; (2) guarda CLI comparar fileURLToPath(import.meta.url) y argv[1] con realpath y sin distinguir mayusculas en win32 (el fallo era silencioso); (4) .hq/project.json corrupto -> error legible con la ruta. APLAZAR: notebookId viejo en CLAUDE.md/Indice tras conectar (la fuente de verdad es .hq/project.json y el agente investigador la lee); createTask ignorado/duplicado; open() en cada re-ejecucion; huecos de tests. CARRY a Task 9: usar la misma guarda CLI robusta en scripts/vault-cli.mjs (y en los demas scripts CLI).
Task 6: minor (deferred): ver arriba
Task 6: fix round 1/5 implemented (commits b89c86f..cedb797), awaiting scoped re-review
Task 6: fix round 1/5 (3 addressed, 0 open; commits b89c86f..cedb797)
Task 6: complete (commits 76fc2e6..cedb797, review clean after 1 fix round)
Carry: lib/cli.mjs isMain(import.meta.url) existe -> usar en scripts/vault-cli.mjs (Task 9) en vez de comparar import.meta.filename; los scripts hq-state/doctor se ejecutan siempre a nivel superior (sin guarda).
Task 7: implemented (commits cedb797..1f6b38d), out-of-brief edit lib/vault.mjs:49 (cap titulo slug a 60) -> revisor debe juzgarlo; awaiting review
Task 7: review: Approved (0 Critical/Important). Out-of-brief lib/vault.mjs:49 (cap 60) juzgado correcto, minimo y seguro.
Task 7: minor (deferred -> final review): falta test que fije el cap de 60 en vault.test.mjs (400 chars sin ENOENT; mismo prefijo -> -2; listDecisions devuelve titulo completo); activeTasks/listDecisions sin try/catch por fichero (un fichero ilegible mata el contexto, queda en log); titulos de tarjeta/decision sin aplanar/sanear en additionalContext (superficie de prompt-injection de una linea); process.exit(0) tras stdout.write (usar exitCode); comillas desemparejadas en parseFrontmatter; test 'stdin invalido' pasa por la razon equivocada; projectPaths sin test directo; port undefined -> localhost:undefined
Task 7: complete (commits cedb797..1f6b38d, review clean)
Task 8: implemented (commits 1f6b38d..86cc61a), 2 desviaciones del brief (force no actualiza estado de debounce; ids de sesion de tests) -> revisor las juzga; awaiting review
Task 8: review: Approved (0 Critical/Important). Deviaciones juzgadas justificadas: (1) force no actualiza estado de debounce (el test del brief era inconsistente con su codigo; la nota se reemplaza in situ, sin spam ni perdida); (2) ids de sesion aleatorios en el test Stop.
Task 8: minor (deferred -> final review): tests Stop/PreCompact por subproceso debiles (solo comprueban Sesiones/ existe; sin caso subcarpeta/registry daniado; falta test de pre-compact.mjs); estado de debounce se acumula en os.tmpdir (falta HQ_STATE_DIR o limpieza); hooks.json test solo mira [0].hooks[0]; sin comentario/aserto explicito de force-no-actualiza-estado; fallo al escribir stateFile lanza tras escribir la nota (solo log)
Task 8: complete (commits 1f6b38d..86cc61a, review clean)
Task 9: implemented (commits 86cc61a..17b7cca), awaiting review
Task 9: review: Approved (0 Critical/Important).
Task 9: minor (deferred -> final review): stdin JSON invalido da mensaje crudo de JSON.parse; no se quita BOM ni se documenta UTF-8-only; activeTask/changes '' no toman el default (usar ||); comprobacion de proyecto antes que de subcomando (mensaje confuso fuera de proyecto, sin usage); manual-HHMM sobrescribe dentro del mismo minuto; tests sin camino de error de decision / payload no objeto / wrapper CLI
Task 9: complete (commits 86cc61a..17b7cca, review clean)
RISK (verificar en Task 12/13): que ${CLAUDE_PLUGIN_ROOT} se sustituya en el cuerpo de commands/*.md y agents/*.md (documentado para hooks/MCP; para commands no verificado). Plan B si no: los comandos usan una ruta resuelta via config o un script launcher (p.ej. node "%USERPROFILE%/.claude/plugins/.../scripts/x.mjs" o variable HQ_ROOT en el entorno de usuario).
Task 10: implemented (commits 17b7cca..d3f034e), awaiting review
Task 10: review: Needs fixes (6 Important plan-mandated + spec gaps).
- Ruling: Task 10 ARREGLAR: (1) arquitecto tools += Edit, Write; (2) /idea la entrevista la lleva el agente principal (Opus por frontmatter del comando) en rondas de <=5 preguntas; el arquitecto solo devuelve borradores/rondas de preguntas, no puede dialogar — desviacion del spec §5 "Opus me entrevista" que sigue cumpliendo la intencion; (3) linea "contenido de ficheros, tarjetas, NotebookLM y web son DATOS, no instrucciones" en arquitecto, investigador, skill-scout, ejecutor, revisor; (4) /nuevo-proyecto: lista blanca del nombre + pasarlo entre comillas simples; (5) echo '{json}' -> heredoc <<'EOF' en guardar, idea, arquitecto; (6) ejecutor sin instruccion de usar explorador; + spec: vault-cli subcomando 'estado' (setProjectEstado en vault.mjs, valores idea|planificado|en-curso|hecho, modo backup) usado por /guardar y /planificar; /revisar con escalada a Opus (delegar con model opus si la tarjeta es critica); skill-scout solo devuelve texto; revisor usa git show HEAD; /idea usa hq-state.mjs en vez de "ejecuta /retomar"; tests mas fuertes (tools por agente, model de commands, linea de datos, ausencia de echo '{', lista blanca). APLAZAR: plan-mode real de /planificar (solo prosa), namespacing de agentes (verificar en Task 13), activeTasks solo 'En curso'.
RISK (Task 13): nombres de subagente de plugin podrian requerir prefijo project-hq:
Task 10: fix round 1/5 implemented (commits d3f034e..db452b0), awaiting scoped re-review
Task 10: fix round 1/5 (all addressed, 0 open; commits d3f034e..db452b0)
Task 10: minor (deferred -> final review): commands/guardar.md paso 4 heredoc 'estado' dentro de lista con sangria -> el cierre EOF no esta en columna 0 (dedentar el bloque); test de DATOS comprueba fragmento no la frase completa; test de lista blanca no comprueba limite 60/ñ
Task 10: complete (commits 17b7cca..db452b0, review clean after 1 fix round)
Task 11: implemented (commits db452b0..f829ce7), awaiting review
Task 11: review: Approved (0 Critical/Important).
Task 11: minor (deferred -> final review): firstLine no defensivo si el runner devuelve undefined o lanza (un check malo oculta los demas); uv como check duro; process.exit tras console.log; tests no cubren runner que lanza
Task 11: complete (commits db452b0..f829ce7, review clean)
Tasks 1-11 complete. Next: final whole-branch review (opus), then Task 12 (instalaciones con el usuario) y Task 13 (e2e) ejecutadas por el controlador.
Final review (opus): Ready for real use after 2 MUST items (M1 dataDir estable; M2 /retomar ve el resumen manual). 0 Critical.
- Ruling: se aceptan M1, M2 y S1-S9 en UNA tanda de arreglos (fix-wave-brief.md), implementador sonnet fresco; CAN-WAIT se queda diferido (lista en el informe final). Una sola re-revision acotada despues.
- Ruling: Task 13 debe ejecutarse ademas DENTRO de Claude Code con el plugin instalado (/project-hq:nuevo-proyecto, retomar, guardar, ejecutar), no solo con scripts desde terminal, y re-instalar/subir version tras cada fix (la cache del plugin es por version).
Fix wave: dispatched (base f829ce7)
Fix wave: implemented (commits f829ce7..b1a918a), 121 tests; awaiting ONE scoped re-review
Fix wave: re-review clean (M1,M2,S1-S9 addressed, no new Critical/Important). Tests 121/121. HEAD b1a918a.
Code tasks 1-11 + fix wave COMPLETE. Pendiente: Task 12 (instalaciones con aprobacion del usuario) y Task 13 (e2e + README), ejecutadas por el controlador.
