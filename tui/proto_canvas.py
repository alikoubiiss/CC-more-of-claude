"""Prototipo: dibuja el lienzo con las tarjetas reales de un proyecto (solo lectura)."""
import re
import sys
from pathlib import Path

from hq.canvas import Card, disenar


def parse_task(text: str) -> Card:
    m = re.match(r"---\r?\n(.*?)\r?\n---", text.lstrip("\ufeff"), re.S)
    data: dict = {}
    key = None
    for line in (m.group(1) if m else "").splitlines():
        item = re.match(r"\s+-\s*(.*)$", line)
        if item and key:
            data[key].append(item.group(1).strip().strip("'\""))
            continue
        kv = re.match(r"([\w-]+):\s*(.*)$", line)
        if kv:
            k, v = kv.groups()
            if v == "":
                data[k] = []
                key = k
            else:
                data[k] = [] if v == "[]" else v.strip().strip("'\"")
                key = None
    ac = re.search(r"<!-- AC:BEGIN -->(.*?)<!-- AC:END -->", text, re.S)
    items = re.findall(r"- \[( |x|X)\] #", ac.group(1)) if ac else []
    return Card(
        id=data.get("id", "?"), title=data.get("title", "?"), status=data.get("status", ""),
        labels=data.get("labels", []) or [], deps=data.get("dependencies", []) or [],
        done=sum(1 for i in items if i != " "), total=len(items),
    )


def main(repo: str) -> None:
    cards = [parse_task(p.read_text(encoding="utf8")) for p in sorted(Path(repo, "backlog", "tasks").glob("*.md"))]
    g, pos = disenar(cards)
    sys.stdout.reconfigure(encoding="utf8")
    print(f"{len(cards)} tarjetas, lienzo {g.w}x{g.h}")
    print("\n".join(g.lines()))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else r"C:\proyectos personales\demo-hq")
