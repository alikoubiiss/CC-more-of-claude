# Registro Plan B (interfaz `hq`)

## Rulings
- `unittest` en lugar de `pytest` (sin dependencias extra).
- Revisores de las Tasks 4 y 6 diferidos a una revisión final de toda la rama (Opus): 3 hallazgos Importantes corregidos con test.
- Selección inicial del lienzo = primera tarjeta «En curso».
- Tasks 6–9: tests y código escritos a la vez, sin rojo previo observado.
- `uv` no estaba instalado: se instaló con el instalador oficial.

## Menores diferidos
- `_NOMBRE_RE` (actions) acepta control y nombres que empiezan por `-`.
- `_mejorar` no revalida el estado de la tarjeta tras el diálogo.
- Slugs duplicados en `registry.json` → DuplicateKey en la pantalla global.
- tasks.py difiere de Node con U+2028 y espacios dobles.
- Sondeo del feed/global relee más de lo necesario; la cabecera del tablero no refresca la sesión.
- Fondo del lienzo distinto al resto en el área libre (estético).
