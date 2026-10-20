"""Datos del panel «Foco»: tarjeta activa, fases, sesión (contexto y coste), actividad, subagentes y cambios de git."""
from __future__ import annotations

import subprocess
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from . import events, session
from .fases import Fase, FasesError, active, derive, load_fases
from .tasks import Task, read_milestones, read_tasks
from .textos import limpiar

CTX_AVISO = 70  # % de contexto a partir del cual se sugiere /guardar y /clear
ESTADOS = ("Planificado", "En curso", "Verificando", "Hecho")
_EDITA = ("Edit", "Write", "MultiEdit", "NotebookEdit")
_RUIDO = ("prompt",)


@dataclass
class Foco:
    tarjeta: Task | None = None
    fase: str = ""  # «Construcción 1/1»
    espera_aprobacion: bool = False
    siguiente: str = ""
    sesion: session.SesionEstado | None = None
    subagentes: list[str] = field(default_factory=list)
    archivos: list[str] = field(default_factory=list)
    git: list[str] | None = None  # None = no es un repo o git no responde
    slug: str = ""
    rama: str = ""
    fases: list[Fase] | None = None
    conteo: dict[str, int] = field(default_factory=dict)
    bloqueadas: list[tuple[str, list[str]]] = field(default_factory=list)  # (id, dependencias sin hacer)
    pendientes_fase: list[str] = field(default_factory=list)
    actividad: list[tuple[str, str]] = field(default_factory=list)  # (hora, texto), lo último al final
    fallos: list[tuple[str, str]] = field(default_factory=list)
    minutos: int | None = None  # duración de la sesión según sus eventos
    claude_espera: bool = False  # el último evento de la sesión es el fin de turno
    ultima_hora: str = ""  # hora del último evento de la sesión
    parado_min: int | None = None  # minutos desde ese evento


def _git(repo) -> tuple[str, list[str] | None]:
    try:
        r = subprocess.run(["git", "status", "--porcelain", "-b"], cwd=repo, capture_output=True, text=True,
                           encoding="utf8", errors="replace", timeout=5)
    except (OSError, subprocess.SubprocessError):
        return "", None
    if r.returncode != 0:
        return "", None
    rama, lineas = "", []
    for x in r.stdout.splitlines():
        if x.startswith("## "):
            rama = limpiar(x[3:].split("...")[0].replace("No commits yet on ", ""))
        elif x.strip():
            lineas.append(limpiar(x))
    return rama, lineas


def _activos(evs) -> list[str]:
    """Subagentes con `subagent_start` sin su `subagent_stop`."""
    vivos: list[str] = []
    for e in evs:
        if e.kind == "subagent_start":
            vivos.append(e.agent or "?")
        elif e.kind == "subagent_stop" and (e.agent or "?") in vivos:
            vivos.remove(e.agent or "?")
    return vivos


def _archivos(evs) -> list[str]:
    vistos: dict[str, None] = {}
    for e in evs:
        if e.kind == "tool" and e.tool in _EDITA and e.target:
            vistos.pop(e.target, None)
            vistos[e.target] = None
    return list(vistos)


def _siguiente(tareas: list[Task], espera: bool, activa: Task | None) -> str:
    if espera:
        return "Aprobar la fase en el tablero (a)"
    if activa:
        return f"/ejecutar {activa.id}"
    if any(t.status.lower() == "verificando" for t in tareas):
        return "/revisar"
    plan = next((t for t in tareas if t.status.lower() == "planificado"), None)
    return f"/ejecutar {plan.id}" if plan else "/planificar"


def _conteo(tareas: list[Task]) -> dict[str, int]:
    c = {k: 0 for k in ESTADOS}
    for t in tareas:
        k = next((e for e in ESTADOS if e.lower() == t.status.lower()), "Otros")
        c[k] = c.get(k, 0) + 1
    return c


def _bloqueadas(tareas: list[Task]) -> list[tuple[str, list[str]]]:
    hechas = {t.id.lower() for t in tareas if t.status.lower() == "hecho"}
    out = []
    for t in tareas:
        if t.status.lower() == "hecho":
            continue
        faltan = [d for d in t.dependencies if d.lower() not in hechas]
        if faltan:
            out.append((t.id, faltan))
    return out


def _pendientes(fase: Fase | None, tareas: list[Task], milestones) -> list[str]:
    if fase is None:
        return []
    ms = next((m for m in milestones if m.title == fase.milestone), None)
    return [t.id for t in tareas if t.milestone and (t.milestone == fase.milestone or (ms and t.milestone == ms.id))
            and t.status.lower() != "hecho"]


def _minutos(inicio: str, ahora: datetime) -> int | None:
    try:
        t = datetime.fromisoformat(inicio.replace("Z", "+00:00"))
    except ValueError:
        return None
    if t.tzinfo is None:
        t = t.replace(tzinfo=timezone.utc)
    return max(int((ahora - t).total_seconds() // 60), 0)


# ---------------------------------------------------------------- ¿Claude libre en el panel? (solo lectura de eventos)

LIBRE_MARGEN = timedelta(seconds=1.5)  # los hooks de eventos son async y llegan con retraso
VIVA_VENTANA = timedelta(minutes=30)  # otra sesión sin `fin` con eventos aquí dentro: no se sabe cuál es la del panel
CLEAR_HOLGURA = timedelta(seconds=2)  # el `fin` (clear) de la sid vieja puede apuntarse justo después del `inicio` nuevo
_TURNO = ("prompt", "tool", "tool_fail", "subagent_start", "subagent_stop")


def _ruido(e) -> bool:
    """`subagent_stop` sin agente: llega 1-183 s después de muchos `stop` (spike TASK-18) y no es actividad del turno.
    Un evento sin sid tampoco cuenta: hooks/event.mjs siempre escribe una (`sin-id` si falta), así que es una línea
    ajena o rota y no se sabe de qué sesión es."""
    return not e.sid or (e.kind == "subagent_stop" and not e.agent)


def _instante(iso: str) -> datetime | None:
    try:
        t = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        return None
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


def _hace(d: timedelta) -> str:
    s = max(int(d.total_seconds()), 0)
    return f"{s} s" if s < 120 else f"{s // 60} min" if s < 7200 else f"{s // 3600} h"


def _motivo_fin(e) -> str:
    if e.reason == "clear":
        return "/clear en curso: aún no hay sesión nueva"
    return f"Claude cerrado ({e.reason or 'sin motivo'})"


def _motivo_turno(e) -> str:
    if e.kind == "subagent_start":
        return f"subagente {e.agent} en marcha"
    if e.kind == "subagent_stop":
        return f"turno en curso: vuelve el subagente {e.agent}"
    if e.kind in ("tool", "tool_fail"):
        quien = f"subagente {e.agent}" if e.agent else "turno en curso"
        return f"{quien}: {e.tool or 'herramienta'}"
    return "turno en curso: mensaje enviado"


def estado_claude(events_dir, state_dir, slug: str, ahora: datetime | None = None) -> tuple[str, str]:
    """(libre | ocupado | desconocido, motivo) del Claude del panel, a partir de los eventos de hooks/event.mjs.

    Regla conservadora (ARQUITECTURA de obsidian, «Ejecutar y revisar en el panel de Claude», punto 1). La sesión del
    panel se elige por los eventos: la sid del slug con el evento más reciente cuyo último evento no es `fin`. `state_dir`
    no se usa para elegirla (una sid recién creada tras /clear aún no tiene fichero de state). Solo es libre si no hay otra
    sesión viva en los últimos 30 min, su último evento es `stop` o `inicio` con source `clear`, ese evento tiene al
    menos 1,5 s y no hay subagentes abiertos. Los `subagent_stop` sin agente y los eventos sin sid son ruido y no cuentan.
    """
    ahora = ahora or datetime.now(timezone.utc)
    if ahora.tzinfo is None:
        ahora = ahora.replace(tzinfo=timezone.utc)
    evs = events.read_recent(events_dir, slug, limit=5000, hoy=ahora.astimezone().date())
    todos = sorted(((t, e) for e in evs if (t := _instante(e.t)) is not None), key=lambda x: x[0])
    sesiones: dict[str, list] = {}
    for t, e in todos:
        if not _ruido(e):
            sesiones.setdefault(e.sid, []).append((t, e))
    if not sesiones:
        return "desconocido", "sin eventos de Claude en este proyecto"
    fines = [(t, e) for xs in sesiones.values() for t, e in xs if e.kind == "fin"]
    vivas = {sid: xs for sid, xs in sesiones.items() if xs[-1][1].kind != "fin"}
    if not vivas:
        return "ocupado", _motivo_fin(max(fines, key=lambda x: x[0])[1])
    sid = max(vivas, key=lambda s: vivas[s][-1][0])
    panel = vivas[sid]
    t_ult, ult = panel[-1]
    # Un `fin` más nuevo que lo último de esa sid: se cerró Claude (o hay un /clear a medias) y la sid elegida es vieja.
    # Se perdona el `fin` (clear) del /clear que creó la sid elegida, que puede apuntarse unos ms después de su `inicio`.
    t0, primero = panel[0]
    nuevos = [(t, e) for t, e in fines if t > t_ult and not (
        e.reason == "clear" and primero.kind == "inicio" and primero.source == "clear" and abs(t - t0) <= CLEAR_HOLGURA)]
    if nuevos:
        return "ocupado", _motivo_fin(max(nuevos, key=lambda x: x[0])[1])
    for otra, xs in vivas.items():
        if otra != sid and ahora - xs[-1][0] <= VIVA_VENTANA:
            return "desconocido", f"otra sesión viva ({otra or 'sin sid'}), último evento hace {_hace(ahora - xs[-1][0])}"
    if ult.kind == "stop":
        libre = "turno terminado"
    elif ult.kind == "inicio" and ult.source == "clear":
        libre = "sesión nueva tras /clear"
    elif ult.kind == "inicio":
        return "desconocido", f"sesión recién iniciada ({ult.source or 'sin source'})"
    elif ult.kind in _TURNO:
        return "ocupado", _motivo_turno(ult)[:80]
    else:
        return "desconocido", f"último evento «{ult.kind or '?'}»"[:80]
    edad = ahora - t_ult
    if edad < LIBRE_MARGEN:
        return "ocupado", "último evento hace menos de 1,5 s"
    abiertos = _activos([e for _, e in todos if e.sid == sid])
    if abiertos:
        return "ocupado", f"subagente abierto: {', '.join(abiertos)}"[:80]
    return "libre", f"{libre} hace {_hace(edad)}"


def sid_panel(events_dir, slug: str, ahora: datetime | None = None) -> str:
    """sid de la última sesión con un evento que no es `fin`: la del panel cuando estado_claude dice libre. "" si no hay."""
    ahora = ahora or datetime.now(timezone.utc)
    evs = events.read_recent(events_dir, slug, limit=5000, hoy=ahora.astimezone().date())
    vivos = [(t, e) for e in evs if not _ruido(e) and e.kind != "fin" and (t := _instante(e.t)) is not None]
    return max(vivos, key=lambda x: x[0])[1].sid if vivos else ""


def prompt_desde(events_dir, slug: str, sid: str, desde: datetime) -> bool:
    """¿Hay un evento `prompt` de esa sid posterior a `desde`? Poscondición del envío al panel de Claude."""
    evs = events.read_recent(events_dir, slug, limit=5000, hoy=datetime.now(timezone.utc).astimezone().date())
    return any(e.kind == "prompt" and e.sid == sid and (t := _instante(e.t)) is not None and t > desde for e in evs)


def cargar(repo, slug: str, events_dir, state_dir, hoy: date | None = None, con_git: bool = True,
           ahora: datetime | None = None) -> Foco:
    tareas = read_tasks(repo)
    activa = next((t for t in tareas if t.status.lower() == "en curso"), None)
    try:
        milestones = read_milestones(repo)
        fases = derive(load_fases(repo), tareas, milestones)
    except (FasesError, OSError):
        milestones, fases = [], None
    fase = active(fases or [])
    espera = bool(fase and fase.estado == "esperando")
    evs = events.read_recent(events_dir, slug, limit=5000, hoy=hoy)
    ses = session.latest(state_dir, slug) if state_dir else None
    if ses and ses.presupuesto_fecha != (hoy or date.today()).isoformat():
        ses.dia_pct = ses.tarjeta_pct = None
    propios = [e for e in evs if ses and ses.sid and e.sid == ses.sid]
    evs_ses = propios if ses and ses.sid else evs
    utiles = [e for e in evs_ses if e.kind not in _RUIDO]
    ahora = ahora or datetime.now(timezone.utc)
    ultimo = evs_ses[-1] if evs_ses else None
    rama, git = _git(Path(repo)) if con_git else ("", None)
    return Foco(
        tarjeta=activa,
        fase=f"{fase.nombre} {fase.hechas}/{fase.total}" if fase else "",
        espera_aprobacion=espera,
        siguiente=_siguiente(tareas, espera, activa),
        sesion=ses,
        subagentes=_activos(evs_ses),
        archivos=_archivos(evs_ses),
        git=git,
        slug=slug,
        rama=rama,
        fases=fases,
        conteo=_conteo(tareas),
        bloqueadas=_bloqueadas(tareas),
        pendientes_fase=_pendientes(fase, tareas, milestones),
        actividad=[(e.hora, e.texto) for e in utiles[-4:]],
        fallos=[(e.hora, e.texto) for e in evs_ses if e.kind == "tool_fail"][-3:],
        minutos=_minutos(propios[0].t, ahora) if propios else None,
        claude_espera=bool(ultimo and ultimo.kind == "stop"),
        ultima_hora=ultimo.hora if ultimo else "",
        parado_min=_minutos(ultimo.t, ahora) if ultimo else None,
    )
