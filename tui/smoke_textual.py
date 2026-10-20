"""Humo: ¿Textual 8 renderiza el lienzo con colores dentro de un ScrollView, sin errores?"""
import asyncio
import sys

from rich.segment import Segment
from rich.style import Style
from rich.text import Text
from textual.app import App, ComposeResult
from textual.geometry import Size
from textual.scroll_view import ScrollView
from textual.strip import Strip

from hq.canvas import disenar
from proto_canvas import parse_task
from pathlib import Path


class Lienzo(ScrollView):
    def __init__(self, grid) -> None:
        super().__init__()
        self.grid = grid
        self.virtual_size = Size(grid.w, grid.h)

    def render_line(self, y: int) -> Strip:
        _, scroll_y = self.scroll_offset
        row = y + scroll_y
        if row >= self.grid.h:
            return Strip.blank(self.size.width)
        segs = []
        for x in range(self.grid.w):
            st = self.grid.st[row][x]
            style = Style(color=st) if st.startswith("#") else (Style(bold=True) if st == "bold" else Style())
            segs.append(Segment(self.grid.ch[row][x], style))
        return Strip(segs).crop(self.scroll_offset.x, self.scroll_offset.x + self.size.width)


class Humo(App):
    def __init__(self, grid) -> None:
        super().__init__()
        self.grid = grid

    def compose(self) -> ComposeResult:
        yield Lienzo(self.grid)


async def main() -> None:
    cards = [parse_task(p.read_text(encoding="utf8")) for p in sorted(Path(r"C:\proyectos personales\demo-hq\backlog\tasks").glob("*.md"))]
    g, _ = disenar(cards)
    app = Humo(g)
    async with app.run_test(size=(120, 24)) as pilot:
        await pilot.pause()
        await pilot.press("right", "right")
        await pilot.pause()
        svg = app.export_screenshot()
        print("OK: renderizado sin errores; captura SVG de", len(svg), "bytes; scroll_x =", app.query_one(Lienzo).scroll_offset.x)


asyncio.run(main())
