"""Pantalla «Ahora mismo»: cabecera de la sesión y actividad en vivo."""
from __future__ import annotations

from pathlib import Path

from rich.text import Text
from textual.app import ComposeResult
from textual.binding import Binding
from textual.screen import Screen
from textual.widgets import RichLog, Static

from .. import events, session
from ..canvas import MODELO_COLOR
from ..textos import limpiar

VACIO = "Sin actividad todavía: abre una sesión de Claude Code en este proyecto"


def _clave(e) -> tuple:
    return (e.t, e.kind, e.tool, e.target, e.agent)


def _firma(events_dir, slug: str, state_dir) -> tuple:
    out = []
    for d, patron in ((Path(events_dir) / slug, "*.jsonl"), (Path(state_dir) if state_dir else None, "*.json")):
        if d is None:
            continue
        try:
            out.extend((p.name, p.stat().st_mtime_ns, p.stat().st_size) for p in d.glob(patron))
        except OSError:
            out.append((str(d), None, None))
    return tuple(sorted(out, key=str))


class FeedScreen(Screen):
    DEFAULT_CSS = """
    #cabecera { height: 1; padding: 0 1; }
    #registro { padding: 0 1; }
    """
    BINDINGS = [
        Binding("end", "al_final", "Final"),
        Binding("q", "app.quit", "Salir"),
    ]

    def __init__(self, slug: str, events_dir, state_dir=None, display: str | None = None) -> None:
        super().__init__()
        self.slug, self.events_dir, self.state_dir = slug, events_dir, state_dir
        self.display_name = limpiar(display or slug)
        self._firma = None
        self._ultima = None
        self._vacio = False

    def compose(self) -> ComposeResult:
        yield Static(id="cabecera", markup=False)
        yield RichLog(id="registro", markup=False, wrap=True, auto_scroll=True)

    def on_mount(self) -> None:
        self.refrescar()
        self.set_interval(1.0, self._sondeo)

    def _sondeo(self) -> None:
        f = _firma(self.events_dir, self.slug, self.state_dir)
        if f != self._firma:
            self.refrescar()

    def action_al_final(self) -> None:
        self.query_one(RichLog).scroll_end(animate=False)

    def refrescar(self) -> None:
        self._firma = _firma(self.events_dir, self.slug, self.state_dir)
        self._cabecera()
        log = self.query_one(RichLog)
        evs = events.read_recent(self.events_dir, self.slug)
        if not evs:
            if not self._vacio:
                log.clear()
                log.write(Text(VACIO, style="dim"), scroll_end=True)
                self._vacio = True
            return
        if self._vacio:
            log.clear()
            self._vacio = False
            self._ultima = None
        claves = [_clave(e) for e in evs]
        if self._ultima in claves:
            nuevos = evs[claves.index(self._ultima) + 1:]
        else:
            if self._ultima is not None:
                log.clear()
            nuevos = evs
        al_final = log.scroll_y >= log.max_scroll_y - 1
        for e in nuevos:
            t = Text()
            t.append(e.hora + "  ", style="dim")
            t.append("● ", style=MODELO_COLOR.get(e.model.lower(), "dim"))
            t.append(e.texto, style="#ff6b6b" if e.kind == "tool_fail" else "")
            log.write(t, scroll_end=al_final)
        self._ultima = claves[-1]

    def _cabecera(self) -> None:
        s = session.latest(self.state_dir, self.slug) if self.state_dir else None
        t = Text(f"{self.display_name}  ·  ", style="bold")
        if not s:
            t.append("sin sesión", style="dim")
        else:
            t.append(s.model_name or s.model or "?", style=MODELO_COLOR.get((s.model or s.model_name or "").lower(), ""))
            if s.ctx_pct is not None:
                t.append(f"  ctx {s.ctx_pct:.0f}%")
            if s.cost is not None:
                t.append(f"  ${s.cost:.2f}")
            if s.tokens_in is not None or s.tokens_out is not None:
                t.append(f"  {s.tokens_in or 0}↓ {s.tokens_out or 0}↑")
        self.query_one("#cabecera", Static).update(t)
