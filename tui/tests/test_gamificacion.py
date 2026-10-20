import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

from hq.gamificacion import NIVELES, calcular, nivel_de
from hq.tasks import parse_task

HOY = date(2026, 10, 10)
PRES = {"diaUsd": 10, "tarjetaUsd": 5}


def d(n: int) -> str:
    """Fecha de hace n días en formato AAAA-MM-DD."""
    return (HOY - timedelta(days=n)).isoformat()


def calc(hechas=(), fases=(), por_dia=None, por_tarjeta=None, memoria=None, decisiones=0, presupuesto=PRES):
    mem = {"nlm": 0, "vault": 0, "conocimiento": 0, "dias": []}
    mem.update(memoria or {})
    return calcular(list(hechas), list(fases), por_dia or {}, por_tarjeta or {}, mem, decisiones, HOY, presupuesto)


def logros(e):
    return {i: ok for i, _, ok in e.logros}


class TestXp(unittest.TestCase):
    def test_tarjetas(self):
        e = calc(hechas=[(d(1), "a:T-1"), (d(2), "a:T-2"), (d(3), "a:T-3"), ("", "a:T-4")],
                 por_tarjeta={"a:T-1": 3.0, "a:T-2": 7.0, "a:T-3": 0.0})
        # 4 tarjetas x 10 + 5 solo por T-1 (gasto > 0 y <= 5)
        self.assertEqual(e.xp, 45)

    def test_sin_presupuesto_no_hay_bonus(self):
        e = calc(hechas=[(d(1), "a:T-1")], por_tarjeta={"a:T-1": 1.0}, por_dia={d(1): 2.0}, presupuesto=None)
        self.assertEqual(e.xp, 10)
        e2 = calc(hechas=[(d(1), "a:T-1")], por_tarjeta={"a:T-1": 1.0}, presupuesto={"diaUsd": None, "tarjetaUsd": None})
        self.assertEqual(e2.xp, 10)

    def test_fases_y_dias(self):
        e = calc(fases=[d(5), d(2)], por_dia={d(1): 4.0, d(2): 10.0, d(3): 10.5, d(4): 0.0})
        # 2 fases x 50 + dias cerrados dentro de presupuesto (d1 y d2): 2 x 5
        self.assertEqual(e.xp, 110)

    def test_hoy_no_cuenta_para_dias_bajo_presupuesto(self):
        self.assertEqual(calc(por_dia={HOY.isoformat(): 1.0}).xp, 0)
        self.assertEqual(calc(por_dia={HOY: 1.0}).xp, 0)

    def test_nada_sin_acciones_del_usuario(self):
        e = calc(memoria={"nlm": 500, "vault": 500, "conocimiento": 500, "dias": [HOY - timedelta(days=i) for i in range(10)]}, decisiones=0)
        self.assertEqual((e.xp, e.nivel, e.racha), (0, 1, 0))


class TestNivel(unittest.TestCase):
    def test_umbrales(self):
        self.assertEqual(NIVELES, [0, 20, 50, 100, 180, 300, 480, 720, 1050, 1500])
        for xp, nivel in {0: 1, 19: 1, 20: 2, 49: 2, 50: 3, 99: 3, 100: 4, 1499: 9, 1500: 10, 5000: 10}.items():
            self.assertEqual(nivel_de(xp), nivel, xp)

    def test_con_datos_reales(self):
        e = calc(fases=[d(1)])
        self.assertEqual((e.xp, e.nivel, e.xp_siguiente), (50, 3, 100))
        self.assertIsNone(calc(fases=[d(1)] * 30).xp_siguiente)


class TestRacha(unittest.TestCase):
    def test_racha(self):
        self.assertEqual(calc(hechas=[(d(0), "a:1"), (d(1), "a:2"), (d(2), "a:3")]).racha, 3)
        self.assertEqual(calc(hechas=[(d(1), "a:1"), (d(2), "a:2")]).racha, 2)
        self.assertEqual(calc(hechas=[(d(2), "a:1"), (d(3), "a:2")]).racha, 0)
        self.assertEqual(calc(hechas=[(d(0), "a:1"), (d(2), "a:2")]).racha, 1)
        self.assertEqual(calc(hechas=[("", "a:1"), ("basura", "a:2")]).racha, 0)
        self.assertEqual(calc(hechas=[(d(0), "a:1"), (d(0), "a:2")]).racha, 1)


class TestLogros(unittest.TestCase):
    def test_primeros(self):
        self.assertFalse(any(logros(calc()).values()))
        e = calc(hechas=[(d(1), "a:1")], fases=[d(1)])
        self.assertTrue(logros(e)["primera-tarjeta"] and logros(e)["primera-fase"])

    def test_rachas_historicas(self):
        e = calc(hechas=[(d(20), "a:1"), (d(19), "a:2"), (d(18), "a:3")])
        self.assertTrue(logros(e)["racha-3"])
        self.assertFalse(logros(e)["racha-7"])
        e = calc(hechas=[(d(i), f"a:{i}") for i in range(30, 22, -1)])
        self.assertTrue(logros(e)["racha-7"])

    def test_bajo_presupuesto(self):
        hechas = [(d(1), f"a:{i}") for i in range(5)]
        e = calc(hechas=hechas, por_tarjeta={f"a:{i}": 1.0 for i in range(5)})
        self.assertTrue(logros(e)["bajo-presupuesto-5"])
        e = calc(hechas=hechas, por_tarjeta={f"a:{i}": 1.0 for i in range(4)})
        self.assertFalse(logros(e)["bajo-presupuesto-5"])
        self.assertFalse(logros(calc(hechas=hechas, por_tarjeta={f"a:{i}": 1.0 for i in range(5)}, presupuesto=None))["bajo-presupuesto-5"])

    def test_semana_sin_pasarte(self):
        dias = {d(i): 3.0 for i in range(1, 8)}
        self.assertTrue(logros(calc(por_dia=dias))["semana-sin-pasarte"])
        dias[d(4)] = 11.0
        self.assertFalse(logros(calc(por_dia=dias))["semana-sin-pasarte"])
        dias[d(4)] = 0.0
        self.assertFalse(logros(calc(por_dia=dias))["semana-sin-pasarte"])
        self.assertFalse(logros(calc(por_dia={d(i): 3.0 for i in range(1, 8)}, presupuesto=None))["semana-sin-pasarte"])

    def test_memoria_y_decisiones(self):
        self.assertTrue(logros(calc(memoria={"nlm": 1}))["primera-consulta-nlm"])
        self.assertFalse(logros(calc(memoria={"nlm": 0}))["primera-consulta-nlm"])
        self.assertTrue(logros(calc(memoria={"conocimiento": 10}))["conocimiento-10"])
        self.assertFalse(logros(calc(memoria={"conocimiento": 9}))["conocimiento-10"])
        self.assertTrue(logros(calc(memoria={"dias": [HOY - timedelta(days=i) for i in range(7)]}))["memoria-activa"])
        self.assertFalse(logros(calc(memoria={"dias": [HOY - timedelta(days=i) for i in (0, 1, 2, 4, 5, 6, 7)]}))["memoria-activa"])
        self.assertTrue(logros(calc(decisiones=10))["decisiones-10"])
        self.assertFalse(logros(calc(decisiones=9))["decisiones-10"])

    def test_lista_completa_y_nombres(self):
        e = calc()
        self.assertEqual(len(e.logros), 10)
        self.assertTrue(all(nombre for _, nombre, _ in e.logros))


class TestUpdated(unittest.TestCase):
    def test_fecha_de_actualizacion(self):
        t = parse_task("---\nid: TASK-1\ntitle: t\nstatus: Hecho\nupdated_date: '2026-10-09 15:03'\n---\n")
        self.assertEqual(t.updated, "2026-10-09")
        t = parse_task("---\nid: TASK-1\nupdated_date: 2026-10-09T15:03:00Z\n---\n")
        self.assertEqual(t.updated, "2026-10-09")
        for raro in ("", "ayer", "2026-13-45x", "\x1b[31m2026-10-09"):
            t = parse_task(f"---\nid: TASK-1\nupdated_date: {raro}\n---\n")
            self.assertIn(t.updated, ("", "2026-10-09"))
        self.assertEqual(parse_task("---\nid: TASK-1\n---\n").updated, "")


if __name__ == "__main__":
    unittest.main()
