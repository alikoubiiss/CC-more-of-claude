"""e/v del tablero envían la orden al panel de Claude (TASK-4), con backend Win32 falso.

Esta suite corre dentro de la ventana de Windows Terminal del usuario: `panel._ejecutar_real` y
`panel.backend_por_defecto` se sustituyen por funciones que fallan, así que un clip.exe, un `wt move-focus` o un
SendInput reales harían fallar el test en vez de tocar su sesión.
"""
import asyncio
import json
import tempfile
import threading
import time
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

from textual import events as tx_events

from hq import panel
from hq.actions import Backlog
from hq.app import HQApp
from hq.focus import prompt_desde, sid_panel
from hq.panel import CTRL_V, ENTER
from hq.screens import board

from tests.test_board_screen import Falso as BacklogFalso, estado, nuevo, tarjeta
from tests.test_panel import HWND, Falso

SLUG = "demo"
ORDEN = "/project-hq:ejecutar TASK-1"
MOVE_FOCUS = ("wt", "-w", "0", "move-focus", "left")


def iso(t: datetime) -> str:
    return t.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def escribir_evento(events_dir: Path, sid: str, kind: str, t: datetime | None = None, **extra) -> None:
    t = t or datetime.now(timezone.utc)
    d = events_dir / SLUG
    d.mkdir(parents=True, exist_ok=True)
    with (d / f"{t.astimezone().date().isoformat()}.jsonl").open("a", encoding="utf8") as f:
        f.write(json.dumps({"t": iso(t), "sid": sid, "kind": kind, **extra}) + "\n")


class FalsoTablero(Falso):
    """Backend y procesos falsos. `wt move-focus` hace llegar AppBlur al tablero por el camino real (post_message
    desde el hilo del envío). `puerta`: si se da, el pegado espera a que el test la abra (envío en vuelo)."""

    def __init__(self, blur=True, puerta=None, al_enter=None, **kw):
        super().__init__(**kw)
        self.app = None
        self.blur, self.puerta, self.al_enter = blur, puerta, al_enter
        self.en_vuelo = threading.Event()

    def ejecutar(self, args, entrada=None):
        rc = super().ejecutar(args, entrada)
        if tuple(args) == MOVE_FOCUS and self.blur and self.app is not None:
            self.app.call_from_thread(self.app.post_message, tx_events.AppBlur())
        return rc

    def send_input(self, teclas):
        teclas = tuple(teclas)
        if teclas == CTRL_V and self.puerta is not None:
            self.en_vuelo.set()
            self.puerta.wait(5)
        n = super().send_input(teclas)
        if teclas == ENTER and self.al_enter:
            self.al_enter()
        return n


def _prohibido(*a, **k):
    raise AssertionError("un test ha llegado a un proceso o backend real")


def tablero(app):
    return next(s for s in app.screen_stack if isinstance(s, board.BoardScreen))


async def esperar(pilot, cond, tope=5.0):
    fin = time.monotonic() + tope
    while not cond():
        if time.monotonic() > fin:
            raise AssertionError("tiempo agotado esperando la condición")
        await pilot.pause(0.05)


class Base(unittest.TestCase):
    def setUp(self):
        for nombre in ("_ejecutar_real", "backend_por_defecto"):
            p = mock.patch.object(panel, nombre, _prohibido)
            p.start()
            self.addCleanup(p.stop)
        self.repo = nuevo()
        self.events_dir = Path(tempfile.mkdtemp(prefix="hq-envio-ev-"))
        self.backlog = BacklogFalso()

    def correr(self, f, prueba, estado_claude=("libre", "turno terminado hace 9 s"), entorno=None, tope=5.0):
        entorno = {"WT_SESSION": "f00d", "HQ_LAYOUT": SLUG} if entorno is None else entorno
        self.estados = []

        def leer_estado(slug):
            self.estados.append(slug)
            return estado_claude

        async def run():
            app = HQApp("board", SLUG, repo=self.repo, backlog=Backlog(self.backlog), events_dir=self.events_dir,
                        panel_backend=f, panel_ejecutar=f.ejecutar, panel_entorno=entorno, panel_dormir=f.dormir,
                        estado_claude=leer_estado, tope_poscondicion=tope)
            f.app = app
            async with app.run_test(size=(120, 30)) as pilot:
                await pilot.pause()
                await prueba(app, pilot)
                await esperar(pilot, lambda: not tablero(app).enviando)  # nunca se sale con un envío en vuelo
        asyncio.run(run())


class TestConfirmacion(Base):
    def test_el_dialogo_muestra_la_orden_exacta_y_el_aviso_del_prompt_vacio(self):
        tarjeta(self.repo, 1, "Planificado")
        f = FalsoTablero()

        async def prueba(app, pilot):
            await pilot.press("e")
            await pilot.pause()
            self.assertEqual(type(app.screen).__name__, "Confirmar")
            texto = app.screen.pregunta
            self.assertIn(f"Se enviará a Claude: {ORDEN}", texto)
            self.assertIn("vacío", texto)
            await pilot.press("n")
            await pilot.pause()
            self.assertIn("Cancelado", estado(app))
        self.correr(f, prueba)
        self.assertEqual(f.log, [])

    def test_la_orden_mostrada_es_la_que_se_envia(self):
        self.assertEqual(panel.texto_orden("revisar", "TASK-7"), "/project-hq:revisar TASK-7")
        self.assertEqual(panel.preparar_orden("revisar", "TASK-7", lambda a, e=None: 0).orden,
                         panel.texto_orden("revisar", "TASK-7"))


class TestEnvio(Base):
    def test_libre_envia_pegando_y_con_enter_y_confirma_con_el_prompt(self):
        tarjeta(self.repo, 1, "Planificado")
        escribir_evento(self.events_dir, "panel01", "stop", datetime.now(timezone.utc) - timedelta(seconds=9))
        f = FalsoTablero(al_enter=lambda: escribir_evento(self.events_dir, "panel01", "prompt"))

        async def prueba(app, pilot):
            await pilot.press("e")
            await pilot.pause()
            await pilot.press("s")
            await esperar(pilot, lambda: not tablero(app).enviando and "Enviado" in estado(app))
            self.assertIn(ORDEN, estado(app))
        self.correr(f, prueba)
        self.assertEqual(f.acciones(), [("clip",), MOVE_FOCUS, CTRL_V, ENTER])
        self.assertEqual(self.backlog.llamadas, [])  # no toca la tarjeta: lo hace Claude
        self.assertGreaterEqual(len(self.estados), 2)  # se vuelve a mirar el estado antes de la primera tecla

    def test_hwnd_se_toma_al_confirmar(self):
        tarjeta(self.repo, 1, "Planificado")
        f = FalsoTablero()
        vistos = []
        original = f.primer_plano

        def primer_plano():
            vistos.append(type(f.app.screen).__name__)
            return original()
        f.primer_plano = primer_plano

        async def prueba(app, pilot):
            await pilot.press("e")
            await pilot.pause()
            self.assertEqual(vistos, [])  # abrir el diálogo no mira la ventana
            await pilot.press("s")
            await esperar(pilot, lambda: not tablero(app).enviando)
        self.correr(f, prueba, tope=0.1)
        self.assertTrue(vistos)
        self.assertNotEqual(vistos[0], "Confirmar")

    def test_v_revisa_en_verificando_sin_revisar(self):
        tarjeta(self.repo, 1, "Verificando")
        f = FalsoTablero()

        async def prueba(app, pilot):
            await pilot.press("v")
            await pilot.pause()
            self.assertIn("/project-hq:revisar TASK-1", app.screen.pregunta)
            await pilot.press("s")
            await esperar(pilot, lambda: not tablero(app).enviando)
        self.correr(f, prueba, tope=0.1)
        self.assertEqual(f.procesos()[0], ("clip",))
        self.assertEqual(f.log[0][2], b"/project-hq:revisar TASK-1")

    def test_sin_prompt_en_el_tope_la_barra_dice_no_se_confirmo(self):
        tarjeta(self.repo, 1, "Planificado")
        escribir_evento(self.events_dir, "panel01", "stop", datetime.now(timezone.utc) - timedelta(seconds=9))
        # Un prompt de OTRA sesión no confirma el envío.
        f = FalsoTablero(al_enter=lambda: escribir_evento(self.events_dir, "otra", "prompt"))

        async def prueba(app, pilot):
            await pilot.press("e")
            await pilot.pause()
            await pilot.press("s")
            await esperar(pilot, lambda: not tablero(app).enviando)
            self.assertIn("no se confirmó el envío", estado(app))
        self.correr(f, prueba, tope=0.3)
        self.assertEqual(f.envios_hechos(), [CTRL_V, ENTER])

    def test_tope_de_la_poscondicion_es_5_s(self):
        self.assertEqual(board.POSCONDICION_S, 5.0)


class TestNoLibre(Base):
    def test_ocupado_o_desconocido_mueve_el_foco_sin_teclear_y_dice_el_motivo(self):
        for est, motivo, texto in (("ocupado", "turno en curso: Bash", "Claude ocupado (turno en curso: Bash)"),
                                   ("desconocido", "otra sesión viva (abc)", "otra sesión viva (abc)")):
            with self.subTest(est):
                self.repo = nuevo()
                tarjeta(self.repo, 1, "Planificado")
                f = FalsoTablero()

                async def prueba(app, pilot):
                    await pilot.press("e")
                    await pilot.pause()
                    await pilot.press("s")
                    await esperar(pilot, lambda: not tablero(app).enviando)
                    self.barra = estado(app)
                self.correr(f, prueba, estado_claude=(est, motivo))
                self.assertEqual(f.envios_hechos(), [])
                self.assertIn(MOVE_FOCUS, f.procesos())
                self.assertIn(texto, self.barra)
                self.assertIn("copiada", self.barra)

    def test_otro_proyecto_solo_copia_y_dice_donde_pegarlo(self):
        tarjeta(self.repo, 1, "Planificado")
        f = FalsoTablero()

        async def prueba(app, pilot):
            await pilot.press("e")
            await pilot.pause()
            await pilot.press("s")
            await esperar(pilot, lambda: not tablero(app).enviando)
            self.barra = estado(app)
        self.correr(f, prueba, entorno={"WT_SESSION": "f00d", "HQ_LAYOUT": "otro"})
        self.assertEqual(f.procesos(), [("clip",)])
        self.assertEqual(f.envios_hechos(), [])
        self.assertIn(f"pégalo en la sesión de {SLUG}", self.barra)
        self.assertTrue(self.barra.lstrip("✖ ").startswith("Orden copiada"), self.barra)

    def test_sin_tarjeta_valida_no_se_envia_nada(self):
        casos = (("Hecho", (), "e", "no se puede ejecutar"), ("Verificando", (), "e", "no se puede ejecutar"),
                 ("Ideas", (), "e", "no se puede ejecutar"), ("Planificado", (), "v", "no se puede revisar"),
                 ("Verificando", ("revisada",), "v", "no se puede revisar"))
        for st, labels, tecla, aviso in casos:
            with self.subTest(st=st, tecla=tecla, labels=labels):
                self.repo = nuevo()
                tarjeta(self.repo, 1, st, labels)
                f = FalsoTablero()

                async def prueba(app, pilot):
                    await pilot.press(tecla)
                    await pilot.pause()
                    self.assertEqual(type(app.screen).__name__, "BoardScreen")
                    self.barra = estado(app)
                self.correr(f, prueba)
                self.assertEqual(f.log, [])
                self.assertIn(aviso, self.barra)


NOTEPAD = 1247050


class LadronDeFoco(FalsoTablero):
    """Otra ventana (Bloc de notas) pasa a primer plano justo tras el move-focus, durante la espera de AppBlur."""

    def ejecutar(self, args, entrada=None):
        if tuple(args) == MOVE_FOCUS:
            self.hwnd, self.clase_, self.exe = NOTEPAD, "Notepad", r"C:\Windows\System32\notepad.exe"
        return super().ejecutar(args, entrada)


class TestFocoRobado(Base):
    """TASK-20 criterio 4, versión automática: con otra ventana en primer plano no se teclea y la barra dice por qué."""

    def lanzar(self, f, tope=0.2):
        tarjeta(self.repo, 1, "Planificado")

        async def prueba(app, pilot):
            await pilot.press("e")
            await pilot.pause()
            await pilot.press("s")
            await esperar(pilot, lambda: not tablero(app).enviando)
            self.barra = estado(app)
        self.correr(f, prueba, tope=tope)

    def test_foco_robado_durante_la_espera_no_teclea(self):
        f = LadronDeFoco()
        self.lanzar(f)
        self.assertEqual(f.envios_hechos(), [])
        self.assertIn("La ventana en primer plano no es la del tablero", self.barra)
        self.assertIn("copiada", self.barra)

    def test_foco_robado_entre_pegar_y_enter_no_manda_el_enter_y_dice_por_que(self):
        f = FalsoTablero(tras_pegar={"hwnd": NOTEPAD, "clase_": "Notepad"})
        self.lanzar(f)
        self.assertEqual(f.envios_hechos(), [CTRL_V])  # el Ctrl+V fue a WT, antes de perder el foco
        self.assertIn(panel.MSG_PEGADA, self.barra)
        self.assertIn("La ventana en primer plano no es la del tablero", self.barra)

    def test_sendinput_bloqueado_lo_dice_la_barra(self):
        f = FalsoTablero(envios=[0])
        self.lanzar(f)
        self.assertEqual(f.envios_hechos(), [CTRL_V])
        self.assertIn("UIPI", self.barra)
        self.assertNotIn(panel.MSG_PEGADA, self.barra)

    def test_poscondicion_acaba_en_su_tope(self):
        f = FalsoTablero()
        t0 = time.monotonic()
        self.lanzar(f, tope=0.3)
        self.assertLess(time.monotonic() - t0, 0.3 + 4.0)  # arranque del tablero incluido
        self.assertIn("no se confirmó el envío", self.barra)


class TestModoEnviando(Base):
    def test_durante_el_envio_el_tablero_ignora_teclas(self):
        tarjeta(self.repo, 1, "Verificando", ["revisada"])  # con a se podría aprobar si llegara la tecla
        tarjeta(self.repo, 2, "Planificado")
        puerta = threading.Event()
        f = FalsoTablero(puerta=puerta)

        async def prueba(app, pilot):
            lienzo = app.screen.query_one("#lienzo")
            for tecla in ("left",) * 4 + ("right",) * 8:
                if lienzo.seleccionada.id == "TASK-2":
                    break
                await pilot.press(tecla)
                await pilot.pause()
            self.assertEqual(lienzo.seleccionada.id, "TASK-2")
            await pilot.press("e")
            await pilot.pause()
            await pilot.press("s")
            await esperar(pilot, f.en_vuelo.is_set)
            for tecla in ("enter", "e", "a", "A", "v", "left", "greater_than_sign", "q"):
                await pilot.press(tecla)
                await pilot.pause()
            self.assertNotIn(type(app.screen).__name__, ("Confirmar", "Motivo"))
            board_scr = tablero(app)
            self.assertFalse(board_scr.query_one("#detalle").display)
            self.assertEqual(board_scr.query_one("#lienzo").seleccionada.id, "TASK-2")
            self.assertTrue(app.is_running)
            puerta.set()
            await esperar(pilot, lambda: not board_scr.enviando)
            self.assertEqual(type(app.screen).__name__, "BoardScreen")
        self.correr(f, prueba, tope=0.2)
        self.assertEqual(self.backlog.llamadas, [])
        self.assertEqual(f.envios_hechos(), [CTRL_V, ENTER])  # un solo envío

    def test_un_fallo_del_envio_no_deja_el_tablero_bloqueado(self):
        tarjeta(self.repo, 1, "Planificado")
        f = FalsoTablero()

        def roto(*a, **k):
            raise RuntimeError("se rompió")

        async def prueba(app, pilot):
            with mock.patch.object(board.envio, "enviar_orden", roto):
                await pilot.press("e")
                await pilot.pause()
                await pilot.press("s")
                await esperar(pilot, lambda: not tablero(app).enviando)
            self.assertIn("se rompió", estado(app))
            await pilot.press("e")
            await pilot.pause()
            self.assertEqual(type(app.screen).__name__, "Confirmar")
            await pilot.press("n")
            await pilot.pause()
        self.correr(f, prueba)


class TestEventos(unittest.TestCase):
    def setUp(self):
        self.d = Path(tempfile.mkdtemp(prefix="hq-envio-ev-"))
        self.ahora = datetime.now(timezone.utc)

    def test_sid_panel_es_la_ultima_sesion_que_no_ha_terminado(self):
        self.assertEqual(sid_panel(self.d, SLUG), "")
        escribir_evento(self.d, "vieja", "stop", self.ahora - timedelta(seconds=30))
        escribir_evento(self.d, "nueva", "inicio", self.ahora - timedelta(seconds=20), source="clear")
        escribir_evento(self.d, "vieja", "fin", self.ahora - timedelta(seconds=19.9), reason="clear")
        self.assertEqual(sid_panel(self.d, SLUG), "nueva")

    def test_prompt_desde_exige_misma_sid_y_posterior(self):
        desde = self.ahora - timedelta(seconds=5)
        escribir_evento(self.d, "panel", "prompt", self.ahora - timedelta(seconds=10))
        escribir_evento(self.d, "otra", "prompt", self.ahora)
        escribir_evento(self.d, "panel", "stop", self.ahora)
        self.assertFalse(prompt_desde(self.d, SLUG, "panel", desde))
        escribir_evento(self.d, "panel", "prompt", self.ahora)
        self.assertTrue(prompt_desde(self.d, SLUG, "panel", desde))
        self.assertFalse(prompt_desde(self.d / "no-existe", SLUG, "panel", desde))


class TestSinNewTab(unittest.TestCase):
    def test_actions_y_board_no_abren_pestanas(self):
        import hq.actions as act
        for m in (act, board):
            self.assertNotIn("new-tab", Path(m.__file__).read_text(encoding="utf8"))
        self.assertFalse(hasattr(act, "lanzar_comando"))


if __name__ == "__main__":
    unittest.main()
