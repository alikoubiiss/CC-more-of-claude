import json
import os
import tempfile
import unittest
from pathlib import Path

from hq.config import Config, ConfigError, load_config
from hq.registry import RegistryError, find_by_path, load_registry
from hq.tasks import parse_task, read_milestones, read_tasks
from hq.textos import limpiar, recortar

TASK3 = """---
id: TASK-3
title: Prototipo del flujo de moderación
status: Verificando
assignee: []
created_date: '2026-10-08 15:48'
updated_date: '2026-10-08 15:48'
labels:
  - 'modelo:sonnet'
  - 'skill:n8n'
  - revisada
milestone: m-0
dependencies:
  - TASK-2
ordinal: 3000
---

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Flujo importado
- [ ] #2 Prueba con 3 mensajes
<!-- AC:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @revisor
created: 2026-10-08 15:48
---
Revisión: PASA (2/2)
---
<!-- COMMENTS:END -->
"""

TASK1 = """---
id: TASK-1
title: Conectar NotebookLM
status: En curso
assignee: []
created_date: '2026-10-08 15:20'
labels: []
dependencies: []
ordinal: 1000
---
"""


def tmp() -> Path:
    return Path(tempfile.mkdtemp(prefix="hq-test-"))


class TestTasks(unittest.TestCase):
    def test_parse_task_real(self):
        t = parse_task(TASK3)
        self.assertEqual((t.id, t.status, t.milestone), ("TASK-3", "Verificando", "m-0"))
        self.assertEqual(t.title, "Prototipo del flujo de moderación")
        self.assertEqual(t.labels, ["modelo:sonnet", "skill:n8n", "revisada"])
        self.assertEqual(t.dependencies, ["TASK-2"])
        self.assertEqual((t.criteria_done, t.criteria_total), (1, 2))
        self.assertEqual(t.criteria_items, [(1, "Flujo importado", True), (2, "Prueba con 3 mensajes", False)])
        self.assertEqual(t.comments, [("@revisor", "2026-10-08 15:48", "Revisión: PASA (2/2)")])

    def test_crlf_y_bom_igual(self):
        base = parse_task(TASK3)
        self.assertEqual(parse_task(TASK3.replace("\n", "\r\n")), base)
        self.assertEqual(parse_task("\ufeff" + TASK3), base)

    def test_minima(self):
        t = parse_task(TASK1)
        self.assertEqual((t.id, t.status, t.milestone), ("TASK-1", "En curso", ""))
        self.assertEqual((t.labels, t.dependencies, t.comments), ([], [], []))
        self.assertEqual((t.criteria_done, t.criteria_total), (0, 0))

    def test_comillas(self):
        t = parse_task("---\nid: TASK-9\ntitle: 'it''s fine'\nstatus: \"Hecho\"\n---\n")
        self.assertEqual((t.title, t.status), ("it's fine", "Hecho"))

    def test_read_tasks_orden_y_resiliencia(self):
        repo = tmp()
        self.assertEqual(read_tasks(repo), [])
        d = repo / "backlog" / "tasks"
        (d / "x.md").mkdir(parents=True)
        (d / "task-10 - Diez.md").write_text(TASK1.replace("TASK-1", "TASK-10"), encoding="utf8")
        (d / "task-2 - Dos.md").write_text(TASK1.replace("TASK-1", "TASK-2"), encoding="utf8")
        (d / "notas.txt").write_text("no", encoding="utf8")
        ts = read_tasks(repo)
        self.assertEqual([t.id for t in ts], ["TASK-2", "TASK-10"])
        self.assertEqual(ts[0].file, "task-2 - Dos.md")

    def test_milestones(self):
        repo = tmp()
        d = repo / "backlog" / "milestones"
        d.mkdir(parents=True)
        (d / "m-1 - construcción.md").write_text('---\nid: m-1\ntitle: "Construcción"\n---\n', encoding="utf8")
        (d / "m-0 - diseño.md").write_text('---\nid: m-0\ntitle: "Diseño"\n---\n', encoding="utf8")
        self.assertEqual([(m.id, m.title) for m in read_milestones(repo)], [("m-0", "Diseño"), ("m-1", "Construcción")])
        self.assertEqual(read_milestones(tmp()), [])


class TestTextos(unittest.TestCase):
    def test_limpiar(self):
        s = limpiar("\x1b[31mRojo\nL2\u202e  fin\x07")
        self.assertNotRegex(s, "[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]")
        self.assertIn("Rojo L2", s)

    def test_recortar(self):
        self.assertEqual(recortar("abcdef", 4), "abc…")
        self.assertEqual(recortar("abc", 4), "abc")


class TestRegistry(unittest.TestCase):
    P = [type("P", (), {"slug": "demo", "path": "C:\\proyectos personales\\demo"})(),
         type("P", (), {"slug": "demo-2", "path": "C:\\proyectos personales\\demo-2"})()]

    def test_find_by_path(self):
        self.assertEqual(find_by_path(self.P, "C:/Proyectos Personales/DEMO/src").slug, "demo")
        self.assertEqual(find_by_path(self.P, "C:\\proyectos personales\\demo-2\\x").slug, "demo-2")
        self.assertIsNone(find_by_path(self.P, "C:\\proyectos personales\\otro"))
        self.assertIsNone(find_by_path(self.P, ""))

    def test_load_registry(self):
        d = tmp()
        self.assertEqual(load_registry(d / "registry.json"), [])
        (d / "registry.json").write_text('{"projects":[{"slug":"a","display":"A","path":"C:\\\\x\\\\a","port":6430,"notebookId":"nb"}]}', encoding="utf8")
        p = load_registry(d / "registry.json")[0]
        self.assertEqual((p.slug, p.port, p.notebook_id), ("a", 6430, "nb"))
        (d / "registry.json").write_text("{oops", encoding="utf8")
        with self.assertRaises(RegistryError):
            load_registry(d / "registry.json")


class TestConfig(unittest.TestCase):
    def _cfg(self, **extra):
        d = tmp()
        raw = {"vaultPath": str(d / "v"), "projectsRoot": str(d / "p"), "vaultProjectsDir": "Proyectos", **extra}
        f = d / "config.json"
        f.write_text(json.dumps(raw), encoding="utf8")
        return d, f

    def test_sin_datadir(self):
        d, f = self._cfg()
        c = load_config(f)
        self.assertEqual(c.registry_file, d / "registry.json")
        self.assertEqual(c.events_dir, d / "events")
        self.assertEqual(c.state_dir, d / "state")

    def test_con_datadir(self):
        d, f = self._cfg(dataDir=str(tmp()))
        c = load_config(f)
        self.assertEqual(c.registry_file, Path(c.data_dir) / "registry.json")

    def test_errores(self):
        with self.assertRaises(ConfigError):
            load_config(self._cfg(dataDir="relativa")[1])
        with self.assertRaises(ConfigError):
            load_config(tmp() / "no-existe.json")


if __name__ == "__main__":
    unittest.main()
