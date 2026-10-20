"""enviar_orden / preparar_orden (tui/hq/panel.py) con backend Win32 falso.

Todos los tests inyectan backend, procesos, entorno, dormir y señal de foco: esta suite corre dentro de la
ventana de Windows Terminal del usuario y un clip.exe o un `wt move-focus` reales tocarían su sesión.
"""
import ast
import subprocess
import sys
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

from hq import panel
from hq.panel import (CLASE_WT, CTRL_V, ENTER, MSG_PEGADA, PAUSA_S, TOPE_FOCO_S, VK_SHIFT, BackendNulo,
                      enviar_orden, preparar_orden)

HWND = 4852008
EXE = r"C:\Program Files\WindowsApps\Microsoft.WindowsTerminal_1.24.12741.0_x64__8wekyb3d8bbwe\WindowsTerminal.exe"
ENTORNO = {"WT_SESSION": "f00d", "HQ_LAYOUT": "obsidian"}
CLIP = ("clip",)
MOVE_FOCUS = ("wt", "-w", "0", "move-focus", "left")
BACKEND_POR_DEFECTO = panel.backend_por_defecto  # antes de que Base lo sustituya por _prohibido
EJECUTAR_REAL = panel._ejecutar_real


class Falso:
    """Backend Win32 falso, procesos y dormir: todo efecto va a un mismo registro ordenado."""
    disponible = True

    def __init__(self, hwnd=HWND, clase=CLASE_WT, exe=EXE, pulsadas=(), envios=None, rc_clip=0, rc_wt=0,
                 tras_pegar=None):
        self.log = []
        self.hwnd, self.clase_, self.exe, self.pulsadas = hwnd, clase, exe, set(pulsadas)
        self.envios = list(envios) if envios is not None else None
        self.rc = {"clip": rc_clip, "wt": rc_wt}
        self.tras_pegar = tras_pegar or {}

    # backend Win32
    def primer_plano(self):
        return self.hwnd

    def clase(self, hwnd):
        return self.clase_

    def proceso(self, hwnd):
        return self.exe

    def tecla_pulsada(self, vk):
        return vk in self.pulsadas

    def send_input(self, teclas):
        teclas = tuple(teclas)
        self.log.append(("send", teclas))
        n = self.envios.pop(0) if self.envios else len(teclas)
        if teclas == CTRL_V:
            for k, v in self.tras_pegar.items():
                setattr(self, k, v)
        return n

    # procesos y tiempo
    def ejecutar(self, args, entrada=None):
        self.log.append(("proc", tuple(args), entrada))
        return self.rc[args[0]]

    def dormir(self, s):
        self.log.append(("dormir", s))

    # vistas del registro
    def procesos(self):
        return [e[1] for e in self.log if e[0] == "proc"]

    def envios_hechos(self):
        return [e[1] for e in self.log if e[0] == "send"]

    def acciones(self):
        return [e[1] for e in self.log if e[0] in ("proc", "send")]


class Senal:
    def __init__(self, log, llega=True):
        self.log, self.llega, self.timeouts = log, llega, []

    def clear(self):
        self.log.append(("clear",))

    def wait(self, timeout=None):
        self.timeouts.append(timeout)
        self.log.append(("wait", timeout))
        return self.llega


def _prohibido(*a, **k):
    raise AssertionError("un test ha llegado a un proceso o backend real")


class Base(unittest.TestCase):
    def setUp(self):
        for nombre in ("_ejecutar_real", "backend_por_defecto"):
            p = mock.patch.object(panel, nombre, _prohibido)
            p.start()
            self.addCleanup(p.stop)

    def enviar(self, f=None, llega=True, **kw):
        f = f or Falso()
        senal = Senal(f.log, llega)
        args = dict(slug="obsidian", estado="libre", hwnd0=HWND, senal_foco=senal, backend=f,
                    ejecutar=f.ejecutar, entorno=ENTORNO, dormir=f.dormir)
        args.update(kw)
        comando = args.pop("comando", "ejecutar")
        tid = args.pop("task_id", "TASK-1")
        return enviar_orden(comando, tid, **args), f, senal


class TestCaminoFeliz(Base):
    """Criterio 1: secuencia exacta con Claude libre, layout correcto y mismo HWND."""

    def test_secuencia_exacta(self):
        r, f, senal = self.enviar()
        self.assertTrue(r.ok, r.mensaje)
        self.assertIsNone(r.motivo)
        self.assertEqual(r.orden, "/project-hq:ejecutar TASK-1")
        self.assertEqual(f.acciones(), [CLIP, MOVE_FOCUS, CTRL_V, ENTER])
        i, j = f.log.index(("send", CTRL_V)), f.log.index(("send", ENTER))
        self.assertEqual(f.log[i + 1:j], [("dormir", PAUSA_S)])
        self.assertEqual(f.log[0], ("proc", CLIP, b"/project-hq:ejecutar TASK-1"))

    def test_pausa_es_la_del_spike(self):
        self.assertGreaterEqual(PAUSA_S, 0.150)

    def test_nunca_new_tab_ni_claude(self):
        for comando in ("ejecutar", "revisar"):
            r, f, _ = self.enviar(comando=comando, task_id="TASK-7")
            self.assertTrue(r.ok, r.mensaje)
            for args in f.procesos():
                self.assertNotIn("new-tab", args)
                self.assertFalse(any("claude" in a.lower() for a in args), args)

    def test_limpia_la_senal_antes_de_mover_el_foco_y_espera_con_tope(self):
        r, f, senal = self.enviar()
        self.assertLess(f.log.index(("clear",)), f.log.index(("proc", MOVE_FOCUS, None)))
        self.assertLess(f.log.index(("proc", MOVE_FOCUS, None)), f.log.index(("wait", TOPE_FOCO_S)))
        self.assertEqual(len(senal.timeouts), 1)
        self.assertLessEqual(senal.timeouts[0], 0.5)

    def test_revisar_usa_la_orden_de_revisar(self):
        r, f, _ = self.enviar(comando="revisar", task_id="TASK-12")
        self.assertTrue(r.ok, r.mensaje)
        self.assertEqual(f.log[0], ("proc", CLIP, b"/project-hq:revisar TASK-12"))


class TestNoTeclea(Base):
    """Criterio 2: cualquier fallo antes de la primera tecla no llama a SendInput y dice el motivo."""

    def comprobar(self, r, f, motivo, foco):
        self.assertFalse(r.ok)
        self.assertEqual(r.motivo, motivo, r.mensaje)
        self.assertEqual(f.envios_hechos(), [], "no debe llamar a SendInput")
        self.assertEqual(f.procesos()[0], CLIP, "la orden queda copiada")
        self.assertEqual(MOVE_FOCUS in f.procesos(), foco, "move-focus")
        self.assertIn("copiada", r.mensaje)

    def test_claude_ocupado(self):
        r, f, _ = self.enviar(estado="ocupado")
        self.comprobar(r, f, "ocupado", foco=True)
        self.assertIn("Claude ocupado", r.mensaje)

    def test_claude_ocupado_con_motivo_de_estado_claude(self):
        r, f, _ = self.enviar(estado=("ocupado", "turno en curso"))
        self.comprobar(r, f, "ocupado", foco=True)
        self.assertIn("turno en curso", r.mensaje)

    def test_claude_desconocido(self):
        r, f, _ = self.enviar(estado="desconocido")
        self.comprobar(r, f, "desconocido", foco=True)

    def test_estado_raro_cuenta_como_desconocido(self):
        r, f, _ = self.enviar(estado=None)
        self.comprobar(r, f, "desconocido", foco=True)

    def test_sin_wt_session(self):
        r, f, _ = self.enviar(entorno={"HQ_LAYOUT": "obsidian"})
        self.comprobar(r, f, "sin_wt_session", foco=False)
        self.assertIn("pégalo en la sesión de obsidian", r.mensaje)

    def test_sin_hq_layout(self):
        r, f, _ = self.enviar(entorno={"WT_SESSION": "f00d"})
        self.comprobar(r, f, "sin_layout", foco=False)
        self.assertIn("pégalo en la sesión de obsidian", r.mensaje)

    def test_layout_de_otro_proyecto(self):
        r, f, _ = self.enviar(entorno={"WT_SESSION": "f00d", "HQ_LAYOUT": "otro"})
        self.comprobar(r, f, "otro_proyecto", foco=False)
        self.assertIn("pégalo en la sesión de obsidian", r.mensaje)

    def test_hwnd_distinto_del_de_la_confirmacion(self):
        r, f, _ = self.enviar(Falso(hwnd=1247050))
        self.comprobar(r, f, "hwnd", foco=True)

    def test_hwnd_de_la_confirmacion_vacio(self):
        r, f, _ = self.enviar(Falso(hwnd=0), hwnd0=0)
        self.comprobar(r, f, "hwnd", foco=True)

    def test_clase_que_no_es_de_windows_terminal(self):
        r, f, _ = self.enviar(Falso(clase="Notepad"))
        self.comprobar(r, f, "clase", foco=True)

    def test_clase_ilegible(self):
        r, f, _ = self.enviar(Falso(clase=""))
        self.comprobar(r, f, "clase", foco=True)

    def test_proceso_que_no_es_windows_terminal(self):
        r, f, _ = self.enviar(Falso(exe=r"C:\Windows\System32\notepad.exe"))
        self.comprobar(r, f, "proceso", foco=True)

    def test_proceso_ilegible(self):
        r, f, _ = self.enviar(Falso(exe=None))
        self.comprobar(r, f, "proceso", foco=True)

    def test_proceso_por_nombre_de_fichero_sin_importar_ruta_ni_mayusculas(self):
        r, f, _ = self.enviar(Falso(exe="D:/otra/version/windowsterminal.EXE"))
        self.assertTrue(r.ok, r.mensaje)

    def test_modificador_pulsado(self):
        r, f, _ = self.enviar(Falso(pulsadas={VK_SHIFT}))
        self.comprobar(r, f, "modificador", foco=True)

    def test_tecla_de_confirmacion_pulsada(self):
        r, f, _ = self.enviar(Falso(pulsadas={ord("S")}))
        self.comprobar(r, f, "modificador", foco=True)

    def test_la_espera_de_teclas_tiene_tope(self):
        r, f, _ = self.enviar(Falso(pulsadas={VK_SHIFT}))
        esperas = [e[1] for e in f.log if e[0] == "dormir"]
        self.assertLessEqual(sum(esperas), 2.0)

    def test_sin_senal_de_foco(self):
        r, f, senal = self.enviar(llega=False)
        self.comprobar(r, f, "sin_foco", foco=True)
        self.assertEqual(senal.timeouts, [TOPE_FOCO_S])
        self.assertLessEqual(TOPE_FOCO_S, 0.5)

    def test_sin_senal_de_foco_inyectada(self):
        r, f, _ = self.enviar(senal_foco=None)
        self.comprobar(r, f, "sin_foco", foco=True)

    def test_fuera_de_windows(self):
        f = Falso()
        r, f, _ = self.enviar(f, backend=BackendNulo())
        self.comprobar(r, f, "no_windows", foco=False)

    def test_backend_por_defecto_fuera_de_windows_es_nulo(self):
        b = BACKEND_POR_DEFECTO("linux")
        self.assertFalse(b.disponible)
        self.assertEqual(b.send_input(CTRL_V), 0)

    def test_wt_no_se_puede_lanzar(self):
        r, f, _ = self.enviar(Falso(rc_wt=None))
        self.assertFalse(r.ok)
        self.assertEqual(r.motivo, "wt")
        self.assertEqual(f.envios_hechos(), [])

    def test_estado_se_reevalua_antes_de_la_primera_tecla(self):
        estados = iter(["libre", ("ocupado", "turno en curso")])
        r, f, _ = self.enviar(estado=lambda: next(estados))
        self.comprobar(r, f, "ocupado", foco=True)

    def test_estado_que_falla_cuenta_como_desconocido(self):
        def roto():
            raise OSError("events/ ilegible")
        r, f, _ = self.enviar(estado=roto)
        self.comprobar(r, f, "desconocido", foco=True)

    def test_error_win32_antes_de_teclear(self):
        def roto():
            raise OSError("user32")
        f = Falso()
        f.primer_plano = roto
        r, f, _ = self.enviar(f)
        self.assertFalse(r.ok)
        self.assertEqual(r.motivo, "win32")
        self.assertEqual(f.envios_hechos(), [])


class TestPegadaSinEnviar(Base):
    """Criterio 3: fallo entre Ctrl+V y Enter: no hay Enter y el mensaje es exacto."""

    def comprobar(self, r, f):
        self.assertFalse(r.ok)
        self.assertEqual(r.mensaje, MSG_PEGADA)
        self.assertEqual(MSG_PEGADA, "orden pegada sin enviar: pulsa Enter en Claude")
        self.assertNotIn(ENTER, f.envios_hechos())

    def test_hwnd_cambia_entre_pegar_y_enter(self):
        r, f, _ = self.enviar(Falso(tras_pegar={"hwnd": 1247050}))
        self.comprobar(r, f)
        self.assertEqual(f.envios_hechos(), [CTRL_V])

    def test_clase_cambia_entre_pegar_y_enter(self):
        r, f, _ = self.enviar(Falso(tras_pegar={"clase_": "Notepad"}))
        self.comprobar(r, f)

    def test_proceso_cambia_entre_pegar_y_enter(self):
        r, f, _ = self.enviar(Falso(tras_pegar={"exe": r"C:\Windows\notepad.exe"}))
        self.comprobar(r, f)

    def test_modificador_entre_pegar_y_enter(self):
        r, f, _ = self.enviar(Falso(tras_pegar={"pulsadas": {VK_SHIFT}}))
        self.comprobar(r, f)

    def test_sendinput_pega_menos_eventos(self):
        for n in (1, 3):  # 0 no pegó nada: ver TestFallosWin32.test_sendinput_bloqueado_uipi
            with self.subTest(n=n):
                r, f, _ = self.enviar(Falso(envios=[n]))
                self.comprobar(r, f)
                self.assertEqual(f.envios_hechos(), [CTRL_V])

    def test_sendinput_enter_menos_eventos(self):
        r, f, _ = self.enviar(Falso(envios=[4, 1]))
        self.assertFalse(r.ok)
        self.assertEqual(r.mensaje, MSG_PEGADA)

    def test_explicar_anade_el_motivo_para_la_barra(self):
        r, _, _ = self.enviar(Falso(tras_pegar={"hwnd": 1247050}))
        self.assertEqual(panel.explicar(r),
                         f"{MSG_PEGADA} (tras pegar: La ventana en primer plano no es la del tablero)")
        r, _, _ = self.enviar(Falso(envios=[4, 1]))
        self.assertEqual(panel.explicar(r), f"{MSG_PEGADA} (sendinput Enter 1/2)")
        r, _, _ = self.enviar(Falso(clase="Notepad"))
        self.assertEqual(panel.explicar(r), r.mensaje)  # antes de teclear el mensaje ya lleva la causa
        r, _, _ = self.enviar()
        self.assertEqual(panel.explicar(r), r.mensaje)

    def test_error_win32_tras_pegar(self):
        f = Falso()

        def primer_plano():
            if ("send", CTRL_V) in f.log:
                raise OSError("user32")
            return HWND
        f.primer_plano = primer_plano
        r, f, _ = self.enviar(f)
        self.comprobar(r, f)


class TestOrdenValidada(Base):
    """Criterio 4: lista blanca de comandos, _valida_id y texto copiado sin salto de línea."""

    IDS_MALOS = ["TASK-1\n", "TASK-1 && calc", "TASK-1;calc", "../x", "", None, "TASK-", "1", "TASK-١",
                 "TASK-1\r", " TASK-1", 7, "TASK-1;", "TASK-1\r\n", "TASK-1ñ", "TÁSK-1", "TASK-1​"]
    COMANDOS_MALOS = ["aprobar", "ejecutar ", "EJECUTAR", "", None, "ejecutar;calc", "revisar\n", "revisar\r",
                      "ejecutár", "revisar​"]

    def test_id_no_valido_no_llama_a_nada(self):
        for tid in self.IDS_MALOS:
            with self.subTest(tid=tid):
                r, f, _ = self.enviar(task_id=tid)
                self.assertFalse(r.ok)
                self.assertEqual(r.motivo, "id")
                self.assertEqual(f.log, [])

    def test_comando_fuera_de_lista_blanca_no_llama_a_nada(self):
        for comando in self.COMANDOS_MALOS:
            with self.subTest(comando=comando):
                r, f, _ = self.enviar(comando=comando)
                self.assertFalse(r.ok)
                self.assertEqual(r.motivo, "comando")
                self.assertEqual(f.log, [])

    def test_preparar_orden_rechaza_sin_procesos(self):
        f = Falso()
        for comando, tid in [("aprobar", "TASK-1"), ("ejecutar", "TASK-1 & calc"), ("revisar", None)]:
            with self.subTest(comando=comando, tid=tid):
                self.assertFalse(preparar_orden(comando, tid, f.ejecutar).ok)
        self.assertEqual(f.log, [])

    def test_texto_copiado_sin_salto_de_linea(self):
        f = Falso()
        r = preparar_orden("ejecutar", "TASK-3", f.ejecutar)
        self.assertTrue(r.ok, r.mensaje)
        self.assertEqual(f.log, [("proc", CLIP, b"/project-hq:ejecutar TASK-3")])
        copiado = f.log[0][2]
        self.assertFalse(copiado.endswith((b"\n", b"\r")))
        self.assertEqual(r.orden, "/project-hq:ejecutar TASK-3")

    def test_subtarea(self):
        f = Falso()
        self.assertTrue(preparar_orden("revisar", "TASK-3.1", f.ejecutar).ok)
        self.assertEqual(f.log[0][2], b"/project-hq:revisar TASK-3.1")

    def test_portapapeles_falla_no_teclea_ni_mueve_el_foco(self):
        for rc in (1, None):
            with self.subTest(rc=rc):
                r, f, _ = self.enviar(Falso(rc_clip=rc))
                self.assertFalse(r.ok)
                self.assertEqual(r.motivo, "portapapeles")
                self.assertEqual(f.procesos(), [CLIP])
                self.assertEqual(f.envios_hechos(), [])
                self.assertIn("/project-hq:ejecutar TASK-1", r.mensaje)

    def test_copiar_interno_solo_acepta_ordenes_de_lista_blanca(self):
        f = Falso()
        for texto in ["/project-hq:ejecutar TASK-1\n", "/project-hq:ejecutar TASK-1\r", "/project-hq:ejecutar TASK-1;x",
                      "/project-hq:ejecutar TASK-ñ1", "/project-hq:aprobar TASK-1", "rm -rf /", "", None]:
            with self.subTest(texto=texto):
                self.assertFalse(panel._copiar(texto, f.ejecutar))
        self.assertEqual(f.log, [])


class U32Falso:
    """user32 falso para BackendWin32: se pone ANTES de llamar a ningún método, así nunca se toca el real."""

    def __init__(self, primer_plano=HWND, clase=CLASE_WT, rc_clase=None, rc_send=None):
        self.fg, self.clase_, self.rc_clase, self.rc_send = primer_plano, clase, rc_clase, rc_send
        self.llamadas = []  # una lista de (vk, flags) por cada llamada a SendInput

    def GetForegroundWindow(self):
        return self.fg

    def GetClassNameW(self, hwnd, buf, n):
        buf.value = self.clase_
        return len(self.clase_) if self.rc_clase is None else self.rc_clase

    def GetAsyncKeyState(self, vk):
        return 0

    def SendInput(self, n, arr, size):
        self.llamadas.append([(arr[i].u.ki.wVk, arr[i].u.ki.dwFlags) for i in range(n)])
        return n if self.rc_send is None else self.rc_send


def backend_win32_falso(**kw):
    b = panel.BackendWin32()
    b._u32 = U32Falso(**kw)
    b.proceso = lambda hwnd: EXE if hwnd else ""  # kernel32 aparte: aquí solo interesa user32
    return b


class TestFallosWin32(Base):
    """TASK-20 criterio 1: fallos de la API Win32. No se envía ninguna tecla y el resultado dice el motivo."""

    def sin_teclas(self, r, motivo):
        self.assertFalse(r.ok)
        self.assertEqual(r.motivo, motivo, r.mensaje)
        self.assertIn("copiada", r.mensaje)
        self.assertNotEqual(r.mensaje, MSG_PEGADA)

    def test_primer_plano_0_con_hwnd_de_confirmacion_valido(self):
        r, f, _ = self.enviar(Falso(hwnd=0), hwnd0=HWND)
        self.sin_teclas(r, "hwnd")
        self.assertEqual(f.envios_hechos(), [])
        self.assertIn("no es la del tablero", r.mensaje)

    def test_clase_que_lanza_es_error_win32(self):
        f = Falso()

        def roto(hwnd):
            raise OSError("GetClassNameW")
        f.clase = roto
        r, f, _ = self.enviar(f)
        self.sin_teclas(r, "win32")
        self.assertEqual(f.envios_hechos(), [])

    def test_sendinput_bloqueado_uipi(self):
        """SendInput devuelve 0: no insertó nada (UIPI). No se pegó: el mensaje no puede decir «pegada»."""
        r, f, _ = self.enviar(Falso(envios=[0]))
        self.sin_teclas(r, "uipi")
        self.assertIn("UIPI", r.mensaje)
        self.assertEqual(f.envios_hechos(), [CTRL_V])  # el intento bloqueado; nunca el Enter


@unittest.skipUnless(sys.platform == "win32", "solo Windows")
class TestBackendWin32Falso(Base):
    """BackendWin32 con user32 falso: el código real de los envoltorios, sin tocar el teclado."""

    def enviar_con(self, b):
        f = Falso()
        return self.enviar(f, backend=b)[0], f

    def test_get_foreground_window_0(self):
        for fg in (None, 0):
            with self.subTest(fg=fg):
                b = backend_win32_falso(primer_plano=fg)
                self.assertEqual(b.primer_plano(), 0)
                r, _ = self.enviar_con(b)
                self.assertEqual(r.motivo, "hwnd", r.mensaje)
                self.assertEqual(b._u32.llamadas, [])

    def test_clase_ilegible_aunque_el_buffer_tenga_texto(self):
        b = backend_win32_falso(rc_clase=0)  # GetClassNameW falla (0) pero deja CASCADIA_... en el buffer
        self.assertEqual(b.clase(HWND), "")
        r, _ = self.enviar_con(b)
        self.assertEqual(r.motivo, "clase", r.mensaje)
        self.assertIn("copiada", r.mensaje)
        self.assertEqual(b._u32.llamadas, [])

    def test_sendinput_0_no_manda_el_enter(self):
        b = backend_win32_falso(rc_send=0)
        r, _ = self.enviar_con(b)
        self.assertEqual(r.motivo, "uipi", r.mensaje)
        self.assertEqual(len(b._u32.llamadas), 1)  # solo el Ctrl+V que Windows bloqueó

    def test_camino_feliz_con_el_backend_real(self):
        b = backend_win32_falso()
        r, _ = self.enviar_con(b)
        self.assertTrue(r.ok, r.mensaje)
        self.assertEqual(b._u32.llamadas, [[(0x11, 0), (0x56, 0), (0x56, 2), (0x11, 2)], [(0x0D, 0), (0x0D, 2)]])


@unittest.skipUnless(sys.platform == "win32", "solo Windows")
class TestSoloCtrlVyEnter(unittest.TestCase):
    """TASK-20 criterio 3: aunque se llame directamente a send_input, solo llegan a SendInput Ctrl+V y Enter."""

    def test_texto_o_teclas_fuera_de_lista_blanca_no_llegan(self):
        b = backend_win32_falso()
        textos = ["hola\n", "TASK-1\r", ";", "ñ", "/project-hq:ejecutar TASK-1", "\r\n"]
        teclas = [tuple(v for c in t for v in ((ord(c), False), (ord(c), True))) for t in textos]
        otros = [(), ((0x0D, False),), CTRL_V + ENTER, ENTER + ENTER, ((0xBA, False), (0xBA, True)),
                 ((VK_SHIFT, False),) + ENTER]
        for t in textos + teclas + otros:
            with self.subTest(t=t):
                self.assertEqual(b.send_input(t), 0)
        self.assertEqual(b._u32.llamadas, [])

    def test_ctrl_v_y_enter_si_llegan(self):
        b = backend_win32_falso()
        self.assertEqual(b.send_input(CTRL_V), 4)
        self.assertEqual(b.send_input(list(ENTER)), 2)
        self.assertEqual(len(b._u32.llamadas), 2)


class TestSendInputSoloEnPanel(unittest.TestCase):
    def test_sendinput_solo_aparece_en_panel_py(self):
        raiz = Path(panel.__file__).parent
        con = sorted(p.relative_to(raiz).as_posix() for p in raiz.rglob("*.py")
                     if "SendInput" in p.read_text(encoding="utf8"))
        self.assertEqual(con, ["panel.py"])


class TestEsperasConTope(Base):
    """TASK-20 criterio 2: toda espera de enviar_orden tiene tope y la pausa es la del spike."""

    def test_senal_real_que_no_llega_vuelve_en_el_tope(self):
        t0 = time.monotonic()
        r, f, _ = self.enviar(senal_foco=threading.Event())
        dt = time.monotonic() - t0
        self.assertEqual(r.motivo, "sin_foco")
        self.assertGreaterEqual(dt, TOPE_FOCO_S - 0.05)
        self.assertLess(dt, 0.5 + 0.3)
        self.assertEqual(f.envios_hechos(), [])

    def test_esperas_del_camino_feliz(self):
        r, f, senal = self.enviar()
        self.assertTrue(r.ok, r.mensaje)
        self.assertEqual(senal.timeouts, [TOPE_FOCO_S])
        self.assertLessEqual(TOPE_FOCO_S, 0.5)
        esperas = [e[1] for e in f.log if e[0] == "dormir"]
        self.assertEqual(esperas, [panel.MARGEN_S, PAUSA_S])
        self.assertGreaterEqual(PAUSA_S, 0.150)  # spike TASK-18, 5.2: P = 150 ms

    def test_peor_caso_de_esperas_en_proceso(self):
        r, f, senal = self.enviar(Falso(pulsadas={VK_SHIFT}))
        self.assertEqual(r.motivo, "modificador")
        esperas = [e[1] for e in f.log if e[0] == "dormir"]
        self.assertLessEqual(sum(esperas) + sum(senal.timeouts), 0.5 + panel.MARGEN_S + panel.TOPE_TECLAS_S + 0.01)

    def test_procesos_con_tope(self):
        llamadas = []

        def run(args, **kw):
            llamadas.append(kw)
            return mock.Mock(returncode=0)
        with mock.patch.object(panel, "buscar_exe", lambda n: f"C:/x/{n}.exe"), \
                mock.patch.object(panel.subprocess, "run", run):
            self.assertEqual(EJECUTAR_REAL(["clip"], b"x"), 0)
            self.assertEqual(EJECUTAR_REAL(["wt", "-w", "0", "move-focus", "left"]), 0)
        for kw in llamadas:
            self.assertLessEqual(kw["timeout"], 5)
            self.assertIs(kw["shell"], False)

    def test_proceso_que_no_acaba_cuenta_como_fallo(self):
        def run(args, **kw):
            raise subprocess.TimeoutExpired(args, kw["timeout"])
        with mock.patch.object(panel, "buscar_exe", lambda n: f"C:/x/{n}.exe"), \
                mock.patch.object(panel.subprocess, "run", run):
            self.assertIsNone(EJECUTAR_REAL(["wt", "-w", "0", "move-focus", "left"]))

    def test_panel_no_tiene_esperas_sin_tope(self):
        arbol = ast.parse(Path(panel.__file__).read_text(encoding="utf8"))
        for n in ast.walk(arbol):
            if isinstance(n, ast.While):
                self.fail(f"bucle while en la línea {n.lineno}: usa for con tope")
            if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute):
                if n.func.attr == "wait":
                    self.assertTrue(n.args or n.keywords, f"wait() sin tope en la línea {n.lineno}")
                if n.func.attr == "run":
                    self.assertIn("timeout", [k.arg for k in n.keywords], f"run() sin timeout en la línea {n.lineno}")


@unittest.skipUnless(sys.platform == "win32", "solo Windows")
class TestBackendWin32SoloLectura(unittest.TestCase):
    """Humo del backend real: SOLO lectura del primer plano. Nunca send_input ni move-focus."""

    def test_lee_primer_plano(self):
        b = BACKEND_POR_DEFECTO()
        self.assertTrue(b.disponible)
        hwnd = b.primer_plano()
        self.assertIsInstance(hwnd, int)
        self.assertIsInstance(b.clase(hwnd), str)
        self.assertIsInstance(b.proceso(hwnd), str)
        self.assertIsInstance(b.tecla_pulsada(VK_SHIFT), bool)


if __name__ == "__main__":
    unittest.main()
