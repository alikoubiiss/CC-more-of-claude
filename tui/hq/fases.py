"""Fases del proyecto (puerto de lib/fases.mjs). Esquema de .hq/fases.json idéntico al de Node."""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, replace
from pathlib import Path

from .tasks import Milestone, Task, read_milestones, read_tasks
from .textos import limpiar


class FasesError(Exception):
    pass


@dataclass(frozen=True)
class Fase:
    id: str
    nombre: str
    milestone: str
    aprobada: str | None
    estado: str = "pendiente"
    total: int = 0
    hechas: int = 0


def fases_file(repo) -> Path:
    return Path(repo) / ".hq" / "fases.json"


def load_fases(repo) -> list[dict]:
    f = fases_file(repo)
    if not f.exists():
        return []
    try:
        data = json.loads(f.read_text(encoding="utf8"))
        if not isinstance(data.get("fases"), list):
            raise ValueError('falta "fases"')
        for x in data["fases"]:
            if not (isinstance(x, dict) and isinstance(x.get("id"), str) and isinstance(x.get("nombre"), str)):
                raise ValueError("cada fase necesita id y nombre en texto")
        return data["fases"]
    except (OSError, ValueError, AttributeError) as e:
        raise FasesError(f"fases: {f} está dañado ({e})") from e


def _save(repo, fases: list[dict]) -> None:
    f = fases_file(repo)
    f.parent.mkdir(parents=True, exist_ok=True)
    tmp = f.with_name(f.name + ".tmp")
    tmp.write_text(json.dumps({"fases": fases}, indent=2, ensure_ascii=False) + "\n", encoding="utf8")
    os.replace(tmp, f)


def derive(fases: list[dict], tasks: list[Task], milestones: list[Milestone]) -> list[Fase]:
    hay_candidata = False
    out = []
    for f in fases:
        ms = next((m for m in milestones if m.title == f.get("milestone")), None)
        propias = [t for t in tasks if t.milestone and (t.milestone == f.get("milestone") or (ms and t.milestone == ms.id))]
        total = len(propias)
        hechas = sum(1 for t in propias if t.status.lower() == "hecho")
        if f.get("aprobada"):
            estado = "aprobada"
        elif hay_candidata:
            estado = "pendiente"
        else:
            hay_candidata = True
            estado = "esperando" if total > 0 and hechas == total else "activa"
        out.append(Fase(limpiar(f["id"]), limpiar(f["nombre"]), f.get("milestone", f["nombre"]), f.get("aprobada"), estado, total, hechas))
    return out


def active(derived: list[Fase]) -> Fase | None:
    return next((f for f in derived if f.estado in ("activa", "esperando")), None)


def project_phases(repo) -> list[Fase]:
    return derive(load_fases(repo), read_tasks(repo), read_milestones(repo))


def approve(repo, fase_id: str, fecha: str, force: bool = False) -> Fase:
    raw = load_fases(repo)
    f = next((x for x in derive(raw, read_tasks(repo), read_milestones(repo)) if x.id == fase_id), None)
    if f is None:
        raise FasesError(f'fases: no existe la fase "{fase_id}"')
    if f.estado == "aprobada":
        raise FasesError(f'fases: la fase "{f.nombre}" ya está aprobada')
    if f.estado != "esperando" and not force:
        raise FasesError(f'fases: la fase "{f.nombre}" no está lista ({f.hechas}/{f.total} tarjetas hechas)')
    next(x for x in raw if x["id"] == fase_id)["aprobada"] = fecha
    _save(repo, raw)
    return replace(f, estado="aprobada", aprobada=fecha)
