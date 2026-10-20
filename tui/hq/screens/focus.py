"""Pantalla «Foco»: lo accionable arriba, luego tarea activa, fases, sesión y coste, actividad y cambios. Estilo HUD."""
from __future__ import annotations

from itertools import zip_longest
from pathlib import Path

from rich.cells import cell_len
from rich.text import Text
from textual.app import ComposeResult
from textual.binding import Binding
from textual.containers import VerticalScroll
from textual.screen import Screen
from textual.widgets import Static
from textual.worker import get_current_worker

from .. import focus
from ..canvas import AMBER, DIM, IRIS, MODELO_COLOR, OK
from ..textos import limpiar
from .stats import ONDAS, tendencia

FONDO, PANEL, BORDE, PISTA = "#0B0E1A", "#141A2E", "#3B4360", "#232A42"
TEXTO, ROJO, CIAN, BLANCO = "#E6E9F5", "#FF6B6B", "#5ED3C2", "#FFFFFF"
USO = [OK, AMBER, ROJO]  # verde al empezar, rojo al acercarse al límite
GASTO = ["#3B5BFF", "#6EA8FF", "#C58BFF"]
CRITERIOS = [IRIS, OK]
CABECERA = ["#3A2F7A", "#1B2140", FONDO]
ALIADOS = [IRIS, CIAN, AMBER, "#C58BFF", "#6EA8FF"]
GIROS = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"
PARCIAL = " ▏▎▍▌▋▊▉"
NODO = {"aprobada": ("●", OK), "activa": ("◉", AMBER), "esperando": ("◎", ROJO), "pendiente": ("○", DIM)}
GIT_COLOR = {"M": AMBER, "A": OK, "D": ROJO, "R": IRIS, "??": CIAN}
ESTADO_CORTO = {"Planificado": "Plan", "En curso": "Curso", "Verificando": "Verif", "Hecho": "Hecho", "Otros": "Otros"}
ESTADO_COLOR = {"Planificado": DIM, "En curso": AMBER, "Verificando": IRIS, "Hecho": OK, "Otros": DIM}
COMPACTO, DOS_COLUMNAS, MINIMO = 46, 100, 24
ETIQUETAS_LARGAS = 44
MAX_LISTA = 8
PARADO_MIN = 10


def _rgb(c: str) -> tuple[int, int, int]:
    return tuple(int(c[i:i + 2], 16) for i in (1, 3, 5))


def mezcla(paradas: list[str], x: float) -> str:
    """Color en la posición x (0..1) de un degradado truecolor."""
    x = min(max(x, 0.0), 1.0) * (len(paradas) - 1)
    i = min(int(x), len(paradas) - 2)
    a, b = _rgb(paradas[i]), _rgb(paradas[i + 1])
    return "#" + "".join(f"{round(a[k] + (b[k] - a[k]) * (x - i)):02X}" for k in range(3))


def barra(pct, ancho: int, paradas: list[str], brillo: int | None = None) -> Text:
    """Barra de HUD con degradado por celda, octavos de bloque y un destello opcional."""
    pct = min(max(pct or 0, 0), 100)
    celdas = pct / 100 * ancho
    llenas, resto = int(celdas), int((celdas - int(celdas)) * 8)
    t = Text()
    for i in range(ancho):
        c = mezcla(paradas, i / max(ancho - 1, 1))
        if i < llenas:
            t.append("█", style=mezcla([c, BLANCO], 0.5) if i == brillo else c)
        elif i == llenas and resto:
            t.append(PARCIAL[resto], style=f"{c} on {PISTA}")
        else:
            t.append(" ", style=f"on {PISTA}")
    return t


def _linea(*partes) -> Text:
    return Text.assemble(*partes, style=f"{TEXTO} on {PANEL}")


def _ajustar(t: Text, n: int) -> Text:
    t = t.copy()
    t.truncate(n, overflow="ellipsis", pad=True)
    return t


def _vacia(n: int) -> Text:
    return Text(" " * n, style=f"on {FONDO}")


def _k(n) -> str:
    n = n or 0
    return f"{n / 1e6:.1f}M" if n >= 1e6 else f"{n / 1e3:.1f}k" if n >= 1e3 else str(n)


def _duracion(m: int | None) -> str:
    if m is None:
        return ""
    return f"{m} min" if m < 60 else f"{m // 60} h {m % 60:02d} min"


def _color_uso(pct, aviso: float, limite: float = 100) -> str:
    pct = pct or 0
    return ROJO if pct >= limite else AMBER if pct >= aviso else OK


def _cabe(opciones: list[str], ancho: int) -> str:
    return next((o for o in opciones if cell_len(o) <= ancho), opciones[-1])


def _panel(titulo: str, color: str, cuerpo: list[Text], ancho: int, compacto: bool) -> list[Text]:
    if compacto:
        cab = Text.assemble((f" {titulo} ", f"bold {FONDO} on {color}"), style=f"{color} on {PISTA}")
        return [_ajustar(cab, ancho)] + [_ajustar(Text.assemble(" ", l, style=f"on {PANEL}"), ancho) for l in cuerpo]
    marco = f"{BORDE} on {PANEL}"
    tit = Text(f" {titulo} ", style=f"bold {color} on {PANEL}")
    tit.truncate(ancho - 4, overflow="ellipsis")
    out = [Text.assemble(("╭─", marco), tit, ("─" * (ancho - 3 - tit.cell_len) + "╮", marco))]
    for l in cuerpo:
        out.append(Text.assemble(("│ ", marco), _ajustar(l, ancho - 4), (" │", marco)))
    out.append(Text("╰" + "─" * (ancho - 2) + "╯", style=marco))
    return out


def _modelo(f: focus.Foco) -> str:
    s = f.sesion
    return limpiar(s.model_name or s.model) if s else ""


def _cabecera(f: focus.Foco, nombre: str, ancho: int, compacto: bool) -> Text:
    izq = f" ◆ {limpiar(nombre).upper()}"
    modelo = _modelo(f)
    partes = [modelo] if compacto else [modelo, _duracion(f.minutos)]
    der = " · ".join(p for p in partes if p)
    der = f"{der} " if der else ""
    hueco = ancho - cell_len(izq) - cell_len(der)
    if hueco < 1:
        der, hueco = "", 1
    t = _ajustar(Text.assemble((izq, f"bold {BLANCO}"), " " * hueco, (der, f"bold {AMBER}")), ancho)
    for i in range(len(t.plain)):
        t.stylize(f"on {mezcla(CABECERA, i / max(ancho - 1, 1))}", i, i + 1)
    return t


def _alerta(texto: str, ancho: int, estilo: str) -> Text:
    izq = max((ancho - cell_len(texto)) // 2, 0)
    return _ajustar(Text(" " * izq + texto, style=estilo), ancho)


def _mas(n: int) -> Text:
    return _linea((f"… y {n} más", DIM))


def _pct_dia(f: focus.Foco, res):
    if res is not None and res.dia.pct is not None:
        return res.dia.pct
    return f.sesion.dia_pct if f.sesion else None


def _pct_tarjeta(f: focus.Foco):
    s, k = f.sesion, f.tarjeta
    if s is None or k is None or s.tarjeta_pct is None or s.tarjeta_id.lower() != k.id.lower():
        return None
    return s.tarjeta_pct


def _coste_tarjeta(f: focus.Foco, res) -> float | None:
    if res is None or f.tarjeta is None or not f.slug:
        return None
    vals = [v for s, c, v in res.por_tarjeta if s == f.slug and c and c.lower() == f.tarjeta.id.lower()]
    return sum(vals) if vals else None


def _siguiente(f: focus.Foco, w: int, compacto: bool, frame: int):
    cuerpo = [_linea((f" ► {limpiar(f.siguiente) or '—'} ", f"bold {FONDO} on {CIAN}"))]
    if f.claude_espera:
        cuerpo.append(_linea(("● ", f"bold {AMBER}"), ("Claude terminó el turno: te toca" if not compacto else "te toca a ti", TEXTO)))
    elif f.ultima_hora and (f.parado_min or 0) >= PARADO_MIN:
        cuerpo.append(_linea(("○ ", f"bold {DIM}"), (f"sin actividad desde {limpiar(f.ultima_hora)}", DIM)))
    elif f.ultima_hora:
        cuerpo.append(_linea((GIROS[frame % len(GIROS)] + " ", f"bold {CIAN}"),
                             ("Claude trabajando" if not compacto else "trabajando", TEXTO),
                             (f" · último evento {limpiar(f.ultima_hora)}" if not compacto else f" {limpiar(f.ultima_hora)}", DIM)))
    return "SIGUIENTE ACCIÓN", CIAN, cuerpo


def _tarea(f: focus.Foco, w: int, compacto: bool):
    k = f.tarjeta
    cuerpo: list[Text] = []
    if k is None:
        return "TAREA ACTIVA", AMBER, [_linea(("Sin tarjeta en curso", DIM))]
    cuerpo.append(_linea((limpiar(k.title), f"bold {TEXTO}")))
    items = k.criteria_items
    if items:
        hechos = sum(1 for *_, h in items if h)
        sufijo = f" {hechos}/{len(items)} criterios"
        cuerpo.append(_linea(barra(100 * hechos / len(items), max(4, min(16, w - len(sufijo))), CRITERIOS),
                             (sufijo, OK if hechos == len(items) else DIM)))
        limite = 4 if compacto else MAX_LISTA
        orden = [i for i, it in enumerate(items) if not it[2]] + [i for i, it in enumerate(items) if it[2]]
        for i in sorted(orden[:limite]):
            _, texto, hecho = items[i]
            if hecho:
                cuerpo.append(_linea(("✓ ", f"bold {OK}"), (limpiar(texto), f"strike {DIM}")))
            else:
                cuerpo.append(_linea(("◇ ", f"bold {AMBER}"), (limpiar(texto), TEXTO)))
        if len(items) > limite:
            cuerpo.append(_mas(len(items) - limite))
    else:
        cuerpo.append(_linea(("sin criterios de aceptación", DIM)))
    if k.dependencies:
        cuerpo.append(_linea(("Depende de: ", DIM), (", ".join(limpiar(d) for d in k.dependencies), TEXTO)))
    return f"TAREA ACTIVA · {limpiar(k.id)}", AMBER, cuerpo


def _fila_barra(etiqueta: str, valor, paradas, sufijo: str, color: str, w: int,
                estilo_etiqueta: str = "", brillo_frame: int | None = None) -> Text:
    largo = max(4, w - cell_len(etiqueta) - cell_len(sufijo))
    brillo = None if brillo_frame is None else brillo_frame % largo
    return _linea((etiqueta, estilo_etiqueta or f"bold {color}"), barra(valor, largo, paradas, brillo), (sufijo, f"bold {color}"))


def _sesion(f: focus.Foco, w: int, compacto: bool, frame: int, gam, res):
    s = f.sesion
    largas = w >= ETIQUETAS_LARGAS
    medias = w >= 30

    def eti(larga: str, media: str, corta: str) -> str:
        return f"{larga:<14}" if largas else f"{media:<9}" if medias else f"{corta} "

    cuerpo: list[Text] = []
    if s and s.ctx_pct is not None:
        ctx = min(max(s.ctx_pct, 0), 100)
        color = _color_uso(ctx, 50, focus.CTX_AVISO)
        alerta = ctx >= focus.CTX_AVISO
        estilo = f"bold {BLANCO} on {ROJO}" if alerta and frame % 2 == 0 else f"bold {color}"
        cuerpo.append(_fila_barra(eti("CONTEXTO", "CONTEXTO", "CTX"), ctx, USO, f" {ctx:.0f}%" + (" usado" if largas else ""), color, w, estilo))
    else:
        cuerpo.append(_linea((eti("CONTEXTO", "CONTEXTO", "CTX"), f"bold {DIM}"), ("sin sesión", DIM)))
    dia = _pct_dia(f, res)
    if dia is not None:
        cuerpo.append(_fila_barra(eti("PRESUP. DÍA", "PRES.DÍA", "DÍA"), dia, USO, f" {dia:.0f}%" + (" gastado" if largas else ""),
                                  _color_uso(dia, 80), w))
    elif largas:
        cuerpo.append(_linea((eti("PRESUP. DÍA", "PRES.DÍA", "DÍA"), f"bold {DIM}"), ("sin presupuesto configurado", DIM)))
    tar = _pct_tarjeta(f)
    if tar is not None:
        cuerpo.append(_fila_barra(eti("PRESUP. TARJ.", "PRES.TAR", "TAR"), tar, USO, f" {tar:.0f}%" + (" gastado" if largas else ""),
                                  _color_uso(tar, 80), w))
    et_coste = eti("COSTE", "COSTE", "$")
    coste: list = []
    if s and s.cost is not None:
        coste.append((f"sesión ${s.cost:.2f}" if medias else f"ses ${s.cost:.2f}", f"bold {AMBER}"))
    ct = _coste_tarjeta(f, res)
    if ct is not None:
        coste.append((f" · tarjeta ${ct:.2f}" if medias else f" · tar ${ct:.2f}", TEXTO))
    if res is not None:
        hoy = f" · hoy ${res.hoy_usd:.2f}"
        largo = cell_len(et_coste) + sum(cell_len(x) for x, _ in coste) + cell_len(hoy)
        coste.append((hoy + (" (todos)" if largo + 8 <= w else ""), TEXTO))
    if coste:
        cuerpo.append(_linea((et_coste, f"bold {AMBER}"), *coste))
    if s and (s.tokens_in is not None or s.tokens_out is not None):
        cuerpo.append(_linea((eti("TOKENS", "TOKENS", "TOK"), f"bold {IRIS}"),
                             (f"entrada {_k(s.tokens_in)} · salida {_k(s.tokens_out)}" if largas
                              else f"↓{_k(s.tokens_in)} ↑{_k(s.tokens_out)}", TEXTO)))
    if res is not None and largas:
        hueco = w - 14 - 18
        if hueco >= 7:
            onda = tendencia([v for _, v in res.tendencia][-min(14, hueco):])
            fila = _linea((eti("GASTO 14 DÍAS", "", ""), f"bold {DIM}"))
            for i, c in enumerate(onda):
                fila.append(c, style=mezcla(GASTO, i / max(len(onda) - 1, 1)))
            fila.append(f"  máx ${max((v for _, v in res.tendencia), default=0):.2f}/día", DIM)
            cuerpo.append(fila)
    modelo = _modelo(f)
    dur = _duracion(f.minutos)
    titulo = " · ".join(x for x in ("SESIÓN", modelo, dur) if x)
    color = next((c for m, c in MODELO_COLOR.items() if m in modelo.lower()), IRIS)
    return titulo, color, cuerpo


def _fases(f: focus.Foco, fases, w: int, compacto: bool, frame: int):
    cuerpo: list[Text] = []
    titulo = "FASES Y TARJETAS"
    if fases:
        n = len(fases)
        tramo = min(6, max(1, (w - n) // (n - 1))) if n > 1 else 0
        camino = _linea()
        for i, x in enumerate(fases):
            sim, col = NODO.get(x.estado, NODO["pendiente"])
            if x.estado == "esperando" and frame % 2:
                col = AMBER
            camino.append(sim, style=f"bold {col}")
            if i < n - 1:
                hecho = x.estado == "aprobada"
                camino.append(("━" if hecho else "─") * tramo, style=OK if hecho else BORDE)
        cuerpo.append(camino)
        i_act = next((i for i, x in enumerate(fases) if x.estado in ("activa", "esperando")), None)
        if i_act is None:
            todas = all(x.estado == "aprobada" for x in fases)
            cuerpo.append(_linea(("Todas las fases aprobadas" if todas else "Sin fase activa", f"bold {OK}" if todas else DIM)))
        else:
            x = fases[i_act]
            titulo = f"FASE {i_act + 1}/{n} · {limpiar(x.nombre)}"
            cuerpo.append(_linea((f"Fase {i_act + 1} de {n}: ", DIM), (limpiar(x.nombre), f"bold {AMBER}"),
                                 (f" · {x.hechas}/{x.total} hechas", f"bold {TEXTO}")))
            if x.estado == "esperando":
                cuerpo.append(_linea(("◎ ", f"bold {ROJO}"), ("Completa: espera tu aprobación", f"bold {ROJO}")))
            elif f.pendientes_fase:
                ids = [limpiar(i) for i in f.pendientes_fase]
                cuerpo.append(_linea(("Faltan para cerrarla: ", DIM), (", ".join(ids), TEXTO)))
    elif f.fase:
        cuerpo.append(_linea(("Fase: ", DIM), (limpiar(f.fase), f"bold {TEXTO}")))
    if f.conteo:
        fila = _linea(("Tarjetas " if not compacto else "", DIM))
        for i, (k, v) in enumerate(c for c in f.conteo.items() if c[0] != "Otros" or c[1]):
            nombre = ESTADO_CORTO.get(k, "Otros") if compacto or w < 60 else k
            fila.append((" · " if i else ""), DIM)
            fila.append(f"{nombre} ", ESTADO_COLOR.get(k, DIM))
            fila.append(str(v), f"bold {TEXTO}")
        cuerpo.append(fila)
    limite = 2 if compacto else 4
    for tid, deps in f.bloqueadas[:limite]:
        cuerpo.append(_linea(("⊘ ", f"bold {ROJO}"), (limpiar(tid), f"bold {TEXTO}"),
                             (" bloqueada por ", DIM), (", ".join(limpiar(d) for d in deps), TEXTO)))
    if len(f.bloqueadas) > limite:
        cuerpo.append(_mas(len(f.bloqueadas) - limite))
    if not cuerpo:
        return None
    return titulo, AMBER, cuerpo


def _subagentes(f: focus.Foco, w: int, compacto: bool, frame: int):
    aliados = [limpiar(a) or "?" for a in f.subagentes]
    if not aliados:
        return "SUBAGENTES EN MARCHA", CIAN, [_linea(("ninguno", DIM))]
    limite = 3 if compacto else 5
    cuerpo = []
    for i, a in enumerate(aliados[:limite]):
        c = ALIADOS[i % len(ALIADOS)]
        ondas = "" if compacto else "".join(ONDAS[(frame * 3 + j * 5 + i) % len(ONDAS)] for j in range(4))
        nombre = Text(a, style=f"bold {c}")
        nombre.truncate(max(4, w - 18), overflow="ellipsis")
        cuerpo.append(_linea((GIROS[(frame + i * 3) % len(GIROS)] + " ", f"bold {c}"), nombre,
                             (f"  {ondas}" if ondas else "", c), ("" if compacto else " trabajando", DIM)))
    if len(aliados) > limite:
        cuerpo.append(_mas(len(aliados) - limite))
    return f"SUBAGENTES EN MARCHA · {len(aliados)}", CIAN, cuerpo


def _actividad(f: focus.Foco, compacto: bool):
    cuerpo = []
    for hora, texto in f.fallos[-(1 if compacto else 3):]:
        cuerpo.append(_linea(("✗ ", f"bold {ROJO}"), (f"{limpiar(hora)} ", DIM), (limpiar(texto), ROJO)))
    for hora, texto in f.actividad[-(2 if compacto else 4):]:
        cuerpo.append(_linea(("· ", DIM), (f"{limpiar(hora)} ", DIM), (limpiar(texto), TEXTO)))
    if not cuerpo:
        cuerpo.append(_linea(("sin actividad registrada", DIM)))
    n = len(f.fallos)
    if n:
        return f"ACTIVIDAD RECIENTE · {n} fallo{'s' if n > 1 else ''}", ROJO, cuerpo
    return "ACTIVIDAD RECIENTE", IRIS, cuerpo


def _archivos(f: focus.Foco, compacto: bool):
    archivos = [limpiar(a) for a in f.archivos][::-1]
    if not archivos:
        return "ARCHIVOS EDITADOS POR CLAUDE", AMBER, [_linea(("ninguno en esta sesión", DIM))]
    limite = 3 if compacto else MAX_LISTA
    cuerpo = []
    for a in archivos[:limite]:
        ruta = a.replace("\\", "/")
        nombre = ruta.rsplit("/", 1)[-1] or ruta
        carpeta = ruta[: len(ruta) - len(nombre)].rstrip("/")
        cuerpo.append(_linea(("◆ ", AMBER), (nombre, f"bold {TEXTO}"), (f"  {carpeta}" if carpeta else "", DIM)))
    if len(archivos) > limite:
        cuerpo.append(_mas(len(archivos) - limite))
    return f"ARCHIVOS EDITADOS POR CLAUDE · {len(archivos)}", AMBER, cuerpo


def _git(f: focus.Foco, compacto: bool):
    rama = f" · rama {limpiar(f.rama)}" if f.rama else ""
    if f.git is None:
        return "CAMBIOS SIN COMMIT", DIM, [_linea(("git no disponible", DIM))]
    if not f.git:
        return f"CAMBIOS SIN COMMIT · 0{rama}", OK, [_linea(("✓ ", f"bold {OK}"), ("todo commiteado", DIM))]
    limite = 4 if compacto else MAX_LISTA
    cuerpo = []
    for ln in f.git[:limite]:
        ln = limpiar(ln)
        codigo, _, ruta = ln.partition(" ")
        if not ruta:
            codigo, ruta = "", ln
        color = GIT_COLOR.get(codigo, GIT_COLOR.get(codigo[:1], DIM))
        cuerpo.append(_linea((f" {codigo[:2]:<2} ", f"bold {FONDO} on {color}"), (f" {ruta}", TEXTO)))
    if len(f.git) > limite:
        cuerpo.append(_mas(len(f.git) - limite))
    return f"CAMBIOS SIN COMMIT · {len(f.git)}{rama}", AMBER, cuerpo


def _vitales(f: focus.Foco, ancho: int, res) -> Text:
    """Una sola línea con lo esencial, para cuando el panel es tan bajo que el contexto quedaría fuera."""
    t = Text(style=f"{TEXTO} on {PISTA}")
    s = f.sesion
    if s and s.ctx_pct is not None:
        ctx = min(max(s.ctx_pct, 0), 100)
        color = _color_uso(ctx, 50, focus.CTX_AVISO)
        t.append(" CTX ", style=f"bold {color}")
        t.append_text(barra(ctx, 6, USO))
        t.append(f" {ctx:.0f}%", style=f"bold {color}")
    dia = _pct_dia(f, res)
    if dia is not None:
        t.append(f"  DÍA {dia:.0f}%", style=f"bold {_color_uso(dia, 80)}")
    k = f.tarjeta
    if k is not None and k.criteria_items:
        hechos = sum(1 for *_, h in k.criteria_items if h)
        t.append(f"  CRIT {hechos}/{len(k.criteria_items)}", style=f"bold {AMBER}")
    if f.siguiente:
        t.append(f"  ► {limpiar(f.siguiente)}", style=f"bold {CIAN}")
    return _ajustar(t, ancho)


def render(f: focus.Foco, nombre: str, ancho: int = 80, frame: int = 0, fases=None, gam=None, res=None,
           alto: int | None = None) -> Text:
    """HUD completo en un Text de líneas de `ancho` celdas exactas. Puro: no lee ficheros.
    Con `alto` y si el HUD no cabe, se añade bajo la cabecera una tira con contexto, presupuesto, criterios y siguiente acción."""
    ancho = max(int(ancho), MINIMO)
    compacto = ancho < COMPACTO
    fases = fases if fases is not None else f.fases
    lineas = [_cabecera(f, nombre, ancho, compacto)]
    if f.espera_aprobacion:
        texto = _cabe(["⚠ ESPERA TU APROBACIÓN · fase completa → «a» en el tablero ⚠", "⚠ ESPERA TU APROBACIÓN", "ESPERA TU APROBACIÓN"], ancho)
        lineas.append(_alerta(texto, ancho, f"bold {FONDO} on {AMBER}" if frame % 2 == 0 else f"bold {BLANCO} on {ROJO}"))
    s = f.sesion
    if s and s.ctx_pct is not None and s.ctx_pct >= focus.CTX_AVISO:
        c = f"{min(s.ctx_pct, 100):.0f}%"
        texto = _cabe([f"⚠ CONTEXTO ALTO ({c}) → /guardar y /clear", f"⚠ CTX {c} → /guardar y /clear", "/guardar y /clear"], ancho)
        lineas.append(_alerta(texto, ancho, f"bold {BLANCO} on {ROJO}" if frame % 2 == 0 else f"bold {BLANCO} on #8A1F35"))
    dia = _pct_dia(f, res)
    if dia is not None and dia >= 100:
        lineas.append(_alerta(_cabe([f"⚠ PRESUPUESTO DEL DÍA SUPERADO ({dia:.0f}%)", f"⚠ PRESUPUESTO {dia:.0f}%"], ancho),
                              ancho, f"bold {BLANCO} on #8A1F35"))

    def bloques(fns, w: int) -> list[Text]:
        out: list[Text] = []
        interior = w - 1 if compacto else w - 4
        for fn in fns:
            b = fn(interior)
            if b:
                out += _panel(*b, w, compacto)
        return out

    siguiente = lambda w: _siguiente(f, w, compacto, frame)  # noqa: E731
    tarea = lambda w: _tarea(f, w, compacto)  # noqa: E731
    sesion = lambda w: _sesion(f, w, compacto, frame, gam, res)  # noqa: E731
    fase = lambda w: _fases(f, fases, w, compacto, frame)  # noqa: E731
    subagentes = lambda w: _subagentes(f, w, compacto, frame)  # noqa: E731
    actividad = lambda w: _actividad(f, compacto)  # noqa: E731
    archivos = lambda w: _archivos(f, compacto)  # noqa: E731
    git = lambda w: _git(f, compacto)  # noqa: E731
    if ancho >= DOS_COLUMNAS:
        lineas += bloques([siguiente], ancho)
        wi = (ancho - 1) // 2
        wd = ancho - 1 - wi
        izq, der = bloques([tarea, fase, archivos, git], wi), bloques([sesion, subagentes, actividad], wd)
        for a, b in zip_longest(izq, der):
            lineas.append(Text.assemble(a or _vacia(wi), _vacia(1), b or _vacia(wd)))
    else:
        lineas += bloques([siguiente, tarea, sesion, fase, subagentes, actividad, archivos, git], ancho)
    if alto is not None and len(lineas) > alto:
        lineas.insert(1, _vitales(f, ancho, res))
    t = Text("\n").join(lineas)
    t.no_wrap, t.overflow = True, "crop"
    return t


def animado(f: focus.Foco | None) -> bool:
    if f is None:
        return False
    s = f.sesion
    return f.espera_aprobacion or bool(f.subagentes) or bool(s and s.ctx_pct is not None and s.ctx_pct >= focus.CTX_AVISO)


class FocusScreen(Screen):
    DEFAULT_CSS = f"""
    FocusScreen {{ background: {FONDO}; }}
    FocusScreen VerticalScroll {{ background: {FONDO}; scrollbar-size-vertical: 1; scrollbar-gutter: stable;
        scrollbar-background: {FONDO}; scrollbar-color: {BORDE}; }}
    #foco {{ padding: 0; background: {FONDO}; }}
    """
    BINDINGS = [Binding("r", "refrescar", "Refrescar"), Binding("q", "app.quit", "Salir")]

    def __init__(self, repo, slug: str, events_dir, state_dir=None, display: str | None = None, stats_loader=None) -> None:
        super().__init__()
        self.repo, self.slug, self.events_dir, self.state_dir = Path(repo), slug, events_dir, state_dir
        self.display_name = limpiar(display or slug)
        self.stats_loader = stats_loader
        self.foco: focus.Foco | None = None
        self.gam = self.res = None
        self.frame = 0
        self._latido = None

    def compose(self) -> ComposeResult:
        with VerticalScroll():
            yield Static(id="foco", markup=False)

    def on_mount(self) -> None:
        # El latido solo repinta desde la caché (sin E/S) y se pausa si no hay nada animado.
        self._latido = self.set_interval(0.5, self._tic, pause=True)
        self.refrescar()
        self.set_interval(2.0, self.refrescar)
        if self.stats_loader is not None:
            self._stats()
            self.set_interval(30.0, self._stats)

    def on_resize(self, event) -> None:
        self.call_after_refresh(self._pintar)

    def action_refrescar(self) -> None:
        self.refrescar()

    def refrescar(self) -> None:
        self.foco = focus.cargar(self.repo, self.slug, self.events_dir, self.state_dir)
        if animado(self.foco):
            self._latido.resume()
        else:
            self._latido.pause()
        self._pintar()

    def _tic(self) -> None:
        self.frame += 1
        self._pintar()

    def _medidas(self) -> tuple[int, int | None]:
        region = self.query_one(VerticalScroll).scrollable_content_region
        ancho = region.width if region.width > 0 else max(self.size.width - 1, MINIMO)
        return ancho, (region.height or self.size.height or None)

    def _pintar(self) -> None:
        if self.foco is not None:
            ancho, alto = self._medidas()
            self.query_one("#foco", Static).update(
                render(self.foco, self.display_name, ancho, self.frame, None, self.gam, self.res, alto))

    # --- gasto y nivel: leen todo el historial, van en un hilo ---
    def _stats(self) -> None:
        self.run_worker(self._calcular_stats, thread=True, group="stats-foco", exclusive=True)

    def _calcular_stats(self) -> None:
        worker = get_current_worker()
        try:
            datos = self.stats_loader()
        except Exception:
            datos = None
        if worker.is_cancelled:
            return
        try:
            self.app.call_from_thread(self._poner_stats, datos)
        except Exception:
            pass  # la aplicación ya se está cerrando

    def _poner_stats(self, datos) -> None:
        self.res, self.gam = datos if datos else (None, None)
        self._pintar()
