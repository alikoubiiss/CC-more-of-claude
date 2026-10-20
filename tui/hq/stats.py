"""Lectura y resumen del gasto real (el historial lo escribe lib/metrics.mjs en <dataDir>/metrics/<slug>/AAAA-MM-DD.jsonl).

Solo se suma `delta` de las líneas `snap`: así una sesión que cruza la medianoche no cuenta dos veces.
"""
from __future__ import annotations

import json
import re
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path

from .textos import limpiar

_SLUG = re.compile(r"^[a-z0-9-]+$")
_CARD = re.compile(r"^[A-Za-z]+-\d+(\.\d+)?$")
_MODEL = re.compile(r"^[a-z0-9-]{1,20}$")
_DIA = re.compile(r"^(\d{4}-\d{2}-\d{2})\.jsonl$")


@dataclass(frozen=True)
class Estado:
    pct: int | None
    estado: str  # ok | aviso | pasado | sin


def estado(usado: float, limite) -> Estado:
    """Mismos umbrales que lib/metrics.mjs: aviso ≥ 80 %, pasado ≥ 100 %."""
    if not isinstance(limite, (int, float)) or isinstance(limite, bool) or limite <= 0:
        return Estado(None, "sin")
    pct = int(usado / limite * 100 + 0.5)
    return Estado(pct, "pasado" if pct >= 100 else "aviso" if pct >= 80 else "ok")


def _num(v) -> float:
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and v == v else 0.0


def leer(metrics_dir, slug: str | None = None, desde: date | None = None, hasta: date | None = None) -> list[dict]:
    """Líneas válidas de uno o todos los proyectos; las corruptas se ignoran y los textos se limpian."""
    base = Path(metrics_dir)
    try:
        slugs = [slug] if slug else sorted(p.name for p in base.iterdir() if p.is_dir())
    except OSError:
        return []
    out: list[dict] = []
    for s in slugs:
        if not _SLUG.match(s):
            continue
        try:
            ficheros = sorted((base / s).iterdir())
        except OSError:
            continue
        for f in ficheros:
            m = _DIA.match(f.name)
            if not m:
                continue
            try:
                dia = date.fromisoformat(m.group(1))
            except ValueError:
                continue
            if (desde and dia < desde) or (hasta and dia > hasta):
                continue  # fuera del rango: ni se abre el fichero
            try:
                texto = f.read_text(encoding="utf8", errors="replace")
            except OSError:
                continue
            for ln in texto.splitlines():
                try:
                    d = json.loads(ln)
                except ValueError:
                    continue
                if not isinstance(d, dict):
                    continue
                d["slug"], d["dia"] = s, dia
                if d.get("kind") == "snap":
                    d["delta"] = _num(d.get("delta"))
                    card = limpiar(d.get("card") or "")
                    model = limpiar(d.get("model") or "")
                    d["card"] = card if _CARD.match(card) else None
                    d["model"] = model if _MODEL.match(model) else None
                out.append(d)
    return out


@dataclass
class Resumen:
    hoy_usd: float = 0.0
    semana_usd: float = 0.0
    mes_usd: float = 0.0
    por_proyecto: list[tuple[str, float]] = field(default_factory=list)
    por_tarjeta: list[tuple[str, str | None, float]] = field(default_factory=list)
    por_modelo: list[tuple[str, float]] = field(default_factory=list)
    tendencia: list[tuple[date, float]] = field(default_factory=list)
    gasto_por_dia: dict = field(default_factory=dict)
    dia: Estado = Estado(None, "sin")
    memoria: dict = field(default_factory=dict)
    n_datos: int = 0


def resumen(lineas: list[dict], hoy: date, presupuesto) -> Resumen:
    por_dia: dict[date, float] = defaultdict(float)
    por_proy: dict[str, float] = defaultdict(float)
    por_card: dict[tuple[str, str | None], float] = defaultdict(float)
    por_mod: dict[str, float] = defaultdict(float)
    mem = {"nlm": 0, "vault": 0, "conocimiento": 0}
    mem_dias: set[date] = set()
    inicios: list[float] = []
    n = 0
    for l in lineas:
        k = l.get("kind")
        if k == "snap":
            n += 1
            por_dia[l["dia"]] += l["delta"]
            por_proy[l["slug"]] += l["delta"]
            por_card[(l["slug"], l["card"])] += l["delta"]
            por_mod[l["model"] or "desconocido"] += l["delta"]
        elif k == "mem" and l.get("mem") in mem:
            mem[l["mem"]] += 1
            mem_dias.add(l["dia"])
        elif k == "inicio" and isinstance(l.get("chars"), (int, float)):
            inicios.append(float(l["chars"]))
    semana = [hoy - timedelta(days=i) for i in range(7)]
    tendencia = [(hoy - timedelta(days=13 - i), por_dia.get(hoy - timedelta(days=13 - i), 0.0)) for i in range(14)]
    limite = presupuesto.get("diaUsd") if isinstance(presupuesto, dict) else None
    return Resumen(
        hoy_usd=por_dia.get(hoy, 0.0),
        semana_usd=sum(por_dia.get(d, 0.0) for d in semana),
        mes_usd=sum(v for d, v in por_dia.items() if (d.year, d.month) == (hoy.year, hoy.month)),
        por_proyecto=sorted(((s, round(v, 6)) for s, v in por_proy.items()), key=lambda x: (-x[1], x[0])),
        por_tarjeta=sorted(((s, c, round(v, 6)) for (s, c), v in por_card.items()), key=lambda x: (-x[2], x[0], x[1] or "")),
        por_modelo=sorted(((m, round(v, 6)) for m, v in por_mod.items()), key=lambda x: (-x[1], x[0])),
        tendencia=tendencia, gasto_por_dia=dict(por_dia), dia=estado(por_dia.get(hoy, 0.0), limite),
        memoria={**mem, "dias": sorted(mem_dias), "inicio_medio_chars": (sum(inicios) / len(inicios)) if inicios else None}, n_datos=n,
    )
