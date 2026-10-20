"""Pantalla `hq stats`: gasto real, presupuesto, uso de la memoria y gamificación. Solo lectura."""
from __future__ import annotations

import os
from pathlib import Path

from rich.text import Text
from textual.app import ComposeResult
from textual.binding import Binding
from textual.containers import VerticalScroll
from textual.screen import Screen
from textual.widgets import Static
from textual.worker import get_current_worker

from ..stats import estado
from ..textos import limpiar

COLOR = {"ok": "#6FE3A0", "aviso": "#FFC86B", "pasado": "#FF6B6B", "sin": "#98A0BC"}
VACIO = "Sin datos todavía: el gasto se registra mientras trabajas en Claude Code"
SIN_PRESUPUESTO = "Sin presupuesto configurado (config.json → presupuesto)"
ONDAS = "▁▂▃▄▅▆▇█"


def barra(pct, ancho: int = 20) -> str:
    n = 0 if pct is None else max(0, min(ancho, round(pct / 100 * ancho)))
    return "█" * n + "░" * (ancho - n)


def tendencia(valores: list[float]) -> str:
    m = max(valores, default=0)
    if m <= 0:
        return ONDAS[0] * len(valores)
    return "".join(ONDAS[min(len(ONDAS) - 1, int(v / m * (len(ONDAS) - 1) + 0.5))] for v in valores)


def usd(v: float) -> str:
    return f"${v:.2f}"


def construir(res, gam, presupuesto, slug: str | None) -> Text:
    t = Text()
    p = presupuesto or {}

    def titulo(s: str) -> None:
        t.append(f"\n{s}\n", style="bold")

    t.append(f"Gasto de tokens{f' · {limpiar(slug)}' if slug else ' · todos los proyectos'}\n", style="bold underline")
    if res.n_datos == 0:
        t.append(f"\n{VACIO}\n", style="dim")
    else:
        dia = res.dia
        t.append(f"\nHoy      {usd(res.hoy_usd):>9}  ")
        t.append(barra(dia.pct), style=COLOR[dia.estado])
        t.append(f"  {dia.pct}% del día (presupuesto {usd(p['diaUsd'])})\n" if dia.pct is not None else "\n", style=COLOR[dia.estado])
        t.append(f"Semana   {usd(res.semana_usd):>9}\nMes      {usd(res.mes_usd):>9}\n")
    if not presupuesto or (p.get("diaUsd") is None and p.get("tarjetaUsd") is None):
        t.append(f"{SIN_PRESUPUESTO}\n", style="dim")

    if res.n_datos:
        titulo("Tendencia (14 días)")
        t.append(f"{tendencia([v for _, v in res.tendencia])}  máx {usd(max(v for _, v in res.tendencia))}\n")
        titulo("Por proyecto")
        for s, v in res.por_proyecto:
            t.append(f"  {limpiar(s):<24} {usd(v):>9}\n")
        titulo("Por modelo (modelo principal de la sesión; los subagentes cuentan dentro de la sesión)")
        for m, v in res.por_modelo:
            t.append(f"  {limpiar(m):<24} {usd(v):>9}\n")
        titulo("Tarjetas más caras")
        for s, c, v in res.por_tarjeta[:10]:
            e = estado(v, p.get("tarjetaUsd"))
            t.append(f"  {limpiar(s)} {limpiar(c) if c else 'sin tarjeta':<14} {usd(v):>9}")
            t.append(f"  {e.pct}%\n" if e.pct is not None else "\n", style=COLOR[e.estado])

    m = res.memoria
    titulo("Uso de la memoria")
    medio = m.get("inicio_medio_chars")
    t.append(f"  NotebookLM: {m.get('nlm', 0)} consultas · vault: {m.get('vault', 0)} lecturas · Conocimiento: {m.get('conocimiento', 0)} lecturas\n")
    t.append("  Contexto al empezar: " + (f"~{round(medio)} caracteres (~{round(medio / 3.5)} tokens)\n" if medio else "sin datos\n"))

    titulo("Progreso")
    sig = f" · siguiente nivel en {gam.xp_siguiente} XP" if gam.xp_siguiente else " · nivel máximo"
    t.append(f"  Nivel {gam.nivel} · {gam.xp} XP{sig} · racha {gam.racha} días\n", style="bold")
    for _, nombre, ok in gam.logros:
        t.append(f"  {'✓' if ok else '·'} {limpiar(nombre)}\n", style="" if ok else "dim")
    return t


def _firma(metrics_dir) -> tuple:
    out = []
    try:
        with os.scandir(metrics_dir) as it:
            for d in it:
                if d.is_dir():
                    with os.scandir(d.path) as ft:
                        out.extend((d.name, f.name, f.stat().st_mtime_ns) for f in ft if f.name.endswith(".jsonl"))
    except OSError:
        pass
    return tuple(sorted(out))


class StatsScreen(Screen):
    DEFAULT_CSS = """
    #estado { height: 1; padding: 0 1; background: $boost; }
    #panel { padding: 0 1; }
    """
    BINDINGS = [
        Binding("r", "refrescar", "Refrescar"),
        Binding("q", "app.quit", "Salir"),
    ]

    def __init__(self, cargador, presupuesto, metrics_dir, slug: str | None = None) -> None:
        super().__init__()
        self.cargador, self.presupuesto, self.metrics_dir, self.slug = cargador, presupuesto, metrics_dir, slug
        self._firma = None

    def compose(self) -> ComposeResult:
        with VerticalScroll():
            yield Static(id="panel", markup=False)
        yield Static("r refrescar · q salir", id="estado", markup=False)

    def on_mount(self) -> None:
        self.query_one("#panel", Static).update(Text("Calculando…", style="dim"))
        self.action_refrescar()
        self.set_interval(5.0, self._sondeo)

    def _sondeo(self) -> None:
        f = _firma(self.metrics_dir)
        if f != self._firma:
            self.action_refrescar()

    def action_refrescar(self) -> None:
        """Lee y calcula en un hilo: con un historial grande la interfaz no se congela."""
        self._firma = _firma(self.metrics_dir)
        self.run_worker(self._calcular, thread=True, group="stats", exclusive=True)

    def _calcular(self) -> None:
        worker = get_current_worker()
        try:
            resultado = self.cargador()
            error = None
        except Exception as e:  # el panel nunca debe cerrar la aplicación
            resultado, error = None, limpiar(str(e))
        if worker.is_cancelled:
            return
        try:
            self.app.call_from_thread(self._pintar, resultado, error)
        except Exception:
            pass  # la aplicación ya se está cerrando

    def _pintar(self, resultado, error) -> None:
        panel = self.query_one("#panel", Static)
        if error is not None:
            panel.update(Text(f"No se pudieron leer las métricas: {error}", style="red"))
            return
        res, gam = resultado
        panel.update(construir(res, gam, self.presupuesto, self.slug))
