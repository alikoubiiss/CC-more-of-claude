"""Gamificación ligera: XP, nivel, racha y logros, calculados al leer (sin base de datos propia).

Solo da XP por cosas que verifica el usuario (tarjeta «Hecho», fase aprobada) y por gasto real dentro de presupuesto;
nunca por eventos que Claude pueda generar solo.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta

NIVELES = [0, 20, 50, 100, 180, 300, 480, 720, 1050, 1500]
XP_TARJETA, XP_BAJO_PRESUPUESTO_TARJETA, XP_FASE, XP_DIA = 10, 5, 50, 5

NOMBRES = {
    "primera-tarjeta": "Primera tarjeta aprobada",
    "primera-fase": "Primera fase aprobada",
    "racha-3": "Racha de 3 días",
    "racha-7": "Racha de 7 días",
    "bajo-presupuesto-5": "5 tarjetas dentro de presupuesto",
    "semana-sin-pasarte": "Una semana sin pasarte del presupuesto",
    "primera-consulta-nlm": "Primera consulta a NotebookLM",
    "conocimiento-10": "10 lecturas de Conocimiento",
    "memoria-activa": "Memoria en uso 7 días seguidos",
    "decisiones-10": "10 decisiones registradas",
}


def nivel_de(xp: int) -> int:
    return max(i + 1 for i, umbral in enumerate(NIVELES) if umbral <= xp)


@dataclass
class Estado:
    xp: int = 0
    nivel: int = 1
    xp_siguiente: int | None = NIVELES[1]
    racha: int = 0
    logros: list[tuple[str, str, bool]] = field(default_factory=list)


def _fecha(v) -> date | None:
    if isinstance(v, date):
        return v
    try:
        return date.fromisoformat(str(v)[:10])
    except ValueError:
        return None


def _max_racha(dias: set[date]) -> int:
    mejor = 0
    for d in dias:
        if d - timedelta(days=1) in dias:
            continue  # solo se cuenta desde el inicio de cada tramo
        n = 1
        while d + timedelta(days=n) in dias:
            n += 1
        mejor = max(mejor, n)
    return mejor


def _racha_actual(dias: set[date], hoy: date) -> int:
    d = hoy if hoy in dias else hoy - timedelta(days=1)
    n = 0
    while d in dias:
        n += 1
        d -= timedelta(days=1)
    return n


def _limite(presupuesto, clave):
    v = presupuesto.get(clave) if isinstance(presupuesto, dict) else None
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) and v > 0 else None


def calcular(hechas, fases, gasto_por_dia, gasto_por_tarjeta, memoria, decisiones, hoy: date, presupuesto) -> Estado:
    """`hechas`: [(fecha AAAA-MM-DD o '', clave de tarjeta)]; `fases`: [fecha de aprobación];
    `gasto_por_dia`: {fecha: usd}; `gasto_por_tarjeta`: {clave de tarjeta: usd}; `memoria`: {nlm, vault, conocimiento, dias}."""
    dia_lim, tarjeta_lim = _limite(presupuesto, "diaUsd"), _limite(presupuesto, "tarjetaUsd")
    por_dia = {}
    for k, v in gasto_por_dia.items():
        f = _fecha(k)
        if f is not None and isinstance(v, (int, float)):
            por_dia[f] = por_dia.get(f, 0.0) + v
    # Un día solo cuenta cuando ya está cerrado: hoy todavía puede subir.
    dias_bajo = {f for f, v in por_dia.items() if dia_lim is not None and f < hoy and 0 < v <= dia_lim}

    dentro = sum(1 for _, k in hechas if tarjeta_lim is not None and 0 < gasto_por_tarjeta.get(k, 0) <= tarjeta_lim)
    xp = len(hechas) * XP_TARJETA + dentro * XP_BAJO_PRESUPUESTO_TARJETA + len(fases) * XP_FASE + len(dias_bajo) * XP_DIA

    fechas_hechas = {f for f in (_fecha(x) if x else None for x, _ in hechas) if f is not None}
    racha = _racha_actual(fechas_hechas, hoy)
    mejor = _max_racha(fechas_hechas)
    mem_dias = {f for f in (_fecha(x) for x in memoria.get("dias", [])) if f is not None}
    semana = any(all((d + timedelta(days=i)) in dias_bajo for i in range(7)) for d in dias_bajo)

    nivel = nivel_de(xp)
    conseguidos = {
        "primera-tarjeta": len(hechas) >= 1,
        "primera-fase": len(fases) >= 1,
        "racha-3": mejor >= 3,
        "racha-7": mejor >= 7,
        "bajo-presupuesto-5": dentro >= 5,
        "semana-sin-pasarte": semana,
        "primera-consulta-nlm": memoria.get("nlm", 0) >= 1,
        "conocimiento-10": memoria.get("conocimiento", 0) >= 10,
        "memoria-activa": _max_racha(mem_dias) >= 7,
        "decisiones-10": decisiones >= 10,
    }
    return Estado(
        xp=xp, nivel=nivel, xp_siguiente=NIVELES[nivel] if nivel < len(NIVELES) else None, racha=racha,
        logros=[(i, NOMBRES[i], bool(ok)) for i, ok in conseguidos.items()],
    )
