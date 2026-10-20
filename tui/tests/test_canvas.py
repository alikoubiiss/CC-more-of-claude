import asyncio
import re
import time
import unittest
from types import SimpleNamespace as NS

from textual.app import App, ComposeResult

from hq.canvas import (Card, barra, bloqueos, card_de_task, color_etiqueta, disenar, franja_fases, franja_fases_texto,
                       mezcla)
from hq.fases import Fase
from hq.widgets import Lienzo

CTRL = re.compile("[\u0000-\u001f\u007f-\u009f‪-‮]")


def c(id, status, title="t", deps=(), **kw):
    return Card(id, title, status, deps=list(deps), **kw)


class TestDisenar(unittest.TestCase):
    def test_posiciones_por_columna(self):
        g, pos = disenar([c("A", "Ideas"), c("B", "En curso"), c("C", "En curso")], plegar_vacias=False)
        self.assertEqual(pos["A"][0], 0)
        self.assertEqual(pos["B"][0], 2 * (26 + 9))
        self.assertGreater(pos["C"][1], pos["B"][1])
        self.assertEqual(g.w, 5 * 26 + 4 * 9)

    def test_misma_columna_conecta(self):
        g, pos = disenar([c("A", "En curso"), c("B", "En curso", deps=["A"])])
        txt = "\n".join(g.lines())
        self.assertTrue(set("├┴┬╰╭╮╯") & set(txt))
        self.assertTrue(all(len(r) <= g.w for r in g.lines()))

    def test_cruce(self):
        cards = [c("A", "Ideas"), c("B", "Hecho", deps=["A"]), c("C", "Ideas"), c("D", "Hecho", deps=["C"])]
        g, _ = disenar(cards, plegar_vacias=False)
        self.assertIn("┼", "\n".join(g.lines()))

    def test_plegado_reduce_ancho(self):
        cards = [c("A", "En curso")]
        a, _ = disenar(cards, plegar_vacias=False)
        b, _ = disenar(cards, plegar_vacias=True)
        self.assertLess(b.w, a.w)

    def test_compacto_mas_estrecho(self):
        cards = [c("A", "Ideas"), c("B", "Hecho")]
        a, _ = disenar(cards, plegar_vacias=False)
        b, _ = disenar(cards, compacto=True, plegar_vacias=False)
        self.assertLess(b.w, a.w)

    def test_seleccion_doble(self):
        g, _ = disenar([c("A", "Ideas"), c("B", "Hecho")], seleccion="B")
        self.assertEqual("\n".join(g.lines()).count("╔"), 1)

    def test_200_tarjetas_rapido(self):
        cards = [c(f"T-{i}", ["Ideas", "Planificado", "En curso", "Verificando", "Hecho"][i % 5],
                   deps=[f"T-{i - 1}"] if i else []) for i in range(200)]
        t = time.perf_counter()
        disenar(cards)
        self.assertLess(time.perf_counter() - t, 0.5)

    def test_control_no_llega_al_grid(self):
        g, _ = disenar([c("A", "Ideas", title="\x1b[31mroja‮")])
        self.assertFalse(CTRL.search("".join("".join(r) for r in g.ch)))

    def test_sin_tarjetas(self):
        g, pos = disenar([])
        self.assertEqual(pos, {})


class TestEstiloTarjetas(unittest.TestCase):
    def test_bloqueos(self):
        cards = [c("A", "En curso"), c("B", "Planificado", deps=["A", "X-9"]), c("C", "Hecho"),
                 c("D", "Planificado", deps=["c"]), c("E", "Hecho", deps=["A"])]
        # X-9 no está en el tablero: no bloquea; las hechas nunca se marcan; ids sin distinguir mayúsculas
        self.assertEqual(bloqueos(cards), {"B": ["A"]})
        txt = "\n".join(disenar(cards, plegar_vacias=False)[0].lines())
        self.assertIn("bloqueada: A", txt)

    def test_cables_no_atraviesan_tarjetas(self):
        cards = [c("A", "Ideas"), c("M1", "Planificado"), c("M2", "En curso"), c("M3", "Verificando"),
                 c("B", "Hecho", deps=["A"]), c("C", "Ideas", deps=["A"]), c("D", "Verificando", deps=["M1"])]
        for compacto in (False, True):
            g, pos = disenar(cards, compacto=compacto, plegar_vacias=False)
            for x, y in pos.values():
                for yy in range(y, y + g.alto_card):
                    for xx in range(x, x + g.ancho_card):
                        self.assertEqual(g.mask[yy][xx], 0, (compacto, xx, yy))

    def test_caracteres_anchos_no_descuadran(self):
        from rich.cells import cell_len
        g, _ = disenar([c("A", "Ideas", title="漢字漢字漢字漢字漢字漢字漢字 🚀🚀"), c("B", "En curso", title="ok")])
        for fila in g.ch:
            self.assertEqual(cell_len("".join(fila)), g.w)

    def test_insignias_y_modelo(self):
        cards = [c("A", "Verificando", labels=["revisada", "modelo:opus"]), c("B", "Hecho"), c("C", "Planificado", labels=["revisada"])]
        txt = "\n".join(disenar(cards)[0].lines())
        for x in ("espera aprobación", "✓ hecha", "✔ revisada", "● Opus", "VERIFICANDO  1"):
            self.assertIn(x, txt)

    def test_animacion_solo_en_curso_y_esperando(self):
        g, _ = disenar([c("A", "Planificado"), c("B", "Hecho")])
        self.assertEqual(g.anim, [])
        g, pos = disenar([c("A", "En curso")])
        x, y = pos["A"]
        antes = "".join(g.ch[y])
        self.assertEqual(g.animar(1), {y})
        self.assertNotEqual("".join(g.ch[y]), antes)
        g, _ = disenar([c("A", "Verificando", labels=["revisada"])])
        self.assertEqual(len(g.anim), 1)

    def test_etiquetas_de_usuario_con_color_estable(self):
        card = c("A", "Planificado", labels=["modelo:opus", "skill:tdd", "revisada", "backend"])
        self.assertEqual(card.etiquetas, ["backend"])
        self.assertEqual(color_etiqueta("backend"), color_etiqueta("backend"))
        txt = "\n".join(disenar([card])[0].lines())
        self.assertIn("#backend", txt)
        self.assertIn("⚑ tdd", txt)

    def test_esfuerzo_riesgo_y_estimacion_son_etiquetas_de_sistema(self):
        card = c("A", "Planificado", labels=["modelo:opus", "esfuerzo:xhigh", "riesgo:alto", "est:45", "skill:tdd", "backend"])
        self.assertEqual(card.etiquetas, ["backend"])
        self.assertEqual(card.model, "opus")
        txt = "\n".join(disenar([card])[0].lines())
        for x in ("#esfuerzo", "#riesgo", "#est"):
            self.assertNotIn(x, txt)

    def test_modelo_haiku_heredado_se_sigue_leyendo_sin_romper(self):
        card = c("A", "Planificado", labels=["modelo:haiku", "esfuerzo:high"])
        self.assertEqual(card.model, "haiku")
        self.assertEqual(card.etiquetas, [])
        disenar([card])

    def test_barra_y_mezcla(self):
        self.assertEqual(mezcla(["#000000", "#FFFFFF"], 0), "#000000")
        self.assertEqual(mezcla(["#000000", "#FFFFFF"], 1), "#FFFFFF")
        b = barra(50, 10, ["#000000", "#FFFFFF"])
        self.assertEqual(b.cell_len, 10)
        self.assertEqual(b.plain.count("█"), 5)
        self.assertEqual(barra(250, 4, ["#000000", "#FFFFFF"]).plain, "████")

    def test_franja_con_color(self):
        fs = [Fase("f1", "Diseño", "Diseño", "2026-10-01", "aprobada", 2, 2), Fase("f2", "Build\x1b[2J", "Build", None, "esperando", 3, 3)]
        self.assertIn("espera tu aprobación", franja_fases_texto(fs, 80).plain)
        t = franja_fases_texto(fs, 30)
        self.assertFalse(CTRL.search(t.plain.replace("\n", "")))
        self.assertTrue(all(len(l) <= 30 for l in t.plain.splitlines()))


class TestCardDeTask(unittest.TestCase):
    def test_conversion(self):
        t = NS(id="TASK-1", title="x", status="Hecho", labels=["modelo:opus"], dependencies=["TASK-2"],
               criteria_done=1, criteria_total=2, milestone="m-0")
        card = card_de_task(t, [NS(id="m-0", title="Diseño")])
        self.assertEqual((card.id, card.deps, card.done, card.total, card.milestone, card.model),
                         ("TASK-1", ["TASK-2"], 1, 2, "Diseño", "opus"))


class TestFranja(unittest.TestCase):
    def test_simbolos(self):
        fs = [Fase("f1", "Diseño", "Diseño", "2026-10-01", "aprobada", 2, 2), Fase("f2", "Build", "Build", None, "esperando", 3, 3),
              Fase("f3", "Pruebas", "Pruebas", None, "pendiente", 0, 0)]
        s = franja_fases(fs, 120)
        for x in ("●", "◎", "○", "2/2", "3/3"):
            self.assertIn(x, s)
        self.assertEqual(franja_fases([], 80), "")

    def test_ajusta_a_ancho(self):
        fs = [Fase(f"f{i}", f"Fase{i}", "m", None, "pendiente", 0, 0) for i in range(8)]
        self.assertTrue(all(len(l) <= 40 for l in franja_fases(fs, 40).splitlines()))


class Host(App):
    def __init__(self, cards):
        super().__init__()
        self.cards = cards

    def compose(self) -> ComposeResult:
        yield Lienzo()

    def on_mount(self):
        self.query_one(Lienzo).set_cards(self.cards)


class TestLienzo(unittest.TestCase):
    def test_mueve_y_scroll(self):
        async def run():
            cards = [c("A", "Ideas"), c("B", "En curso"), c("C", "Hecho"), c("D", "Hecho")]
            app = Host(cards)
            async with app.run_test(size=(60, 20)) as pilot:
                l = app.query_one(Lienzo)
                await pilot.pause()
                self.assertEqual(l.seleccionada.id, "B")
                await pilot.press("right")
                await pilot.pause()
                self.assertEqual(l.seleccionada.id, "C")
                self.assertGreater(l.scroll_offset.x, 0)
                await pilot.press("down")
                await pilot.pause()
                self.assertEqual(l.seleccionada.id, "D")
        asyncio.run(run())

    def test_latido_solo_con_tarjetas_animadas(self):
        async def run():
            for cards, animado in (([c("A", "Planificado")], False), ([c("A", "En curso")], True)):
                app = Host(cards)
                async with app.run_test(size=(60, 20)) as pilot:
                    l = app.query_one(Lienzo)
                    await pilot.pause()
                    self.assertEqual(l.animado, animado)
                    self.assertEqual(l._latido._active.is_set(), animado)
                    antes = l.frame
                    await pilot.pause(0.6)
                    self.assertEqual(l.frame > antes, animado)
                    self.assertEqual(l.seleccionada.id, "A")
        asyncio.run(run())

    def test_cero_tarjetas(self):
        async def run():
            app = Host([])
            async with app.run_test(size=(60, 20)) as pilot:
                await pilot.pause()
                await pilot.press("right", "down", "left", "up")
                self.assertIsNone(app.query_one(Lienzo).seleccionada)
        asyncio.run(run())


if __name__ == "__main__":
    unittest.main()
