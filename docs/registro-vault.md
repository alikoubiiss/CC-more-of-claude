# Registro del subsistema 2 (vault Personal y conocimiento)

## Rulings
- Revisores por tarea (T1/T6/T7/T8) diferidos a una revisión final de toda la rama (Opus).
- Bases: filtran por propiedades, así que el frontmatter de los chats conserva `tipo` y `categoria`; solo se reescribe `file.inFolder(...)`.
- `Inicio.md`/`Panel.md` viejos se conservan como `Fuentes/Recursos/<x> (antiguo).md`; ficheros sin clasificar van a `Notas/Sin clasificar/`; `.obsidian` se omite.
- Enlaces sin destino se informan pero no hacen fallar la verificación.
- Privacidad en tres estados (`revisar-privacidad`: ausente → se evalúa; `true` → retenida; `false` → ya revisada, se exporta redactada).
- Lo que deja de compartirse se lista como obsoleta pero no se borra de HQ.
- Tiempos de pared en tests (gate 250 → 1500 ms, redactor 500 → 1500 ms): eran frágiles con la suite en paralelo.
- Falsos positivos aceptados del redactor: timestamps de 10 dígitos se redactan como teléfono.

## Menores diferidos
- Etiquetas con comillas escapadas no sobreviven a releer el frontmatter.
- Dos notas con el mismo nombre redactado se pisan en HQ (queda .bak).
- El hash del origen está fuera del try de la migración: un fichero ilegible tras la copia deja el destino a medias.
- Enlaces dentro de código indentado o de citas se reescriben; los enlaces a alias no se reescriben.
- Prompt de destilado: solo se escapa </chat> en minúsculas; la guardia no comprueba ancestros de la raíz.

## Arreglado en la revisión final
Teléfonos internacionales, IBAN, correos con acentos y DNI/NIE sin redactar; nota en la raíz de Wiki; claves de frontmatter perdidas; ficheros no UTF-8; enlaces con carpeta; # y corchetes en nombres; junctions silenciosas; --forzar-existente sin .bak.

## Paso real a HQ (2026-10-10)
Aprobadas y compartidas las 97 notas de la Wiki (84 destiladas + 13 temas migrados) y exportadas a ProjectHQ/Conocimiento; los 66 chats originales NO se exportan (archivo crudo, ya destilados). Redactor: falso positivo de identificadores con guiones (claude-sonnet-4-5-20250929) corregido con test; lista real de terminos en vault-redactor.json (gitignored).
