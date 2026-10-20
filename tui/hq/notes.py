"""Notas del vault de un proyecto: árbol, lectura y URI de Obsidian."""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote

from .textos import limpiar

MAX_BYTES = 200_000


@dataclass
class Nota:
    ruta: Path
    titulo: str
    tipo: str  # indice | decision | sesion


def _titulo(f: Path) -> str:
    try:
        m = re.search(r"^# (.+)$", f.read_text(encoding="utf8"), re.M)
    except (OSError, UnicodeDecodeError):
        m = None
    return limpiar(m.group(1)) if m else f.stem


def tree(vault_path, vault_projects_dir: str, slug: str) -> list[Nota]:
    base = Path(vault_path) / vault_projects_dir / slug
    out: list[Nota] = []
    idx = base / "Índice.md"
    if idx.is_file():
        out.append(Nota(idx, _titulo(idx), "indice"))
    for carpeta, tipo in (("Decisiones", "decision"), ("Sesiones", "sesion")):
        try:
            files = sorted((p for p in (base / carpeta).glob("*.md") if p.is_file()), key=lambda p: p.name, reverse=True)
        except OSError:
            files = []
        out.extend(Nota(p, _titulo(p), tipo) for p in files)
    return out


def read(ruta) -> str:
    try:
        data = Path(ruta).read_bytes()
    except OSError as e:
        return f"No se pudo leer la nota: {e}"
    texto = data[:MAX_BYTES].decode("utf8", errors="replace")
    return texto + ("\n\n… (texto recortado)" if len(data) > MAX_BYTES else "")


def obsidian_uri(vault_path, ruta) -> str:
    rel = Path(ruta).relative_to(vault_path).as_posix()
    if rel.endswith(".md"):
        rel = rel[:-3]
    return f"obsidian://open?vault={quote(Path(vault_path).name, safe='')}&file={quote(rel, safe='')}"
