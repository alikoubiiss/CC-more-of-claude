"""Junta los datos de gasto, tarjetas, fases y vault para el panel `hq stats` y la cabecera del tablero."""
from __future__ import annotations

from datetime import date

from .fases import project_phases
from .gamificacion import Estado as Gamificacion
from .gamificacion import calcular
from .stats import Resumen, leer, resumen
from .tasks import read_tasks


def _decisiones(cfg, slug: str) -> int:
    try:
        return sum(1 for p in (cfg.vault_path / cfg.vault_projects_dir / slug / "Decisiones").glob("*.md") if p.is_file())
    except OSError:
        return 0


def cargar(cfg, proyectos, slug: str | None = None, hoy: date | None = None) -> tuple[Resumen, Gamificacion]:
    """(resumen del gasto —de un proyecto o de todos—, gamificación global). Un proyecto roto no tumba el resto."""
    hoy = hoy or date.today()
    todas = leer(cfg.metrics_dir) if cfg.metrics_dir else []
    res_global = resumen(todas, hoy, cfg.presupuesto)
    res = res_global if slug is None else resumen([l for l in todas if l["slug"] == slug], hoy, cfg.presupuesto)

    hechas: list[tuple[str, str]] = []
    fases: list[str] = []
    decisiones = 0
    for p in proyectos:
        try:
            hechas += [(t.updated, f"{p.slug}:{t.id}") for t in read_tasks(p.path) if t.status.lower() == "hecho"]
        except Exception:
            pass
        try:
            fases += [f.aprobada for f in project_phases(p.path) if f.aprobada]
        except Exception:
            pass
        decisiones += _decisiones(cfg, p.slug)
    por_tarjeta = {f"{s}:{c}": v for s, c, v in res_global.por_tarjeta if c}
    gam = calcular(hechas, fases, res_global.gasto_por_dia, por_tarjeta, res_global.memoria, decisiones, hoy, cfg.presupuesto)
    return res, gam
