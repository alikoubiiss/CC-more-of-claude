import asyncio
import json
import tempfile
import time
import unittest
from datetime import date, timedelta
from pathlib import Path

from textual.widgets import Static

from hq.app import HQApp
from hq.config import load_config
from hq.estadisticas import cargar
from hq.registry import Project

HOY = date(2026, 10, 10)


def entorno(presupuesto=None, con_datos=True):
    d = Path(tempfile.mkdtemp(prefix="hq-es-"))
    extra = {"presupuesto": presupuesto} if presupuesto else {}
    (d / "config.json").write_text(json.dumps({"vaultPath": str(d / "vault"), "projectsRoot": str(d), "vaultProjectsDir": "P",
                                              "dataDir": str(d), **extra}), encoding="utf8")
    repo = d / "demo"
    (repo / "backlog" / "tasks").mkdir(parents=True)
    (repo / "backlog" / "tasks" / "task-1 - a.md").write_text(
        f"---\nid: TASK-1\ntitle: Hecha\nstatus: Hecho\nupdated_date: '{HOY.isoformat()} 10:00'\n---\n", encoding="utf8")
    (repo / "backlog" / "tasks" / "task-2 - b.md").write_text("---\nid: TASK-2\ntitle: Abierta\nstatus: En curso\n---\n", encoding="utf8")
    (d / "registry.json").write_text(json.dumps({"projects": [{"slug": "demo", "display": "Demo", "path": str(repo)}]}), encoding="utf8")
    if con_datos:
        f = d / "metrics" / "demo" / f"{HOY.isoformat()}.jsonl"
        f.parent.mkdir(parents=True)
        lineas = [
            {"kind": "snap", "sid": "s1", "model": "sonnet", "card": "TASK-1", "cost": 3, "delta": 3},
            {"kind": "snap", "sid": "s1", "model": "opus", "card": "TASK-2\x1b[31m", "cost": 4, "delta": 1},
            {"kind": "mem", "mem": "nlm"}, {"kind": "mem", "mem": "conocimiento"}, {"kind": "inicio", "chars": 400},
        ]
        f.write_text("\n".join(json.dumps(x) for x in lineas) + "\n", encoding="utf8")
    return d, load_config(d / "config.json"), [Project("demo", "Demo", str(repo))]


def correr(d, cfg, prueba, slug=None, size=(110, 40)):
    async def run():
        app = HQApp("stats", slug, cfg=cfg, hoy=HOY)
        async with app.run_test(size=size) as pilot:
            await pilot.pause()
            await app.workers.wait_for_complete()  # el cálculo va en un hilo
            await pilot.pause()
            await prueba(app, pilot)
    asyncio.run(run())


def texto(app) -> str:
    return "\n".join(str(w.render()) for w in app.screen.query(Static))


class TestCargar(unittest.TestCase):
    def test_resumen_y_gamificacion_con_datos_reales(self):
        _, cfg, proyectos = entorno({"diaUsd": 10, "tarjetaUsd": 5})
        res, gam = cargar(cfg, proyectos, hoy=HOY)
        self.assertAlmostEqual(res.hoy_usd, 4)
        self.assertEqual(res.dia.estado, "ok")
        self.assertEqual(gam.xp, 15)  # tarjeta hecha +10, gasto 3 <= 5 +5
        self.assertEqual(gam.racha, 1)

    def test_filtra_por_proyecto_pero_la_gamificacion_es_global(self):
        _, cfg, proyectos = entorno({"diaUsd": 10, "tarjetaUsd": 5})
        res, gam = cargar(cfg, proyectos, slug="otro", hoy=HOY)
        self.assertEqual(res.n_datos, 0)
        self.assertEqual(gam.xp, 15)

    def test_proyecto_roto_no_tumba(self):
        _, cfg, proyectos = entorno()
        res, gam = cargar(cfg, proyectos + [Project("roto", "Roto", "Z:/no/existe")], hoy=HOY)
        self.assertEqual(res.n_datos, 2)


class TestPantalla(unittest.TestCase):
    def test_con_datos(self):
        d, cfg, _ = entorno({"diaUsd": 10, "tarjetaUsd": 5})

        async def prueba(app, pilot):
            t = texto(app)
            for esperado in ("Hoy", "$4.00", "demo", "sonnet", "opus", "TASK-1", "NotebookLM", "Nivel 1", "racha", "Primera tarjeta aprobada"):
                self.assertIn(esperado, t)
            self.assertNotIn("\x1b", t)
            self.assertIn("modelo principal", t)
        correr(d, cfg, prueba)

    def test_vacia_y_sin_presupuesto(self):
        d, cfg, _ = entorno(con_datos=False)

        async def prueba(app, pilot):
            t = texto(app)
            self.assertIn("Sin datos todavía", t)
            self.assertIn("Sin presupuesto configurado", t)
            await pilot.press("r")
            await pilot.pause()
        correr(d, cfg, prueba)

    def test_avisos_de_presupuesto(self):
        d, cfg, _ = entorno({"diaUsd": 4.5, "tarjetaUsd": 5})

        async def prueba(app, pilot):
            self.assertIn("89%", texto(app))
        correr(d, cfg, prueba)

    def test_nombres_hostiles_no_llegan_a_pantalla(self):
        d, cfg, _ = entorno({"diaUsd": 10})
        f = d / "metrics" / "demo" / f"{HOY.isoformat()}.jsonl"
        with f.open("a", encoding="utf8") as fh:
            fh.write(json.dumps({"kind": "snap", "model": "[red]x[/red]", "card": "[bold]T-1[/bold]", "delta": 1}) + "\n")

        async def prueba(app, pilot):
            t = texto(app)
            self.assertNotIn("\x1b", t)
            self.assertNotIn("[red]", t)
        correr(d, cfg, prueba)

    def test_estrecha(self):
        d, cfg, _ = entorno({"diaUsd": 10, "tarjetaUsd": 5})

        async def prueba(app, pilot):
            await pilot.press("down", "up", "r")
        correr(d, cfg, prueba, size=(50, 20))


class TestCli(unittest.TestCase):
    def test_hq_stats(self):
        import contextlib
        import io

        from hq.cli import main
        d, cfg, _ = entorno({"diaUsd": 10})
        apps = []
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            code = main(["--config", str(d / "config.json"), "stats"], run_app=apps.append)
            self.assertEqual((code, apps[0].modo, apps[0].slug), (0, "stats", None))
            code = main(["--config", str(d / "config.json"), "stats", "demo"], run_app=apps.append)
            self.assertEqual((code, apps[1].slug), (0, "demo"))
            code = main(["--config", str(d / "config.json"), "stats", "nada"], run_app=apps.append)
            self.assertEqual(code, 2)
        self.assertIn("nada", err.getvalue())


class TestCabeceraTablero(unittest.TestCase):
    def test_nivel_y_gasto_en_la_cabecera(self):
        from hq.actions import Backlog
        d, cfg, _ = entorno({"diaUsd": 4.5, "tarjetaUsd": 5})
        repo = d / "demo"

        async def run():
            app = HQApp("board", "demo", repo=repo, backlog=Backlog(lambda a, c: (0, "", "")), cfg=cfg, hoy=HOY)
            async with app.run_test(size=(140, 30)) as pilot:
                await pilot.pause()
                await app.workers.wait_for_complete()
                await pilot.pause()
                cab = str(app.screen.query_one("#progreso", Static).render())
                self.assertIn("Gasto hoy", cab)
                self.assertIn("89%", cab)
        asyncio.run(run())

    def test_el_tablero_funciona_sin_carpeta_de_metricas(self):
        from hq.actions import Backlog
        d, cfg, _ = entorno(con_datos=False)

        async def run():
            app = HQApp("board", "demo", repo=d / "demo", backlog=Backlog(lambda a, c: (0, "", "")), cfg=cfg, hoy=HOY)
            async with app.run_test(size=(140, 30)) as pilot:
                await pilot.pause()
                self.assertEqual(type(app.screen).__name__, "BoardScreen")
        asyncio.run(run())


if __name__ == "__main__":
    unittest.main()


class TestSinCongelar(unittest.TestCase):
    def test_pantalla_stats_calcula_en_segundo_plano(self):
        import threading

        from hq.screens.stats import StatsScreen
        d, cfg, proyectos = entorno({"diaUsd": 10})
        libre = threading.Event()
        real = cargar

        def lento():
            libre.wait(5)
            return real(cfg, proyectos, hoy=HOY)

        async def run():
            from textual.app import App

            class Host(App):
                def on_mount(self):
                    self.push_screen(StatsScreen(lento, cfg.presupuesto, cfg.metrics_dir))
            app = Host()
            async with app.run_test(size=(100, 30)) as pilot:
                await pilot.pause()
                self.assertIn("Calculando", texto(app))  # la interfaz ya responde aunque el cálculo siga en curso
                libre.set()
                await app.workers.wait_for_complete()
                await pilot.pause()
                self.assertIn("$4.00", texto(app))
        asyncio.run(run())

    def test_cabecera_del_tablero_no_espera_al_cargador(self):
        import threading

        from hq.actions import Backlog
        d, cfg, proyectos = entorno({"diaUsd": 4.5})
        libre = threading.Event()

        async def run():
            app = HQApp("board", "demo", repo=d / "demo", backlog=Backlog(lambda a, c: (0, "", "")), cfg=cfg, hoy=HOY)
            real = app._cargador_stats(None)
            app._cargador_stats = lambda slug: (lambda: (libre.wait(5), real())[1])
            t0 = time.perf_counter()
            async with app.run_test(size=(140, 30)) as pilot:
                await pilot.pause()
                self.assertEqual(type(app.screen).__name__, "BoardScreen")  # montó y responde sin esperar al cargador
                self.assertLess(time.perf_counter() - t0, 2.5)
                libre.set()
                await app.workers.wait_for_complete()
                await pilot.pause()
                self.assertIn("Gasto hoy", str(app.screen.query_one("#progreso", Static).render()))
        asyncio.run(run())

    def test_un_cargador_que_falla_no_cierra_la_pantalla(self):
        from hq.screens.stats import StatsScreen
        d, cfg, _ = entorno({"diaUsd": 10})

        def roto():
            raise OSError("disco")

        async def run():
            from textual.app import App

            class Host(App):
                def on_mount(self):
                    self.push_screen(StatsScreen(roto, cfg.presupuesto, cfg.metrics_dir))
            app = Host()
            async with app.run_test(size=(100, 30)) as pilot:
                await pilot.pause()
                await app.workers.wait_for_complete()
                await pilot.pause()
                self.assertIn("No se pudieron leer las métricas", texto(app))
        asyncio.run(run())
