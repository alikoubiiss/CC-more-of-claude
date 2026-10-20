"""Pantalla de notas del vault del proyecto (Índice, Decisiones, Sesiones)."""
from __future__ import annotations

import os
import re

from rich.text import Text
from textual.app import ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal, VerticalScroll
from textual.screen import Screen
from textual.widgets import Label, ListItem, ListView, Markdown, Static

from .. import notes
from ..textos import limpiar

# Como limpiar(), pero conserva saltos de línea y tabuladores.
_CONTROL = re.compile("[\u0000-\u0008\u000b-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]")
_ETIQUETA = {"indice": "◆", "decision": "▣", "sesion": "◷"}
VACIO = "Este proyecto aún no tiene notas en el vault"


def preparar(texto: str) -> str:
    """Quita controles y muestra el frontmatter como bloque aparte."""
    t = _CONTROL.sub(" ", texto).replace("\r\n", "\n")
    m = re.match(r"---\n(.*?)\n---\n?", t, re.S)
    if m:
        return f"```yaml\n{m.group(1)}\n```\n\n{t[m.end():]}"
    return t


def _abrir_por_defecto(destino: str) -> None:
    os.startfile(destino)  # type: ignore[attr-defined]  # solo Windows


class NotesScreen(Screen):
    DEFAULT_CSS = """
    #lista { width: 34; border-right: solid #3B4360; }
    #visor { padding: 0 1; }
    #estado { height: 1; padding: 0 1; background: $boost; }
    """
    BINDINGS = [
        Binding("o", "obsidian", "Obsidian"),
        Binding("e", "editor", "Editor"),
        Binding("r", "refrescar", "Refrescar"),
        Binding("q", "app.quit", "Salir"),
    ]

    def __init__(self, slug: str, vault_path, vault_projects_dir: str, abrir=None, display: str | None = None) -> None:
        super().__init__()
        self.slug, self.vault_path, self.vault_projects_dir = slug, vault_path, vault_projects_dir
        self.abrir = abrir or _abrir_por_defecto
        self.display_name = limpiar(display or slug)
        self.notas: list[notes.Nota] = []
        self.nota_actual = None
        self.texto_mostrado = ""

    def compose(self) -> ComposeResult:
        with Horizontal():
            yield ListView(id="lista")
            with VerticalScroll(id="visor"):
                yield Markdown("")
        yield Static("o Obsidian · e editor · r refrescar · q salir", id="estado", markup=False)

    async def on_mount(self) -> None:
        await self.action_refrescar()
        self.query_one(ListView).focus()

    def estado(self, msg: str) -> None:
        self.query_one("#estado", Static).update(Text(limpiar(msg)))

    async def action_refrescar(self) -> None:
        self.notas = notes.tree(self.vault_path, self.vault_projects_dir, self.slug)
        lista = self.query_one(ListView)
        await lista.clear()
        if not self.notas:
            self.nota_actual = None
            await self._mostrar(VACIO)
            return
        await lista.extend(
            ListItem(Label(Text(f"{_ETIQUETA.get(n.tipo, '·')} {n.titulo}", no_wrap=True, overflow="ellipsis"))) for n in self.notas)
        lista.index = 0

    async def _mostrar(self, texto: str) -> None:
        self.texto_mostrado = texto
        await self.query_one(Markdown).update(texto)

    async def on_list_view_highlighted(self, ev: ListView.Highlighted) -> None:
        i = self.query_one(ListView).index
        if i is None or not (0 <= i < len(self.notas)):
            return
        self.nota_actual = self.notas[i].ruta
        await self._mostrar(preparar(notes.read(self.nota_actual)))

    def _abrir(self, destino: str, que: str) -> None:
        if self.nota_actual is None:
            self.estado("No hay nota seleccionada")
            return
        try:
            self.abrir(destino)
            self.estado(f"Abierta en {que}")
        except Exception as e:
            self.estado(f"No se pudo abrir en {que}: {e}")

    def action_obsidian(self) -> None:
        if self.nota_actual is not None:
            self._abrir(notes.obsidian_uri(self.vault_path, self.nota_actual), "Obsidian")
        else:
            self._abrir("", "Obsidian")

    def action_editor(self) -> None:
        self._abrir(str(self.nota_actual), "el editor") if self.nota_actual is not None else self._abrir("", "el editor")
