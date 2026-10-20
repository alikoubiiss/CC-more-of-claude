import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

from hq.cli import main


def entorno(slugs=("demo", "otro")):
    d = Path(tempfile.mkdtemp(prefix="hq-cli-"))
    cfg = d / "config.json"
    cfg.write_text(json.dumps({"vaultPath": str(d), "projectsRoot": str(d), "vaultProjectsDir": "P", "dataDir": str(d)}), encoding="utf8")
    proyectos = []
    for s in slugs:
        (d / s).mkdir()
        proyectos.append({"slug": s, "display": s.title(), "path": str(d / s)})
    (d / "registry.json").write_text(json.dumps({"projects": proyectos}), encoding="utf8")
    return d, cfg


def ejecutar(argv, **kw):
    err = io.StringIO()
    with contextlib.redirect_stderr(err):
        code = main(argv, **kw)
    return code, err.getvalue()


class TestCli(unittest.TestCase):
    def test_modo_con_slug(self):
        d, cfg = entorno()
        apps = []
        code, _ = ejecutar(["--config", str(cfg), "board", "demo"], run_app=apps.append)
        self.assertEqual((code, apps[0].modo, apps[0].slug), (0, "board", "demo"))

    def test_slug_por_defecto_desde_cwd(self):
        d, cfg = entorno()
        apps = []
        code, _ = ejecutar(["--config", str(cfg), "feed"], cwd=str(d / "otro" / "sub"), run_app=apps.append)
        self.assertEqual((code, apps[0].slug), (0, "otro"))

    def test_sin_proyecto_en_cwd(self):
        d, cfg = entorno()
        code, err = ejecutar(["--config", str(cfg), "notes"], cwd=str(d), run_app=lambda a: None)
        self.assertEqual(code, 2)
        self.assertIn("demo, otro", err)

    def test_proyecto_inexistente(self):
        d, cfg = entorno()
        code, err = ejecutar(["--config", str(cfg), "board", "nada"], run_app=lambda a: None)
        self.assertEqual(code, 2)
        self.assertIn("nada", err)

    def test_config_danada(self):
        d, cfg = entorno()
        cfg.write_text("{rota", encoding="utf8")
        code, err = ejecutar(["--config", str(cfg)], run_app=lambda a: None)
        self.assertEqual(code, 1)
        self.assertEqual(len(err.strip().splitlines()), 1)

    def test_registro_danado(self):
        d, cfg = entorno()
        (d / "registry.json").write_text("{rota", encoding="utf8")
        code, _ = ejecutar(["--config", str(cfg)], run_app=lambda a: None)
        self.assertEqual(code, 1)

    def test_open_llama_al_lanzador(self):
        d, cfg = entorno()
        llamadas = []
        code, _ = ejecutar(["--config", str(cfg), "open", "demo"], lanzador=llamadas.append)
        self.assertEqual((code, llamadas), (0, ["demo"]))
        code, _ = ejecutar(["--config", str(cfg), "open", "nada"], lanzador=llamadas.append)
        self.assertEqual((code, llamadas), (2, ["demo"]))

    def test_open_con_lanzador_que_falla(self):
        d, cfg = entorno()

        def malo(slug):
            raise OSError("sin node")
        code, err = ejecutar(["--config", str(cfg), "open", "demo"], lanzador=malo)
        self.assertEqual(code, 1)
        self.assertIn("sin node", err)

    def test_global_sin_argumentos(self):
        d, cfg = entorno()
        apps = []
        code, _ = ejecutar(["--config", str(cfg)], run_app=apps.append)
        self.assertEqual((code, apps[0].modo), (0, "global"))

    def test_uso_incorrecto(self):
        with self.assertRaises(SystemExit) as cm, contextlib.redirect_stderr(io.StringIO()):
            main(["--no-existe"])
        self.assertEqual(cm.exception.code, 2)


if __name__ == "__main__":
    unittest.main()


class TestStart(unittest.TestCase):
    def test_start(self):
        d, cfg = entorno()
        llamadas, apps = [], []
        # en la carpeta de un proyecto: abre ese proyecto
        code, _ = ejecutar(["--config", str(cfg), "start"], cwd=str(d / "otro" / "sub"), lanzador=llamadas.append, run_app=apps.append)
        self.assertEqual((code, llamadas, apps), (0, ["otro"], []))
        # con nombre: abre ese proyecto aunque estés en otro sitio
        code, _ = ejecutar(["--config", str(cfg), "start", "demo"], cwd=str(d), lanzador=llamadas.append, run_app=apps.append)
        self.assertEqual((code, llamadas), (0, ["otro", "demo"]))
        # fuera de cualquier proyecto y sin nombre: la lista de proyectos
        code, _ = ejecutar(["--config", str(cfg), "start"], cwd=str(d), lanzador=llamadas.append, run_app=apps.append)
        self.assertEqual((code, llamadas, apps[0].modo), (0, ["otro", "demo"], "global"))
        # nombre inexistente: error claro
        code, err = ejecutar(["--config", str(cfg), "start", "nada"], cwd=str(d), lanzador=llamadas.append, run_app=apps.append)
        self.assertEqual(code, 2)
        self.assertIn("nada", err)
