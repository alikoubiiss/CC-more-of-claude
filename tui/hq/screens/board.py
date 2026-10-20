"""Pantalla del tablero: lienzo Flujo, detalle y puertas humanas (a/m tarjeta, A/M fase)."""
from __future__ import annotations

import os
import textwrap
import time
from datetime import date, datetime, timezone
from itertools import zip_longest
from pathlib import Path

from rich.text import Text
from textual.app import ComposeResult
from textual.binding import Binding
from textual.containers import VerticalScroll
from textual.screen import Screen
from textual.widgets import Static
from textual.worker import get_current_worker

from .. import actions, focus, session
from .. import panel as envio  # `panel` ya es la función de dibujo de canvas
from ..canvas import (AMBER, BLANCO, BORDE, CIAN, COLUMNAS, CRITERIOS, DIM, FONDO, IRIS, OK, PANEL, PISTA, ROJO, TEXTO,
                      ajustar, barra, card_de_task, color_estado, color_etiqueta, color_modelo, degradado_fondo, SISTEMA,
                      franja_fases_texto, panel)
from ..fases import FasesError, active, derive, load_fases
from ..tasks import read_milestones, read_tasks
from ..textos import limpiar
from ..widgets import Lienzo
from .modales import Confirmar, EditarTarjeta, Enviando, Motivo

TECLAS = [("←↑↓→", "mover"), ("Enter", "detalle"), ("i", "iniciar"), ("E", "editar"), ("e", "ejecutar"), ("v", "revisar"), ("a", "aprobar"),
          ("m", "mejorar"), ("A", "aprobar fase"), ("M", "mejorar fase"), ("c", "compacto"),
          ("> <", "mover de columna"), ("r", "refrescar"), ("q", "salir"), ("Alt+Mayús+flechas", "tamaño de paneles")]
AYUDA = " · ".join(f"{k} {v}" for k, v in TECLAS)
DOS_COLUMNAS = 100
MAX_CRITERIOS, MAX_COMENTARIOS, MAX_DESCRIPCION = 6, 3, 3
POSCONDICION_S = 5.0  # tope para ver el `prompt` de la sesión del panel tras el Enter


def _ayuda_texto() -> Text:
    t = Text(no_wrap=True, overflow="ellipsis")
    for i, (k, v) in enumerate(TECLAS):
        t.append(" · " if i else " ", style=BORDE)
        t.append(k, style=f"bold {AMBER}")
        t.append(f" {v}", style=DIM)
    return t


def _linea(*partes) -> Text:
    return Text.assemble(*partes, style=f"{TEXTO} on {PANEL}")


def _envolver(texto: str, ancho: int, maximo: int) -> list[str]:
    lineas = textwrap.wrap(texto, max(ancho, 8)) or [""]
    if len(lineas) > maximo:
        lineas = lineas[:maximo]
        lineas[-1] = lineas[-1][: max(ancho - 1, 1)].rstrip() + "…"
    return lineas


def render_detalle(t, tareas, ancho: int, hito: str | None = None) -> Text:
    """Detalle de una tarjeta en paneles: resumen, criterios, dependencias y comentarios. Puro."""
    ancho = max(int(ancho), 24)
    por_id = {x.id.lower(): x for x in tareas}
    color = color_estado(t.status)
    hecha = t.status.lower() == "hecho"
    labels = [limpiar(x) for x in t.labels]
    modelo = next((x.split(":", 1)[1] for x in labels if x.startswith("modelo:")), "")
    skill = next((x.split(":", 1)[1] for x in labels if x.startswith("skill:")), "")
    propias = [x for x in labels if x != "revisada" and not x.startswith(SISTEMA)]

    def resumen(w: int):
        cuerpo = [_linea((limpiar(t.title) or "(sin título)", f"bold {BLANCO}"))]
        meta = _linea(("Estado ", DIM), (f" {limpiar(t.status) or '—'} ", f"bold {FONDO} on {color}"))
        if "revisada" in labels:
            meta.append("  ✔ revisada", style=f"bold {OK}")
        meta.append("  Modelo ", style=DIM)
        meta.append(modelo.capitalize() or "—", style=f"bold {color_modelo(modelo)}" if modelo else DIM)
        if skill:
            meta.append("  Skill ", style=DIM)
            meta.append(skill, style=CIAN)
        meta.append("  Hito ", style=DIM)
        meta.append(limpiar(hito or t.milestone) or "—", style=TEXTO)
        cuerpo.append(meta)
        if propias:
            et = _linea(("Etiquetas", DIM))
            for e in propias:
                et.append(f" #{e}", style=color_etiqueta(e))
            cuerpo.append(et)
        if t.description:
            cuerpo.append(_linea(("Descripción", f"bold {DIM}")))
            cuerpo += [_linea((l, TEXTO)) for l in _envolver(limpiar(t.description), w, MAX_DESCRIPCION)]
        return Text(f"{limpiar(t.id)} · {limpiar(t.status)}", style=f"bold {color}"), cuerpo

    def criterios(w: int):
        items = t.criteria_items
        if not items:
            return Text("Criterios de aceptación", style=f"bold {DIM}"), [_linea(("Sin criterios definidos", DIM))]
        hechos = sum(1 for *_, h in items if h)
        completo = hechos == len(items)
        sufijo = f" {hechos}/{len(items)} cumplidos"
        cuerpo = [_linea(barra(100 * hechos / len(items), max(4, min(24, w - len(sufijo))), CRITERIOS),
                         (sufijo, f"bold {OK if completo else TEXTO}"))]
        orden = [i for i, it in enumerate(items) if not it[2]] + [i for i, it in enumerate(items) if it[2]]
        for i in sorted(orden[:MAX_CRITERIOS]):
            _, texto, hecho = items[i]
            if hecho:
                cuerpo.append(_linea(("✓ ", f"bold {OK}"), (limpiar(texto), f"strike {DIM}")))
            else:
                cuerpo.append(_linea(("◇ ", f"bold {AMBER}"), (limpiar(texto), TEXTO)))
        if len(items) > MAX_CRITERIOS:
            cuerpo.append(_linea((f"… y {len(items) - MAX_CRITERIOS} más", DIM)))
        return Text(f"Criterios de aceptación · {hechos}/{len(items)}", style=f"bold {OK if completo else IRIS}"), cuerpo

    def relaciones(w: int):
        cuerpo, pend = [], 0
        for d in t.dependencies:
            dep = por_id.get(d.lower())
            if dep is None:
                cuerpo.append(_linea(("○ ", DIM), (limpiar(d), TEXTO), ("  no está en el tablero", DIM)))
            elif dep.status.lower() == "hecho":
                cuerpo.append(_linea(("✓ ", f"bold {OK}"), (limpiar(d), TEXTO), (f"  {limpiar(dep.title)}", DIM)))
            else:
                pend += 1
                cuerpo.append(_linea(("⊘ ", f"bold {ROJO}"), (limpiar(d), f"bold {TEXTO}"),
                                     (f"  {limpiar(dep.status)}", color_estado(dep.status)), (f"  {limpiar(dep.title)}", DIM)))
        if not cuerpo:
            cuerpo.append(_linea(("Sin dependencias", DIM)))
        if t.comments:
            cuerpo.append(_linea(("Comentarios", f"bold {DIM}"), (f" · {len(t.comments)}", DIM)))
            for autor, fecha, texto in t.comments[-MAX_COMENTARIOS:]:
                cuerpo.append(_linea(("▸ ", CIAN), (limpiar(autor), f"bold {CIAN}"), (f" {limpiar(fecha)} ", DIM), (limpiar(texto), TEXTO)))
        bloquea = pend and not hecha
        titulo = "Dependencias y comentarios" + (f" · bloqueada por {pend}" if bloquea else "")
        return Text(titulo, style=f"bold {ROJO if bloquea else CIAN}"), cuerpo

    def bloque(fn, w: int) -> list[Text]:
        titulo, cuerpo = fn(w - 4)
        return panel(titulo, "", cuerpo, w)

    lineas = bloque(resumen, ancho)
    if ancho >= DOS_COLUMNAS:
        wi = (ancho - 1) // 2
        wd = ancho - 1 - wi
        vacia = lambda n: Text(" " * n, style=f"on {FONDO}")  # noqa: E731
        for a, b in zip_longest(bloque(criterios, wi), bloque(relaciones, wd)):
            lineas.append(Text.assemble(a or vacia(wi), vacia(1), b or vacia(wd)))
    else:
        lineas += bloque(criterios, ancho) + bloque(relaciones, ancho)
    x = Text("\n").join(lineas)
    x.no_wrap, x.overflow = True, "crop"
    return x


def _firma(repo: Path) -> tuple:
    """Marca barata de cambios: mtimes de tarjetas, hitos y fases."""
    out = []
    for sub in ("backlog/tasks", "backlog/milestones"):
        try:
            with os.scandir(repo / sub) as it:
                out.extend((e.name, e.stat().st_mtime_ns) for e in it)
        except OSError:
            out.append((sub, None))
    try:
        out.append(("fases", (repo / ".hq" / "fases.json").stat().st_mtime_ns))
    except OSError:
        out.append(("fases", None))
    return tuple(sorted(out, key=str))


class BoardScreen(Screen):
    DEFAULT_CSS = f"""
    BoardScreen {{ background: {FONDO}; }}
    BoardScreen #cabecera {{ height: 1; padding: 0; background: {FONDO}; }}
    BoardScreen #progreso {{ height: 1; padding: 0 1; background: {FONDO}; }}
    BoardScreen #franja {{ height: auto; padding: 0 1; background: {FONDO}; }}
    BoardScreen #detalle {{ height: auto; max-height: 50%; padding: 0 1; display: none; background: {FONDO};
        scrollbar-size-vertical: 1; scrollbar-background: {FONDO}; scrollbar-color: {BORDE}; }}
    BoardScreen #detalle-texto {{ height: auto; background: {FONDO}; }}
    BoardScreen #estado {{ height: 1; padding: 0; background: {PISTA}; color: {TEXTO}; }}
    """
    BINDINGS = [
        Binding("enter", "detalle", "Detalle"),
        Binding("a", "aprobar_tarjeta", "Aprobar"),
        Binding("m", "mejorar_tarjeta", "Mejorar"),
        Binding("A", "aprobar_fase", "Aprobar fase"),
        Binding("M", "mejorar_fase", "Mejorar fase"),
        Binding("c", "compacto", "Compacto"),
        Binding("r", "refrescar", "Refrescar"),
        Binding("question_mark", "ayuda", "Ayuda"),
        Binding("greater_than_sign", "mover_col(1)", "Mover →"),
        Binding("less_than_sign", "mover_col(-1)", "Mover ←"),
        Binding("i", "iniciar", "Iniciar"),
        Binding("E", "editar", "Editar"),
        Binding("e", "ejecutar", "Ejecutar"),
        Binding("v", "revisar", "Revisar"),
        Binding("q", "salir", "Salir"),
    ]

    def action_mover_col(self, d) -> None:
        """Mueve la tarjeta seleccionada a la columna de al lado (> y <). A «Hecho» solo se llega aprobándola con a."""
        c = self.query_one(Lienzo).seleccionada
        if c is None:
            self.estado("No hay tarjeta seleccionada")
            return
        destino = c.col + int(d)
        if destino < 0:
            self.estado(f"{c.id} ya está en la primera columna")
            return
        if destino >= len(COLUMNAS):
            self.estado(f"{c.id} ya está en la última columna")
            return
        if COLUMNAS[destino].lower() == "hecho":
            self.estado("Pasa por la puerta: usa a para aprobarla (solo una tarjeta en Verificando y revisada)")
            return
        self._resultado(actions.mover(self.repo, c.id, COLUMNAS[destino], self.backlog))

    # --- e/v: enviar /ejecutar y /revisar al panel de Claude de la izquierda (gastan tokens: piden confirmación) ---
    # Flujo y comprobaciones en tui/hq/panel.py (importado como `envio`). El tablero pone la confirmación, hwnd0,
    # el hilo, el modo «enviando» y la poscondición.
    def _seleccion_para(self, comando: str):
        t = self._tarea(self.query_one(Lienzo).seleccionada)
        if t is None:
            self.estado("No hay tarjeta seleccionada")
            return None
        st = t.status.lower()
        if comando == "ejecutar" and st not in ("planificado", "en curso"):
            self.estado(f"{t.id} no se puede ejecutar: debe estar en Planificado o En curso")
            return None
        if comando == "revisar" and (st != "verificando" or "revisada" in t.labels):
            self.estado(f"{t.id} no se puede revisar: debe estar en Verificando y sin revisar")
            return None
        return t

    def _pedir_lanzar(self, comando: str) -> None:
        if self.enviando:
            return
        t = self._seleccion_para(comando)
        if t:
            orden = envio.texto_orden(comando, t.id)  # la misma función que construye lo que se envía
            self.app.push_screen(Confirmar(
                f"Se enviará a Claude: {orden} ({t.title}). Gasta tokens. El prompt de Claude debe estar vacío: "
                "lo que haya escrito se enviaría junto con la orden."),
                lambda ok, i=t.id: self._lanzar(ok, comando, i))

    def _lanzar(self, ok, comando: str, tid: str) -> None:
        if ok is not True:
            self.estado("Cancelado")
            return
        if self.enviando:
            return
        x = self.app.extra
        try:
            backend = x.get("panel_backend") or envio.backend_por_defecto()
            hwnd0 = backend.primer_plano()  # al confirmar el usuario está en el tablero: es su ventana de WT
        except Exception as e:
            self.estado("✖ " + limpiar(f"No se pudo leer la ventana: {e}")[:200])
            return
        self.recargar()  # el estado pudo cambiar mientras el diálogo estaba abierto
        if self._seleccion_para_id(comando, tid) is None:
            return
        desde = datetime.now(timezone.utc)
        try:
            sid = focus.sid_panel(self.events_dir, self.slug)
        except Exception:
            sid = ""
        orden = envio.texto_orden(comando, tid)
        self.enviando = True
        self._modal_envio = Enviando(f"Enviando a Claude: {orden}")
        self.app.push_screen(self._modal_envio)
        self.estado(f"Enviando a Claude: {orden}…")
        self.run_worker(lambda: self._enviar(comando, tid, backend, hwnd0, sid, desde), thread=True, group="envio")

    def _estado_claude(self):
        f = self.app.extra.get("estado_claude")
        return f(self.slug) if f else focus.estado_claude(self.events_dir, self.state_dir, self.slug)

    def _enviar(self, comando: str, tid: str, backend, hwnd0, sid: str, desde) -> None:
        """En un hilo: la espera de AppBlur no puede bloquear el bucle de eventos que la recibe."""
        x, msg = self.app.extra, None
        try:
            r = envio.enviar_orden(comando, tid, slug=self.slug, estado=self._estado_claude, hwnd0=hwnd0,
                                   senal_foco=self.app.senal_foco, backend=backend, ejecutar=x.get("panel_ejecutar"),
                                   entorno=x.get("panel_entorno"), dormir=x.get("panel_dormir"))
            msg = ("✔ " if r.ok else "✖ ") + envio.explicar(r)
            if r.ok:
                self._desde_hilo(self.estado, f"Enviado a Claude: {r.orden} · esperando confirmación…")
                if not self._esperar_prompt(sid, desde):
                    msg = f"✖ no se confirmó el envío de {r.orden}: mira el panel de Claude"
        except Exception as e:
            msg = "✖ " + limpiar(f"Error al enviar: {e}")[:200]
        finally:
            self._desde_hilo(self._fin_envio, msg)

    def _esperar_prompt(self, sid: str, desde) -> bool:
        """Poscondición: un evento `prompt` nuevo de la sesión del panel en <= POSCONDICION_S."""
        worker = get_current_worker()
        fin = time.monotonic() + float(self.app.extra.get("tope_poscondicion", POSCONDICION_S))
        while not worker.is_cancelled:
            try:
                if focus.prompt_desde(self.events_dir, self.slug, sid, desde):
                    return True
            except Exception:
                pass
            if time.monotonic() >= fin:
                return False
            time.sleep(0.1)
        return False

    def _desde_hilo(self, fn, *args) -> None:
        try:
            self.app.call_from_thread(fn, *args)
        except Exception:
            pass  # la aplicación ya se está cerrando

    def _fin_envio(self, msg) -> None:
        self.enviando = False
        if self._modal_envio is not None and self.app.screen is self._modal_envio:
            self.app.pop_screen()
        self._modal_envio = None
        self.recargar()
        self.estado(msg or "✖ El envío terminó sin resultado")

    def _seleccion_para_id(self, comando: str, tid: str):
        t = self._tarea(next((c for c in self.query_one(Lienzo).cards if c.id == tid), None))
        if t is None:
            self.estado(f"{tid} ya no existe")
            return None
        st = t.status.lower()
        bien = st in ("planificado", "en curso") if comando == "ejecutar" else (st == "verificando" and "revisada" not in t.labels)
        if not bien:
            self.estado(f"{tid} cambió mientras decidías: no se lanza")
            return None
        return t

    # --- iniciar sin Claude (i) y editar la tarjeta (E): no gastan tokens ---
    def _fase_bloqueada(self, t) -> bool:
        return any(f.estado == "pendiente" and t.milestone in (f.milestone, f.nombre) for f in self.fases)

    def action_iniciar(self) -> None:
        t = self._tarea(self.query_one(Lienzo).seleccionada)
        if t is None:
            self.estado("No hay tarjeta seleccionada")
        elif t.status.lower() != "planificado":
            self.estado(f"{t.id} no se puede iniciar: debe estar en Planificado")
        elif self._fase_bloqueada(t):
            self.estado(f"{t.id} es de una fase que aún no está activa")
        else:
            self._resultado(actions.iniciar(self.repo, t.id, self.backlog))
            self._abrir_editor(t.id)

    def action_editar(self) -> None:
        t = self._tarea(self.query_one(Lienzo).seleccionada)
        if t is None:
            self.estado("No hay tarjeta seleccionada")
        elif t.status.lower() not in ("planificado", "en curso"):
            self.estado(f"{t.id} no se puede editar: debe estar en Planificado o En curso")
        else:
            self._abrir_editor(t.id)

    def _abrir_editor(self, tid: str) -> None:
        t = self._tarea(next((c for c in self.query_one(Lienzo).cards if c.id == tid), None))
        if t is None:
            return
        valor = lambda clave: next((x.split(":", 1)[1].strip() for x in t.labels  # noqa: E731
                                    if x.lower().startswith(clave + ":")), "")
        self.app.push_screen(EditarTarjeta(t, valor("modelo"), valor("esfuerzo")),
                             lambda d, i=t.id: self._guardar_edicion(d, i))

    def _guardar_edicion(self, datos, tid: str) -> None:
        if datos is None:
            self.estado("Cancelado")
            return
        self.recargar()
        t = self._tarea(next((c for c in self.query_one(Lienzo).cards if c.id == tid), None))
        if t is None:
            self.estado(f"{tid} ya no existe")
            return
        self._resultado(actions.editar(self.repo, tid, t.labels, datos["titulo"], datos["descripcion"],
                                       datos["criterios"], datos["modelo"], datos["esfuerzo"], self.backlog))

    def action_ejecutar(self) -> None:
        self._pedir_lanzar("ejecutar")

    def action_revisar(self) -> None:
        self._pedir_lanzar("revisar")

    def __init__(self, repo, slug: str, display: str | None = None, backlog: actions.Backlog | None = None,
                 state_dir=None, hoy=None, stats_loader=None, events_dir=None) -> None:
        super().__init__()
        self.stats_loader = stats_loader
        self.events_dir = events_dir
        self.enviando = False  # modo «enviando»: el tablero no atiende teclas hasta que acaba el envío
        self._modal_envio = None
        self.repo = Path(repo)
        self.slug = slug
        self.display_name = limpiar(display or slug)
        self.backlog = backlog
        self.state_dir = state_dir
        self.hoy = hoy or (lambda: date.today().isoformat())
        self.tasks = []
        self.fases = []
        self._firma = None
        self._msg_fases = ""

    def compose(self) -> ComposeResult:
        yield Static(id="cabecera", markup=False)
        yield Static(id="progreso", markup=False)
        yield Static(id="franja", markup=False)
        yield Lienzo(id="lienzo")
        with VerticalScroll(id="detalle") as d:
            d.can_focus = False
            yield Static(id="detalle-texto", markup=False)
        yield Static(_ayuda_texto(), id="estado", markup=False)

    def on_mount(self) -> None:
        self.recargar()
        self.query_one(Lienzo).focus()
        self.set_interval(1.0, self._sondeo)
        self.set_interval(30.0, self._progreso)

    # --- datos ---
    def _sondeo(self) -> None:
        f = _firma(self.repo)
        if f != self._firma:
            self.recargar()

    def action_refrescar(self) -> None:
        self.recargar()
        self.estado("Actualizado")

    def recargar(self) -> None:
        self._firma = _firma(self.repo)
        self.tasks = read_tasks(self.repo)
        hitos = read_milestones(self.repo)
        self._msg_fases = ""
        try:
            self.fases = derive(load_fases(self.repo), self.tasks, hitos)
        except FasesError as e:
            self.fases, self._msg_fases = [], limpiar(str(e))
        lienzo = self.query_one(Lienzo)
        lienzo.set_cards([card_de_task(t, hitos) for t in self.tasks])
        self._cabecera()
        self._progreso()
        self._franja()
        if not self.tasks:
            self.estado("Este proyecto aún no tiene tarjetas: pídele a Claude que cree el plan")
        if self.query_one("#detalle").display:
            self._detalle()

    def _ancho(self) -> int:
        return self.size.width or 80

    def on_resize(self, event) -> None:
        self.call_after_refresh(self._repintar)

    def _repintar(self) -> None:
        self._cabecera()
        self._franja()
        if self.query_one("#detalle").display:
            self._detalle()

    def _franja(self) -> None:
        w = self.query_one("#franja", Static)
        ancho = max(20, self._ancho() - 2)
        if self.fases:
            w.update(franja_fases_texto(self.fases, ancho))
        else:
            w.update(Text.assemble(("FASES ", f"bold {DIM}"), (self._msg_fases or "Sin fases definidas", DIM)))
        w.display = True

    def _cabecera(self) -> None:
        ancho = self._ancho()
        hechas = sum(1 for t in self.tasks if t.status.lower() == "hecho")
        pct = round(100 * hechas / len(self.tasks)) if self.tasks else 0
        t = Text.assemble((f" ◆ {self.display_name.upper()} ", f"bold {BLANCO}"), style=TEXTO)
        if ancho >= 60:
            t.append(" Hechas ", style=DIM)
            t.append_text(barra(pct, 10 if ancho >= 90 else 6, CRITERIOS))
        t.append(f" {pct}% ({hechas}/{len(self.tasks)})", style=f"bold {OK if self.tasks and hechas == len(self.tasks) else TEXTO}")
        fa = active(self.fases)
        if fa:
            t.append("  Fase ", style=DIM)
            if fa.estado == "esperando":
                t.append(f" {limpiar(fa.nombre)} · espera tu aprobación (A) ", style=f"bold {FONDO} on {AMBER}")
            else:
                t.append(f"{limpiar(fa.nombre)} ({fa.estado})", style=f"bold {AMBER}")
        s = session.latest(self.state_dir, self.slug) if self.state_dir else None
        if s:
            modelo = s.model or s.model_name
            t.append("  ● ", style=color_modelo(modelo))
            t.append(limpiar(s.model_name or s.model or "?"), style=f"bold {color_modelo(modelo)}")
            if s.ctx_pct is not None:
                t.append(f"  contexto {s.ctx_pct:.0f}%", style=ROJO if s.ctx_pct >= 80 else TEXTO)
            if s.cost is not None:
                t.append(f"  ${s.cost:.2f}", style=f"bold {AMBER}")
        self.query_one("#cabecera", Static).update(degradado_fondo(ajustar(t, ancho)))

    def _progreso(self) -> None:
        """Gasto del día (coloreado por el presupuesto). Si falla, la línea se oculta."""
        w = self.query_one("#progreso", Static)
        if self.stats_loader is None:
            w.display = False
            return
        # El cálculo lee todo el historial: va en un hilo para no congelar el tablero.
        self.run_worker(self._calcular_progreso, thread=True, group="progreso", exclusive=True)

    def _calcular_progreso(self) -> None:
        worker = get_current_worker()
        try:
            datos = self.stats_loader()
        except Exception:
            datos = None
        if worker.is_cancelled:
            return
        try:
            self.app.call_from_thread(self._pintar_progreso, datos)
        except Exception:
            pass  # la aplicación ya se está cerrando

    def _pintar_progreso(self, datos) -> None:
        w = self.query_one("#progreso", Static)
        if datos is None:
            w.display = False
            return
        res, gam = datos
        t = Text.assemble(("Gasto hoy ", DIM), (f"${res.hoy_usd:.2f}", f"bold {TEXTO}"))
        if res.dia.pct is not None:
            color = {"ok": OK, "aviso": AMBER, "pasado": ROJO}.get(res.dia.estado, TEXTO)
            t.append(" ")
            t.append_text(barra(res.dia.pct, 8, [OK, AMBER, ROJO]))
            t.append(f" ({res.dia.pct}% del día)", style=f"bold {color}")
        t.no_wrap, t.overflow = True, "ellipsis"
        w.update(t)
        w.display = True

    def estado(self, msg: str) -> None:
        if msg == AYUDA:
            self.query_one("#estado", Static).update(_ayuda_texto())
            return
        msg = limpiar(msg)
        color = OK if msg.startswith("✔") else ROJO if msg.startswith("✖") else TEXTO
        t = Text(f" {msg}", style=f"bold {color}" if color != TEXTO else color, no_wrap=True, overflow="ellipsis")
        self.query_one("#estado", Static).update(t)

    # --- detalle ---
    def action_detalle(self) -> None:
        d = self.query_one("#detalle")
        d.display = not d.display
        if d.display:
            self._detalle()

    def _tarea(self, card):
        return next((t for t in self.tasks if t.id == card.id), None) if card else None

    def _detalle(self) -> None:
        w = self.query_one("#detalle-texto", Static)
        card = self.query_one(Lienzo).seleccionada
        t = self._tarea(card)
        if t is None:
            w.update(Text("Sin tarjeta seleccionada", style=DIM))
            return
        w.update(render_detalle(t, self.tasks, self._ancho() - 3, card.milestone))

    def on_lienzo_soltada(self, ev: Lienzo.Soltada) -> None:
        c = next((c for c in self.query_one(Lienzo).cards if c.id == ev.card_id), None)
        destino = COLUMNAS[ev.col]
        if destino.lower() == "hecho":
            self.estado("Pasa por la puerta: selecciona la tarjeta y usa a")
            return
        if c is None:
            return
        self._resultado(actions.mover(self.repo, c.id, destino, self.backlog))

    def _resultado(self, r: actions.Resultado) -> None:
        self.recargar()
        self.estado(("✔ " if r.ok else "✖ ") + r.mensaje)

    # --- puertas humanas ---
    def _seleccion_aprobable(self):
        t = self._tarea(self.query_one(Lienzo).seleccionada)
        if t is None:
            self.estado("No hay tarjeta seleccionada")
            return None
        if t.status.lower() != "verificando" or "revisada" not in t.labels:
            self.estado(f"{t.id} no se puede aprobar: debe estar en Verificando y con la etiqueta revisada")
            return None
        return t

    def action_aprobar_tarjeta(self) -> None:
        t = self._seleccion_aprobable()
        if t:
            self.app.push_screen(Confirmar(f"¿Apruebas {t.id} {t.title}?"), lambda ok, i=t.id: self._aprobar(ok, i))

    def _aprobar(self, ok, tid: str) -> None:
        if ok is not True:
            self.estado("Cancelado")
            return
        self.recargar()  # el estado pudo cambiar mientras el diálogo estaba abierto
        t = self._tarea(next((c for c in self.query_one(Lienzo).cards if c.id == tid), None))
        if t is None or t.status.lower() != "verificando" or "revisada" not in t.labels:
            self.estado(f"{tid} cambió mientras decidías: no se aprueba")
            return
        self._resultado(actions.aprobar_tarjeta(self.repo, tid, self.backlog))

    def action_mejorar_tarjeta(self) -> None:
        t = self._seleccion_aprobable()
        if t:
            self.app.push_screen(Motivo(f"¿Qué falta en {t.id} {t.title}?"), lambda m, i=t.id: self._mejorar(m, i))

    def _mejorar(self, motivo, tid: str) -> None:
        if motivo is None:
            self.estado("Cancelado")
            return
        self._resultado(actions.mejorar_tarjeta(self.repo, tid, motivo, self.backlog))

    def _fase_esperando(self):
        fa = active(self.fases)
        if fa is None or fa.estado != "esperando":
            self.estado("No hay ninguna fase esperando tu visto bueno")
            return None
        return fa

    def action_aprobar_fase(self) -> None:
        fa = self._fase_esperando()
        if fa:
            self.app.push_screen(Confirmar(f"¿Apruebas la fase «{fa.nombre}» ({fa.hechas}/{fa.total})?"),
                                 lambda ok, i=fa.id: self._aprobar_fase(ok, i))

    def _aprobar_fase(self, ok, fid: str) -> None:
        if ok is not True:
            self.estado("Cancelado")
            return
        self._resultado(actions.aprobar_fase(self.repo, fid, self.hoy()))

    def action_mejorar_fase(self) -> None:
        fa = self._fase_esperando()
        if fa:
            self.app.push_screen(Motivo(f"¿Qué falta en la fase «{fa.nombre}»?"), lambda m, f=fa: self._mejorar_fase(m, f))

    def _mejorar_fase(self, motivo, fase) -> None:
        if motivo is None:
            self.estado("Cancelado")
            return
        self._resultado(actions.mejorar_fase(self.repo, fase, motivo, self.backlog))

    # --- varios ---
    def action_compacto(self) -> None:
        self.query_one(Lienzo).alternar_compacto()

    def action_ayuda(self) -> None:
        self.estado(AYUDA)

    def action_salir(self) -> None:
        self.app.exit()
