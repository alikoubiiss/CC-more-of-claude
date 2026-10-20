from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path


class RegistryError(Exception):
    pass


@dataclass
class Project:
    slug: str
    display: str
    path: str
    port: int = 0
    notebook_id: str = ""


def _norm(p: str) -> str:
    return str(p).replace("\\", "/").rstrip("/").lower()


def load_registry(file: str | Path) -> list[Project]:
    f = Path(file)
    if not f.exists():
        return []
    try:
        data = json.loads(f.read_text(encoding="utf8"))
        items = data["projects"]
        if not isinstance(items, list):
            raise ValueError("projects no es una lista")
        return [Project(p["slug"], p.get("display", p["slug"]), p["path"], int(p.get("port") or 0), p.get("notebookId", "")) for p in items]
    except (OSError, ValueError, KeyError, TypeError) as e:
        raise RegistryError(f"registry: {f} está dañado ({e})") from e


def find_by_path(projects, cwd: str) -> Project | None:
    if not cwd:
        return None
    here = _norm(cwd)
    for p in projects:
        root = _norm(p.path)
        if here == root or here.startswith(root + "/"):
            return p
    return None
