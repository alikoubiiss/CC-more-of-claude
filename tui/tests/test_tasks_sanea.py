import re
import unittest

from hq.tasks import parse_task

CTRL = re.compile("[\u0000-\u0008\u000b-\u001f\u007f-\u009f‪-‮⁦-⁩]")


class TestSanea(unittest.TestCase):
    def test_todos_los_campos_sin_control(self):
        esc = "\x1b[31m"
        txt = (f"---\nid: TASK-1{esc}\ntitle: t\nstatus: Hecho{esc}\nmilestone: m-0{esc}\n"
               f"labels:\n  - a{esc}\ndependencies:\n  - TASK-2{esc}\n---\n"
               f"<!-- COMMENTS:BEGIN -->\nauthor: x\ncreated: 2026{esc}\n---\nhola\n---\n<!-- COMMENTS:END -->\n")
        t = parse_task(txt)
        campos = [t.id, t.status, t.milestone, *t.labels, *t.dependencies, *(c[1] for c in t.comments)]
        self.assertTrue(campos and all(not CTRL.search(c) for c in campos), campos)

    def test_descripcion(self):
        t = parse_task("---\nid: TASK-1\ntitle: t\n---\n\n## Description\n\n<!-- SECTION:DESCRIPTION:BEGIN -->\n"
                       "Hacer \x1b[31mesto\ny aquello\n<!-- SECTION:DESCRIPTION:END -->\n")
        self.assertEqual(t.description, "Hacer [31mesto y aquello")
        self.assertEqual(parse_task("---\nid: TASK-2\n---\n").description, "")
        largo = "---\nid: T-1\n---\n<!-- SECTION:DESCRIPTION:BEGIN -->" + "x" * 5000 + "<!-- SECTION:DESCRIPTION:END -->"
        self.assertEqual(len(parse_task(largo).description), 600)


if __name__ == "__main__":
    unittest.main()
