import json
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

from hq.config import ConfigError, load_config
from hq.stats import Estado, estado, leer, resumen

HOY = date(2026, 10, 10)


def tmp() -> Path:
    return Path(tempfile.mkdtemp(prefix="hq-stats-"))


def escribe(d: Path, slug: str, dia: date, *lineas) -> None:
    f = d / slug / f"{dia.isoformat()}.jsonl"
    f.parent.mkdir(parents=True, exist_ok=True)
    with f.open("a", encoding="utf8") as fh:
        for ln in lineas:
            fh.write((ln if isinstance(ln, str) else json.dumps(ln)) + "\n")


def snap(delta, card="TASK-1", model="sonnet", sid="abc12345", **kw):
    return {"t": "2026-10-10T10:00:00.000Z", "sid": sid, "kind": "snap", "model": model, "card": card, "cost": delta, "delta": delta, **kw}


class TestEstado(unittest.TestCase):
    def test_umbrales(self):
        self.assertEqual(estado(79, 100), Estado(79, "ok"))
        self.assertEqual(estado(80, 100).estado, "aviso")
        self.assertEqual(estado(99, 100).estado, "aviso")
        self.assertEqual(estado(100, 100).estado, "pasado")
        self.assertEqual(estado(150, 100), Estado(150, "pasado"))
        self.assertEqual(estado(5, None).estado, "sin")
        self.assertEqual(estado(5, 0).estado, "sin")
        self.assertEqual(estado(0.005, 0.01).pct, 50)  # redondeo como en Node: mitades hacia arriba


class TestLeer(unittest.TestCase):
    def test_lee_ignora_corruptas_y_limpia(self):
        d = tmp()
        escribe(d, "demo", HOY, snap(1.5, card="TASK-1"), "{corrupta", snap(2, card="TASK-9\x1b[31m", model="Son\x1bnet"),
                {"kind": "mem", "mem": "nlm", "sid": "x"}, [1, 2], snap("mucho"))
        l = leer(d)
        self.assertEqual([x["kind"] for x in l], ["snap", "snap", "mem", "snap"])
        self.assertEqual(l[0]["slug"], "demo")
        self.assertEqual(l[0]["dia"], HOY)
        self.assertIsNone(l[1]["card"])
        self.assertIsNone(l[1]["model"])
        self.assertEqual(l[3]["delta"], 0.0)

    def test_filtros_y_directorios_raros(self):
        d = tmp()
        escribe(d, "demo", HOY, snap(1))
        escribe(d, "demo", HOY - timedelta(days=5), snap(2))
        escribe(d, "otro", HOY, snap(4))
        (d / "Mal Slug").mkdir()
        (d / "Mal Slug" / f"{HOY.isoformat()}.jsonl").write_text(json.dumps(snap(99)) + "\n", encoding="utf8")
        (d / "demo" / "tarjetas.json").write_text("{}", encoding="utf8")
        (d / "demo" / "basura.jsonl").write_text("x", encoding="utf8")
        self.assertEqual(sum(x["delta"] for x in leer(d)), 7)
        self.assertEqual(len(leer(d, slug="demo")), 2)
        self.assertEqual(len(leer(d, desde=HOY)), 2)
        self.assertEqual(leer(d, slug="no-existe"), [])
        self.assertEqual(leer(d / "no-existe"), [])


class TestResumen(unittest.TestCase):
    def test_totales_y_agrupaciones(self):
        d = tmp()
        escribe(d, "demo", HOY, snap(1.5, card="TASK-1"), snap(0.5, card="TASK-2", model="opus"), snap(2, card=None))
        escribe(d, "demo", HOY - timedelta(days=3), snap(3, card="TASK-1"))
        escribe(d, "demo", HOY - timedelta(days=9), snap(4, card="TASK-2"))
        escribe(d, "demo", date(2026, 9, 20), snap(8, card="TASK-3"))
        escribe(d, "otro", HOY, snap(1, card="TASK-1", model="haiku"))
        r = resumen(leer(d), HOY, {"diaUsd": 10, "tarjetaUsd": 5})
        self.assertAlmostEqual(r.hoy_usd, 5)
        self.assertAlmostEqual(r.semana_usd, 8)
        self.assertAlmostEqual(r.mes_usd, 12)
        self.assertEqual(r.por_proyecto, [("demo", 19.0), ("otro", 1.0)])
        self.assertEqual(r.por_tarjeta[0], ("demo", "TASK-3", 8.0))
        self.assertIn(("demo", None, 2.0), r.por_tarjeta)
        self.assertEqual(dict(r.por_modelo)["opus"], 0.5)
        self.assertEqual(len(r.tendencia), 14)
        self.assertEqual(r.tendencia[-1], (HOY, 5.0))
        self.assertEqual(r.tendencia[-4], (HOY - timedelta(days=3), 3.0))
        self.assertEqual(r.tendencia[0][1], 0.0)
        self.assertEqual(r.dia, Estado(50, "ok"))
        self.assertEqual(r.n_datos, 7)

    def test_medianoche_no_duplica(self):
        d = tmp()
        escribe(d, "demo", HOY - timedelta(days=1), snap(2, cost=2))
        escribe(d, "demo", HOY, snap(3, cost=5))
        r = resumen(leer(d), HOY, None)
        self.assertEqual((r.hoy_usd, r.dia.estado), (3.0, "sin"))
        self.assertEqual(sum(v for _, v in r.tendencia), 5.0)

    def test_memoria(self):
        d = tmp()
        escribe(d, "demo", HOY, {"kind": "mem", "mem": "nlm"}, {"kind": "mem", "mem": "nlm"}, {"kind": "mem", "mem": "vault"},
                {"kind": "mem", "mem": "conocimiento"}, {"kind": "mem", "mem": "raro"}, {"kind": "inicio", "chars": 300}, {"kind": "inicio", "chars": 500})
        m = resumen(leer(d), HOY, None).memoria
        self.assertEqual((m["nlm"], m["vault"], m["conocimiento"], m["inicio_medio_chars"]), (2, 1, 1, 400))

    def test_vacio(self):
        r = resumen([], HOY, {"diaUsd": 10})
        self.assertEqual((r.n_datos, r.hoy_usd, r.por_tarjeta, r.por_proyecto), (0, 0.0, [], []))
        self.assertIsNone(r.memoria["inicio_medio_chars"])
        self.assertEqual(r.dia, Estado(0, "ok"))


class TestConfig(unittest.TestCase):
    def _cfg(self, **extra):
        d = tmp()
        f = d / "config.json"
        f.write_text(json.dumps({"vaultPath": str(d), "projectsRoot": str(d), "vaultProjectsDir": "P", "dataDir": str(d), **extra}), encoding="utf8")
        return d, f

    def test_metrics_dir_y_presupuesto(self):
        d, f = self._cfg(presupuesto={"diaUsd": 50, "tarjetaUsd": 15})
        c = load_config(f)
        self.assertEqual(c.metrics_dir, d / "metrics")
        self.assertEqual(c.presupuesto, {"diaUsd": 50, "tarjetaUsd": 15})
        self.assertIsNone(load_config(self._cfg()[1]).presupuesto)
        self.assertEqual(load_config(self._cfg(presupuesto={"diaUsd": 5})[1]).presupuesto, {"diaUsd": 5, "tarjetaUsd": None})

    def test_presupuesto_invalido(self):
        for malo in ({"diaUsd": 0}, {"tarjetaUsd": "mucho"}, 5, {"diaUsd": True}):
            with self.assertRaises(ConfigError, msg=str(malo)):
                load_config(self._cfg(presupuesto=malo)[1])


if __name__ == "__main__":
    unittest.main()


class TestLeerNoAbreFuera(unittest.TestCase):
    def test_no_lee_los_ficheros_fuera_del_rango(self):
        from unittest import mock

        d = tmp()
        for i in range(5):
            escribe(d, "demo", HOY - timedelta(days=i), snap(1))
        with mock.patch.object(Path, "read_text", autospec=True, side_effect=Path.read_text) as rt:
            self.assertEqual(len(leer(d, desde=HOY - timedelta(days=1))), 2)
            self.assertEqual(rt.call_count, 2)
