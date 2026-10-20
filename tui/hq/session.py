"""Estado de la sesión de Claude Code (lo escribe scripts/statusline.mjs en <dataDir>/state/<sid8>.json)."""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from .textos import limpiar


@dataclass
class SesionEstado:
    sid: str = ""
    model: str = ""
    model_name: str = ""
    cost: float | None = None
    ctx_pct: float | None = None
    tokens_in: int | None = None
    tokens_out: int | None = None
    t: str = ""
    presupuesto_fecha: str = ""
    dia_pct: float | None = None
    tarjeta_id: str = ""
    tarjeta_pct: float | None = None


def _num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def latest(state_dir, slug: str) -> SesionEstado | None:
    try:
        files = sorted(Path(state_dir).glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
    except OSError:
        return None
    for f in files:
        try:
            d = json.loads(f.read_text(encoding="utf8"))
        except (OSError, ValueError):
            continue
        if isinstance(d, dict) and d.get("slug") == slug:
            p = d.get("presupuesto") if isinstance(d.get("presupuesto"), dict) else {}
            dia = p.get("dia") if isinstance(p.get("dia"), dict) else {}
            tar = p.get("tarjeta") if isinstance(p.get("tarjeta"), dict) else {}
            return SesionEstado(limpiar(d.get("sid")), limpiar(d.get("model")), limpiar(d.get("model_name")),
                                _num(d.get("cost")), _num(d.get("ctx_pct")), _num(d.get("tokens_in")), _num(d.get("tokens_out")),
                                limpiar(d.get("t") or ""), limpiar(p.get("fecha") or ""), _num(dia.get("pct")),
                                limpiar(tar.get("id") or ""), _num(tar.get("pct")))
    return None
