# Changelog

## 0.5.4
- Comando `cc` (antes `hq`): `cc start`, `cc open`, `cc stats`, tablero, foco, feed y notas.
- Tablero: ejecutar (`e`) y revisar (`v`) desde el tablero; `i` y `E` para iniciar y editar tarjetas sin gastar tokens.
- Modelo y esfuerzo por tarjeta (haiku/sonnet/opus), lint de tarjetas y escalera de reintentos.
- Puertas humanas: solo el usuario cierra tarjetas y fases (hook `gate`).
- Métricas de gasto, presupuesto y progreso (`cc stats`).
- Config en `%USERPROFILE%\.project-hq` (`scripts/setup.mjs`), `doctor` con avisos opcionales.
- Repo publicable: sin datos personales, capturas de ejemplo, licencia MIT, CI.
