"""Diálogos de la puerta humana. Devuelven la decisión; no ejecutan nada por sí mismos."""
from __future__ import annotations

from rich.text import Text
from textual.app import ComposeResult
from textual.binding import Binding
from textual.containers import Vertical
from textual.screen import ModalScreen
from textual.widgets import Input, Static

from ..textos import limpiar

CSS = """
Confirmar, Motivo { align: center middle; }
#caja { width: 70; height: auto; border: round #8B7CFF; background: $surface; padding: 1 2; }
"""


class Confirmar(ModalScreen[bool]):
    DEFAULT_CSS = CSS
    BINDINGS = [
        Binding("s", "decidir(True)", "Sí"),
        Binding("n,escape,enter", "decidir(False)", "No"),
    ]

    def __init__(self, pregunta: str) -> None:
        super().__init__()
        self.pregunta = limpiar(pregunta)

    def compose(self) -> ComposeResult:
        with Vertical(id="caja"):
            yield Static(Text(self.pregunta))
            yield Static(Text("[s] sí   [n / Esc] no", style="dim"))

    def action_decidir(self, valor) -> None:
        self.dismiss(valor is True or valor == "True")


class Enviando(ModalScreen):
    """Tapa el tablero mientras se envía una orden al panel de Claude: se traga teclas y ratón, sin atajos.
    Si el foco no hubiera salido del tablero, el Enter del envío le llegaría a él y no debe hacer nada.
    Lo cierra quien lo abrió cuando termina el envío."""
    DEFAULT_CSS = CSS + "Enviando { align: center middle; }"
    BINDINGS = []

    def __init__(self, texto: str) -> None:
        super().__init__()
        self.texto = limpiar(texto)

    def compose(self) -> ComposeResult:
        with Vertical(id="caja"):
            yield Static(Text(self.texto))
            yield Static(Text("No toques el teclado hasta que termine.", style="dim"))

    def on_key(self, event) -> None:
        event.stop()
        event.prevent_default()


class EditarTarjeta(ModalScreen):
    """Formulario de tarjeta. Devuelve un dict (titulo, descripcion, criterios, modelo, esfuerzo) o None."""
    DEFAULT_CSS = CSS + "EditarTarjeta { align: center middle; }\n#caja Input { margin-bottom: 1; }"
    BINDINGS = [Binding("escape", "cancelar", "Cancelar")]

    def __init__(self, tarea, modelo: str = "", esfuerzo: str = "") -> None:
        super().__init__()
        self.tarea, self.modelo, self.esfuerzo = tarea, modelo, esfuerzo

    def compose(self) -> ComposeResult:
        t = self.tarea
        with Vertical(id="caja"):
            yield Static(Text(f"Editar {limpiar(t.id)}  (Tab cambia de campo · Enter guarda · Esc cancela)"))
            yield Input(value=limpiar(t.title), id="f-titulo", placeholder="Título")
            yield Input(value=limpiar(t.description or ""), id="f-descripcion", placeholder="Descripción")
            yield Input(value=" | ".join(limpiar(c[1]) for c in t.criteria_items), id="f-criterios",
                        placeholder="Criterios separados por |")
            yield Input(value=self.modelo, id="f-modelo", placeholder="Modelo: haiku, sonnet u opus (vacío = automático)")
            yield Input(value=self.esfuerzo, id="f-esfuerzo", placeholder="Esfuerzo: medium, high o xhigh")

    def on_input_submitted(self, event: Input.Submitted) -> None:
        event.stop()
        v = lambda i: self.query_one(i, Input).value  # noqa: E731
        self.dismiss({
            "titulo": v("#f-titulo"), "descripcion": v("#f-descripcion"),
            "criterios": [c.strip() for c in v("#f-criterios").split("|") if c.strip()],
            "modelo": v("#f-modelo"), "esfuerzo": v("#f-esfuerzo"),
        })

    def action_cancelar(self) -> None:
        self.dismiss(None)


class Motivo(ModalScreen):
    DEFAULT_CSS = CSS
    BINDINGS = [Binding("escape", "cancelar", "Cancelar")]

    def __init__(self, titulo: str) -> None:
        super().__init__()
        self.titulo = limpiar(titulo)

    def compose(self) -> ComposeResult:
        with Vertical(id="caja"):
            yield Static(Text(self.titulo))
            yield Input(placeholder="¿Qué falta? (Enter envía, Esc cancela)", max_length=200)

    def on_input_submitted(self, event: Input.Submitted) -> None:
        event.stop()
        self.dismiss(event.value)

    def action_cancelar(self) -> None:
        self.dismiss(None)
