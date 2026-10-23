# Contribuir

1. Haz un fork y crea una rama desde `main`.
2. Instala: Node 22+, Python 3.12+, [uv](https://docs.astral.sh/uv/) (ver README).
3. Antes de abrir un PR, deben pasar las dos suites:
   ```powershell
   npm test
   cd tui; uv pip install -e .; python -m unittest discover -s tests -t .
   ```
4. Los tests son herméticos (carpetas temporales, runners simulados): no escribas en tu vault ni en tu HQ reales.
5. **Anonimato:** no subas rutas, correos, ids de cuaderno ni nombres reales. Usa datos ficticios (`demo`, `usuario@correo.example.com`).
6. Si cambias la interfaz de `cc`, regenera las capturas: `cd tui && python tools/capturas.py`.
7. Sube `version` en `.claude-plugin/plugin.json` y anota el cambio en `CHANGELOG.md`.

Proyecto solo para Windows (usa `wt.exe`); las contribuciones que lo hagan portable son bienvenidas.
