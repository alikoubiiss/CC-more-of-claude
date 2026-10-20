"""Pantalla global: todos los proyectos del registro, su progreso y su última actividad."""
from __future__ import annotations

from rich.text import Text
from textual.app import ComposeResult
from textual.binding import Binding
from textual.screen import Screen
from textual.widgets import DataTable, Static

from .. import events
from ..fases import active, project_phases
from ..tasks import read_tasks
from ..textos import limpiar

VACIO = "No hay proyectos registrados todavía: crea uno con /nuevo-proyecto en Claude Code"
COLUMNAS = ("Proyecto", "Progreso", "Fase", "En curso", "Última actividad")


def resumen(p, events_dir) -> tuple[str, str, str, str, str]:
    """Una fila por proyecto; un proyecto roto no tumba la lista."""
    try:
        tasks = read_tasks(p.path)
        hechas = sum(1 for t in tasks if t.status.lower() == "hecho")
        progreso = f"{hechas}/{len(tasks)}" if tasks else "sin tarjetas"
        en_curso = next((t for t in tasks if t.status.lower() == "en curso"), None)
        en_curso_txt = f"{en_curso.id} {en_curso.title}" if en_curso else "—"
    except Exception:
        progreso, en_curso_txt = "ilegible", "—"
    try:
        fa = active(project_phases(p.path))
        fase = f"{fa.nombre} ({fa.estado})" if fa else "—"
    except Exception:
        fase = "ilegible"
    try:
        evs = events.read_recent(events_dir, p.slug, limit=1)
        actividad = f"{evs[-1].hora} {evs[-1].texto}" if evs else "—"
    except Exception:
        actividad = "—"
    return (limpiar(p.display), progreso, limpiar(fase), limpiar(en_curso_txt), limpiar(actividad))


class GlobalScreen(Screen):
    DEFAULT_CSS = """
    #titulo { height: 1; padding: 0 1; text-style: bold; }
    #estado { height: 1; padding: 0 1; background: $boost; }
    """
    BINDINGS = [
        Binding("r", "refrescar", "Refrescar"),
        Binding("q", "app.quit", "Salir"),
    ]

    def __init__(self, proyectos, events_dir, open_proyecto=None) -> None:
        super().__init__()
        self.proyectos = list(proyectos)
        self.events_dir = events_dir
        self.open_proyecto = open_proyecto

    def compose(self) -> ComposeResult:
        yield Static("Proyectos", id="titulo", markup=False)
        yield DataTable(id="tabla", cursor_type="row")
        yield Static("Enter abre el proyecto · g guía de comandos · r refrescar · q salir", id="estado", markup=False)

    def on_mount(self) -> None:
        t = self.query_one(DataTable)
        t.add_columns(*COLUMNAS)
        self.action_refrescar()
        t.focus()
        self.set_interval(5.0, self.action_refrescar)

    def estado(self, msg: str) -> None:
        self.query_one("#estado", Static).update(Text(limpiar(msg)))

    def action_refrescar(self) -> None:
        t = self.query_one(DataTable)
        fila = t.cursor_row
        t.clear()
        if not self.proyectos:
            self.estado(VACIO)
            return
        for p in self.proyectos:
            t.add_row(*(Text(c) for c in resumen(p, self.events_dir)), key=p.slug)
        if self.proyectos:
            t.move_cursor(row=min(fila, len(self.proyectos) - 1))

    def on_data_table_row_selected(self, ev: DataTable.RowSelected) -> None:
        slug = ev.row_key.value
        if self.open_proyecto is None:
            self.estado("No se puede abrir desde aquí")
            return
        try:
            self.open_proyecto(slug)
            self.estado(f"Abriendo {slug}…")
        except Exception as e:
            self.estado(f"No se pudo abrir {slug}: {e}")
