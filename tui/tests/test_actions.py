import json
import re
import tempfile
import unittest
from pathlib import Path

from hq.actions import Backlog, aprobar_fase, aprobar_tarjeta, mejorar_fase, mejorar_tarjeta, mover, sanear_texto
from hq.fases import Fase

PROHIBIDOS = re.compile("[&|<>^%\"'`$\r\n\u0000-\u001f\u007f-\u009f]")


class Falso:
    def __init__(self, status=0, err=""):
        self.llamadas = []
        self.status, self.err = status, err

    def __call__(self, args, cwd):
        self.llamadas.append(list(args))
        return self.status, "", self.err


def repo() -> Path:
    return Path(tempfile.mkdtemp(prefix="hq-act-"))


class TestSanear(unittest.TestCase):
    def test_sin_metacaracteres_y_recorta(self):
        s = sanear_texto('a & b | c "d" `x` $y %z% ^ \n \x1b[0m')
        self.assertFalse(PROHIBIDOS.search(s), s)
        self.assertEqual(len(sanear_texto("x" * 500)), 200)
        self.assertEqual(sanear_texto("&|<>"), "")


class TestTarjetas(unittest.TestCase):
    def setUp(self):
        self.r = repo()
        self.f = Falso()
        self.b = Backlog(self.f)

    def test_mover_rechaza_hecho(self):
        for e in ("Hecho", "done", "HECHO", " Done "):
            self.assertFalse(mover(self.r, "TASK-3", e, self.b).ok)
        self.assertEqual(self.f.llamadas, [])

    def test_mover_normal(self):
        self.assertTrue(mover(self.r, "TASK-3", "En curso", self.b).ok)
        self.assertEqual(self.f.llamadas, [["task", "edit", "TASK-3", "-s", "En curso"]])

    def test_mover_estado_desconocido(self):
        self.assertFalse(mover(self.r, "TASK-3", "Inventado", self.b).ok)
        self.assertEqual(self.f.llamadas, [])

    def test_aprobar_tarjeta(self):
        self.assertTrue(aprobar_tarjeta(self.r, "TASK-3", self.b).ok)
        self.assertEqual(self.f.llamadas, [["task", "edit", "TASK-3", "-s", "Hecho", "--remove-label", "revisada"]])

    def test_mejorar_tarjeta(self):
        self.assertTrue(mejorar_tarjeta(self.r, "TASK-3", "falta la firma & el test", self.b).ok)
        self.assertEqual(self.f.llamadas, [["task", "edit", "TASK-3", "-s", "En curso", "--remove-label", "revisada",
                                            "--comment", "Falta: falta la firma el test", "--comment-author", "@usuario"]])

    def test_mejorar_motivo_vacio(self):
        self.assertFalse(mejorar_tarjeta(self.r, "TASK-3", "&|<>", self.b).ok)
        self.assertEqual(self.f.llamadas, [])

    def test_ids_invalidos(self):
        for i in ("TASK-3; rm", "../x", "", "TASK-", "TASK-3\n"):
            self.assertFalse(aprobar_tarjeta(self.r, i, self.b).ok, i)
            self.assertFalse(mover(self.r, i, "En curso", self.b).ok, i)
        self.assertTrue(aprobar_tarjeta(self.r, "TASK-3.1", self.b).ok)
        self.assertEqual(len(self.f.llamadas), 1)

    def test_fallo_del_runner(self):
        b = Backlog(Falso(1, "boom " * 200))
        r = aprobar_tarjeta(self.r, "TASK-3", b)
        self.assertFalse(r.ok)
        self.assertLessEqual(len(r.mensaje), 300)

    def test_runner_que_lanza(self):
        def malo(args, cwd):
            raise OSError("no")
        self.assertFalse(aprobar_tarjeta(self.r, "TASK-3", Backlog(malo)).ok)

    def test_cwd_inexistente(self):
        r = aprobar_tarjeta(self.r / "nada", "TASK-3", self.b)
        self.assertFalse(r.ok)
        self.assertEqual(self.f.llamadas, [])


class TestFases(unittest.TestCase):
    def _repo(self, hechas: bool):
        r = repo()
        (r / ".hq").mkdir()
        (r / ".hq" / "fases.json").write_text(json.dumps({"fases": [
            {"id": "f1", "nombre": "Diseño", "milestone": "Diseño", "aprobada": None}]}), encoding="utf8")
        t = r / "backlog" / "tasks"
        t.mkdir(parents=True)
        (t / "task-1 - a.md").write_text(
            f"---\nid: TASK-1\ntitle: a\nstatus: {'Hecho' if hechas else 'Planificado'}\nmilestone: Diseño\n---\n", encoding="utf8")
        return r

    def test_aprobar_fase_esperando(self):
        r = self._repo(True)
        self.assertTrue(aprobar_fase(r, "f1", "2026-10-09").ok)
        self.assertEqual(json.loads((r / ".hq" / "fases.json").read_text(encoding="utf8"))["fases"][0]["aprobada"], "2026-10-09")

    def test_aprobar_fase_no_lista_no_toca(self):
        r = self._repo(False)
        antes = (r / ".hq" / "fases.json").read_text(encoding="utf8")
        self.assertFalse(aprobar_fase(r, "f1", "2026-10-09").ok)
        self.assertEqual((r / ".hq" / "fases.json").read_text(encoding="utf8"), antes)
        self.assertFalse(aprobar_fase(r, "nada", "2026-10-09").ok)

    def test_mejorar_fase(self):
        f = Falso()
        fase = Fase("f1", "Diseño", "Diseño", None, "esperando", 1, 1)
        self.assertTrue(mejorar_fase(repo(), fase, "falta & algo", Backlog(f)).ok)
        self.assertEqual(f.llamadas, [["task", "create", "Mejorar: falta algo", "-m", "Diseño", "-s", "Planificado"]])

    def test_mejorar_fase_milestone_invalido(self):
        f = Falso()
        fase = Fase("f1", "x", 'a"b', None, "esperando", 1, 1)
        self.assertFalse(mejorar_fase(repo(), fase, "algo", Backlog(f)).ok)
        self.assertFalse(mejorar_fase(repo(), Fase("f1", "x", "ok", None), "&|", Backlog(f)).ok)
        self.assertEqual(f.llamadas, [])


if __name__ == "__main__":
    unittest.main()
