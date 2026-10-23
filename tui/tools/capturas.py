"""Genera las capturas de docs/capturas/*.svg con datos de ejemplo ficticios (sin tocar tu HQ real).

Uso (desde la raíz del repo): cd tui && python tools/capturas.py
"""
from __future__ import annotations

import asyncio
import json
import re
import shutil
import sys
import tempfile
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from hq.actions import Backlog  # noqa: E402
from hq.app import HQApp  # noqa: E402
from hq.config import load_config  # noqa: E402
from hq.registry import Project  # noqa: E402

RAIZ = Path(__file__).resolve().parents[2]
SALIDA = RAIZ / "docs" / "capturas"
HOY = date.today()


def fixture() -> tuple[Path, Path]:
    """Un HQ de mentira en una carpeta temporal: proyecto «demo», tarjetas de ejemplo y gasto ficticio."""
    d = Path(tempfile.mkdtemp(prefix="hq-capturas-"))
    repo = d / "demo"
    shutil.copytree(RAIZ / "backlog", repo / "backlog")
    (repo / ".hq").mkdir()
    fases = json.loads((RAIZ / ".hq" / "fases.example.json").read_text(encoding="utf8"))
    fases["fases"][0]["aprobada"] = HOY.isoformat()  # primera fase ya aprobada por el usuario
    (repo / ".hq" / "fases.json").write_text(json.dumps(fases), encoding="utf8")
    # Reparte las tarjetas de ejemplo por columnas para que el tablero se vea vivo.
    reparto = {"1": ("Hecho", []), "2": ("Verificando", ["revisada", "modelo:opus", "esfuerzo:high"]),
               "3": ("En curso", ["modelo:sonnet", "esfuerzo:high"]), "4": ("Planificado", ["modelo:haiku", "esfuerzo:medium"])}
    for f in (repo / "backlog" / "tasks").glob("task-*.md"):
        estado, etiquetas = reparto[f.name.split(" ")[0].removeprefix("task-")]
        t = f.read_text(encoding="utf8")
        t = re.sub(r"^status: .*$", f"status: {estado}", t, count=1, flags=re.M)
        lista = "labels:\n" + "\n".join(f"  - {x}" for x in etiquetas) if etiquetas else "labels: []"
        t = re.sub(r"^labels: \[\]$", lambda _: lista, t, count=1, flags=re.M)
        f.write_text(t, encoding="utf8")
    (d / "config.json").write_text(json.dumps({
        "vaultPath": str(d / "vault"), "projectsRoot": str(d), "vaultProjectsDir": "Proyectos",
        "dataDir": str(d), "presupuesto": {"diaUsd": 50, "tarjetaUsd": 15}}), encoding="utf8")
    (d / "registry.json").write_text(json.dumps({"projects": [
        {"slug": "demo", "display": "demo", "path": str(repo), "port": 6430},
        {"slug": "mi-api", "display": "mi-api", "path": str(d / "mi-api"), "port": 6431}]}), encoding="utf8")
    ejemplo = [("sonnet", "TASK-3", 1.8), ("opus", "TASK-2", 4.2), ("haiku", "TASK-4", 0.3), ("sonnet", "TASK-1", 2.6)]
    for i in range(14):
        dia = HOY - timedelta(days=i)
        f = d / "metrics" / "demo" / f"{dia.isoformat()}.jsonl"
        f.parent.mkdir(parents=True, exist_ok=True)
        lineas, acum = [], 0.0
        for j, (modelo, tarjeta, coste) in enumerate(ejemplo[: 2 + (i % 3)]):
            acum += coste * (1 + (i % 4) / 4)
            lineas.append({"kind": "snap", "sid": f"s{i}{j}", "model": modelo, "card": tarjeta, "cost": round(acum, 2),
                           "delta": round(coste * (1 + (i % 4) / 4), 2)})
        lineas += [{"kind": "mem", "mem": "nlm"}, {"kind": "mem", "mem": "vault"}, {"kind": "inicio", "chars": 900}]
        f.write_text("\n".join(json.dumps(x) for x in lineas) + "\n", encoding="utf8")
    return d, repo


async def _sin_llamadas(args, cwd):  # el tablero nunca llama a `backlog` en las capturas
    return 0, "", ""


def capturar(nombre: str, app: HQApp, size: tuple[int, int], esperar_stats: bool = False) -> None:
    async def run():
        async with app.run_test(size=size) as pilot:
            await pilot.pause()
            if esperar_stats:
                await app.workers.wait_for_complete()
                await pilot.pause()
            svg = app.export_screenshot(title=f"Project HQ · {nombre}")
            (SALIDA / f"{nombre}.svg").write_text(svg, encoding="utf8")
    asyncio.run(run())
    print("ok", SALIDA / f"{nombre}.svg")


def main() -> None:
    SALIDA.mkdir(parents=True, exist_ok=True)
    d, repo = fixture()
    cfg = load_config(d / "config.json")
    proyectos = [Project("demo", "demo", str(repo)), Project("mi-api", "mi-api", str(d / "mi-api"))]
    capturar("tablero", HQApp("board", "demo", cfg=cfg), (130, 30))
    capturar("estadisticas", HQApp("stats", None, cfg=cfg, hoy=HOY), (110, 42), esperar_stats=True)
    capturar("proyectos", HQApp("global", cfg=cfg, proyectos=proyectos), (110, 18))
    capturar("foco", HQApp("focus", "demo", cfg=cfg), (70, 28), esperar_stats=True)
    shutil.rmtree(d, ignore_errors=True)


if __name__ == "__main__":
    main()
