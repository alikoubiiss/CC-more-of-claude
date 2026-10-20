# Subsistema 2: vault Personal reestructurado y conocimiento para HQ

Fecha: 2026-10-09 · Estado: pendiente de visto bueno del usuario · Depende de: Núcleo (vault `ProjectHQ`, `vaultProjectsDir`), Terminal (sin cambios).

## 1. Objetivo y alcance

Ali tiene un vault Personal en OneDrive (`%USERPROFILE%\OneDrive\Bovedas\Personal`): 89 notas, de las que 67 son chats de Claude exportados (~1 MB, con ruido como «This block is not supported on your current device yet.»), 14 notas de «Temas», 2 proyectos personales, 1 nota de contexto, 6 Bases y 3 plantillas; las carpetas Entrada, Diario, Notas, Salud y Archivo están vacías.

Se construye un vault nuevo, **`C:\Bovedas\Personal`** (fuera de OneDrive), con una estructura mejor y **todo** el contenido útil migrado, y se prepara conocimiento reutilizable para HQ. Dos fases:

- **Fase 1 (determinista, sin tokens):** copia de seguridad, migración, limpieza, reescritura de enlaces y Bases, verificación.
- **Fase 2 (con modelo, por lotes y con visto bueno):** destilar la Wiki (temas, decisiones, recetas) y exportar a `ProjectHQ\Conocimiento\` solo lo marcado `compartir: hq`, con redacción automática de datos personales.

Fuera de alcance: gamificación y métricas de tokens (subsistema 4), cambios en el vault `ProjectHQ` fuera de `Conocimiento/`, sincronización del vault nuevo entre dispositivos, borrar el vault viejo (lo decide el usuario).

## 2. Estructura del vault nuevo

```
Personal/
  CLAUDE.md        reglas del vault para agentes (≤ 40 líneas)
  index.md         catálogo de la Wiki (lo regenera el script)
  log.md           historial: migración, destilados, cambios
  Inicio.md        portada
  Diario/  Notas/  Proyectos/  Salud y Habitos/     espacio del usuario
  Fuentes/
    Chats/AAAA/AAAA-MM-DD <titulo>.md               67 chats, limpios e inmutables
    Recursos/                                        contexto guardado por Claude, adjuntos
  Wiki/
    Temas/  Decisiones/  Recetas/                   notas destiladas
  Plantillas/      Paneles/ (las 6 Bases)
  _migracion/      mapa.json, informe.md
```

Reglas: `Fuentes/` es solo lectura (se enlaza, no se edita). `Wiki/` es lo que Claude consulta; cada nota lleva `fuentes:` (enlaces a chats de origen), `estado: borrador|revisada` y `compartir: hq|privado`. La categoría vieja de cada chat pasa a etiqueta (`#finanzas`) y a una nota de Wiki, de modo que un chat puede pertenecer a varios temas. Las carpetas vacías del vault viejo no se migran.

## 3. Fase 1: migración (script `scripts/vault-migrar.mjs`)

1. **Copia de seguridad:** copia completa del vault viejo a `C:\proyectos personales\project-hq\backups\vault-personal-<fecha>\` con hash SHA-256 por fichero; si la copia no coincide, se detiene.
2. **Solo lectura del original:** nunca escribe ni borra en el vault viejo. Crea `C:\Bovedas\Personal` desde cero; se niega a ejecutar si existe con contenido salvo `--forzar-existente`. Escribe únicamente en `C:\Bovedas\Personal`, `ProjectHQ\Conocimiento\` y `backups\`; rechaza rutas con `..` o fuera de esas tres y no sigue enlaces simbólicos.
3. **Chats:** quita los bloques de ruido conocidos y normaliza saltos de línea; el texto de la conversación se conserva. Frontmatter unificado: se conservan `tipo: chat-claude`, `categoria`, `fecha`, `mensajes` y `uuid` (las Bases filtran por estas propiedades) y se añaden `titulo`, `etiquetas` (con la categoría) y `compartir: privado`. Nombre `AAAA-MM-DD <titulo>.md` en `Fuentes/Chats/AAAA/`; los nombres se sanean para Windows (`: ? " < > | * \ /`); duplicados se conservan con sufijo ` (2)`.
4. **Resto de notas:** «Contexto guardado por Claude» → `Fuentes/Recursos/` (`compartir: privado`); las 14 notas de Temas → `Wiki/Temas/` como `estado: borrador`; los 2 proyectos → `Proyectos/`; plantillas → `Plantillas/`; Bases → `Paneles/`; solo se reescriben los argumentos de `file.inFolder(...)` porque el resto de sus filtros usa propiedades.
5. **Enlaces:** todos los `[[…]]` de las notas migradas se reescriben al nombre nuevo.
6. **Informe y mapa:** `_migracion/mapa.json` (viejo → nuevo + hash) e `informe.md`. Los fallos por fichero (frontmatter roto, nombre inválido) se anotan y no detienen el resto; nunca se pierde un chat en silencio.
7. **Verificación:** 89 notas de origen presentes en destino, cero enlaces rotos, texto de cada chat igual salvo el ruido quitado. Si algo no cuadra, el informe lo dice y la migración no se marca completa.
8. **Idempotente** y con `--dry-run` que muestra qué haría sin escribir. Deshacer = borrar `C:\Bovedas\Personal`. Al terminar y verificar, el informe indica que el vault viejo ya no hace falta; la copia de seguridad se queda hasta que el usuario la borre.

## 4. Fase 2: destilado y exportación a HQ

1. **Destilado (`scripts/vault-destilar.mjs`):** agrupa los chats por tema y los envía por lotes a Sonnet con una plantilla fija; escribe en `Wiki/Temas|Decisiones|Recetas/` con `estado: borrador` y `fuentes:`. Se fusiona con las 14 notas de Temas del borrador sin duplicar. Haiku solo clasifica; Opus no interviene. Antes de gastar, muestra una estimación de tokens por lote y espera confirmación.
2. **Texto no confiable:** el contenido de los chats se trata siempre como dato; el prompt lo delimita y ordena ignorar instrucciones contenidas en él. Ninguna salida del modelo se ejecuta.
3. **Visto bueno por lote:** nada pasa de `borrador` a `revisada` sin el usuario; un lote rechazado se puede repetir con otra instrucción.
4. **Exportación a HQ (`scripts/vault-exportar-hq.mjs`):** copia a `ProjectHQ\Conocimiento\` solo las notas `revisada` con `compartir: hq`, tras pasar el **redactor automático**: sustituye por `[redactado]` correos, teléfonos, IBAN, tarjetas, claves y tokens comunes y los términos de una lista editable (`vault-redactor.json`: empresas, cuentas). Toda nota con alguna coincidencia queda además `revisar-privacidad: true` y no se exporta hasta que el usuario la revise. Nunca se exportan chats ni la nota de contexto personal. Genera `Conocimiento/index.md`.
5. **Uso por Claude:** `/retomar` y `/planificar` consultan `Conocimiento/index.md` y cargan solo la nota necesaria.
6. **Mantenimiento:** `log.md` registra cada destilado; un comando de revisión detecta notas huérfanas y enlaces rotos.

## 5. Errores, límites y pruebas

- Sin red salvo la llamada al modelo en la fase 2. Config en `config.json` (nuevas claves `vaultPersonalOrigen`, `vaultPersonalDestino`, `conocimientoDir`).
- Tests con un vault de ejemplo: chats con ruido, duplicados, enlaces cruzados, nombres con `:` o `?`, frontmatter malformado, una Base con rutas viejas, enlace simbólico, destino ya existente. Tests del redactor con casos reales y falsos positivos. Prueba final con el vault real en `--dry-run`, y luego real con verificación.
- Review focus: pérdida silenciosa de notas, reescritura de enlaces con alias y anclas (`[[nota|alias]]`, `[[nota#sección]]`), nombres con caracteres no válidos, fuga de datos personales a HQ, prompt injection desde el texto de un chat, rutas fuera de las permitidas.
