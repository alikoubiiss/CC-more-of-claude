import asyncio
import json
import tempfile
import unittest
from pathlib import Path

from hq.actions import Backlog
from hq.app import HQApp
from hq.screens.board import BoardScreen
from hq.widgets import Lienzo


class Falso:
    def __init__(self, status=0, err=""):
        self.llamadas, self.status, self.err = [], status, err

    def __call__(self, args, cwd):
        self.llamadas.append(list(args))
        return self.status, "", self.err


def tarjeta(repo: Path, n: int, status="Planificado", labels=(), title=None, milestone="Diseño"):
    d = repo / "backlog" / "tasks"
    d.mkdir(parents=True, exist_ok=True)
    lab = "labels:\n" + "".join(f"  - {x}\n" for x in labels) if labels else ""
    (d / f"task-{n} - t.md").write_text(
        f"---\nid: TASK-{n}\ntitle: {title or 'Tarea ' + str(n)}\nstatus: {status}\n{lab}milestone: {milestone}\n---\n", encoding="utf8")


def fases(repo: Path):
    (repo / ".hq").mkdir(exist_ok=True)
    (repo / ".hq" / "fases.json").write_text(json.dumps({"fases": [
        {"id": "f1", "nombre": "Diseño", "milestone": "Diseño", "aprobada": None}]}), encoding="utf8")


def nuevo() -> Path:
    return Path(tempfile.mkdtemp(prefix="hq-board-"))


def correr(repo, fake, prueba, size=(120, 30), **extra):
    async def run():
        app = HQApp("board", "demo", repo=repo, backlog=Backlog(fake), **extra)
        async with app.run_test(size=size) as pilot:
            await pilot.pause()
            await prueba(app, pilot, app.screen)
    asyncio.run(run())


async def dialogo(pilot, tecla, respuesta):
    await pilot.press(tecla)
    await pilot.pause()
    await pilot.press(respuesta)
    await pilot.pause()


def estado(app) -> str:
    return str(app.screen.query_one("#estado").render())


class TestPuertaTarjeta(unittest.TestCase):
    def test_cancelar_no_ejecuta_y_confirmar_si(self):
        repo, fake = nuevo(), Falso()
        tarjeta(repo, 1, "Verificando", ["revisada"])

        async def prueba(app, pilot, scr):
            await pilot.press("a")
            await pilot.pause()
            self.assertEqual(type(app.screen).__name__, "Confirmar")
            await pilot.press("n")
            await pilot.pause()
            self.assertEqual(fake.llamadas, [])
            await dialogo(pilot, "a", "escape")
            await dialogo(pilot, "a", "enter")
            self.assertEqual(fake.llamadas, [])
            await dialogo(pilot, "a", "s")
            self.assertEqual(fake.llamadas, [["task", "edit", "TASK-1", "-s", "Hecho", "--remove-label", "revisada"]])
        correr(repo, fake, prueba)

    def test_no_aprobable(self):
        for status, labels in (("Verificando", []), ("En curso", ["revisada"])):
            repo, fake = nuevo(), Falso()
            tarjeta(repo, 1, status, labels)

            async def prueba(app, pilot, scr):
                await pilot.press("a")
                await pilot.pause()
                self.assertEqual(type(app.screen).__name__, "BoardScreen")
                self.assertIn("no se puede aprobar", estado(app))
                self.assertEqual(fake.llamadas, [])
            correr(repo, fake, prueba)

    def test_mejorar_con_motivo_saneado(self):
        repo, fake = nuevo(), Falso()
        tarjeta(repo, 1, "Verificando", ["revisada"])

        async def prueba(app, pilot, scr):
            await pilot.press("m")
            await pilot.pause()
            for ch in "falta test & firma":
                await pilot.press("ampersand" if ch == "&" else ("space" if ch == " " else ch))
            await pilot.press("enter")
            await pilot.pause()
            self.assertEqual(len(fake.llamadas), 1)
            self.assertIn("Falta: falta test firma", fake.llamadas[0])
            await dialogo(pilot, "m", "escape")
            self.assertEqual(len(fake.llamadas), 1)
        correr(repo, fake, prueba)

    def test_fallo_de_backlog_se_muestra(self):
        repo, fake = nuevo(), Falso(1, "boom roto")
        tarjeta(repo, 1, "Verificando", ["revisada"])

        async def prueba(app, pilot, scr):
            await dialogo(pilot, "a", "s")
            self.assertIn("boom roto", estado(app))
            self.assertEqual(scr.query_one(Lienzo).seleccionada.status, "Verificando")
        correr(repo, fake, prueba)


class TestPuertaFase(unittest.TestCase):
    def test_aprobar_fase_esperando(self):
        repo, fake = nuevo(), Falso()
        fases(repo)
        tarjeta(repo, 1, "Hecho")

        async def prueba(app, pilot, scr):
            await dialogo(pilot, "A", "n")
            self.assertIsNone(json.loads((repo / ".hq" / "fases.json").read_text(encoding="utf8"))["fases"][0]["aprobada"])
            await dialogo(pilot, "A", "s")
            self.assertIsNotNone(json.loads((repo / ".hq" / "fases.json").read_text(encoding="utf8"))["fases"][0]["aprobada"])
            self.assertEqual(fake.llamadas, [])
        correr(repo, fake, prueba)

    def test_fase_activa_no_se_aprueba(self):
        repo, fake = nuevo(), Falso()
        fases(repo)
        tarjeta(repo, 1, "En curso")

        async def prueba(app, pilot, scr):
            await pilot.press("A")
            await pilot.pause()
            self.assertEqual(type(app.screen).__name__, "BoardScreen")
            self.assertIn("ninguna fase", estado(app))
        correr(repo, fake, prueba)

    def test_mejorar_fase_crea_tarjeta(self):
        repo, fake = nuevo(), Falso()
        fases(repo)
        tarjeta(repo, 1, "Hecho")

        async def prueba(app, pilot, scr):
            await pilot.press("M")
            await pilot.pause()
            for ch in "x":
                await pilot.press(ch)
            await pilot.press("enter")
            await pilot.pause()
            self.assertEqual(fake.llamadas, [["task", "create", "Mejorar: x", "-m", "Diseño", "-s", "Planificado"]])
        correr(repo, fake, prueba)


class TestVarios(unittest.TestCase):
    def test_arrastrar_a_hecho_no_llama(self):
        repo, fake = nuevo(), Falso()
        tarjeta(repo, 1, "En curso")

        async def prueba(app, pilot, scr):
            l = scr.query_one(Lienzo)
            g = l._grid
            x0, y0 = l._pos["TASK-1"]
            l.arrastrar(x0 + 2, y0 + 1, g.xs[4] + 2, y0 + 1)
            await pilot.pause()
            self.assertEqual(fake.llamadas, [])
            self.assertIn("puerta", estado(app))
            l.arrastrar(x0 + 2, y0 + 1, g.xs[3] + 2, y0 + 1)
            await pilot.pause()
            self.assertEqual(fake.llamadas, [["task", "edit", "TASK-1", "-s", "Verificando"]])
        correr(repo, fake, prueba)

    def test_refresco_por_sondeo(self):
        repo, fake = nuevo(), Falso()
        tarjeta(repo, 1)

        async def prueba(app, pilot, scr):
            l = scr.query_one(Lienzo)
            self.assertEqual(len(l.cards), 1)
            tarjeta(repo, 2)
            for _ in range(5):
                await pilot.pause(0.5)
                if len(l.cards) == 2:
                    break
            self.assertEqual(len(l.cards), 2)
        correr(repo, fake, prueba)

    def test_sin_tarjetas_sin_fases(self):
        repo, fake = nuevo(), Falso()

        async def prueba(app, pilot, scr):
            await pilot.press("a", "m", "A", "M", "enter", "c", "r", "right", "down")
            await pilot.pause()
            self.assertEqual(type(app.screen).__name__, "BoardScreen")
            self.assertEqual(fake.llamadas, [])
        correr(repo, fake, prueba)

    def test_registro_vacio_muestra_mensaje(self):
        async def run():
            cfgdir = nuevo()
            (cfgdir / "config.json").write_text(json.dumps({
                "vaultPath": str(cfgdir), "projectsRoot": str(cfgdir), "vaultProjectsDir": "P", "dataDir": str(cfgdir)}), encoding="utf8")
            from hq.config import load_config
            app = HQApp("board", "nada", cfg=load_config(cfgdir / "config.json"))
            async with app.run_test(size=(80, 20)) as pilot:
                await pilot.pause()
                self.assertEqual(type(app.screen).__name__, "MensajeScreen")
        asyncio.run(run())

    def test_escapes_no_llegan_a_pantalla(self):
        repo, fake = nuevo(), Falso()
        tarjeta(repo, 1, title="\x1b[31mroja")

        async def prueba(app, pilot, scr):
            await pilot.press("enter")
            await pilot.pause()
            self.assertNotIn("\x1b", app.export_screenshot())
            self.assertNotIn("\x1b", scr.query_one(Lienzo).cards[0].title)
        correr(repo, fake, prueba)

    def test_estrecha(self):
        repo, fake = nuevo(), Falso()
        for i in range(1, 8):
            tarjeta(repo, i, ["Ideas", "En curso", "Hecho"][i % 3])

        async def prueba(app, pilot, scr):
            await pilot.press("right", "right", "down", "c")
            await pilot.pause()
        correr(repo, fake, prueba, size=(60, 20))




class Tarea:
    def __init__(self, id, status="Planificado", title="t", labels=(), deps=(), items=(), comments=(), description=""):
        self.id, self.status, self.title, self.labels, self.dependencies = id, status, title, list(labels), list(deps)
        self.criteria_items, self.comments, self.description, self.milestone = list(items), list(comments), description, "Diseño"


class TestDetalle(unittest.TestCase):
    def _detalle(self, ancho):
        from hq.screens.board import render_detalle
        t = Tarea("TASK-2", "En curso", "Pagos \x1b[31m‮" + "x" * 300, ["modelo:opus", "skill:tdd", "backend", "revisada"],
                  ["TASK-1", "TASK-3", "TASK-99"], [(i, f"criterio {i}", i % 2 == 0) for i in range(1, 10)],
                  [("autor", "2026-10-10", "comentario [b]sin markup[/b]")], "descripción " * 80)
        otras = [t, Tarea("TASK-1", "Hecho", "base"), Tarea("TASK-3", "Verificando", "otra")]
        return render_detalle(t, otras, ancho)

    def test_paneles_y_textos_literales(self):
        for ancho in (30, 70, 120):
            txt = self._detalle(ancho).plain
            for x in ("TASK-2 · En curso", "4/9", "… y 3 más", "TASK-99", "Estado"):
                self.assertIn(x, txt, (ancho, x))
            self.assertNotIn("\x1b", txt)
            self.assertNotIn("‮", txt)
            self.assertTrue(all(len(l) == ancho for l in txt.splitlines()), ancho)
        txt = self._detalle(120).plain
        for x in ("Criterios de aceptación · 4/9", "4/9 cumplidos", "bloqueada por 1", "[b]sin markup[/b]", "#backend",
                  "no está en el tablero", "Modelo Opus"):
            self.assertIn(x, txt, x)

    def test_dos_columnas_desde_100(self):
        estrecho, ancho = self._detalle(80).plain.splitlines(), self._detalle(120).plain.splitlines()
        self.assertLess(len(ancho), len(estrecho))
        self.assertTrue(any(l.count("╭") == 2 for l in ancho))

    def test_detalle_en_pantalla_y_ayuda(self):
        repo, fake = nuevo(), Falso()
        tarjeta(repo, 1, "En curso", ["modelo:opus"], title="Conectar")

        async def prueba(app, pilot, scr):
            self.assertIn("Enter detalle", estado(app))
            self.assertIn("0% (0/1)", str(scr.query_one("#cabecera").render()))
            await pilot.press("enter")
            await pilot.pause()
            self.assertTrue(scr.query_one("#detalle").display)
            self.assertIn("TASK-1 · En curso", str(scr.query_one("#detalle-texto").render()))
            await pilot.press("r")
            await pilot.pause()
            self.assertIn("Actualizado", estado(app))
            await pilot.press("question_mark")
            self.assertIn("mover de columna", estado(app))
            await pilot.press("enter")
            await pilot.pause()
            self.assertFalse(scr.query_one("#detalle").display)
        for ancho in (40, 70, 110):
            correr(repo, fake, prueba, size=(ancho, 30))


class TestMoverConTeclas(unittest.TestCase):
    def test_mayor_que_y_menor_que_mueven_de_columna_sin_pasar_por_hecho(self):
        repo, fake = nuevo(), Falso()
        tarjeta(repo, 1, "Planificado")

        async def prueba(app, pilot, scr):
            await pilot.press("greater_than_sign")
            await pilot.pause()
            self.assertEqual(fake.llamadas, [["task", "edit", "TASK-1", "-s", "En curso"]])
            self.assertIn("En curso", estado(app))
            await pilot.press("less_than_sign")
            await pilot.pause()
            self.assertEqual(fake.llamadas[-1], ["task", "edit", "TASK-1", "-s", "Ideas"])
        correr(repo, fake, prueba)

    def test_no_se_mueve_a_hecho_ni_fuera_de_los_extremos(self):
        repo, fake = nuevo(), Falso()
        tarjeta(repo, 1, "Verificando", ["revisada"])

        async def prueba(app, pilot, scr):
            await pilot.press("greater_than_sign")
            await pilot.pause()
            self.assertEqual(fake.llamadas, [])
            self.assertIn("a", estado(app))
            self.assertIn("puerta", estado(app))
        correr(repo, fake, prueba)

        repo2, fake2 = nuevo(), Falso()
        tarjeta(repo2, 1, "Ideas")

        async def prueba2(app, pilot, scr):
            await pilot.press("less_than_sign")
            await pilot.pause()
            self.assertEqual(fake2.llamadas, [])
            self.assertIn("primera columna", estado(app))
        correr(repo2, fake2, prueba2)

    def test_sin_tarjetas_no_hace_nada_y_un_fallo_se_muestra(self):
        repo, fake = nuevo(), Falso(1, "boom roto")

        async def prueba(app, pilot, scr):
            await pilot.press("greater_than_sign", "less_than_sign")
            await pilot.pause()
            self.assertEqual(fake.llamadas, [])
        correr(repo, fake, prueba)

        repo2, fake2 = nuevo(), Falso(1, "boom roto")
        tarjeta(repo2, 1, "Planificado")

        async def prueba2(app, pilot, scr):
            await pilot.press("greater_than_sign")
            await pilot.pause()
            self.assertIn("boom roto", estado(app))
        correr(repo2, fake2, prueba2)


if __name__ == "__main__":
    unittest.main()


class TestIniciarYEditar(unittest.TestCase):
    def test_i_pasa_planificado_a_en_curso_y_abre_el_editor(self):
        repo, fake = nuevo(), Falso()
        tarjeta(repo, 1, "Planificado")

        async def prueba(app, pilot, scr):
            await pilot.press("i")
            await pilot.pause()
            self.assertEqual(fake.llamadas, [["task", "edit", "TASK-1", "-s", "En curso"]])
            self.assertEqual(type(app.screen).__name__, "EditarTarjeta")
            await pilot.press("escape")
            await pilot.pause()
            self.assertEqual(len(fake.llamadas), 1)
        correr(repo, fake, prueba)

    def test_i_rechaza_otros_estados(self):
        for st in ("Ideas", "En curso", "Verificando", "Hecho"):
            repo, fake = nuevo(), Falso()
            tarjeta(repo, 1, st)

            async def prueba(app, pilot, scr):
                await pilot.press("i")
                await pilot.pause()
                self.assertIn("no se puede iniciar", estado(app))
                self.assertEqual(fake.llamadas, [])
            correr(repo, fake, prueba)

    def test_i_respeta_las_fases_pendientes(self):
        repo, fake = nuevo(), Falso()
        (repo / ".hq").mkdir()
        (repo / ".hq" / "fases.json").write_text(json.dumps({"fases": [
            {"id": "f1", "nombre": "Diseño", "milestone": "Diseño", "aprobada": None},
            {"id": "f2", "nombre": "Build", "milestone": "Build", "aprobada": None}]}), encoding="utf8")
        tarjeta(repo, 1, "Planificado", milestone="Build")

        async def prueba(app, pilot, scr):
            await pilot.press("i")
            await pilot.pause()
            self.assertIn("fase", estado(app))
            self.assertEqual(fake.llamadas, [])
        correr(repo, fake, prueba)

    def test_E_edita_titulo_y_conserva_otras_etiquetas(self):
        repo, fake = nuevo(), Falso()
        tarjeta(repo, 1, "En curso", ["ui", "modelo:opus", "esfuerzo:high"])

        async def prueba(app, pilot, scr):
            await pilot.press("E")
            await pilot.pause()
            self.assertEqual(type(app.screen).__name__, "EditarTarjeta")
            await pilot.press("enter")
            await pilot.pause()
            self.assertEqual(len(fake.llamadas), 1)
            ll = fake.llamadas[0]
            self.assertEqual(ll[:3], ["task", "edit", "TASK-1"])
            self.assertIn("--clear-ac", ll)
            self.assertEqual(ll[ll.index("-l") + 1], "ui,modelo:opus,esfuerzo:high")
        correr(repo, fake, prueba)

    def test_E_rechaza_verificando(self):
        repo, fake = nuevo(), Falso()
        tarjeta(repo, 1, "Verificando")

        async def prueba(app, pilot, scr):
            await pilot.press("E")
            await pilot.pause()
            self.assertIn("no se puede editar", estado(app))
        correr(repo, fake, prueba)


class TestAccionesEditar(unittest.TestCase):
    def test_modelo_invalido_y_titulo_vacio(self):
        from hq import actions
        fake = Falso()
        b = Backlog(fake)
        self.assertFalse(actions.editar(".", "TASK-1", [], "x", "", [], "gpt", "", b).ok)
        self.assertFalse(actions.editar(".", "TASK-1", [], "  ", "", [], "", "", b).ok)
        self.assertFalse(actions.editar(".", "TASK-1", [], "x", "", [], "", "max", b).ok)
        self.assertEqual(fake.llamadas, [])

    def test_sustituye_modelo_y_pasa_criterios(self):
        from hq import actions
        fake = Falso()
        r = actions.editar(repo := nuevo(), "TASK-2", ["a", "modelo:opus"], "T & t", "d", ["uno", "dos"], "haiku", "medium", Backlog(fake))
        self.assertTrue(r.ok)
        ll = fake.llamadas[0]
        self.assertEqual(ll[ll.index("-t") + 1], "T t")
        self.assertEqual(ll[ll.index("-l") + 1], "a,modelo:haiku,esfuerzo:medium")
        self.assertEqual(ll.count("--acceptance-criteria"), 2)
