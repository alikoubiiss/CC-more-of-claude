import asyncio
import json
import tempfile
import unittest
from pathlib import Path

from textual.widgets import DataTable, Static

from hq.app import HQApp
from hq.config import load_config
from hq.registry import Project


def cfg_en(d: Path):
    (d / "config.json").write_text(json.dumps({"vaultPath": str(d), "projectsRoot": str(d), "vaultProjectsDir": "P", "dataDir": str(d)}), encoding="utf8")
    return load_config(d / "config.json")


def proyectos(d: Path, n: int):
    out = []
    for i in range(n):
        p = d / f"p{i}"
        (p / "backlog" / "tasks").mkdir(parents=True)
        (p / "backlog" / "tasks" / "task-1 - a.md").write_text(
            f"---\nid: TASK-1\ntitle: Hacer {i}\nstatus: {'En curso' if i % 2 else 'Hecho'}\n---\n", encoding="utf8")
        out.append(Project(f"p{i}", f"P{i}", str(p)))
    return out


def correr(n, prueba, abrir=None):
    async def run():
        d = Path(tempfile.mkdtemp(prefix="hq-gl-"))
        app = HQApp("global", cfg=cfg_en(d), proyectos=proyectos(d, n), open_proyecto=abrir)
        async with app.run_test(size=(120, 30)) as pilot:
            await pilot.pause()
            await prueba(app, pilot)
    asyncio.run(run())


class TestGlobal(unittest.TestCase):
    def test_cero_proyectos(self):
        async def prueba(app, pilot):
            self.assertIn("No hay proyectos", str(app.screen.query_one("#estado", Static).render()))
            await pilot.press("enter", "down", "r")
        correr(0, prueba)

    def test_un_proyecto_y_abrir(self):
        abiertos = []

        async def prueba(app, pilot):
            t = app.screen.query_one(DataTable)
            self.assertEqual(t.row_count, 1)
            await pilot.press("enter")
            await pilot.pause()
            self.assertEqual(abiertos, ["p0"])
        correr(1, prueba, abiertos.append)

    def test_veinte_proyectos(self):
        async def prueba(app, pilot):
            self.assertEqual(app.screen.query_one(DataTable).row_count, 20)
            await pilot.press("down", "down", "r")
        correr(20, prueba)

    def test_abrir_que_falla_se_muestra(self):
        def malo(slug):
            raise OSError("sin wt")

        async def prueba(app, pilot):
            await pilot.press("enter")
            await pilot.pause()
            self.assertIn("sin wt", str(app.screen.query_one("#estado", Static).render()))
        correr(1, prueba, malo)


if __name__ == "__main__":
    unittest.main()
