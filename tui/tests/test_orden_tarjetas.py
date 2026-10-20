import tempfile
import unittest
from pathlib import Path

from hq.tasks import parse_task, read_tasks


def _tarjeta(i, ordinal=None):
    ord_ = f"ordinal: {ordinal}\n" if ordinal is not None else ""
    return f"---\nid: TASK-{i}\ntitle: T{i}\nstatus: Planificado\n{ord_}---\n"


class OrdenTarjetas(unittest.TestCase):
    def test_ordinal_se_lee_y_sin_el_es_infinito(self):
        self.assertEqual(parse_task(_tarjeta(1, 1500)).ordinal, 1500)
        self.assertEqual(parse_task(_tarjeta(1)).ordinal, float("inf"))

    def test_read_tasks_ordena_por_ordinal_y_luego_por_id(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp, "backlog", "tasks")
            d.mkdir(parents=True)
            for i, o in [(1, 3000), (2, 1000), (3, None), (4, None), (5, 2000)]:
                (d / f"task-{i} - t.md").write_text(_tarjeta(i, o), encoding="utf8")
            self.assertEqual([t.id for t in read_tasks(tmp)], ["TASK-2", "TASK-5", "TASK-1", "TASK-3", "TASK-4"])


if __name__ == "__main__":
    unittest.main()
