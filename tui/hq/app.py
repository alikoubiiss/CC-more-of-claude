"""Aplicación Textual de HQ. Cada modo abre su pantalla; los errores se muestran, no se propagan."""
from __future__ import annotations

import threading
from pathlib import Path

from rich.text import Text
from textual import events
from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.screen import Screen
from textual.widgets import Static

from .config import Config, ConfigError, load_config
from .registry import RegistryError, find_by_path, load_registry
from .textos import limpiar


class MensajeScreen(Screen):
    BINDINGS = [Binding("q,escape", "app.quit", "Salir")]

    def __init__(self, msg: str) -> None:
        super().__init__()
        self.msg = limpiar(msg)

    def compose(self) -> ComposeResult:
        yield Static(Text(self.msg + "\n\n[q] salir"))


class HQApp(App):
    TITLE = "HQ"

    def __init__(self, modo: str = "global", slug: str | None = None, cfg: Config | None = None, repo=None,
                 backlog=None, **extra) -> None:
        super().__init__()
        self.modo, self.slug, self.cfg, self.repo, self.backlog = modo, slug, cfg, repo, backlog
        self.extra = extra
        # Señal de foco para el envío al panel de Claude: WT avisa con AppBlur cuando el foco sale del tablero.
        # La espera el hilo del envío (tui/hq/panel.py), por eso es un threading.Event.
        self.senal_foco = threading.Event()

    def on_app_blur(self, _: events.AppBlur) -> None:
        self.senal_foco.set()

    def on_mount(self) -> None:
        try:
            self.push_screen(self._pantalla())
        except (ConfigError, RegistryError, LookupError) as e:
            self.push_screen(MensajeScreen(str(e)))

    def _resolver(self):
        """(repo, slug, display) del proyecto pedido; si se pasó `repo` se usa tal cual (tests)."""
        if self.repo is not None:
            return Path(self.repo), self.slug or Path(self.repo).name, self.slug
        self.cfg = self.cfg or load_config()
        proyectos = load_registry(self.cfg.registry_file)
        p = next((x for x in proyectos if x.slug == self.slug), None) if self.slug else find_by_path(proyectos, str(Path.cwd()))
        if p is None:
            raise LookupError("No encuentro ese proyecto en el registro de HQ" if self.slug else "Esta carpeta no es un proyecto de HQ")
        return Path(p.path), p.slug, p.display

    def _cargador_stats(self, slug: str | None):
        """Función sin argumentos que calcula (resumen de gasto, gamificación); relee el registro cada vez."""
        from .estadisticas import cargar

        def cargador():
            try:
                proyectos = load_registry(self.cfg.registry_file)
            except RegistryError:
                proyectos = []
            return cargar(self.cfg, proyectos, slug, self.extra.get("hoy"))
        return cargador

    def _pantalla(self) -> Screen:
        if self.modo == "board":
            from .screens.board import BoardScreen
            repo, slug, display = self._resolver()
            return BoardScreen(repo, slug, display, self.backlog, self.cfg.state_dir if self.cfg else self.extra.get("state_dir"),
                               stats_loader=self._cargador_stats(None) if self.cfg else None,
                               events_dir=self.cfg.events_dir if self.cfg else self.extra.get("events_dir"))
        if self.modo == "feed":
            from .screens.feed import FeedScreen
            repo, slug, display = self._resolver()
            ev = self.cfg.events_dir if self.cfg else self.extra["events_dir"]
            st = self.cfg.state_dir if self.cfg else self.extra.get("state_dir")
            return FeedScreen(slug, ev, st, display)
        if self.modo == "focus":
            from .screens.focus import FocusScreen
            repo, slug, display = self._resolver()
            ev = self.cfg.events_dir if self.cfg else self.extra["events_dir"]
            st = self.cfg.state_dir if self.cfg else self.extra.get("state_dir")
            return FocusScreen(repo, slug, ev, st, display, stats_loader=self._cargador_stats(None) if self.cfg else None)
        if self.modo == "notes":
            from .screens.notes import NotesScreen
            repo, slug, display = self._resolver()
            vp = self.cfg.vault_path if self.cfg else self.extra["vault_path"]
            vd = self.cfg.vault_projects_dir if self.cfg else self.extra["vault_projects_dir"]
            return NotesScreen(slug, vp, vd, self.extra.get("abrir"), display)
        if self.modo == "stats":
            from .screens.stats import StatsScreen
            self.cfg = self.cfg or load_config()
            return StatsScreen(self._cargador_stats(self.slug), self.cfg.presupuesto, self.cfg.metrics_dir, self.slug)
        if self.modo == "global":
            from .screens.global_ import GlobalScreen
            self.cfg = self.cfg or load_config()
            proyectos = self.extra.get("proyectos")
            if proyectos is None:
                proyectos = load_registry(self.cfg.registry_file)
            return GlobalScreen(proyectos, self.cfg.events_dir, self.extra.get("open_proyecto"))
        raise LookupError(f"Modo desconocido: {self.modo}")
