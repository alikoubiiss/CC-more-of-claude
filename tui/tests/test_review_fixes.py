import json
import os
import re
import tempfile
import unittest
from pathlib import Path

from hq.actions import buscar_backlog
from hq.fases import FasesError, derive, load_fases

CTRL = re.compile("[\u0000-\u001f\u007f-\u009f]")


def repo_con(fases) -> Path:
    r = Path(tempfile.mkdtemp(prefix="hq-rf-"))
    (r / ".hq").mkdir()
    (r / ".hq" / "fases.json").write_text(json.dumps({"fases": fases}), encoding="utf8")
    return r


class TestFases(unittest.TestCase):
    def test_entradas_invalidas_dan_fases_error(self):
        for malo in ([{"id": "f1"}], [None], [{"nombre": "x"}], [{"id": 3, "nombre": "x"}], ["texto"]):
            with self.assertRaises(FasesError, msg=str(malo)):
                load_fases(repo_con(malo))

    def test_nombre_sin_control(self):
        f = derive([{"id": "f1", "nombre": "A\x1b[31m\x1b]0;pwn", "milestone": "A", "aprobada": None}], [], [])[0]
        self.assertFalse(CTRL.search(f.nombre + f.id))


class TestBuscarBacklog(unittest.TestCase):
    def test_no_usa_el_directorio_actual(self):
        d = Path(tempfile.mkdtemp(prefix="hq-bk-"))
        (d / "backlog.cmd").write_text("@echo pwn\n", encoding="utf8")
        (d / "backlog.bat").write_text("@echo pwn\n", encoding="utf8")
        antes = os.getcwd()
        os.chdir(d)
        try:
            r = buscar_backlog()
        finally:
            os.chdir(antes)
        self.assertTrue(r is None or Path(r).resolve().parent != d.resolve(), r)


if __name__ == "__main__":
    unittest.main()
