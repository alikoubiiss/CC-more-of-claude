"""Único sitio que escribe: acciones del usuario con la puerta humana.

En Windows `backlog` es un `.cmd` y se ejecuta vía cmd.exe aunque shell=False, por eso todo texto libre
pasa por `sanear_texto`. Nada aquí se llama sin que una pantalla haya pedido confirmación antes.
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

from . import fases as fases_mod
from .textos import limpiar

ESTADOS = ("Ideas", "Planificado", "En curso", "Verificando")
_HECHO = {"hecho", "done"}
_ID_RE = re.compile(r"[A-Za-z]+-\d+(\.\d+)?")
_NOMBRE_RE = re.compile(r"[^\r\n\"'`$%&|<>^\\]{1,40}")
_PROHIBIDOS = re.compile("[&|<>^%\"'`$]")


@dataclass(frozen=True)
class Resultado:
    ok: bool
    mensaje: str


def sanear_texto(s, max: int = 200) -> str:
    s = _PROHIBIDOS.sub("", limpiar(s or ""))
    return re.sub(r"\s+", " ", s).strip()[:max].strip()


def buscar_exe(nombre: str):
    """Ruta de un ejecutable en el PATH, sin mirar nunca el directorio actual (un repo hostil podría traer un backlog.cmd)."""
    os.environ["NoDefaultCurrentDirectoryInExePath"] = "1"
    cwd = os.path.normcase(os.path.abspath(os.getcwd()))
    entradas = [e for e in os.environ.get("PATH", "").split(os.pathsep)
                if e and os.path.normcase(os.path.abspath(e)) != cwd]
    return shutil.which(nombre, path=os.pathsep.join(entradas))


def buscar_backlog():
    return buscar_exe("backlog")


def _real_run(args, cwd):
    exe = buscar_backlog()
    if not exe:
        return 127, "", "backlog no está instalado"
    p = subprocess.run([exe, *args], cwd=cwd, capture_output=True, text=True, timeout=30, shell=False)
    return p.returncode, p.stdout, p.stderr


class Backlog:
    def __init__(self, runner=None):
        self.runner = runner or _real_run

    def run(self, args: list[str], cwd) -> Resultado:
        d = Path(cwd)
        if not d.is_dir():
            return Resultado(False, f"El proyecto no existe: {limpiar(str(cwd))}")
        try:
            status, out, err = self.runner(list(args), str(d))
        except Exception as e:  # nunca lanza hacia la pantalla
            return Resultado(False, limpiar(f"No se pudo ejecutar backlog: {e}")[:300])
        if status != 0:
            return Resultado(False, limpiar(err or out or f"backlog terminó con código {status}")[:300])
        return Resultado(True, "ok")


def _valida_id(task_id) -> bool:
    return isinstance(task_id, str) and _ID_RE.fullmatch(task_id) is not None


def _err_id(task_id) -> Resultado:
    return Resultado(False, f"Id de tarjeta no válido: {limpiar(str(task_id))[:40]}")


def mover(repo, task_id, estado, b: Backlog | None = None) -> Resultado:
    if not _valida_id(task_id):
        return _err_id(task_id)
    e = (estado or "").strip()
    if e.casefold() in _HECHO:
        return Resultado(False, "Para pasar a Hecho hay que aprobar la tarjeta (a)")
    canon = next((x for x in ESTADOS if x.casefold() == e.casefold()), None)
    if canon is None:
        return Resultado(False, f"Estado desconocido: {limpiar(e)[:40]}")
    r = (b or Backlog()).run(["task", "edit", task_id, "-s", canon], repo)
    return Resultado(True, f"{task_id} movida a {canon}") if r.ok else r


def aprobar_tarjeta(repo, task_id, b: Backlog | None = None) -> Resultado:
    if not _valida_id(task_id):
        return _err_id(task_id)
    r = (b or Backlog()).run(["task", "edit", task_id, "-s", "Hecho", "--remove-label", "revisada"], repo)
    return Resultado(True, f"{task_id} aprobada: pasa a Hecho") if r.ok else r


def mejorar_tarjeta(repo, task_id, motivo, b: Backlog | None = None) -> Resultado:
    if not _valida_id(task_id):
        return _err_id(task_id)
    m = sanear_texto(motivo)
    if not m:
        return Resultado(False, "Escribe qué falta")
    r = (b or Backlog()).run(["task", "edit", task_id, "-s", "En curso", "--remove-label", "revisada",
                              "--comment", f"Falta: {m}", "--comment-author", "@usuario"], repo)
    return Resultado(True, f"{task_id} vuelve a En curso con tu comentario") if r.ok else r


MODELOS = ("haiku", "sonnet", "opus")
ESFUERZOS = ("medium", "high", "xhigh")
_ETIQUETA_MODELO = re.compile(r"^(modelo|esfuerzo)\s*:", re.IGNORECASE)


def iniciar(repo, task_id, b: Backlog | None = None) -> Resultado:
    """Planificado -> En curso sin lanzar Claude: no gasta tokens."""
    if not _valida_id(task_id):
        return _err_id(task_id)
    r = (b or Backlog()).run(["task", "edit", task_id, "-s", "En curso"], repo)
    return Resultado(True, f"{task_id} en curso") if r.ok else r


def editar(repo, task_id, etiquetas_actuales, titulo, descripcion, criterios, modelo, esfuerzo,
           b: Backlog | None = None) -> Resultado:
    """Reescribe título, descripción, criterios y las etiquetas modelo:/esfuerzo: de una tarjeta.
    Las demás etiquetas se conservan. Los criterios se reemplazan por completo."""
    if not _valida_id(task_id):
        return _err_id(task_id)
    t = sanear_texto(titulo)
    if not t:
        return Resultado(False, "El título no puede estar vacío")
    m, e = (modelo or "").strip().lower(), (esfuerzo or "").strip().lower()
    if m and m not in MODELOS:
        return Resultado(False, f"Modelo no válido: {sanear_texto(m, 20)} (haiku, sonnet u opus)")
    if e and e not in ESFUERZOS:
        return Resultado(False, f"Esfuerzo no válido: {sanear_texto(e, 20)} (medium, high o xhigh)")
    etiquetas = [x for x in etiquetas_actuales if not _ETIQUETA_MODELO.match(x) and "," not in x]
    if m:
        etiquetas.append(f"modelo:{m}")
    if e:
        etiquetas.append(f"esfuerzo:{e}")
    args = ["task", "edit", task_id, "-t", t, "-d", sanear_texto(descripcion, 600)]
    for c in (sanear_texto(c) for c in criterios):
        if c:
            args += ["--acceptance-criteria", c]
    if "--acceptance-criteria" not in args:
        args.append("--clear-ac")
    args += ["-l", ",".join(etiquetas)] if etiquetas else ["--clear-labels"]
    r = (b or Backlog()).run(args, repo)
    return Resultado(True, f"{task_id} actualizada") if r.ok else r


# e/v (ejecutar y revisar) ya no abren pestañas: envían la orden al panel de Claude (tui/hq/panel.py).


def aprobar_fase(repo, fase_id, fecha, b=None) -> Resultado:
    if not Path(repo).is_dir():
        return Resultado(False, f"El proyecto no existe: {limpiar(str(repo))}")
    try:
        f = fases_mod.approve(repo, fase_id, fecha)
    except Exception as e:
        return Resultado(False, limpiar(str(e))[:300])
    return Resultado(True, f"Fase «{f.nombre}» aprobada")


def mejorar_fase(repo, fase, motivo, b: Backlog | None = None) -> Resultado:
    hito = fase.milestone
    if not isinstance(hito, str) or not _NOMBRE_RE.fullmatch(hito.strip()):
        return Resultado(False, "Nombre de fase no válido")
    m = sanear_texto(motivo)
    if not m:
        return Resultado(False, "Escribe qué falta")
    r = (b or Backlog()).run(["task", "create", f"Mejorar: {m}", "-m", hito.strip(), "-s", "Planificado"], repo)
    return Resultado(True, f"Creada la tarjeta «Mejorar: {m}» en la fase") if r.ok else r
