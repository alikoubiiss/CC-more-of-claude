import asyncio
import json
import os
import subprocess
import tempfile
import unittest
from datetime import date, datetime, timezone
from pathlib import Path

from rich.cells import cell_len

from hq import focus
from hq.app import HQApp
from hq.fases import Fase
from hq.gamificacion import Estado, NOMBRES
from hq.screens.focus import FocusScreen, animado, barra, mezcla, render
from hq.stats import Resumen
from hq.stats import Estado as EstadoGasto
from hq.tasks import Task

ANCHOS = (24, 30, 40, 46, 70, 99, 100, 110, 160)


def repo_con_tarjeta() -> Path:
    repo = Path(tempfile.mkdtemp(prefix="hq-focus-"))
    d = repo / "backlog" / "tasks"
    d.mkdir(parents=True)
    (d / "task-1 - a.md").write_text(
        "---\nid: TASK-1\ntitle: Conectar\nstatus: En curso\nmilestone: Construcción\n---\n"
        "<!-- AC:BEGIN -->\n- [x] #1 Hecho uno\n- [ ] #2 Falta dos\n<!-- AC:END -->\n", encoding="utf8")
    (repo / ".hq").mkdir()
    (repo / ".hq" / "fases.json").write_text(json.dumps({"fases": [
        {"id": "f1", "nombre": "Construcción", "milestone": "Construcción", "aprobada": None}]}), encoding="utf8")
    return repo


def eventos(base: Path, slug: str, lineas: list[dict], dia: str = "2026-10-12") -> Path:
    d = base / slug
    d.mkdir(parents=True)
    (d / f"{dia}.jsonl").write_text("\n".join(json.dumps(x) for x in lineas), encoding="utf8")
    return base


def foco_completo(n: int = 3, ctx: float = 40.0, espera: bool = False, titulo: str = "Conectar el HUD") -> focus.Foco:
    items = [(i, f"Objetivo número {i} con texto bastante largo para recortar", i % 2 == 0) for i in range(n)]
    return focus.Foco(
        tarjeta=Task(id="TASK-7", title=titulo, status="En curso", criteria_items=items),
        fase="Construcción 1/2", espera_aprobacion=espera, siguiente="/ejecutar TASK-7",
        sesion=focus.session.SesionEstado(model="claude-opus", model_name="Opus", cost=1.234, ctx_pct=ctx,
                                          tokens_in=123456, tokens_out=7890),
        subagentes=[f"agente-{i}" for i in range(n)],
        archivos=[f"tui/hq/carpeta/muy/profunda/archivo_{i}.py" for i in range(n)],
        git=[f" M ruta/{i}.py" for i in range(n)] + ["?? nuevo.txt"],
        slug="demo", rama="rama-con-nombre-largo-漢字", conteo={"Planificado": n, "En curso": 1, "Verificando": 2, "Hecho": 5},
        bloqueadas=[(f"TASK-{i}", ["TASK-1", "TASK-漢字-2"]) for i in range(n)],
        pendientes_fase=[f"TASK-{i}" for i in range(n)],
        actividad=[(f"10:00:0{i % 10}", f"Edita {titulo} archivo_{i}.py") for i in range(n)],
        fallos=[(f"10:01:0{i % 10}", f"Falla Bash comando {titulo}") for i in range(n)], minutos=65,
        ultima_hora="10:01:09", parado_min=1,
    )


def gam() -> Estado:
    logros = [(k, v, i < 3) for i, (k, v) in enumerate(NOMBRES.items())]
    return Estado(xp=120, nivel=4, xp_siguiente=180, racha=3, logros=logros)


def res(pct=30) -> Resumen:
    return Resumen(hoy_usd=1.5, dia=EstadoGasto(pct, "ok" if pct is not None else "sin"),
                   tendencia=[(date(2026, 10, i + 1), float(i % 5)) for i in range(14)], n_datos=3)


FASES = [Fase("f1", "Diseño", "Diseño", "2026-10-01", "aprobada", 2, 2),
         Fase("f2", "Construcción", "Construcción", None, "esperando", 3, 3),
         Fase("f3", "Pulido", "Pulido", None, "pendiente", 2, 0)]


class FocoTest(unittest.TestCase):
    def assertCabe(self, t, ancho):
        lineas = t.plain.split("\n")
        for ln in lineas:
            self.assertEqual(cell_len(ln), max(ancho, 24), repr(ln))

    def test_tarjeta_activa_criterios_y_siguiente(self):
        repo = repo_con_tarjeta()
        f = focus.cargar(repo, "p", repo / "ev", None, date(2026, 10, 12), con_git=False)
        self.assertEqual(f.tarjeta.id, "TASK-1")
        self.assertEqual(f.siguiente, "/ejecutar TASK-1")
        self.assertEqual(f.fase, "Construcción 0/1")
        t = render(f, "demo")
        txt = t.plain
        self.assertIn("✓ Hecho uno", txt)
        self.assertIn("◇ Falta dos", txt)
        self.assertIn("TAREA ACTIVA · TASK-1", txt)
        self.assertIn("SIGUIENTE ACCIÓN", txt)
        self.assertIn("► /ejecutar TASK-1", txt)
        self.assertIn("Construcción · 0/1 hechas", txt)
        self.assertIn("Faltan para cerrarla: TASK-1", txt)
        tachado = [s for s in t.spans if "strike" in str(s.style)]
        self.assertTrue(any(t.plain[s.start:s.end] == "Hecho uno" for s in tachado))

    def test_espera_aprobacion_cuando_todas_las_tarjetas_estan_hechas(self):
        repo = repo_con_tarjeta()
        t = next((repo / "backlog" / "tasks").glob("*.md"))
        t.write_text(t.read_text(encoding="utf8").replace("En curso", "Hecho"), encoding="utf8")
        f = focus.cargar(repo, "p", repo / "ev", None, date(2026, 10, 12), con_git=False)
        self.assertTrue(f.espera_aprobacion)
        for ancho in (30, 70, 110):
            self.assertIn("ESPERA TU APROBACIÓN", render(f, "demo", ancho).plain)
        self.assertIn("espera tu aprobación", render(f, "demo", 70).plain)

    def test_alerta_parpadea_entre_fotogramas(self):
        f = foco_completo(espera=True)
        a, b = render(f, "demo", 70, frame=0), render(f, "demo", 70, frame=1)
        self.assertEqual(a.plain.split("\n")[1], b.plain.split("\n")[1])
        self.assertNotEqual([str(s.style) for s in a.spans], [str(s.style) for s in b.spans])

    def test_subagentes_activos_y_archivos_tocados(self):
        repo = repo_con_tarjeta()
        ev = eventos(repo / "ev", "p", [
            {"t": "2026-10-12T10:00:00Z", "kind": "subagent_start", "agent": "ejecutor"},
            {"t": "2026-10-12T10:00:01Z", "kind": "subagent_start", "agent": "revisor"},
            {"t": "2026-10-12T10:00:02Z", "kind": "subagent_stop", "agent": "revisor"},
            {"t": "2026-10-12T10:00:03Z", "kind": "tool", "tool": "Edit", "target": "src/a.py"},
            {"t": "2026-10-12T10:00:04Z", "kind": "tool", "tool": "Read", "target": "b.py"},
        ])
        f = focus.cargar(repo, "p", ev, None, date(2026, 10, 12), con_git=False)
        self.assertEqual(f.subagentes, ["ejecutor"])
        self.assertEqual(f.archivos, ["src/a.py"])
        txt = render(f, "demo", 70).plain
        self.assertIn("SUBAGENTES EN MARCHA · 1", txt)
        self.assertIn("ejecutor", txt)
        self.assertIn("ARCHIVOS EDITADOS POR CLAUDE · 1", txt)
        self.assertIn("ACTIVIDAD RECIENTE", txt)
        self.assertIn("Edita src/a.py", txt)
        self.assertIn("a.py  src", txt)

    def test_conteo_bloqueadas_y_pendientes_de_fase(self):
        repo = repo_con_tarjeta()
        d = repo / "backlog" / "tasks"
        for n, estado, deps in ((2, "Hecho", ""), (3, "Planificado", "dependencies:\n  - task-2\n  - TASK-4\n"),
                                (4, "Verificando", ""), (5, "Hecho", "dependencies: [TASK-3]\n")):
            (d / f"task-{n} - x.md").write_text(f"---\nid: TASK-{n}\ntitle: T{n}\nstatus: {estado}\nmilestone: Construcción\n{deps}---\n",
                                                encoding="utf8")
        f = focus.cargar(repo, "p", repo / "ev", None, date(2026, 10, 12), con_git=False)
        self.assertEqual(f.conteo, {"Planificado": 1, "En curso": 1, "Verificando": 1, "Hecho": 2})
        self.assertEqual(f.bloqueadas, [("TASK-3", ["TASK-4"])])  # task-2 está hecha aunque cambie la caja; TASK-5 hecha no cuenta
        fase = focus.active(f.fases)
        self.assertEqual(len(f.pendientes_fase), fase.total - fase.hechas)
        self.assertEqual(f.pendientes_fase, ["TASK-1", "TASK-3", "TASK-4"])
        txt = render(f, "demo", 70).plain
        self.assertIn("⊘ TASK-3 bloqueada por TASK-4", txt)
        self.assertIn("Faltan para cerrarla: TASK-1, TASK-3, TASK-4", txt)

    def test_actividad_fallos_y_sesion_actual(self):
        repo = repo_con_tarjeta()
        ev = eventos(repo / "ev", "p", [
            {"t": "2026-10-12T08:00:00Z", "sid": "viejo", "kind": "subagent_start", "agent": "huerfano"},
            {"t": "2026-10-12T09:00:00Z", "sid": "abc", "kind": "prompt"},
            {"t": "2026-10-12T09:00:01Z", "sid": "abc", "kind": "tool", "tool": "Read", "target": "a.md"},
            {"t": "2026-10-12T09:00:02Z", "sid": "abc", "kind": "tool_fail", "tool": "Bash", "target": "npm test"},
            {"t": "2026-10-12T09:00:03Z", "sid": "abc", "kind": "tool", "tool": "Edit", "target": "b.py"},
            {"t": "2026-10-12T09:00:04Z", "sid": "viejo", "kind": "tool", "tool": "Edit", "target": "ajeno.py"},
            {"t": "2026-10-12T09:00:05Z", "sid": "abc", "kind": "stop"},
        ])
        st = repo / "st"
        st.mkdir()
        (st / "a.json").write_text(json.dumps({"slug": "p", "sid": "abc", "ctx_pct": 30, "presupuesto": {
            "fecha": "2026-10-11", "dia": {"pct": 50}, "tarjeta": {"id": "TASK-1", "pct": 40}}}), encoding="utf8")
        ahora = datetime(2026, 10, 12, 10, 5, tzinfo=timezone.utc)
        f = focus.cargar(repo, "p", ev, st, date(2026, 10, 12), con_git=False, ahora=ahora)
        self.assertEqual(f.subagentes, [])  # el de otra sesión no cuenta como en marcha
        self.assertEqual(f.archivos, ["b.py"])
        self.assertEqual([t for _, t in f.fallos], ["Falla Bash npm test"])
        self.assertEqual(f.actividad[-1][1], "Termina el turno")
        self.assertNotIn("Mensaje del usuario", [t for _, t in f.actividad])
        self.assertTrue(f.claude_espera)
        self.assertEqual(f.minutos, 65)
        self.assertIsNone(f.sesion.dia_pct)  # presupuesto de ayer: se ignora
        self.assertIsNone(f.sesion.tarjeta_pct)
        txt = render(f, "demo", 70).plain
        self.assertIn("ACTIVIDAD RECIENTE · 1 fallo", txt)
        self.assertIn("✗", txt)
        self.assertIn("te toca", txt)
        self.assertIn("1 h 05 min", txt)
        (st / "a.json").write_text(json.dumps({"slug": "p", "sid": "abc", "presupuesto": {
            "fecha": "2026-10-12", "dia": {"pct": 50}, "tarjeta": {"id": "TASK-1", "pct": 40}}}), encoding="utf8")
        f = focus.cargar(repo, "p", ev, st, date(2026, 10, 12), con_git=False, ahora=ahora)
        self.assertEqual((f.sesion.dia_pct, f.sesion.tarjeta_pct), (50, 40))
        txt = render(f, "demo", 70).plain
        self.assertIn("50% gastado", txt)
        self.assertIn("40% gastado", txt)
        # el usuario escribe tras el fin de turno: Claude vuelve a trabajar aunque el prompt no salga en la actividad
        dia = ev / "p" / "2026-10-12.jsonl"
        dia.write_text(dia.read_text(encoding="utf8") + "\n" + json.dumps(
            {"t": "2026-10-12T10:04:30Z", "sid": "abc", "kind": "prompt"}), encoding="utf8")
        f = focus.cargar(repo, "p", ev, st, date(2026, 10, 12), con_git=False, ahora=ahora)
        self.assertFalse(f.claude_espera)
        self.assertIn("Claude trabajando", render(f, "demo", 70).plain)
        f = focus.cargar(repo, "p", ev, st, date(2026, 10, 12), con_git=False, ahora=datetime(2026, 10, 12, 11, 0, tzinfo=timezone.utc))
        self.assertIn("sin actividad desde", render(f, "demo", 70).plain)
        (st / "a.json").write_text(json.dumps({"slug": "p", "sid": "nuevo"}), encoding="utf8")
        f = focus.cargar(repo, "p", ev, st, date(2026, 10, 12), con_git=False, ahora=ahora)
        self.assertEqual((f.archivos, f.actividad, f.fallos), ([], [], []))  # tras /clear no se mezcla la sesión anterior

    def test_rama_y_cambios_de_git(self):
        repo = repo_con_tarjeta()
        if subprocess.run(["git", "init", "-q", "-b", "trabajo"], cwd=repo, capture_output=True).returncode != 0:
            self.skipTest("git no disponible")
        f = focus.cargar(repo, "p", repo / "ev", None, date(2026, 10, 12))
        self.assertEqual(f.rama, "trabajo")
        self.assertTrue(f.git and all(not x.startswith("##") for x in f.git))
        self.assertIn("CAMBIOS SIN COMMIT · 2 · rama trabajo", render(f, "demo", 70).plain)

    def test_aviso_de_contexto_alto(self):
        f = focus.Foco(sesion=focus.session.SesionEstado(ctx_pct=82.0, cost=1.5), siguiente="/guardar")
        for ancho in (30, 70, 110):
            txt = render(f, "demo", ancho).plain
            self.assertIn("/guardar y /clear", txt)
            self.assertIn("82%", txt)  # contexto usado, no el que queda
            self.assertNotIn("18%", txt)
        self.assertIn("CONTEXTO ALTO (82%)", render(f, "demo", 70).plain)
        self.assertIn("82% usado", render(f, "demo", 70).plain)
        f.sesion.ctx_pct = 20.0
        self.assertNotIn("/guardar y /clear", render(f, "demo").plain)
        f.sesion.ctx_pct = float(focus.CTX_AVISO)
        self.assertIn("/guardar y /clear", render(f, "demo").plain)

    def test_sin_sesion_sin_git_y_sin_tarjeta(self):
        f = focus.Foco(siguiente="/planificar")
        for ancho in ANCHOS:
            t = render(f, "demo", ancho)
            self.assertCabe(t, ancho)
            self.assertIn("sin sesión", t.plain)
            self.assertIn("Sin tarjeta en curso", t.plain)
            self.assertIn("git no disponible", t.plain)
        self.assertIn("CAMBIOS SIN COMMIT · 0", render(focus.Foco(git=[]), "demo").plain)
        self.assertIn("todo commiteado", render(focus.Foco(git=[]), "demo").plain)

    def test_no_desborda_a_ningun_ancho(self):
        variantes = [foco_completo(1), foco_completo(25, ctx=95, espera=True),
                     foco_completo(4, titulo="漢字のタイトル 🐉 muy larga " * 6), focus.Foco()]
        for f in variantes:
            for ancho in ANCHOS:
                for kw in ({}, {"fases": FASES, "gam": gam(), "res": res()}, {"res": res(None)}):
                    with self.subTest(ancho=ancho, kw=list(kw)):
                        self.assertCabe(render(f, "demo-hq", ancho, frame=3, **kw), ancho)

    def test_listas_largas_se_recortan(self):
        f = foco_completo(30)
        txt = render(f, "demo", 70).plain
        self.assertIn("… y 22 más", txt)  # objetivos
        self.assertIn("… y 25 más", txt)  # subagentes
        self.assertIn("CAMBIOS SIN COMMIT · 31", txt)
        self.assertIn("archivo_29.py", txt)  # lo más reciente primero
        self.assertNotIn("archivo_0.py", txt)
        compacto = render(f, "demo", 30).plain
        self.assertIn("… y 26 más", compacto)  # solo 4 objetivos en modo compacto
        self.assertLess(len(compacto.split("\n")), len(txt.split("\n")))

    def test_objetivos_pendientes_tienen_prioridad(self):
        items = [(i, f"hecho {i}", True) for i in range(10)] + [(10, "pendiente clave", False)]
        f = focus.Foco(tarjeta=Task(id="T-1", title="x", criteria_items=items))
        self.assertIn("pendiente clave", render(f, "demo", 70).plain)

    def test_texto_externo_con_caracteres_de_control(self):
        malo = "evil\x1b[31m\x07‮\r\nrojo"
        f = focus.Foco(tarjeta=Task(id="T\x1b-1", title=malo, criteria_items=[(0, malo, False)], dependencies=[malo]),
                       siguiente="/ejecutar " + malo, subagentes=[malo], archivos=[malo], git=[malo],
                       sesion=focus.session.SesionEstado(model_name=malo, ctx_pct=10), rama=malo,
                       bloqueadas=[(malo, [malo])], pendientes_fase=[malo], actividad=[(malo, malo)], fallos=[(malo, malo)],
                       conteo={"Planificado": 1})
        for ancho in (30, 70, 110):
            t = render(f, "x\x1bnombre[bold]", ancho, fases=[Fase("f", malo, "m", None, "activa", 1, 0)])
            for c in ("\x1b", "\x07", "‮", "\r"):
                self.assertNotIn(c, t.plain)
            self.assertIn("[bold]", t.plain.lower())  # sin markup interpretado
            self.assertCabe(t, ancho)

    def test_sesion_coste_y_presupuesto(self):
        f = foco_completo(2)
        r = res(30)
        r.por_tarjeta = [("demo", "TASK-7", 0.8), ("otro", "TASK-7", 9.0)]
        txt = render(f, "demo", 70, gam=gam(), res=r).plain
        self.assertIn("SESIÓN · Opus · 1 h 05 min", txt)
        self.assertIn("30% gastado", txt)  # presupuesto del día: lo gastado, no lo que queda
        self.assertNotIn("70%", txt)
        self.assertIn("sesión $1.23 · tarjeta $0.80 · hoy $1.50", txt)
        self.assertIn("entrada 123.5k · salida 7.9k", txt)
        self.assertNotIn("XP", txt)
        self.assertNotIn("racha", txt)
        self.assertIn("sin presupuesto configurado", render(f, "demo", 70, res=res(None)).plain)
        self.assertIn("PRESUPUESTO DEL DÍA SUPERADO (120%)", render(f, "demo", 70, res=res(120)).plain)
        f.sesion.tarjeta_id, f.sesion.tarjeta_pct = "task-7", 45
        self.assertIn("PRESUP. TARJ.", render(f, "demo", 70).plain)
        f.sesion.tarjeta_id = "TASK-99"
        self.assertNotIn("PRESUP. TARJ.", render(f, "demo", 70).plain)

    def test_mapa_de_fases(self):
        txt = render(foco_completo(), "demo", 70, frame=0, fases=FASES).plain
        self.assertIn("●", txt)
        self.assertIn("◎", txt)
        self.assertIn("FASE 2/3 · Construcción", txt)
        self.assertIn("Fase 2 de 3: Construcción · 3/3 hechas", txt)
        self.assertIn("Completa: espera tu aprobación", txt)
        self.assertIn("Tarjetas Planificado 3 · En curso 1 · Verificando 2 · Hecho 5", txt)
        self.assertIn("⊘ TASK-0 bloqueada por TASK-1, TASK-漢字-2", txt)
        hechas = [Fase("f1", "A", "A", "x", "aprobada", 1, 1)]
        self.assertIn("Todas las fases aprobadas", render(focus.Foco(), "d", 70, fases=hechas).plain)

    def test_dos_columnas_a_partir_de_100(self):
        f = foco_completo()
        ancho = render(f, "demo", 110, fases=FASES, gam=gam(), res=res())
        estrecho = render(f, "demo", 70, fases=FASES, gam=gam(), res=res())
        self.assertLess(len(ancho.plain.split("\n")), len(estrecho.plain.split("\n")))
        self.assertTrue(any("TAREA ACTIVA" in ln and "SESIÓN" in ln for ln in ancho.plain.split("\n")))
        self.assertIn("SIGUIENTE ACCIÓN", ancho.plain.split("\n")[1])

    def test_tira_de_vitales_solo_si_no_cabe(self):
        f = foco_completo(8, ctx=40)
        self.assertNotIn("CRIT 4/8", render(f, "demo", 70, gam=gam(), res=res()).plain)
        bajo = render(f, "demo", 70, gam=gam(), res=res(), alto=12)
        segunda = bajo.plain.split("\n")[1]
        for trozo in ("CTX", "40%", "DÍA 30%", "CRIT 4/8", "► /ejecutar TASK-7"):
            self.assertIn(trozo, segunda)
        self.assertCabe(bajo, 70)
        self.assertCabe(render(focus.Foco(), "d", 30, alto=3), 30)

    def test_barra_y_degradado(self):
        self.assertEqual(mezcla(["#000000", "#FFFFFF"], 0), "#000000")
        self.assertEqual(mezcla(["#000000", "#FFFFFF"], 1), "#FFFFFF")
        self.assertEqual(mezcla(["#000000", "#FFFFFF"], 0.5), "#808080")
        for pct in (None, -5, 0, 33, 100, 250):
            self.assertEqual(barra(pct, 12, ["#000000", "#FFFFFF"]).cell_len, 12)
        self.assertEqual(barra(100, 5, ["#000000", "#FFFFFF"]).plain, "█████")

    def test_iconos_de_ancho_simple(self):
        for c in "◆✓◇►⚠●◉◎○⠋⊘✗↓↑·━─▁█":
            self.assertEqual(cell_len(c), 1, c)

    def test_animado_solo_cuando_hace_falta(self):
        self.assertFalse(animado(None))
        self.assertFalse(animado(focus.Foco()))
        self.assertTrue(animado(focus.Foco(espera_aprobacion=True)))
        self.assertTrue(animado(focus.Foco(subagentes=["x"])))
        self.assertTrue(animado(focus.Foco(sesion=focus.session.SesionEstado(ctx_pct=90))))


class FocoPantallaTest(unittest.TestCase):
    def _correr(self, ancho, prueba, stats_loader=None):
        repo = repo_con_tarjeta()
        # HQApp lee los eventos de hoy y de ayer: el fichero debe llevar la fecha real de hoy.
        hoy = date.today().isoformat()
        ev = eventos(repo / "ev", "p", [{"t": f"{hoy}T10:00:00Z", "kind": "subagent_start", "agent": "ejecutor"}], dia=hoy)
        st = repo / "st"
        st.mkdir()
        (st / "a.json").write_text(json.dumps({"slug": "p", "model": "opus", "ctx_pct": 85, "cost": 2}), encoding="utf8")

        async def run():
            app = HQApp("focus", "p", repo=repo, events_dir=ev, state_dir=st)
            async with app.run_test(size=(ancho, 24)) as pilot:
                await pilot.pause()
                if stats_loader:
                    app.screen._poner_stats(stats_loader())
                await pilot.pause()
                await prueba(app, pilot, app.screen)
        asyncio.run(run())

    def test_headless_a_varios_anchos(self):
        destino = os.environ.get("HQ_CAPTURAS")
        for ancho in (40, 70, 110):
            async def prueba(app, pilot, screen, ancho=ancho):
                self.assertIsInstance(screen, FocusScreen)
                txt = screen.query_one("#foco").content
                lineas = txt.plain.split("\n")
                self.assertEqual(max(cell_len(l) for l in lineas), ancho - 1)
                self.assertEqual(screen.query_one("#foco").size.width, ancho - 1)
                self.assertIn("/guardar y /clear", txt.plain)
                self.assertIn("ejecutor", txt.plain)
                self.assertTrue(screen._latido is not None and screen._latido._active.is_set())
                antes = screen.frame
                await pilot.pause(0.6)
                self.assertGreater(screen.frame, antes)
                if destino:
                    app.save_screenshot(f"foco-{ancho}.svg", path=destino)
            self._correr(ancho, prueba, lambda: (res(), gam()))

    def test_panel_bajo_muestra_la_vida_arriba(self):
        for size in ((70, 12), (40, 10)):
            repo = repo_con_tarjeta()
            st = repo / "st"
            st.mkdir()
            (st / "a.json").write_text(json.dumps({"slug": "p", "ctx_pct": 40}), encoding="utf8")

            async def run(size=size):
                app = HQApp("focus", "p", repo=repo, events_dir=repo / "ev", state_dir=st)
                async with app.run_test(size=size) as pilot:
                    await pilot.pause()
                    visibles = app.screen.query_one("#foco").content.plain.split("\n")[:size[1]]
                    self.assertTrue(any("CTX" in l and "40%" in l for l in visibles), visibles)
            asyncio.run(run())

    def test_latido_en_pausa_sin_animacion(self):
        repo = repo_con_tarjeta()

        async def run():
            app = HQApp("focus", "p", repo=repo, events_dir=repo / "ev")
            async with app.run_test(size=(60, 20)) as pilot:
                await pilot.pause()
                screen = app.screen
                self.assertFalse(screen._latido._active.is_set())
                antes = screen.frame
                await pilot.pause(0.6)
                self.assertEqual(screen.frame, antes)
                await pilot.press("r")
                self.assertIn("TAREA ACTIVA", screen.query_one("#foco").content.plain)
        asyncio.run(run())


if __name__ == "__main__":
    unittest.main()
