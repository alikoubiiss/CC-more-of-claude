"""estado_claude: ¿está libre el Claude del panel? (docs/ARQUITECTURA.md de obsidian, «Ejecutar y revisar en el panel
de Claude», punto 1, y los casos medidos en el spike TASK-18)."""
import json
import re
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from hq import events, focus
from hq.focus import estado_claude

SLUG = "demo"
AHORA = datetime(2026, 10, 13, 12, 0, 0, tzinfo=timezone.utc)
PANEL, OTRA = "aaaa1111", "bbbb2222"


def ev(kind: str, hace: float, sid: str = PANEL, **extra) -> dict:
    """Evento como lo escribe hooks/event.mjs, `hace` segundos antes de AHORA."""
    t = (AHORA - timedelta(seconds=hace)).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    return {"t": t, "sid": sid, "kind": kind, "tool": None, "target": None, "agent": None, "model": "opus", "slug": SLUG,
            **extra}


def carpeta(lineas: list[dict], ahora: datetime = AHORA) -> Path:
    """events/<slug>/<fecha local de `ahora`>.jsonl, como appendEvent (ymd con la hora local)."""
    base = Path(tempfile.mkdtemp(prefix="hq-estado-"))
    d = base / SLUG
    d.mkdir(parents=True)
    (d / f"{ahora.astimezone().date().isoformat()}.jsonl").write_text(
        "\n".join(json.dumps(x) for x in lineas) + "\n", encoding="utf8")
    return base


def estado(lineas, ahora: datetime = AHORA, state_dir=None):
    return estado_claude(carpeta(lineas, ahora), state_dir, SLUG, ahora)


class EstadoClaudeTest(unittest.TestCase):
    def assertNoLibre(self, r, esperado: str):
        e, motivo = r
        self.assertEqual(e, esperado, motivo)
        self.assertTrue(motivo.strip(), "todo estado que no es libre trae motivo")
        self.assertLessEqual(len(motivo), 80, motivo)

    # ------------------------------------------------------------ criterio 2: cuándo es libre

    def test_stop_de_hace_mas_de_1_5_s_es_libre(self):
        r = estado([ev("prompt", 60), ev("tool", 50, tool="Bash", target="npm test"), ev("stop", 10)])
        self.assertEqual(r[0], "libre", r[1])

    def test_inicio_con_source_clear_es_libre(self):
        self.assertEqual(estado([ev("inicio", 5, source="clear")])[0], "libre")

    def test_subagent_stop_sin_agente_tras_el_stop_es_ruido(self):
        # Spike 5.4: tras muchos `stop` llega 1-183 s después un `subagent_stop` con agent null; el reposo sigue siendo libre.
        r = estado([ev("prompt", 60), ev("stop", 10), ev("subagent_stop", 0.2)])
        self.assertEqual(r[0], "libre", r[1])

    def test_subagente_cerrado_antes_del_stop_es_libre(self):
        r = estado([ev("prompt", 60), ev("tool", 55, tool="Agent"), ev("subagent_start", 54, agent="project-hq:ejecutor"),
                    ev("tool", 40, agent="project-hq:ejecutor", tool="Bash"),
                    ev("subagent_stop", 20, agent="project-hq:ejecutor"), ev("stop", 10)])
        self.assertEqual(r[0], "libre", r[1])

    def test_panel_en_reposo_mas_de_30_min_sigue_siendo_libre(self):
        self.assertEqual(estado([ev("prompt", 3 * 3600), ev("stop", 2 * 3600)])[0], "libre")

    # ------------------------------------------------------------ criterio 2: cuándo no es libre (y con motivo)

    def test_turno_en_curso_es_ocupado(self):
        self.assertNoLibre(estado([ev("stop", 120), ev("prompt", 60)]), "ocupado")
        self.assertNoLibre(estado([ev("prompt", 60), ev("tool", 30, tool="Bash", target="npm test")]), "ocupado")
        self.assertNoLibre(estado([ev("prompt", 60), ev("tool_fail", 30, tool="Bash")]), "ocupado")
        # Diálogo de permiso o AskUserQuestion abierto: el último evento es el PreToolUse (spike 5.4, sid 9c8210d2).
        self.assertNoLibre(estado([ev("prompt", 60), ev("tool", 50, tool="AskUserQuestion")]), "ocupado")

    def test_subagent_start_sin_cierre_es_ocupado(self):
        self.assertNoLibre(estado([ev("prompt", 60), ev("subagent_start", 30, agent="project-hq:ejecutor")]), "ocupado")
        # Subagente en segundo plano: el turno principal ya paró, pero el subagente sigue abierto.
        r = estado([ev("prompt", 60), ev("subagent_start", 50, agent="project-hq:ejecutor"), ev("stop", 40),
                    ev("subagent_stop", 38)])
        self.assertNoLibre(r, "ocupado")
        self.assertIn("ejecutor", r[1])

    def test_fin_es_ocupado(self):
        self.assertNoLibre(estado([ev("stop", 120), ev("fin", 60, reason="prompt_input_exit")]), "ocupado")
        self.assertNoLibre(estado([ev("stop", 120), ev("fin", 60, reason="clear")]), "ocupado")

    def test_inicio_startup_compact_o_resume_es_desconocido(self):
        for source in ("startup", "compact", "resume"):
            with self.subTest(source=source):
                r = estado([ev("inicio", 30, source=source)])
                self.assertNoLibre(r, "desconocido")
                self.assertIn(source, r[1])
        # /compact mantiene la sid: el inicio llega detrás de los eventos del turno.
        self.assertNoLibre(estado([ev("prompt", 60), ev("stop", 50), ev("inicio", 30, source="compact")]), "desconocido")

    def test_inicio_sin_source_y_otros_eventos_no_son_libre(self):
        self.assertNoLibre(estado([ev("inicio", 30)]), "desconocido")
        self.assertNoLibre(estado([ev("stop", 60), ev("model", 30)]), "desconocido")
        self.assertNoLibre(estado([ev("stop", 60), ev("raro", 30)]), "desconocido")

    # ------------------------------------------------------------ criterio 3: qué sesión es la del panel

    def test_la_sesion_se_elige_por_eventos_y_no_por_state(self):
        estados = Path(tempfile.mkdtemp(prefix="hq-estado-state-"))
        (estados / f"{OTRA}.json").write_text(json.dumps({"slug": SLUG, "sid": OTRA, "model": "opus"}), encoding="utf8")
        # OTRA es la del fichero de state, pero lleva 2 h parada a mitad de turno; la del panel es la de eventos más recientes.
        lineas = [ev("prompt", 2 * 3600 + 60, sid=OTRA), ev("tool", 2 * 3600, sid=OTRA), ev("prompt", 60), ev("stop", 10)]
        r = estado(lineas, state_dir=estados)
        self.assertEqual(r[0], "libre", r[1])
        # Y al revés: si la de eventos más recientes está a mitad de turno, es ocupado aunque state apunte a otra en reposo.
        lineas = [ev("stop", 2 * 3600, sid=OTRA), ev("prompt", 60), ev("tool", 30, tool="Bash")]
        self.assertNoLibre(estado(lineas, state_dir=estados), "ocupado")

    def test_tras_clear_la_sid_nueva_esta_libre(self):
        lineas = [ev("prompt", 60, sid=OTRA), ev("stop", 30, sid=OTRA), ev("fin", 10, sid=OTRA, reason="clear"),
                  # En el panel la sid nueva empezó con un subagent_stop sin agente (spike 5.4, sid 2463b4f1).
                  ev("subagent_stop", 9.8), ev("inicio", 9.54, source="clear")]
        r = estado(lineas)
        self.assertEqual(r[0], "libre", r[1])

    def test_tras_clear_con_los_hooks_async_desordenados_sigue_libre(self):
        # Los dos hooks son async: el fin de la sid vieja puede quedar apuntado unos ms después del inicio de la nueva.
        lineas = [ev("stop", 30, sid=OTRA), ev("inicio", 10, source="clear"), ev("fin", 9.9, sid=OTRA, reason="clear")]
        r = estado(lineas)
        self.assertEqual(r[0], "libre", r[1])

    def test_clear_sin_sesion_nueva_todavia_no_es_libre(self):
        # Entre el fin (clear) y el inicio de la sid nueva no hay sesión viva conocida.
        self.assertNoLibre(estado([ev("stop", 30, sid=OTRA), ev("fin", 10, sid=OTRA, reason="clear")]), "ocupado")
        lineas = [ev("stop", 3 * 3600), ev("stop", 30, sid=OTRA), ev("fin", 10, sid=OTRA, reason="clear")]
        self.assertNoLibre(estado(lineas), "ocupado")

    def test_otra_sid_viva_en_los_ultimos_30_min_es_desconocido(self):
        lineas = [ev("prompt", 25 * 60, sid=OTRA), ev("stop", 20 * 60, sid=OTRA), ev("prompt", 60), ev("stop", 10)]
        r = estado(lineas)
        self.assertNoLibre(r, "desconocido")
        # Una sesión headless (`claude -p`) de hace 29 min también cuenta: no se sabe cuál es la del panel.
        self.assertNoLibre(estado([ev("stop", 29 * 60, sid=OTRA), ev("stop", 10)]), "desconocido")

    def test_otra_sid_con_fin_o_de_hace_mas_de_30_min_no_estorba(self):
        self.assertEqual(estado([ev("stop", 31 * 60, sid=OTRA), ev("stop", 10)])[0], "libre")
        lineas = [ev("stop", 20 * 60, sid=OTRA), ev("fin", 15 * 60, sid=OTRA, reason="other"), ev("stop", 10)]
        self.assertEqual(estado(lineas)[0], "libre")

    def test_claude_cerrado_no_cae_en_una_sesion_vieja(self):
        # Se cerró Claude en el panel (fin) y queda una sid vieja sin fin (de antes de registrar fin, o que se colgó):
        # esa sid no es la del panel.
        lineas = [ev("stop", 2 * 3600, sid=OTRA), ev("prompt", 120), ev("stop", 90), ev("fin", 60, reason="prompt_input_exit")]
        r = estado(lineas)
        self.assertNoLibre(r, "ocupado")
        self.assertIn("cerrado", r[1])

    def test_una_sesion_reanudada_tras_su_fin_vuelve_a_contar(self):
        # --resume conserva la sid: el fin anterior deja de ser el último evento.
        lineas = [ev("stop", 600), ev("fin", 500, reason="other"), ev("inicio", 400, source="resume"), ev("prompt", 300),
                  ev("stop", 200)]
        self.assertEqual(estado(lineas)[0], "libre")

    def test_sin_eventos_es_desconocido(self):
        self.assertNoLibre(estado([]), "desconocido")
        self.assertNoLibre(estado_claude(Path(tempfile.mkdtemp(prefix="hq-estado-")) / "no-existe", None, SLUG, AHORA),
                           "desconocido")
        # Solo ruido (subagent_stop sin agente) tampoco identifica una sesión.
        self.assertNoLibre(estado([ev("subagent_stop", 30)]), "desconocido")

    def test_lineas_rotas_no_rompen(self):
        d = carpeta([ev("stop", 10)])
        f = next((d / SLUG).glob("*.jsonl"))
        f.write_text(f.read_text(encoding="utf8") + "{roto\n[1, 2]\n", encoding="utf8")
        self.assertEqual(estado_claude(d, None, SLUG, AHORA)[0], "libre")

    # ------------------------------------------------------------ criterio 4: margen de 1,5 s y solo lectura

    def test_stop_de_hace_menos_de_1_5_s_es_ocupado(self):
        self.assertNoLibre(estado([ev("prompt", 30), ev("stop", 1)]), "ocupado")
        self.assertNoLibre(estado([ev("prompt", 30), ev("stop", 1.499)]), "ocupado")
        self.assertEqual(estado([ev("prompt", 30), ev("stop", 1.5)])[0], "libre")
        self.assertNoLibre(estado([ev("inicio", 0.5, source="clear")]), "ocupado")

    def test_evento_con_hora_futura_es_ocupado(self):
        self.assertNoLibre(estado([ev("prompt", 30), ev("stop", -5)]), "ocupado")

    def test_ahora_por_defecto_es_la_hora_actual(self):
        ahora = datetime.now(timezone.utc)
        t = (ahora - timedelta(seconds=10)).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        d = carpeta([{"t": t, "sid": PANEL, "kind": "stop"}], ahora)
        self.assertEqual(estado_claude(d, None, SLUG)[0], "libre")

    def test_focus_py_solo_lee_estado(self):
        fuente = Path(focus.__file__).read_text(encoding="utf8")
        self.assertIsNone(re.search(r"new-tab|SendInput", fuente))


def ev_en(ahora: datetime, kind: str, hace: float, sid: str = PANEL, **extra) -> dict:
    """Como ev(), pero `hace` segundos antes de otro `ahora`."""
    d = ev(kind, 0, sid, **extra)
    d["t"] = (ahora - timedelta(seconds=hace)).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    return d


def carpeta_por_dia(lineas: list[dict]) -> Path:
    """Cada evento en el jsonl de su fecha local, como appendEvent."""
    base = Path(tempfile.mkdtemp(prefix="hq-estado-"))
    (base / SLUG).mkdir(parents=True)
    for x in lineas:
        dia = datetime.fromisoformat(x["t"].replace("Z", "+00:00")).astimezone().date().isoformat()
        with open(base / SLUG / f"{dia}.jsonl", "a", encoding="utf8") as f:
            f.write(json.dumps(x) + "\n")
    return base


def carpeta_cruda(contenido: bytes, ahora: datetime = AHORA) -> Path:
    """events/<slug>/<fecha>.jsonl con bytes tal cual (líneas rotas, UTF-8 inválido...)."""
    base = Path(tempfile.mkdtemp(prefix="hq-estado-"))
    (base / SLUG).mkdir(parents=True)
    (base / SLUG / f"{ahora.astimezone().date().isoformat()}.jsonl").write_bytes(contenido)
    return base


def jsonl(*lineas) -> bytes:
    return b"".join((x if isinstance(x, bytes) else (x if isinstance(x, str) else json.dumps(x)).encode("utf8")) + b"\n"
                    for x in lineas)


# Líneas corruptas que puede dejar un append cortado o un fichero tocado a mano.
CORRUPTAS = ["{roto", "[1, 2]", '"texto"', "null", "42", "", "   ", "[" * 50_000,
             json.dumps({"sid": PANEL, "kind": "stop"}),  # sin t
             json.dumps({"t": 5, "sid": PANEL, "kind": "stop"}),
             json.dumps({"t": None, "sid": PANEL, "kind": "stop"}),
             json.dumps({"t": "ayer", "sid": PANEL, "kind": "stop"})]


def sin_sid(hace: float) -> list[dict]:
    """El mismo `stop` sin sid de todas las formas posibles."""
    out = []
    for valor in (None, "", "   ", [], {}, "\u0007", "missing"):
        d = ev("stop", hace)
        if valor == "missing":
            del d["sid"]
        else:
            d["sid"] = valor
        out.append(d)
    return out


class CasosLimiteTest(unittest.TestCase):
    """TASK-21: pruebas negativas de la puerta «Claude libre». Un falso libre haría que el Enter aprobara un permiso."""

    def assertNoLibre(self, r, esperado: str | None = None):
        e, motivo = r
        self.assertNotEqual(e, "libre", motivo)
        if esperado:
            self.assertEqual(e, esperado, motivo)
        self.assertTrue(motivo.strip())

    # ------------------------------------------------------------ criterio 1: /compact a mitad de turno

    def test_inicio_compact_a_mitad_de_turno_no_es_libre(self):
        turno = [ev("prompt", 60), ev("tool", 50, tool="Bash", target="npm test")]
        for ahora in (AHORA, AHORA + timedelta(hours=2)):  # pasado el margen de 1,5 s y con el compact ya viejo
            with self.subTest(ahora=ahora):
                r = estado(turno + [ev("inicio", 30, source="compact")], ahora=ahora)
                self.assertNoLibre(r, "desconocido")
                self.assertIn("compact", r[1])
        # Tras el compact el turno sigue: herramienta o subagente nuevos son ocupado.
        self.assertNoLibre(estado(turno + [ev("inicio", 30, source="compact"), ev("tool", 10, tool="Edit")]), "ocupado")
        self.assertNoLibre(estado(turno + [ev("inicio", 30, source="compact"),
                                           ev("subagent_start", 10, agent="project-hq:ejecutor")]), "ocupado")
        # El ruido (subagent_stop sin agente) detrás del compact no lo convierte en libre.
        self.assertNoLibre(estado(turno + [ev("inicio", 30, source="compact"), ev("subagent_stop", 10)]), "desconocido")
        # Con un subagente abierto antes del compact tampoco.
        r = estado([ev("prompt", 60), ev("subagent_start", 55, agent="project-hq:ejecutor"),
                    ev("tool", 50, agent="project-hq:ejecutor", tool="Bash"), ev("inicio", 30, source="compact")])
        self.assertNoLibre(r, "desconocido")

    # ------------------------------------------------------------ criterio 2: sid antigua sin `fin`

    def test_sid_antigua_colgada_reciente_es_desconocido(self):
        # OTRA se quedó a mitad de turno (último evento un tool) hace 20 min y nunca registró `fin`.
        lineas = [ev("prompt", 25 * 60, sid=OTRA), ev("tool", 20 * 60, sid=OTRA, tool="Bash"), ev("prompt", 60),
                  ev("stop", 10)]
        r = estado(lineas)
        self.assertNoLibre(r, "desconocido")
        self.assertIn(OTRA, r[1])
        # Aunque la del panel esté en turno, la duda manda: no se sabe cuál es la del panel.
        lineas = [ev("tool", 20 * 60, sid=OTRA, tool="Bash"), ev("prompt", 60), ev("tool", 10, tool="Bash")]
        self.assertNoLibre(estado(lineas), "desconocido")

    def test_borde_de_los_30_min(self):
        dentro = [ev("prompt", 40 * 60, sid=OTRA), ev("tool", 30 * 60 - 1, sid=OTRA, tool="Bash"), ev("prompt", 60),
                  ev("stop", 10)]
        self.assertNoLibre(estado(dentro), "desconocido")
        fuera = [ev("prompt", 40 * 60, sid=OTRA), ev("tool", 30 * 60 + 1, sid=OTRA, tool="Bash"), ev("prompt", 60),
                 ev("stop", 10)]
        r = estado(fuera)
        self.assertEqual(r[0], "libre", r[1])

    def test_sid_antigua_de_mas_de_30_min_no_bloquea_la_actual(self):
        vieja = [ev("prompt", 3 * 3600, sid=OTRA), ev("tool", 2 * 3600, sid=OTRA, tool="AskUserQuestion")]
        r = estado(vieja + [ev("prompt", 60), ev("stop", 10)])
        self.assertEqual(r[0], "libre", r[1])
        # No bloquea, pero tampoco tapa el estado real de la actual.
        self.assertNoLibre(estado(vieja + [ev("prompt", 60), ev("tool", 10, tool="Bash")]), "ocupado")
        self.assertNoLibre(estado(vieja + [ev("inicio", 30, source="startup")]), "desconocido")
        # Un subagente que quedó abierto en la sid vieja no cuenta como abierto en la actual.
        vieja = [ev("prompt", 3 * 3600, sid=OTRA), ev("subagent_start", 2 * 3600, sid=OTRA, agent="project-hq:ejecutor")]
        r = estado(vieja + [ev("prompt", 60), ev("stop", 10)])
        self.assertEqual(r[0], "libre", r[1])

    def test_sid_antigua_en_el_fichero_de_ayer_tambien_cuenta(self):
        # A las 00:05 locales, una sid colgada a las 23:55 de ayer está en el jsonl de ayer y sigue dentro de los 30 min.
        ahora = datetime.combine(AHORA.astimezone().date(), datetime.min.time()).astimezone() + timedelta(minutes=5)
        lineas = [ev_en(ahora, "prompt", 12 * 60, sid=OTRA), ev_en(ahora, "tool", 10 * 60, sid=OTRA, tool="Bash"),
                  ev_en(ahora, "prompt", 60), ev_en(ahora, "stop", 10)]
        d = carpeta_por_dia(lineas)
        self.assertEqual(len(list((d / SLUG).glob("*.jsonl"))), 2)
        self.assertNoLibre(estado_claude(d, None, SLUG, ahora), "desconocido")

    # ------------------------------------------------------------ criterio 3: eventos fuera de orden en el jsonl

    def test_tool_anterior_al_stop_escrito_despues_se_ordena_por_t(self):
        # El hook async del tool se apuntó tarde: en el fichero va detrás del stop, pero su t es anterior.
        r = estado([ev("prompt", 60), ev("stop", 10), ev("tool", 30, tool="Bash")])
        self.assertEqual(r[0], "libre", r[1])
        r = estado([ev("stop", 10), ev("tool", 30, tool="Bash"), ev("prompt", 60)])
        self.assertEqual(r[0], "libre", r[1])

    def test_evento_posterior_al_stop_escrito_antes_nunca_es_libre(self):
        posteriores = [ev("prompt", 5), ev("tool", 5, tool="Bash"), ev("tool_fail", 5, tool="Bash"),
                       ev("subagent_start", 5, agent="project-hq:ejecutor"),
                       ev("subagent_stop", 5, agent="project-hq:ejecutor"), ev("inicio", 5, source="compact"),
                       ev("inicio", 5, source="startup"), ev("inicio", 5, source="resume"), ev("inicio", 5),
                       ev("fin", 5, reason="other"), ev("model", 5), ev("raro", 5)]
        for p in posteriores:
            with self.subTest(kind=p["kind"], source=p.get("source"), agent=p["agent"]):
                # En el fichero el posterior va delante del stop (y del prompt), pero su t es más nuevo.
                self.assertNoLibre(estado([p, ev("prompt", 60), ev("stop", 10)]))
                # Y también con el margen de 1,5 s ya cumplido para el posterior.
                self.assertNoLibre(estado([p, ev("prompt", 60), ev("stop", 10)], ahora=AHORA + timedelta(minutes=5)))

    def test_se_ordena_por_instante_y_no_por_el_texto_de_t(self):
        # stop a las 11:59:50Z escrito como 13:59:50+02:00; el tool de las 11:59:55Z es posterior aunque su texto
        # ordene antes. Ordenar por cadena daría un falso libre.
        stop = ev("stop", 10)
        stop["t"] = (AHORA - timedelta(seconds=10)).astimezone(timezone(timedelta(hours=2))).isoformat(
            timespec="milliseconds")
        tool = ev("tool", 5, tool="Bash")
        self.assertGreater(stop["t"], tool["t"])
        self.assertNoLibre(estado([ev("prompt", 60), tool, stop]), "ocupado")
        self.assertNoLibre(estado([ev("prompt", 60), stop, tool]), "ocupado")

    # ------------------------------------------------------------ criterio 4: líneas corruptas o sin sid

    def test_lineas_corruptas_y_sin_sid_se_ignoran(self):
        d = carpeta_cruda(jsonl(ev("prompt", 60), *CORRUPTAS, ev("stop", 10), *CORRUPTAS))
        r = estado_claude(d, None, SLUG, AHORA)
        self.assertEqual(r[0], "libre", r[1])
        # Un stop sin sid más reciente que el turno en curso del panel no lo cierra ni se toma por otra sesión.
        d = carpeta_cruda(jsonl(ev("prompt", 60), ev("tool", 30, tool="Bash"), *sin_sid(10), *CORRUPTAS))
        self.assertNoLibre(estado_claude(d, None, SLUG, AHORA), "ocupado")
        self.assertEqual(focus.sid_panel(d, SLUG, AHORA), PANEL)

    def test_sin_ningun_evento_valido_es_desconocido(self):
        casos = {"corruptas": jsonl(*CORRUPTAS), "sin sid": jsonl(*sin_sid(10)),
                 "mezcla": jsonl(*CORRUPTAS, *sin_sid(10), *CORRUPTAS), "vacío": b"", "solo saltos": b"\n\n\r\n"}
        for nombre, contenido in casos.items():
            with self.subTest(nombre):
                d = carpeta_cruda(contenido)
                self.assertNoLibre(estado_claude(d, None, SLUG, AHORA), "desconocido")
                self.assertEqual(focus.sid_panel(d, SLUG, AHORA), "")

    def test_utf8_invalido_no_rompe_ni_pierde_el_resto_del_fichero(self):
        # Un append cortado a mitad de un carácter multibyte deja bytes que no son UTF-8.
        roto = json.dumps(ev("tool", 20, tool="Bash", target="echo ñ"), ensure_ascii=False).encode("utf8")
        roto = roto[:roto.index("ñ".encode("utf8")) + 1]
        d = carpeta_cruda(jsonl(ev("prompt", 60), roto, b"\xff\xfe\x00basura", ev("stop", 10)))
        r = estado_claude(d, None, SLUG, AHORA)
        self.assertEqual(r[0], "libre", r[1])
        # Si el fichero de hoy tiene bytes rotos y un turno en curso, no se descarta entero y se cae en el stop de ayer.
        ayer = AHORA - timedelta(days=1)
        base = carpeta_cruda(jsonl(ev("prompt", 60), roto, ev("tool", 10, tool="Bash")))
        (base / SLUG / f"{ayer.astimezone().date().isoformat()}.jsonl").write_bytes(
            jsonl(ev_en(ayer, "prompt", 60), ev_en(ayer, "stop", 10)))
        self.assertNoLibre(estado_claude(base, None, SLUG, AHORA), "ocupado")
        # Solo bytes rotos: desconocido, sin excepción.
        self.assertNoLibre(estado_claude(carpeta_cruda(b"\xff\xfe\xfd\n" + roto + b"\n"), None, SLUG, AHORA), "desconocido")


class EventosInicioFinTest(unittest.TestCase):
    def test_read_recent_conserva_source_y_reason(self):
        d = carpeta([ev("fin", 20, sid=OTRA, reason="clear"), ev("inicio", 10, source="clear")])
        fin, inicio = events.read_recent(d, SLUG, hoy=AHORA.astimezone().date())
        self.assertEqual((fin.kind, fin.reason, fin.source), ("fin", "clear", ""))
        self.assertEqual((inicio.kind, inicio.source, inicio.reason), ("inicio", "clear", ""))
        self.assertNotEqual(inicio.texto, "inicio")
        self.assertNotEqual(fin.texto, "fin")


if __name__ == "__main__":
    unittest.main()
