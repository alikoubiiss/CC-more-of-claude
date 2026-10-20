"""Comando `cc`. Errores de uso → código 2; de configuración → código 1; sin trazas."""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

from .config import HQ_ROOT, ConfigError, load_config
from .registry import RegistryError, find_by_path, load_registry

MODOS = ("board", "feed", "notes", "focus")


def lanzar_wt(slug: str) -> None:
    subprocess.Popen(["node", str(HQ_ROOT / "scripts" / "hq-open.mjs"), slug], shell=False)


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="cc", description="Paneles de terminal de Project HQ")
    p.add_argument("--config", help="ruta a config.json (por defecto HQ_CONFIG o el del plugin)")
    sub = p.add_subparsers(dest="cmd")
    for m in MODOS:
        sp = sub.add_parser(m, help=f"pantalla {m}")
        sp.add_argument("slug", nargs="?")
    sub.add_parser("open", help="abre el reparto de paneles de un proyecto").add_argument("slug")
    sub.add_parser("start", help="arranca todo: abre el proyecto de esta carpeta (o el que nombres); sin proyecto, la lista").add_argument("slug", nargs="?")
    sub.add_parser("stats", help="gasto de tokens, presupuesto y progreso (todos los proyectos o uno)").add_argument("slug", nargs="?")
    return p


def main(argv=None, cwd=None, lanzador=None, run_app=None) -> int:
    args = _parser().parse_args(argv)
    err = lambda m: print(f"cc: {m}", file=sys.stderr)  # noqa: E731
    try:
        cfg = load_config(args.config)
        proyectos = load_registry(cfg.registry_file)
    except (ConfigError, RegistryError) as e:
        err(str(e))
        return 1

    def lista() -> str:
        return ", ".join(p.slug for p in proyectos) or "ninguno registrado"

    from .app import HQApp
    arrancar = run_app or (lambda app: app.run())

    if args.cmd == "start":
        slug_start = args.slug or next((p.slug for p in [find_by_path(proyectos, str(cwd or Path.cwd()))] if p), None)
        if slug_start is None:
            args.cmd = None  # fuera de un proyecto y sin nombre: la lista de proyectos
        else:
            args.cmd, args.slug = "open", slug_start
    if args.cmd is None:
        arrancar(HQApp("global", cfg=cfg, proyectos=proyectos, open_proyecto=lanzador or lanzar_wt))
        return 0
    if args.cmd == "stats":  # sin proyecto = todos (no se usa la carpeta actual)
        if args.slug and not any(p.slug == args.slug for p in proyectos):
            err(f'no existe el proyecto "{args.slug}". Proyectos: {lista()}')
            return 2
        arrancar(HQApp("stats", args.slug, cfg=cfg))
        return 0
    slug = args.slug
    if slug is None:
        p = find_by_path(proyectos, str(cwd or Path.cwd()))
        slug = p.slug if p else None
        if slug is None:
            err(f"esta carpeta no es un proyecto de HQ. Proyectos: {lista()}")
            return 2
    if not any(p.slug == slug for p in proyectos):
        err(f'no existe el proyecto "{slug}". Proyectos: {lista()}')
        return 2
    if args.cmd == "open":
        try:
            (lanzador or lanzar_wt)(slug)
        except Exception as e:
            err(f"no se pudo abrir: {e}")
            return 1
        return 0
    arrancar(HQApp(args.cmd, slug, cfg=cfg))
    return 0


if __name__ == "__main__":
    sys.exit(main())
