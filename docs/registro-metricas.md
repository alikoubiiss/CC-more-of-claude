# Registro del subsistema 4 (gasto de tokens y gamificación)

## Rulings
- Solo gasto real (sin estimaciones de ahorro): no existe una ejecución «sin HQ» con la que comparar. El panel muestra el uso real de la memoria (consultas a NotebookLM, lecturas del vault y de `Conocimiento`, contexto inyectado) y la tendencia del coste.
- Presupuesto con avisos, sin bloquear. Valores iniciales `diaUsd: 50`, `tarjetaUsd: 15` (el usuario los ajusta).
- Cada foto lleva su `delta` calculado al escribir: sumar `delta` nunca cuenta dos veces (sesiones que cruzan la medianoche). Primera foto de una sesión con coste > 0,50 USD: `delta` 0 (no arrastra gasto anterior al activar el sistema).
- Gasto por modelo = modelo principal de la sesión; los subagentes no se pueden separar.
- El día de hoy no cuenta para el XP de «día dentro de presupuesto» (aún puede subir); `semana-sin-pasarte` exige gasto > 0 cada día; los logros de racha usan la mejor racha histórica.
- Nivel, XP y gasto del día en una línea propia bajo la cabecera del tablero (no se trunca en terminales estrechas).
- En este entorno los backslashes de heredocs y `node -e` se colapsan y `\x1b` se convierte en un byte real: el código y los tests con rutas o secuencias de escape se escriben con las herramientas de edición, y el carácter ESC se define con `String.fromCharCode(27)`.

## Menores diferidos
- Si se borra el estado de sesión (más de 24 h) al reanudar, el gasto puede repetirse (≤ 0,50 USD) o perderse (> 0,50).
- `updated_date` de una tarjeta ya hecha cambia con cualquier edición posterior y mueve la racha; la fecha de aprobación no se guarda aparte.
- `hq stats` relee todo el historial en cada cambio (en un hilo, sin caché incremental).

## Arreglado en la revisión final
Doble conteo del gasto si fallaba la caché o el fichero del día estaba lleno; `tarjetas.json` perdía actualizaciones (ahora derivado del historial); la puerta bloquea editar tarjetas a «Hecho» con Write/Edit (el XP solo cuenta tarjetas Hecho); el tablero y `hq stats` ya no se congelan con historiales grandes.
