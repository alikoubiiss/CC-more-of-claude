"""Lector de eventos de actividad (los escribe hooks/event.mjs en <dataDir>/events/<slug>/AAAA-MM-DD.jsonl)."""
from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path

from .textos import limpiar

_FRASES = {
    "Read": "Lee", "Edit": "Edita", "Write": "Edita", "MultiEdit": "Edita", "NotebookEdit": "Edita",
    "Bash": "Ejecuta", "PowerShell": "Ejecuta", "Grep": "Busca", "Glob": "Busca",
    "WebFetch": "Consulta la web", "WebSearch": "Consulta la web", "Agent": "Lanza subagente", "Task": "Lanza subagente",
}


@dataclass
class Evento:
    t: str
    hora: str
    kind: str
    tool: str
    target: str
    agent: str
    model: str
    texto: str
    sid: str = ""
    source: str = ""  # solo en `inicio` (SessionStart): startup | resume | clear | compact
    reason: str = ""  # solo en `fin` (SessionEnd): clear, prompt_input_exit, other...


def _hora(iso: str) -> str:
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone().strftime("%H:%M:%S")
    except ValueError:
        return "--:--:--"


def _texto(kind: str, tool: str, target: str, agent: str, model: str) -> str:
    if kind == "tool":
        return f"{_FRASES.get(tool) or 'Usa ' + tool} {target}".strip()
    if kind == "tool_fail":
        return f"Falla {tool} {target}".strip()
    if kind == "subagent_start":
        return f"Subagente {agent} empieza".replace("  ", " ")
    if kind == "subagent_stop":
        return f"Subagente {agent} termina".replace("  ", " ")
    if kind == "model":
        return f"Cambia a {model.capitalize()}" if model else "Cambia de modelo"
    if kind == "prompt":
        return "Mensaje del usuario"
    if kind == "stop":
        return "Termina el turno"
    if kind == "inicio":
        return "Empieza la sesión"
    if kind == "fin":
        return "Termina la sesión"
    return kind


def read_recent(events_dir, slug: str, limit: int = 200, hoy: date | None = None) -> list[Evento]:
    hoy = hoy or date.today()
    out: list[Evento] = []
    for dia in (hoy - timedelta(days=1), hoy):
        f = Path(events_dir) / slug / f"{dia.isoformat()}.jsonl"
        try:
            # errors="replace": un append cortado a mitad de un carácter no tumba el fichero entero, solo su línea.
            lines = f.read_text(encoding="utf8", errors="replace").splitlines()
        except OSError:
            continue
        for ln in lines:
            try:
                d = json.loads(ln)
                t = str(d["t"])
            except (ValueError, KeyError, TypeError, RecursionError):
                continue
            if not isinstance(d, dict):
                continue
            g = lambda k: limpiar(d.get(k) or "")  # noqa: E731
            kind, tool, target, agent, model = g("kind"), g("tool"), g("target"), g("agent"), g("model")
            out.append(Evento(t, _hora(t), kind, tool, target, agent, model, _texto(kind, tool, target, agent, model), g("sid"),
                              g("source"), g("reason")))
    out.sort(key=lambda e: e.t)
    return out[-limit:]
