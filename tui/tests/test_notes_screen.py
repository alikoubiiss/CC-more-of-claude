import asyncio
import tempfile
import unittest
from pathlib import Path

from textual.widgets import Static

from hq.app import HQApp
from hq.screens.notes import preparar


def vault(con_notas=True) -> Path:
    v = Path(tempfile.mkdtemp(prefix="hq-nv-")) / "ProjectHQ"
    base = v / "Proyectos" / "demo"
    (base / "Decisiones").mkdir(parents=True)
    (base / "Sesiones").mkdir()
    if con_notas:
        (base / "Índice.md").write_text("---\nestado: idea\n---\n# Demo\ncuerpo\x1b[31m\n", encoding="utf8")
        (base / "Decisiones" / "2026-10-05-b.md").write_text("# Sin framework\n", encoding="utf8")
        (base / "Sesiones" / "2026-10-08-x.md").write_text("x" * 300_000, encoding="utf8")
    return v


def correr(v, prueba, abrir=None):
    async def run():
        app = HQApp("notes", "demo", repo=v, vault_path=v, vault_projects_dir="Proyectos", abrir=abrir)
        async with app.run_test(size=(100, 24)) as pilot:
            await pilot.pause()
            await prueba(app, pilot)
    asyncio.run(run())


def estado(app) -> str:
    return str(app.screen.query_one("#estado", Static).render())


class TestNotas(unittest.TestCase):
    def test_preparar(self):
        t = preparar("---\na: 1\n---\ncuerpo\x1b[0m\n")
        self.assertTrue(t.startswith("```yaml\na: 1\n```"))
        self.assertNotIn("\x1b", t)
        self.assertIn("\n", t)

    def test_lista_navega_y_abre(self):
        v, abiertos = vault(), []

        async def prueba(app, pilot):
            s = app.screen
            self.assertEqual(s.nota_actual.name, "Índice.md")
            self.assertIn("estado: idea", s.texto_mostrado)
            self.assertNotIn("\x1b", s.texto_mostrado)
            await pilot.press("o")
            await pilot.pause()
            self.assertEqual(abiertos[-1], "obsidian://open?vault=ProjectHQ&file=Proyectos%2Fdemo%2F%C3%8Dndice")
            await pilot.press("down", "e")
            await pilot.pause()
            self.assertTrue(abiertos[-1].endswith("2026-10-05-b.md"))
            await pilot.press("down")
            await pilot.pause()
            self.assertIn("recortado", s.texto_mostrado)
            self.assertLess(len(s.texto_mostrado), 210_000)
        correr(v, prueba, abiertos.append)

    def test_sin_notas(self):
        v = vault(False)

        async def prueba(app, pilot):
            self.assertIn("aún no tiene notas", app.screen.texto_mostrado)
            await pilot.press("o", "e", "r")
            await pilot.pause()
            self.assertIn("No hay nota", estado(app))
        correr(v, prueba, lambda d: None)

    def test_fallo_al_abrir_se_muestra(self):
        v = vault()

        def malo(d):
            raise OSError("sin app")

        async def prueba(app, pilot):
            await pilot.press("o")
            await pilot.pause()
            self.assertIn("sin app", estado(app))
        correr(v, prueba, malo)


if __name__ == "__main__":
    unittest.main()
