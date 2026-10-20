import json
import os
import tempfile
import time
import unittest
from datetime import date
from pathlib import Path

from hq.events import read_recent
from hq.notes import obsidian_uri, read, tree
from hq.session import latest

HOY = date(2026, 10, 9)


def tmp() -> Path:
    return Path(tempfile.mkdtemp(prefix="hq-test-"))


def linea(**kw) -> str:
    base = {"t": "2026-10-09T10:00:00.000Z", "sid": "abc12345", "kind": "tool", "tool": "Read", "target": "lib/state.mjs",
            "agent": None, "model": "sonnet", "slug": "demo"}
    return json.dumps({**base, **kw})


class TestEvents(unittest.TestCase):
    def _escribe(self, ev_dir: Path, dia: str, lineas: list[str]):
        d = ev_dir / "demo"
        d.mkdir(parents=True, exist_ok=True)
        (d / f"{dia}.jsonl").write_text("\n".join(lineas) + "\n", encoding="utf8")

    def test_orden_corruptas_y_limite(self):
        ev = tmp()
        self._escribe(ev, "2026-10-09", [
            linea(t="2026-10-09T10:00:02.000Z", tool="Bash", target="npm test"),
            "{no es json",
            linea(t="2026-10-09T10:00:01.000Z"),
            linea(t="2026-10-09T10:00:03.000Z", kind="stop", tool=None, target=None),
        ])
        self._escribe(ev, "2026-10-08", [linea(t="2026-10-08T23:59:00.000Z", tool="Grep", target="chat_id")])
        out = read_recent(ev, "demo", hoy=HOY)
        self.assertEqual([e.texto for e in out], ["Busca chat_id", "Lee lib/state.mjs", "Ejecuta npm test", "Termina el turno"])
        self.assertRegex(out[0].hora, r"^\d\d:\d\d:\d\d$")
        self.assertEqual(len(read_recent(ev, "demo", limit=2, hoy=HOY)), 2)
        self.assertEqual(read_recent(ev, "demo", limit=2, hoy=HOY)[-1].texto, "Termina el turno")

    def test_frases(self):
        ev = tmp()
        self._escribe(ev, "2026-10-09", [
            linea(t="2026-10-09T10:00:01.000Z", tool="Edit", target="a.js"),
            linea(t="2026-10-09T10:00:02.000Z", kind="subagent_start", tool=None, target=None, agent="ejecutor"),
            linea(t="2026-10-09T10:00:03.000Z", kind="subagent_stop", tool=None, target=None, agent="ejecutor"),
            linea(t="2026-10-09T10:00:04.000Z", kind="model", tool=None, target=None, model="opus"),
            linea(t="2026-10-09T10:00:05.000Z", kind="prompt", tool=None, target=None),
            linea(t="2026-10-09T10:00:06.000Z", kind="tool_fail", tool="Bash", target="npm x"),
            linea(t="2026-10-09T10:00:07.000Z", tool="Rara", target="z"),
        ])
        self.assertEqual([e.texto for e in read_recent(ev, "demo", hoy=HOY)], [
            "Edita a.js", "Subagente ejecutor empieza", "Subagente ejecutor termina", "Cambia a Opus",
            "Mensaje del usuario", "Falla Bash npm x", "Usa Rara z"])

    def test_texto_sin_control_y_ausente(self):
        ev = tmp()
        self.assertEqual(read_recent(ev, "demo", hoy=HOY), [])
        self._escribe(ev, "2026-10-09", [linea(target="\x1b[31mroja\u202e")])
        self.assertNotRegex(read_recent(ev, "demo", hoy=HOY)[0].texto, "[\u0000-\u001f\u007f-\u009f\u202a-\u202e]")


class TestSession(unittest.TestCase):
    def test_mas_reciente_del_proyecto(self):
        sd = tmp()
        a, b, c = sd / "aaaaaaaa.json", sd / "bbbbbbbb.json", sd / "cccccccc.json"
        a.write_text(json.dumps({"slug": "demo", "model_name": "Sonnet", "cost": 0.1}), encoding="utf8")
        b.write_text(json.dumps({"slug": "demo", "model_name": "Opus", "cost": 0.9, "ctx_pct": 12}), encoding="utf8")
        c.write_text(json.dumps({"slug": "otro", "model_name": "Haiku"}), encoding="utf8")
        (sd / "dddddddd.json").write_text("{oops", encoding="utf8")
        now = time.time()
        os.utime(a, (now - 300, now - 300))
        os.utime(b, (now - 100, now - 100))
        os.utime(c, (now, now))
        s = latest(sd, "demo")
        self.assertEqual((s.model_name, s.cost, s.ctx_pct), ("Opus", 0.9, 12))
        self.assertIsNone(latest(sd, "no-existe"))
        self.assertIsNone(latest(tmp() / "nada", "demo"))


class TestNotes(unittest.TestCase):
    def _vault(self):
        v = tmp() / "ProjectHQ"
        base = v / "Proyectos" / "demo"
        (base / "Decisiones").mkdir(parents=True)
        (base / "Sesiones").mkdir()
        (base / "Índice.md").write_text("---\nestado: idea\n---\n# Demo\n", encoding="utf8")
        (base / "Decisiones" / "2026-10-01-a.md").write_text("# Usar SQLite\n", encoding="utf8")
        (base / "Decisiones" / "2026-10-05-b.md").write_text("# Sin framework\n", encoding="utf8")
        (base / "Sesiones" / "2026-10-08-manual-154200.md").write_text("# Sesión 2026-10-08\n", encoding="utf8")
        return v

    def test_tree_y_lectura(self):
        v = self._vault()
        ns = tree(v, "Proyectos", "demo")
        self.assertEqual([(n.tipo, n.titulo) for n in ns], [
            ("indice", "Demo"), ("decision", "Sin framework"), ("decision", "Usar SQLite"), ("sesion", "Sesión 2026-10-08")])
        self.assertIn("estado: idea", read(ns[0].ruta))
        self.assertEqual(tree(v, "Proyectos", "no-existe"), [])

    def test_lectura_recortada(self):
        f = tmp() / "grande.md"
        f.write_text("x" * 300_000, encoding="utf8")
        t = read(f)
        self.assertLess(len(t), 210_000)
        self.assertIn("recortado", t)

    def test_uri_obsidian(self):
        v = self._vault()
        ruta = v / "Proyectos" / "demo" / "Índice.md"
        self.assertEqual(obsidian_uri(v, ruta), "obsidian://open?vault=ProjectHQ&file=Proyectos%2Fdemo%2F%C3%8Dndice")


if __name__ == "__main__":
    unittest.main()
