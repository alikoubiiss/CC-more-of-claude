"""Lienzo «Flujo» en caracteres: columnas de tarjetas (bloques con borde redondeado y puertos)
y cables de dependencia dibujados con caracteres de línea. Puro: no depende de Textual.
También reúne la paleta y los helpers de estilo (degradados, barras, paneles) del tablero."""
from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache

from rich.cells import cell_len, get_character_cell_size
from rich.text import Text

from .textos import limpiar

COLUMNAS = ["Ideas", "Planificado", "En curso", "Verificando", "Hecho"]

L, R, U, D = 1, 2, 4, 8
CHAR = {
    0: " ", L: "─", R: "─", L | R: "─", U: "│", D: "│", U | D: "│",
    R | D: "╭", L | D: "╮", R | U: "╰", L | U: "╯",
    L | R | D: "┬", L | R | U: "┴", U | D | R: "├", U | D | L: "┤", L | R | U | D: "┼",
}
MODELO_COLOR = {"opus": "#C58BFF", "sonnet": "#6EA8FF", "haiku": "#5ED3C2", "fable": "#FFC86B"}
IRIS, DIM, AMBER = "#8B7CFF", "#98A0BC", "#FFC86B"
FONDO, PANEL, BORDE, PISTA = "#0B0E1A", "#141A2E", "#3B4360", "#232A42"
TEXTO, ROJO, CIAN, BLANCO = "#E6E9F5", "#FF6B6B", "#5ED3C2", "#FFFFFF"
SEL = "#A99CFF"
SEL_FONDO = "#1F2850"
OK = "#6FE3A0"
ESTADO_COLOR = {"ideas": DIM, "planificado": "#6EA8FF", "en curso": AMBER, "verificando": CIAN, "hecho": OK}
ETIQUETA_COLOR = ["#FF9EC7", "#7FD8FF", "#FFB86B", "#B9F27C", "#D7A8FF", "#FFE07A"]
CRITERIOS = [IRIS, OK]
CABECERA = ["#3A2F7A", "#1B2140", FONDO]
GIROS = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"
PARCIAL = " ▏▎▍▌▋▊▉"
COLAPSADA = 5
# Etiquetas que pone el sistema (arquitecto, revisor), no el usuario: no se pintan como #etiqueta.
SISTEMA = ("modelo:", "skill:", "esfuerzo:", "riesgo:", "est:")


def color_estado(status: str) -> str:
    return ESTADO_COLOR.get((status or "").lower(), DIM)


def color_etiqueta(etiqueta: str) -> str:
    return ETIQUETA_COLOR[sum(map(ord, etiqueta)) % len(ETIQUETA_COLOR)]


def color_modelo(modelo: str | None) -> str:
    m = (modelo or "").lower()
    return next((c for k, c in MODELO_COLOR.items() if k in m), DIM)


def _rgb(c: str) -> tuple[int, int, int]:
    return tuple(int(c[i:i + 2], 16) for i in (1, 3, 5))


@lru_cache(maxsize=4096)
def _mezcla(paradas: tuple[str, ...], x: float) -> str:
    x = min(max(x, 0.0), 1.0) * (len(paradas) - 1)
    i = min(int(x), len(paradas) - 2)
    a, b = _rgb(paradas[i]), _rgb(paradas[i + 1])
    return "#" + "".join(f"{round(a[k] + (b[k] - a[k]) * (x - i)):02X}" for k in range(3))


def mezcla(paradas, x: float) -> str:
    """Color en la posición x (0..1) de un degradado truecolor."""
    return _mezcla(tuple(paradas), round(float(x), 3))


@lru_cache(maxsize=1024)
def _celdas_barra(pct: float, ancho: int, paradas: tuple[str, ...]) -> tuple[tuple[str, str], ...]:
    celdas = pct / 100 * ancho
    llenas, resto = int(celdas), int((celdas - int(celdas)) * 8)
    out = []
    for i in range(ancho):
        c = _mezcla(paradas, round(i / max(ancho - 1, 1), 3))
        if i < llenas:
            out.append(("█", c))
        elif i == llenas and resto:
            out.append((PARCIAL[resto], f"{c} on {PISTA}"))
        else:
            out.append((" ", f"on {PISTA}"))
    return tuple(out)


def celdas_barra(pct, ancho: int, paradas) -> tuple[tuple[str, str], ...]:
    """Barra con degradado por celda y octavos de bloque: [(carácter, estilo)]."""
    pct = round(min(max(pct or 0, 0), 100), 1)
    return _celdas_barra(pct, max(int(ancho), 0), tuple(paradas))


def barra(pct, ancho: int, paradas) -> Text:
    t = Text()
    for ch, st in celdas_barra(pct, ancho, paradas):
        t.append(ch, style=st)
    return t


def recortar_celdas(s: str, n: int) -> str:
    """Recorta a n celdas de terminal (los caracteres anchos ocupan dos) con «…» al final."""
    if n <= 0:
        return ""
    if cell_len(s) <= n:
        return s
    out, usado = [], 0
    for ch in s:
        w = get_character_cell_size(ch)
        if usado + w > n - 1:
            break
        out.append(ch)
        usado += w
    return "".join(out) + "…"


def ajustar(t: Text, n: int) -> Text:
    t = t.copy()
    t.truncate(max(n, 0), overflow="ellipsis", pad=True)
    return t


def panel(titulo: Text | str, color: str, cuerpo: list[Text], ancho: int, fondo: str = PANEL) -> list[Text]:
    """Panel con borde redondeado y título incrustado, como los del panel Foco. `titulo` ya saneado."""
    marco = f"{BORDE} on {fondo}"
    tit = titulo.copy() if isinstance(titulo, Text) else Text(titulo, style=f"bold {color}")
    tit = Text.assemble(" ", tit, " ", style=f"on {fondo}")
    tit.truncate(max(ancho - 4, 0), overflow="ellipsis")
    out = [Text.assemble(("╭─", marco), tit, ("─" * max(ancho - 3 - tit.cell_len, 0) + "╮", marco))]
    for l in cuerpo:
        out.append(Text.assemble(("│ ", marco), ajustar(Text.assemble(l, style=f"{TEXTO} on {fondo}"), ancho - 4), (" │", marco)))
    out.append(Text("╰" + "─" * max(ancho - 2, 0) + "╯", style=marco))
    return out


def degradado_fondo(t: Text, paradas=CABECERA) -> Text:
    """Pinta el fondo de una línea con un degradado horizontal (por debajo de los estilos ya puestos)."""
    n = len(t.plain)
    for i in range(n):
        t.stylize_before(f"on {mezcla(paradas, i / max(n - 1, 1))}", i, i + 1)
    return t


@dataclass
class Card:
    id: str
    title: str
    status: str
    labels: list[str] = field(default_factory=list)
    deps: list[str] = field(default_factory=list)
    done: int = 0
    total: int = 0
    milestone: str = ""

    @property
    def col(self) -> int:
        s = self.status.lower()
        for i, c in enumerate(COLUMNAS):
            if c.lower() == s:
                return i
        return 0

    @property
    def model(self) -> str | None:
        for lab in self.labels:
            if lab.startswith("modelo:"):
                return lab.split(":", 1)[1]
        return None

    @property
    def skill(self) -> str | None:
        for lab in self.labels:
            if lab.startswith("skill:"):
                return lab.split(":", 1)[1]
        return None

    @property
    def revisada(self) -> bool:
        return "revisada" in self.labels

    @property
    def espera_aprobacion(self) -> bool:
        return self.status.lower() == "verificando" and self.revisada

    @property
    def etiquetas(self) -> list[str]:
        """Etiquetas propias del usuario (sin las de sistema: modelo, skill, revisada)."""
        return [x for x in self.labels if x != "revisada" and not x.startswith(SISTEMA)]


def bloqueos(cards: list[Card]) -> dict[str, list[str]]:
    """Dependencias aún sin terminar de cada tarjeta no hecha. Una dependencia que no está
    en el tablero no bloquea (puede ser de otro proyecto o estar archivada)."""
    estado = {c.id.lower(): c.status.lower() for c in cards}
    out: dict[str, list[str]] = {}
    for c in cards:
        if c.status.lower() == "hecho":
            continue
        pend = [d for d in c.deps if estado.get(d.lower(), "hecho") != "hecho"]
        if pend:
            out[c.id] = pend
    return out


class Grid:
    def __init__(self, w: int, h: int):
        self.w, self.h = w, h
        self.ch = [[" "] * w for _ in range(h)]
        self.st = [[""] * w for _ in range(h)]
        self.mask = [[0] * w for _ in range(h)]
        self.ocupado = [[False] * w for _ in range(h)]
        self.anim: list[tuple[int, int, list[tuple[str, str]]]] = []  # (x, y, fotogramas (texto, estilo))

    def text(self, x: int, y: int, s: str, style: str = "") -> None:
        """Escribe texto celda a celda; un carácter ancho ocupa dos celdas (la segunda queda vacía)."""
        if not 0 <= y < self.h:
            return
        i = x
        for c in s:
            w = get_character_cell_size(c)
            if w == 0:
                continue
            if 0 <= i < self.w:
                if w == 2 and i + 1 >= self.w:
                    c, w = " ", 1
                self.ch[y][i] = c
                self.st[y][i] = style
                if w == 2:
                    self.ch[y][i + 1] = ""
                    self.st[y][i + 1] = style
            i += w

    def rellenar(self, x: int, y: int, w: int, h: int, style: str) -> None:
        for yy in range(max(y, 0), min(y + h, self.h)):
            for xx in range(max(x, 0), min(x + w, self.w)):
                self.ch[yy][xx], self.st[yy][xx], self.ocupado[yy][xx] = " ", style, True

    def line(self, x: int, y: int, bits: int, style: str) -> None:
        """Suma direcciones a una celda de cable y recalcula el carácter (cruces → ┼)."""
        if not (0 <= x < self.w and 0 <= y < self.h) or self.ocupado[y][x]:
            return
        if self.ch[y][x] != " " and self.mask[y][x] == 0:
            return  # no pisar texto de tarjetas ni títulos
        self.mask[y][x] |= bits
        self.ch[y][x] = CHAR.get(self.mask[y][x], "┼")
        self.st[y][x] = style

    def path(self, pts: list[tuple[int, int]], style: str) -> None:
        for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
            if y1 == y2:
                step = 1 if x2 > x1 else -1
                for x in range(x1, x2 + step, step):
                    if x == x1:
                        bits = R if step == 1 else L
                    elif x == x2:
                        bits = L if step == 1 else R
                    else:
                        bits = L | R
                    self.line(x, y1, bits, style)
            else:
                step = 1 if y2 > y1 else -1
                for y in range(y1, y2 + step, step):
                    if y == y1:
                        bits = D if step == 1 else U
                    elif y == y2:
                        bits = U if step == 1 else D
                    else:
                        bits = U | D
                    self.line(x1, y, bits, style)

    def animar(self, frame: int) -> set[int]:
        """Aplica el fotograma `frame` a las celdas animadas; devuelve las filas tocadas."""
        filas = set()
        for x, y, fotos in self.anim:
            s, st = fotos[frame % len(fotos)]
            self.text(x, y, s, st)
            filas.add(y)
        return filas

    def lines(self) -> list[str]:
        return ["".join(r).rstrip() for r in self.ch]


def _recortar(s: str, n: int) -> str:
    return recortar_celdas(s, n)


def card_de_task(task, milestones) -> Card:
    hito = next((m.title for m in milestones if m.id == task.milestone), task.milestone)
    return Card(task.id, task.title, task.status, list(task.labels), list(task.dependencies),
                task.criteria_done, task.criteria_total, hito)


NODO = {"aprobada": ("●", OK), "activa": ("◉", AMBER), "esperando": ("◎", ROJO), "pendiente": ("○", DIM)}
ESTADO_FASE = {"aprobada": "aprobada", "activa": "en curso", "esperando": "espera tu aprobación", "pendiente": "pendiente"}


def franja_fases(fases, ancho: int) -> str:
    """Franja de fases: ● aprobada, ◉ activa, ◎ esperando tu visto bueno, ○ pendiente."""
    simbolo = {k: v[0] for k, v in NODO.items()}
    nodos = [f"{simbolo.get(f.estado, '○')} {limpiar(f.nombre)} {f.hechas}/{f.total}" for f in fases]
    lineas, actual = [], ""
    for n in nodos:
        cand = n if not actual else f"{actual} ── {n}"
        if actual and len(cand) > ancho:
            lineas.append(actual)
            actual = n
        else:
            actual = cand
    if actual:
        lineas.append(actual)
    return "\n".join(_recortar(l, ancho) for l in lineas)


def franja_fases_texto(fases, ancho: int, frame: int = 0) -> Text:
    """Versión con color de la franja: nodos por estado unidos por tramos (verde si la fase está aprobada)."""
    ancho = max(int(ancho), 10)
    lineas: list[Text] = []
    actual = Text.assemble(("FASES ", f"bold {DIM}"))
    for i, f in enumerate(fases):
        sim, col = NODO.get(f.estado, NODO["pendiente"])
        if f.estado == "esperando" and frame % 2:
            col = AMBER
        nodo = Text.assemble((sim + " ", f"bold {col}"), (limpiar(f.nombre), f"bold {TEXTO}" if f.estado in ("activa", "esperando") else DIM),
                             (f" {f.hechas}/{f.total}", col))
        if f.estado == "esperando":
            nodo.append(" espera tu aprobación", style=f"bold {ROJO}")
        union = Text("━━ " if f.estado != "pendiente" and i else "── ", style=OK if i and fases[i - 1].estado == "aprobada" else BORDE) if i else Text("")
        if i and actual.cell_len + 1 + union.cell_len + nodo.cell_len > ancho:
            lineas.append(actual)
            actual = Text("      ")
            union = Text("")
        actual = Text.assemble(actual, " " if i else "", union, nodo)
    lineas.append(actual)
    t = Text("\n").join(ajustar(l, ancho) for l in lineas)
    t.no_wrap, t.overflow = True, "ellipsis"
    return t


def disenar(cards: list[Card], ancho_card: int = 26, hueco: int = 9, alto_card: int = 5,
            seleccion: str | None = None, compacto: bool = False, plegar_vacias: bool = True):
    """Devuelve (Grid, posiciones) con tarjetas y cables ya dibujados."""
    if compacto:
        ancho_card, hueco, alto_card = 22, 6, 4
    por_col: dict[int, list[Card]] = {i: [] for i in range(len(COLUMNAS))}
    for c in cards:
        por_col[c.col].append(c)
    por_id = {c.id: c for c in cards}
    filas = max((len(v) for v in por_col.values()), default=0)
    aleyas = max(1, len([c for c in cards for d in c.deps]))  # una fila de «aleya» por cable
    plegada = [plegar_vacias and not por_col[i] and COLUMNAS[i] != "En curso" for i in range(len(COLUMNAS))]
    xs, x = [], 0
    for i in range(len(COLUMNAS)):
        xs.append(x)
        x += (COLAPSADA if plegada[i] else ancho_card) + hueco
    w = x - hueco
    top = 2
    h = top + filas * (alto_card + 1) + aleyas + 1
    g = Grid(w, h)
    g.xs, g.ancho_card, g.alto_card = xs, ancho_card, alto_card
    pos: dict[str, tuple[int, int]] = {}
    bloq = bloqueos(cards)
    conectadas = {c.id for c in cards if any(d in por_id for d in c.deps)} | {d for c in cards for d in c.deps if d in por_id}

    for i, nombre in enumerate(COLUMNAS):
        x = xs[i]
        color = color_estado(nombre)
        if plegada[i]:
            g.text(x, 0, f"{nombre[0]} 0", DIM)
            g.text(x, 1, "─" * COLAPSADA, BORDE)
            continue
        _titulo_columna(g, x, ancho_card, nombre, len(por_col[i]), color)
        for j, c in enumerate(por_col[i]):
            y = top + j * (alto_card + 1)
            pos[c.id] = (x, y)
            _caja(g, x, y, ancho_card, alto_card, c, c.id == seleccion, bloq.get(c.id, []), c.id in conectadas)

    base = top + filas * (alto_card + 1)
    n = 0
    for c in cards:
        for dep in c.deps:
            if dep not in pos or c.id not in pos:
                continue
            estilo = BORDE if por_id[dep].status.lower() == "hecho" else IRIS
            a, b = (c.id, dep) if c.col <= por_id[dep].col else (dep, c.id)
            (xa, ya), (xb, yb) = pos[a], pos[b]
            y1, y2 = ya + alto_card // 2, yb + alto_card // 2
            if xa == xb:  # misma columna: conexión vertical por el lado izquierdo
                carril = xa - 2 - (n % 2)
                n += 1
                g.path([(xa - 1, y1), (carril, y1), (carril, y2), (xb - 1, y2)], estilo)
                continue
            x1, x2 = xa + ancho_card, xb - 1
            alley = base + n
            n += 1
            g1 = x1 + 1 + (n % 3)           # carril vertical a la salida
            g2 = x2 - 1 - (n % 3)           # carril vertical a la entrada
            g.path([(x1, y1), (g1, y1), (g1, alley), (g2, alley), (g2, y2), (x2, y2)], estilo)
    return g, pos


def _titulo_columna(g: Grid, x: int, w: int, nombre: str, n: int, color: str) -> None:
    chip = f" {nombre.upper()} "
    g.text(x, 0, chip, f"bold {FONDO} on {color}")
    g.text(x + len(chip), 0, f" {n} ", f"bold {color} on {PISTA}")
    for k in range(w):
        g.text(x + k, 1, "━", mezcla([color, BORDE, FONDO], k / max(w - 1, 1)))


def _caja(g: Grid, x: int, y: int, w: int, h: int, c: Card, sel: bool = False,
          bloqueada_por: list[str] | None = None, puertos: bool = False) -> None:
    color = color_estado(c.status)
    hecha = c.status.lower() == "hecho"
    fondo = SEL_FONDO if sel else PANEL
    en = f" on {fondo}"
    if sel:
        borde, tl, tr, bl, br, hz, vt = SEL, "╔", "╗", "╚", "╝", "═", "║"
    else:
        borde = mezcla([color, PANEL], 0.25 if c.status.lower() in ("en curso", "verificando") else 0.55)
        tl, tr, bl, br, hz, vt = "╭", "╮", "╰", "╯", "─", "│"
    bst = f"bold {borde}{en}" if sel else borde + en
    g.rellenar(x, y, w, h, en.strip())
    g.text(x, y, tl + hz * (w - 2) + tr, bst)
    g.text(x, y + h - 1, bl + hz * (w - 2) + br, bst)
    for k in range(1, h - 1):
        g.text(x, y + k, vt, bst)
        g.text(x + w - 1, y + k, vt, bst)

    # borde superior: [giro] ID ······ modelo
    xi = x + 2
    if c.status.lower() == "en curso":
        g.text(xi, y, " ", bst)
        g.anim.append((xi + 1, y, [(s, f"bold {AMBER}{en}") for s in GIROS]))
        g.text(xi + 1, y, GIROS[0], f"bold {AMBER}{en}")
        xi += 2
    ident = f" {recortar_celdas(limpiar(c.id), w - 10)} "
    g.text(xi, y, ident, f"bold {color}{en}")
    if c.model:
        modelo = limpiar(c.model).capitalize()
        hueco = x + w - 1 - (xi + cell_len(ident) + 1)
        etiqueta = f" ● {modelo} " if hueco >= cell_len(modelo) + 4 else f" {recortar_celdas(modelo, hueco - 2)} "
        if hueco >= 4:
            g.text(x + w - 1 - cell_len(etiqueta), y, etiqueta, f"bold {color_modelo(c.model)}{en}")

    titulo_st = f"bold {DIM if hecha else (BLANCO if sel else TEXTO)}{en}"
    g.text(x + 2, y + 1, recortar_celdas(limpiar(c.title) or "(sin título)", w - 4), titulo_st)

    fila_barra = y + h - 2
    if h >= 5:
        _etiquetas(g, x + 2, y + 2, w - 4, c, en)
    ancho_txt = 0
    if c.total:
        txt = f" {c.done}/{c.total}"
        ancho_txt = len(txt)
        largo = max(3, w - 4 - ancho_txt)
        for k, (ch, st) in enumerate(celdas_barra(100 * c.done / c.total, largo, CRITERIOS)):
            g.text(x + 2 + k, fila_barra, ch, st)
        g.text(x + 2 + largo, fila_barra, txt, f"bold {OK if c.done == c.total else TEXTO}{en}")
    else:
        g.text(x + 2, fila_barra, "sin criterios", DIM + en)

    _insignia(g, x, y + h - 1, w, c, bloqueada_por or [], h < 5, en, bst)
    if puertos:
        mid = y + h // 2
        g.text(x, mid, "◆" if sel else "○", IRIS + en)
        g.text(x + w - 1, mid, "◆" if sel else "○", IRIS + en)


def _etiquetas(g: Grid, x: int, y: int, ancho: int, c: Card, en: str) -> None:
    piezas: list[tuple[str, str]] = []
    if c.skill:
        piezas.append((f"⚑ {limpiar(c.skill)}", CIAN))
    piezas += [(f"#{limpiar(e)}", color_etiqueta(e)) for e in c.etiquetas]
    if not piezas and c.milestone:
        piezas.append((f"hito: {limpiar(c.milestone)}", DIM))
    usado = 0
    for i, (txt, col) in enumerate(piezas):
        resto = len(piezas) - i - 1
        sep = 1 if usado else 0
        disponible = ancho - usado - sep - (4 if resto else 0)
        if disponible < 3:
            g.text(x + usado, y, recortar_celdas(f" +{len(piezas) - i}", ancho - usado), DIM + en)
            return
        s = recortar_celdas(txt, disponible)
        g.text(x + usado + sep, y, s, col + en)
        usado += sep + cell_len(s)


def _insignia(g: Grid, x: int, y: int, w: int, c: Card, bloqueada_por: list[str], compacto: bool, en: str, bst: str) -> None:
    """Aviso incrustado en el borde inferior: aprobación pendiente, bloqueo o revisión."""
    maximo = w - 4
    if c.espera_aprobacion:
        txt = " ◎ aprobar (a) " if compacto else " ◎ espera aprobación "
        txt = recortar_celdas(txt, maximo)
        fotos = [(txt, f"bold {FONDO} on {AMBER}"), (txt, f"bold {BLANCO} on #8A5A12")]
        g.text(x + 2, y, *fotos[0])
        g.anim.append((x + 2, y, fotos))
    elif bloqueada_por:
        txt = " ⊘ bloqueada " if compacto else f" ⊘ bloqueada: {limpiar(bloqueada_por[0])}" + \
            (f" +{len(bloqueada_por) - 1} " if len(bloqueada_por) > 1 else " ")
        g.text(x + 2, y, recortar_celdas(txt, maximo), f"bold {ROJO}{en}")
    elif c.status.lower() == "hecho":
        g.text(x + 2, y, " ✓ hecha ", f"{OK}{en}")
    elif c.revisada:
        g.text(x + 2, y, " ✔ revisada ", f"bold {OK}{en}")
