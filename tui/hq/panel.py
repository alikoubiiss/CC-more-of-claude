"""Envío automático de `/project-hq:<comando> <id>` al panel de Claude (izquierda del tablero en el layout de cc).

Flujo (docs/ARQUITECTURA.md del repo obsidian, «Ejecutar y revisar en el panel de Claude», puntos 2 a 5):
copiar con clip.exe -> comprobar layout y estado de Claude -> `wt -w 0 move-focus left` -> esperar la señal
de foco del tablero (AppBlur) con tope -> comprobar ventana, proceso y teclas -> SendInput Ctrl+V -> pausa ->
recomprobar -> SendInput Enter. Valores medidos en el spike TASK-18 (docs/spike-panel-claude.md, sección 5):
pausa 150 ms, sin espacio final, AppBlur a los 102-133 ms.

Fallo seguro: cualquier fallo antes de la primera tecla deja la orden copiada, el foco en Claude si el layout
es correcto y el motivo en el resultado. Si el pegado ya ocurrió y algo falla antes del Enter no se envía nada
más (`MSG_PEGADA`). Nunca se abren pestañas ni procesos `claude`. El único texto que llega al teclado es la
orden de lista blanca, y llega por el portapapeles: SendInput solo pulsa Ctrl+V y Enter.
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
import time
from dataclasses import dataclass

from .actions import _valida_id, buscar_exe
from .textos import limpiar

COMANDOS = ("ejecutar", "revisar")
CLASE_WT = "CASCADIA_HOSTING_WINDOW_CLASS"
EXE_WT = "windowsterminal.exe"  # por nombre de fichero: la ruta cambia con cada versión de WT

PAUSA_S = 0.150        # entre Ctrl+V y Enter (spike 5.2)
TOPE_FOCO_S = 0.5      # espera máxima de AppBlur tras move-focus (spike 5.3: 102-133 ms)
MARGEN_S = 0.080       # tras la señal de foco
TOPE_TECLAS_S = 1.0    # espera máxima a que se suelten modificadores y tecla de confirmación
SONDEO_S = 0.01
TOPE_PROCESO_S = 5

MSG_PEGADA = "orden pegada sin enviar: pulsa Enter en Claude"
_COPIADA = "orden copiada, pégala con Ctrl+V en Claude"

VK_RETURN, VK_SHIFT, VK_CONTROL, VK_MENU, VK_LWIN, VK_RWIN, VK_V, VK_S = 0x0D, 0x10, 0x11, 0x12, 0x5B, 0x5C, 0x56, 0x53
CTRL_V = ((VK_CONTROL, False), (VK_V, False), (VK_V, True), (VK_CONTROL, True))  # (vk, soltar)
ENTER = ((VK_RETURN, False), (VK_RETURN, True))
# Shift/Ctrl/Alt/Win cambiarían el sentido de Ctrl+V o Enter (Shift+Enter es salto de línea en Claude);
# «s» (Sí) y Enter son las teclas del diálogo Confirmar del tablero.
TECLAS_SUELTAS = (VK_SHIFT, VK_CONTROL, VK_MENU, VK_LWIN, VK_RWIN, VK_S, VK_RETURN)

_ORDEN_RE = re.compile(r"/project-hq:(?:ejecutar|revisar) [A-Za-z]+-[0-9]+(?:\.[0-9]+)?", re.ASCII)


@dataclass(frozen=True)
class Envio:
    """ok: la orden se envió (preparar_orden: se copió). motivo: código estable del fallo (None si ok)."""
    ok: bool
    mensaje: str
    motivo: str | None = None
    orden: str = ""


# ---------------------------------------------------------------- procesos

def _ejecutar_real(args, entrada: bytes | None = None):
    """Código de salida del programa (ruta completa del PATH, sin shell, con tope) o None si no se pudo lanzar."""
    exe = buscar_exe(args[0])
    if not exe:
        return None
    io = {"input": entrada} if entrada is not None else {"stdin": subprocess.DEVNULL}  # nunca la consola del TUI
    try:
        p = subprocess.run([exe, *args[1:]], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                           timeout=TOPE_PROCESO_S, shell=False, **io)
    except (OSError, subprocess.SubprocessError):
        return None
    return p.returncode


def _copiar(texto, ejecutar) -> bool:
    """Copia con clip.exe por stdin, en ASCII y sin salto de línea. Solo acepta órdenes de lista blanca."""
    if not isinstance(texto, str) or not texto.isascii() or not _ORDEN_RE.fullmatch(texto):
        return False
    try:
        return ejecutar(["clip"], texto.encode("ascii")) == 0
    except Exception:
        return False


def _mover_foco(ejecutar) -> bool:
    """`wt -w 0 move-focus left`. El código de salida no confirma nada: la confirmación es la señal de foco."""
    try:
        return ejecutar(["wt", "-w", "0", "move-focus", "left"]) is not None
    except Exception:
        return False


# ---------------------------------------------------------------- backends Win32

class BackendNulo:
    """Fuera de Windows (o si ctypes falla): no hay envío automático, todo degrada a copiar."""
    disponible = False

    def primer_plano(self) -> int:
        return 0

    def clase(self, hwnd) -> str:
        return ""

    def proceso(self, hwnd) -> str:
        return ""

    def tecla_pulsada(self, vk) -> bool:
        return False

    def send_input(self, teclas) -> int:
        return 0


class BackendWin32:
    """user32/kernel32 por ctypes, dentro del proceso del tablero (sin PowerShell). Estructuras del spike TASK-18."""
    disponible = True

    def __init__(self):
        import ctypes
        from ctypes import wintypes as wt

        u32 = ctypes.WinDLL("user32", use_last_error=True)
        k32 = ctypes.WinDLL("kernel32", use_last_error=True)

        class KEYBDINPUT(ctypes.Structure):
            _fields_ = [("wVk", wt.WORD), ("wScan", wt.WORD), ("dwFlags", wt.DWORD), ("time", wt.DWORD),
                        ("dwExtraInfo", ctypes.c_size_t)]

        class MOUSEINPUT(ctypes.Structure):  # el mayor de la unión: fija sizeof(INPUT) en x64
            _fields_ = [("dx", wt.LONG), ("dy", wt.LONG), ("mouseData", wt.DWORD), ("dwFlags", wt.DWORD),
                        ("time", wt.DWORD), ("dwExtraInfo", ctypes.c_size_t)]

        class HARDWAREINPUT(ctypes.Structure):
            _fields_ = [("uMsg", wt.DWORD), ("wParamL", wt.WORD), ("wParamH", wt.WORD)]

        class _U(ctypes.Union):
            _fields_ = [("mi", MOUSEINPUT), ("ki", KEYBDINPUT), ("hi", HARDWAREINPUT)]

        class INPUT(ctypes.Structure):
            _fields_ = [("type", wt.DWORD), ("u", _U)]

        u32.SendInput.argtypes = (wt.UINT, ctypes.POINTER(INPUT), ctypes.c_int)
        u32.SendInput.restype = wt.UINT
        u32.GetForegroundWindow.argtypes = ()
        u32.GetForegroundWindow.restype = wt.HWND
        u32.GetClassNameW.argtypes = (wt.HWND, wt.LPWSTR, ctypes.c_int)
        u32.GetWindowThreadProcessId.argtypes = (wt.HWND, ctypes.POINTER(wt.DWORD))
        u32.GetAsyncKeyState.argtypes = (ctypes.c_int,)
        u32.GetAsyncKeyState.restype = ctypes.c_short
        k32.OpenProcess.argtypes = (wt.DWORD, wt.BOOL, wt.DWORD)
        k32.OpenProcess.restype = wt.HANDLE
        k32.QueryFullProcessImageNameW.argtypes = (wt.HANDLE, wt.DWORD, wt.LPWSTR, ctypes.POINTER(wt.DWORD))
        k32.CloseHandle.argtypes = (wt.HANDLE,)
        self._ct, self._wt, self._u32, self._k32, self._INPUT = ctypes, wt, u32, k32, INPUT

    def primer_plano(self) -> int:
        return int(self._u32.GetForegroundWindow() or 0)

    def clase(self, hwnd) -> str:
        if not hwnd:
            return ""
        buf = self._ct.create_unicode_buffer(256)
        if not self._u32.GetClassNameW(hwnd, buf, 256):  # 0 = no se pudo leer: no vale lo que haya en buf
            return ""
        return buf.value

    def proceso(self, hwnd) -> str:
        if not hwnd:
            return ""
        ct, wt = self._ct, self._wt
        pid = wt.DWORD()
        self._u32.GetWindowThreadProcessId(hwnd, ct.byref(pid))
        h = self._k32.OpenProcess(0x1000, False, pid.value)  # PROCESS_QUERY_LIMITED_INFORMATION
        if not h:
            return ""
        try:
            n = wt.DWORD(1024)
            buf = ct.create_unicode_buffer(1024)
            return buf.value if self._k32.QueryFullProcessImageNameW(h, 0, buf, ct.byref(n)) else ""
        finally:
            self._k32.CloseHandle(h)

    def tecla_pulsada(self, vk) -> bool:
        return bool(self._u32.GetAsyncKeyState(vk) & 0x8000)

    def send_input(self, teclas) -> int:
        """Pulsa las teclas virtuales (vk, soltar). Devuelve cuántos eventos insertó SendInput.

        Lista blanca: solo Ctrl+V y Enter. Cualquier otra secuencia (texto, otras teclas) devuelve 0 sin tocar
        user32, aunque se llame a esta función directamente: el texto solo llega por el portapapeles."""
        teclas = tuple(teclas)
        if teclas not in (CTRL_V, ENTER):
            return 0
        arr = (self._INPUT * len(teclas))()
        for i, (vk, soltar) in enumerate(teclas):
            arr[i].type = 1  # INPUT_KEYBOARD
            arr[i].u.ki.wVk = vk
            arr[i].u.ki.dwFlags = 0x0002 if soltar else 0  # KEYEVENTF_KEYUP
        return int(self._u32.SendInput(len(teclas), arr, self._ct.sizeof(self._INPUT)))


def backend_por_defecto(plataforma: str | None = None):
    if (plataforma or sys.platform) != "win32":
        return BackendNulo()
    try:
        return BackendWin32()
    except Exception:
        return BackendNulo()


# ---------------------------------------------------------------- comprobaciones

def _leer_estado(estado) -> tuple[str, str]:
    """`estado` es "libre"/"ocupado"/"desconocido", la tupla (estado, motivo) de estado_claude o una función que
    devuelve cualquiera de las dos (se vuelve a llamar justo antes de la primera tecla)."""
    try:
        v = estado() if callable(estado) else estado
    except Exception as e:
        return "desconocido", limpiar(f"no se pudo leer el estado: {e}")[:80]
    if isinstance(v, tuple):
        e, m = (tuple(v) + ("", ""))[:2]
    else:
        e, m = v, ""
    e = e if e in ("libre", "ocupado") else "desconocido"
    return e, limpiar(str(m or ""))[:80]


def _nombre_exe(ruta) -> str:
    return re.split(r"[\\/]", ruta or "")[-1].lower()


def _fallo_ventana(backend, hwnd0) -> str | None:
    """None si el primer plano es la ventana de WT del tablero; si no, el motivo."""
    hwnd = backend.primer_plano()
    if not hwnd0 or not hwnd or hwnd != hwnd0:
        return "hwnd"
    if backend.clase(hwnd) != CLASE_WT:
        return "clase"
    if _nombre_exe(backend.proceso(hwnd)) != EXE_WT:
        return "proceso"
    return None


def _hay_tecla_pulsada(backend) -> bool:
    return any(backend.tecla_pulsada(vk) for vk in TECLAS_SUELTAS)


def _esperar_teclas_sueltas(backend, dormir) -> bool:
    for _ in range(round(TOPE_TECLAS_S / SONDEO_S)):
        if not _hay_tecla_pulsada(backend):
            return True
        dormir(SONDEO_S)
    return not _hay_tecla_pulsada(backend)


_CAUSAS = {
    "wt": "No se pudo mover el foco (wt)",
    "sin_foco": f"No llegó la señal de foco en {int(TOPE_FOCO_S * 1000)} ms",
    "modificador": "Hay una tecla pulsada (Shift, Ctrl, Alt, Win o la de confirmar)",
    "hwnd": "La ventana en primer plano no es la del tablero",
    "clase": "La ventana en primer plano no es de Windows Terminal",
    "proceso": "El proceso en primer plano no es Windows Terminal",
    "win32": "Error de Win32",
    "uipi": "Windows bloqueó las teclas (UIPI: ¿Claude o la terminal como administrador?)",
}


# ---------------------------------------------------------------- API

def texto_orden(comando, task_id) -> str:
    """El texto que llega a Claude. El tablero lo enseña en la confirmación con esta misma función."""
    return f"/project-hq:{comando} {task_id}"


def explicar(r: Envio) -> str:
    """Texto para la barra del tablero: el mensaje y, si la orden quedó pegada sin enviar, por qué."""
    if r.ok or r.mensaje != MSG_PEGADA or not r.motivo:
        return r.mensaje
    m = r.motivo
    if m.startswith("tras pegar: ") and m[12:] in _CAUSAS:
        m = "tras pegar: " + _CAUSAS[m[12:]]
    return f"{MSG_PEGADA} ({m})"


def preparar_orden(comando, task_id, ejecutar=None) -> Envio:
    """Valida comando (lista blanca) e id (`_valida_id`) y copia `/project-hq:<comando> <id>` con clip.exe."""
    if not isinstance(comando, str) or comando not in COMANDOS:
        return Envio(False, f"Comando no permitido: {limpiar(str(comando))[:40]}", "comando")
    if not _valida_id(task_id) or not task_id.isascii():
        return Envio(False, f"Id de tarjeta no válido: {limpiar(str(task_id))[:40]}", "id")
    orden = texto_orden(comando, task_id)
    if not _copiar(orden, ejecutar or _ejecutar_real):
        return Envio(False, f"No se pudo copiar la orden: escríbela en Claude: {orden}", "portapapeles", orden)
    return Envio(True, f"Copiado: {orden}", None, orden)


def enviar_orden(comando, task_id, *, slug, estado, hwnd0, senal_foco, backend=None, ejecutar=None,
                 entorno=None, dormir=None) -> Envio:
    """Copia la orden y, si todo cuadra, la pega y la envía en el panel de Claude con SendInput.

    slug: proyecto de la tarjeta (debe ser el `HQ_LAYOUT` del tablero). estado: ver `_leer_estado`.
    hwnd0: `backend.primer_plano()` tomado al confirmar. senal_foco: objeto tipo `threading.Event` que el
    tablero activa con `AppBlur`. backend/ejecutar/entorno/dormir: inyectables (tests).
    """
    ejecutar = ejecutar or _ejecutar_real
    dormir = dormir or time.sleep
    entorno = os.environ if entorno is None else entorno

    copia = preparar_orden(comando, task_id, ejecutar)
    if not copia.ok:
        return copia
    orden = copia.orden

    def manual(motivo, causa=None):
        return Envio(False, f"{causa or _CAUSAS[motivo]}: {_COPIADA}", motivo, orden)

    def solo_copia(motivo, causa):
        # Primero lo que hay que hacer: en un panel estrecho la barra corta el final.
        return Envio(False, f"Orden copiada, pégalo en la sesión de {slug} ({causa})", motivo, orden)

    def no_libre(e, m):
        causa = "Claude ocupado" if e == "ocupado" else "Estado de Claude desconocido"
        return manual("ocupado" if e == "ocupado" else "desconocido", f"{causa} ({m})" if m else causa)

    backend = backend or backend_por_defecto()
    if not getattr(backend, "disponible", False):
        return solo_copia("no_windows", "Envío automático solo en Windows")
    if not entorno.get("WT_SESSION"):
        return solo_copia("sin_wt_session", "Tablero fuera de Windows Terminal")
    layout = (entorno.get("HQ_LAYOUT") or "").strip()
    if not layout:
        return solo_copia("sin_layout", "Tablero fuera del layout de cc")
    if layout != slug:
        return solo_copia("otro_proyecto", f"El layout es de {limpiar(layout)[:40]}")

    e, m = _leer_estado(estado)
    if e != "libre":
        _mover_foco(ejecutar)
        return no_libre(e, m)

    if senal_foco is not None and hasattr(senal_foco, "clear"):
        senal_foco.clear()  # solo vale un AppBlur posterior al move-focus
    if not _mover_foco(ejecutar):
        return manual("wt")
    if senal_foco is None or not senal_foco.wait(TOPE_FOCO_S):
        return manual("sin_foco")
    dormir(MARGEN_S)

    pegando = False
    try:
        if not _esperar_teclas_sueltas(backend, dormir):
            return manual("modificador")
        e, m = _leer_estado(estado)
        if e != "libre":
            return no_libre(e, m)
        fallo = _fallo_ventana(backend, hwnd0)
        if fallo:
            return manual(fallo)

        pegando = True  # desde aquí la orden pudo llegar al prompt de Claude: nada de teclas extra
        n = backend.send_input(CTRL_V)
        if n == 0:  # no insertó ningún evento: no se pegó nada, la orden sigue solo en el portapapeles
            return manual("uipi")
        if n != len(CTRL_V):
            return Envio(False, MSG_PEGADA, f"sendinput Ctrl+V {n}/{len(CTRL_V)}", orden)
        dormir(PAUSA_S)
        fallo = _fallo_ventana(backend, hwnd0) or ("modificador" if _hay_tecla_pulsada(backend) else None)
        if fallo:
            return Envio(False, MSG_PEGADA, f"tras pegar: {fallo}", orden)
        n = backend.send_input(ENTER)
        if n != len(ENTER):
            return Envio(False, MSG_PEGADA, f"sendinput Enter {n}/{len(ENTER)}", orden)
    except Exception as ex:
        if pegando:
            return Envio(False, MSG_PEGADA, limpiar(f"win32 tras pegar: {ex}")[:120], orden)
        return manual("win32", limpiar(f"Error de Win32: {ex}")[:120])
    return Envio(True, f"Enviado a Claude: {orden}", None, orden)
