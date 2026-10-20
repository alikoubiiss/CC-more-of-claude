"""Widgets de Textual. Solo dibujan: no escriben ficheros ni ejecutan nada."""
from __future__ import annotations

from functools import lru_cache

from rich.segment import Segment
from rich.style import Style
from textual.binding import Binding
from textual.geometry import Region, Size
from textual.message import Message
from textual.scroll_view import ScrollView
from textual.strip import Strip

from .canvas import BORDE, COLUMNAS, FONDO, TEXTO, Card, disenar

_ANCHO_NORMAL = 5 * 26 + 4 * 9
_BASE = Style(color=TEXTO, bgcolor=FONDO)


@lru_cache(maxsize=512)
def _estilo(st: str) -> Style:
    """Los estilos del grid salen solo de constantes del código, nunca de datos de las tarjetas."""
    return _BASE + Style.parse(st) if st else _BASE


class Lienzo(ScrollView, can_focus=True):
    """Tablero «Flujo»: columnas, tarjetas, cables y una tarjeta seleccionada."""

    DEFAULT_CSS = f"""
    Lienzo {{ background: {FONDO}; scrollbar-size: 1 1; scrollbar-background: {FONDO};
        scrollbar-color: {BORDE}; scrollbar-corner-color: {FONDO}; }}
    """

    BINDINGS = [
        Binding("left,h", "mover(-1,0)", "Izquierda", show=False),
        Binding("right,l", "mover(1,0)", "Derecha", show=False),
        Binding("up,k", "mover(0,-1)", "Arriba", show=False),
        Binding("down,j", "mover(0,1)", "Abajo", show=False),
    ]

    def __init__(self, **kw) -> None:
        super().__init__(**kw)
        self._cards: list[Card] = []
        self._sel: str | None = None
        self._compacto: bool | None = None  # None = automático según el ancho
        self._grid = None
        self._pos: dict[str, tuple[int, int]] = {}
        self._filas: list[list[str]] = []
        self._strips: dict[int, Strip] = {}
        self._compacto_efectivo = False
        self.frame = 0
        self._latido = None

    # --- API ---
    @property
    def cards(self) -> list[Card]:
        return list(self._cards)

    @property
    def seleccionada(self) -> Card | None:
        return next((c for c in self._cards if c.id == self._sel), None)

    def set_cards(self, cards: list[Card], seleccion: str | None = None) -> None:
        self._cards = list(cards)
        wanted = seleccion or self._sel
        if not any(c.id == wanted for c in self._cards):
            wanted = None
        if wanted is None and self._cards:
            wanted = (next((c for c in self._cards if c.status.lower() == "en curso"), self._cards[0])).id
        self._sel = wanted
        self._relayout()

    def set_compacto(self, valor: bool | None) -> None:
        self._compacto = valor
        self._relayout()

    def alternar_compacto(self) -> None:
        self.set_compacto(not self._compacto_efectivo)

    def mover_seleccion(self, dx: int, dy: int) -> None:
        cur = self.seleccionada
        if cur is None:
            return
        cols = [i for i in range(len(COLUMNAS)) if self._filas[i]]
        col = cur.col
        fila = self._filas[col].index(cur.id)
        if dx:
            idx = cols.index(col) + (1 if dx > 0 else -1)
            if 0 <= idx < len(cols):
                col = cols[idx]
                fila = min(fila, len(self._filas[col]) - 1)
        if dy:
            fila = max(0, min(len(self._filas[col]) - 1, fila + (1 if dy > 0 else -1)))
        self._sel = self._filas[col][fila]
        self._relayout()
        self._mostrar_seleccion()

    def action_mover(self, dx: int, dy: int) -> None:
        self.mover_seleccion(int(dx), int(dy))

    @property
    def animado(self) -> bool:
        return bool(self._grid and self._grid.anim)

    def on_mount(self) -> None:
        # El latido solo repinta celdas animadas (sin E/S) y se pausa si ninguna tarjeta lo necesita.
        self._latido = self.set_interval(0.5, self._tic, pause=True)
        self._pausar_o_seguir()

    def _pausar_o_seguir(self) -> None:
        if self._latido is not None:
            self._latido.resume() if self.animado else self._latido.pause()

    def _tic(self) -> None:
        if not self.animado:
            return
        self.frame += 1
        for fila in self._grid.animar(self.frame):
            self._strips.pop(fila, None)
        self.refresh()

    # --- interno ---
    def _relayout(self) -> None:
        ancho = self.size.width
        compacto = self._compacto if self._compacto is not None else (0 < ancho < _ANCHO_NORMAL)
        self._compacto_efectivo = compacto
        self._grid, self._pos = disenar(self._cards, seleccion=self._sel, compacto=compacto)
        self._filas = [[] for _ in COLUMNAS]
        for c in self._cards:
            self._filas[c.col].append(c.id)
        self._grid.animar(self.frame)
        self._strips = {}
        self.virtual_size = Size(self._grid.w, self._grid.h)
        self._pausar_o_seguir()
        self.refresh()

    def _mostrar_seleccion(self) -> None:
        p = self._pos.get(self._sel or "")
        if p:
            ancho, alto = self._grid.ancho_card, self._grid.alto_card
            self.scroll_to_region(Region(p[0], p[1], ancho, alto), animate=False, spacing=None)

    def on_resize(self, event) -> None:
        if self._compacto is None and self._cards:
            antes = self._compacto_efectivo
            nuevo = 0 < event.size.width < _ANCHO_NORMAL
            if nuevo != antes:
                self._relayout()
        self._mostrar_seleccion()

    def _strip_fila(self, row: int) -> Strip:
        s = self._strips.get(row)
        if s is None:
            g = self._grid
            segs, ini = [], 0
            while ini < g.w:
                st = g.st[row][ini]
                fin = ini
                while fin < g.w and g.st[row][fin] == st:
                    fin += 1
                segs.append(Segment("".join(g.ch[row][ini:fin]), _estilo(st)))
                ini = fin
            s = self._strips[row] = Strip(segs, g.w)
        return s

    def render_line(self, y: int) -> Strip:
        ancho = self.size.width
        if self._grid is None:
            return Strip.blank(ancho, _BASE)
        sx, sy = self.scroll_offset
        row = y + sy
        if row >= self._grid.h:
            return Strip.blank(ancho, _BASE)
        return self._strip_fila(row).crop(sx, sx + ancho).extend_cell_length(ancho, _BASE)

    # --- ratón: clic selecciona, arrastrar propone mover de columna (la pantalla decide) ---
    class Soltada(Message):
        def __init__(self, card_id: str, col: int) -> None:
            super().__init__()
            self.card_id, self.col = card_id, col

    def tarjeta_en(self, x: int, y: int) -> Card | None:
        g = self._grid
        if g is None:
            return None
        for c in self._cards:
            p = self._pos.get(c.id)
            if p and p[0] <= x < p[0] + g.ancho_card and p[1] <= y < p[1] + g.alto_card:
                return c
        return None

    def columna_en(self, x: int) -> int:
        xs = self._grid.xs if self._grid else [0]
        return max(i for i, cx in enumerate(xs) if cx <= x) if x >= 0 else 0

    def arrastrar(self, x0: int, y0: int, x1: int, y1: int) -> None:
        """Coordenadas del lienzo (ya con el desplazamiento). Solo propone; no ejecuta nada."""
        c = self.tarjeta_en(x0, y0)
        if c is None:
            return
        self._sel = c.id
        self._relayout()
        destino = self.columna_en(x1)
        if destino != c.col:
            self.post_message(self.Soltada(c.id, destino))

    def on_mouse_down(self, event) -> None:
        self._origen = (event.x + self.scroll_offset.x, event.y + self.scroll_offset.y)
        self.capture_mouse()

    def on_mouse_up(self, event) -> None:
        self.release_mouse()
        o = getattr(self, "_origen", None)
        self._origen = None
        if o:
            self.arrastrar(*o, event.x + self.scroll_offset.x, event.y + self.scroll_offset.y)
