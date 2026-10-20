"""Lector de tarjetas e hitos de Backlog.md (puerto de lib/backlog-task.mjs)."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

from .textos import limpiar


@dataclass
class Task:
    id: str = ""
    title: str = ""
    status: str = ""
    milestone: str = ""
    labels: list[str] = field(default_factory=list)
    dependencies: list[str] = field(default_factory=list)
    criteria_done: int = 0
    criteria_total: int = 0
    criteria_items: list[tuple[int, str, bool]] = field(default_factory=list)
    comments: list[tuple[str, str, str]] = field(default_factory=list)  # (autor, fecha, texto)
    file: str = ""
    description: str = ""
    ordinal: float = float("inf")  # orden manual de Backlog.md; sin él, se ordena por número de id
    updated: str = ""  # fecha AAAA-MM-DD de la última actualización (para fechar cuándo pasó a «Hecho»)


@dataclass
class Milestone:
    id: str
    title: str


def _unquote(v: str) -> str:
    s = v.strip()
    if len(s) >= 2 and s[0] == "'" and s[-1] == "'":
        return s[1:-1].replace("''", "'")
    if len(s) >= 2 and s[0] == '"' and s[-1] == '"':
        return s[1:-1].replace('\\"', '"')
    return s


def _frontmatter(text: str):
    clean = text.lstrip("﻿")
    m = re.match(r"---\r?\n(.*?)\r?\n---\r?\n?", clean, re.S)
    if not m:
        return {}, clean
    data: dict = {}
    key = None
    for line in m.group(1).splitlines():
        item = re.match(r"\s+-\s*(.*)$", line)
        if item and key is not None:
            data[key].append(_unquote(item.group(1)))
            continue
        kv = re.match(r"([\w-]+):\s*(.*)$", line)
        if not kv:
            continue
        k, raw = kv.groups()
        inline = re.match(r"^\[(.*)\]$", raw)
        if raw == "":
            data[k] = []
            key = k
        elif inline:
            data[k] = [x for x in (_unquote(p) for p in inline.group(1).split(",")) if x]
            key = None
        else:
            data[k] = _unquote(raw)
            key = None
    return data, clean[m.end():]


def _scalar(v) -> str:
    return limpiar((v[0] if v else "") if isinstance(v, list) else (v or ""))


def _lista(v) -> list[str]:
    return [limpiar(x) for x in (v if isinstance(v, list) else ([v] if v else []))]


def _fecha(v) -> str:
    m = re.match(r"^(\d{4}-\d{2}-\d{2})", _scalar(v))
    if not m:
        return ""
    try:
        date.fromisoformat(m.group(1))
    except ValueError:
        return ""
    return m.group(1)


def _ordinal(v) -> float:
    try:
        return float(_scalar(v))
    except ValueError:
        return float("inf")


def parse_task(text: str) -> Task:
    data, body = _frontmatter(text)
    items = []
    ac = re.search(r"<!-- AC:BEGIN -->(.*?)<!-- AC:END -->", body, re.S)
    if ac:
        for line in ac.group(1).splitlines():
            m = re.match(r"^- \[( |x|X)\] #(\d+)\s+(.*)$", line)
            if m:
                items.append((int(m.group(2)), limpiar(m.group(3)), m.group(1) != " "))
    dm = re.search(r"<!-- SECTION:DESCRIPTION:BEGIN -->(.*?)<!-- SECTION:DESCRIPTION:END -->", body, re.S)
    descripcion = limpiar(dm.group(1))[:600].strip() if dm else ""
    comments = []
    cm =re.search(r"<!-- COMMENTS:BEGIN -->(.*?)<!-- COMMENTS:END -->", body, re.S)
    if cm:
        for r in re.finditer(r"author:\s*(.*?)\r?\ncreated:\s*(.*?)\r?\n---\r?\n(.*?)\r?\n---", cm.group(1), re.S):
            comments.append((limpiar(r.group(1)), limpiar(r.group(2)), limpiar(r.group(3))))
    return Task(
        id=_scalar(data.get("id")), title=limpiar(_scalar(data.get("title"))), status=_scalar(data.get("status")),
        milestone=_scalar(data.get("milestone")), labels=_lista(data.get("labels")), dependencies=_lista(data.get("dependencies")),
        criteria_done=sum(1 for i in items if i[2]), criteria_total=len(items), criteria_items=items, comments=comments,
        description=descripcion, updated=_fecha(data.get("updated_date")), ordinal=_ordinal(data.get("ordinal")),
    )


def _num(id_: str) -> int:
    m = re.search(r"(\d+)", id_)
    return int(m.group(1)) if m else 10**15


def read_tasks(repo: str | Path) -> list[Task]:
    out: list[Task] = []
    try:
        files = sorted(Path(repo, "backlog", "tasks").glob("*.md"))
    except OSError:
        return []
    for f in files:
        try:
            t = parse_task(f.read_text(encoding="utf8"))
        except (OSError, UnicodeDecodeError):
            continue
        t.id = t.id or limpiar(f.name)
        t.title = t.title or limpiar(f.name)
        t.file = f.name
        out.append(t)
    return sorted(out, key=lambda t: (t.ordinal, _num(t.id)))


def read_milestones(repo: str | Path) -> list[Milestone]:
    out: list[Milestone] = []
    try:
        files = sorted(Path(repo, "backlog", "milestones").glob("*.md"))
    except OSError:
        return []
    for f in files:
        try:
            data, _ = _frontmatter(f.read_text(encoding="utf8"))
        except (OSError, UnicodeDecodeError):
            continue
        if _scalar(data.get("id")):
            out.append(Milestone(_scalar(data["id"]), limpiar(_scalar(data.get("title")))))
    return sorted(out, key=lambda m: _num(m.id))
