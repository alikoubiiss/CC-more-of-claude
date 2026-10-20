import asyncio
import json
import tempfile
import time
import unittest
from datetime import date
from pathlib import Path

from textual.widgets import RichLog, Static

from hq.app import HQApp


def linea(i, **kw):
    base = {"t": f"2026-10-09T10:00:{i:02d}.000Z", "sid": "s", "kind": "tool", "tool": "Read", "target": f"f{i}.js",
            "agent": None, "model": "sonnet", "slug": "demo"}
    return json.dumps({**base, **kw})


def entorno():
    d = Path(tempfile.mkdtemp(prefix="hq-feed-"))
    (d / "events" / "demo").mkdir(parents=True)
    (d / "state").mkdir()
    return d, d / "events" / "demo" / f"{date.today().isoformat()}.jsonl"


def correr(d, prueba, size=(100, 20)):
    async def run():
        app = HQApp("feed", "demo", repo=d, events_dir=d / "events", state_dir=d / "state")
        async with app.run_test(size=size) as pilot:
            await pilot.pause()
            await prueba(app, pilot)
    asyncio.run(run())


def texto(app) -> str:
    return "\n".join(l.text for l in app.screen.query_one(RichLog).lines)


class TestFeed(unittest.TestCase):
    def test_vacio_y_sin_sesion(self):
        d, _ = entorno()

        async def prueba(app, pilot):
            self.assertIn("Sin actividad todavía", texto(app))
            self.assertIn("sin sesión", str(app.screen.query_one("#cabecera", Static).render()))
        correr(d, prueba)

    def test_aparece_linea_nueva_y_corrupta_ignorada(self):
        d, f = entorno()
        f.write_text(linea(1) + "\n{rota\n", encoding="utf8")

        async def prueba(app, pilot):
            self.assertIn("Lee f1.js", texto(app))
            with f.open("a", encoding="utf8") as fh:
                fh.write(linea(2, target="\x1b[31mroja") + "\n")
            for _ in range(5):
                await pilot.pause(0.5)
                if "roja" in texto(app):
                    break
            t = texto(app)
            self.assertIn("roja", t)
            self.assertNotIn("\x1b", t)
            self.assertEqual(t.count("f1.js"), 1)  # solo se añaden los nuevos
        correr(d, prueba)

    def test_cabecera_con_sesion(self):
        d, _ = entorno()
        (d / "state" / "aaaaaaaa.json").write_text(json.dumps(
            {"slug": "demo", "model": "opus", "model_name": "Opus", "cost": 1.5, "ctx_pct": 33}), encoding="utf8")

        async def prueba(app, pilot):
            c = str(app.screen.query_one("#cabecera", Static).render())
            self.assertIn("Opus", c)
            self.assertIn("$1.50", c)
        correr(d, prueba)

    def test_500_eventos_rapido(self):
        d, f = entorno()
        f.write_text("\n".join(linea(i % 60, target=f"f{i}") for i in range(500)) + "\n", encoding="utf8")

        async def prueba(app, pilot):
            t = time.perf_counter()
            app.screen.refrescar()
            self.assertLess(time.perf_counter() - t, 0.3)
        correr(d, prueba)


if __name__ == "__main__":
    unittest.main()
