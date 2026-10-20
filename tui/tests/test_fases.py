import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from hq.fases import FasesError, active, approve, derive, fases_file, load_fases, project_phases
from hq.tasks import read_milestones, read_tasks

HQ_ROOT = Path(__file__).resolve().parents[2]


def repo_con_fases(*nombres) -> Path:
    repo = Path(tempfile.mkdtemp(prefix="hq-test-"))
    (repo / ".hq").mkdir()
    fases = [{"id": f"f{i + 1}", "nombre": n, "milestone": n, "aprobada": None} for i, n in enumerate(nombres)]
    fases_file(repo).write_text(json.dumps({"fases": fases}), encoding="utf8")
    return repo


def write_milestone(repo: Path, id_: str, title: str):
    d = repo / "backlog" / "milestones"
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{id_} - {title.lower()}.md").write_text(f'---\nid: {id_}\ntitle: "{title}"\n---\n', encoding="utf8")


def write_task(repo: Path, n: int, status="Planificado", milestone=""):
    d = repo / "backlog" / "tasks"
    d.mkdir(parents=True, exist_ok=True)
    ms = f"milestone: {milestone}\n" if milestone else ""
    (d / f"task-{n} - t.md").write_text(f"---\nid: TASK-{n}\ntitle: Tarea {n}\nstatus: {status}\nlabels: []\n{ms}dependencies: []\n---\n", encoding="utf8")


def estados(repo):
    return [(f.estado, f.hechas, f.total) for f in project_phases(repo)]


class TestFases(unittest.TestCase):
    def test_load_ausente_y_danado(self):
        repo = Path(tempfile.mkdtemp())
        self.assertEqual(load_fases(repo), [])
        (repo / ".hq").mkdir()
        fases_file(repo).write_text("{oops", encoding="utf8")
        with self.assertRaises(FasesError):
            load_fases(repo)

    def test_esperando_y_pendiente_ignorando_sin_hito(self):
        repo = repo_con_fases("Diseño", "Construcción")
        write_milestone(repo, "m-0", "Diseño")
        write_milestone(repo, "m-1", "Construcción")
        write_task(repo, 1, "Hecho", "m-0")
        write_task(repo, 2, "hecho", "m-0")
        write_task(repo, 3, "Planificado", "m-1")
        write_task(repo, 4, "En curso")
        self.assertEqual(estados(repo), [("esperando", 2, 2), ("pendiente", 0, 1)])
        self.assertEqual(active(project_phases(repo)).id, "f1")

    def test_activa_y_vacia(self):
        repo = repo_con_fases("Diseño")
        write_milestone(repo, "m-0", "Diseño")
        write_task(repo, 1, "Hecho", "m-0")
        write_task(repo, 2, "En curso", "m-0")
        self.assertEqual(estados(repo)[0][0], "activa")
        self.assertEqual(estados(repo_con_fases("Solo"))[0][0], "activa")

    def test_hito_por_titulo(self):
        repo = repo_con_fases("Diseño")
        write_task(repo, 1, "Hecho", "Diseño")
        self.assertEqual(estados(repo)[0][0], "esperando")

    def test_approve(self):
        repo = repo_con_fases("Diseño", "Construcción")
        write_milestone(repo, "m-0", "Diseño")
        write_milestone(repo, "m-1", "Construcción")
        write_task(repo, 1, "Hecho", "m-0")
        write_task(repo, 2, "Planificado", "m-1")
        self.assertEqual(approve(repo, "f1", "2026-10-09").estado, "aprobada")
        self.assertEqual([f[0] for f in estados(repo)], ["aprobada", "activa"])
        with self.assertRaisesRegex(FasesError, r"no está lista \(0/1"):
            approve(repo, "f2", "2026-10-09")
        self.assertEqual(approve(repo, "f2", "2026-10-09", force=True).estado, "aprobada")
        with self.assertRaisesRegex(FasesError, "ya está aprobada"):
            approve(repo, "f1", "2026-10-09")
        with self.assertRaisesRegex(FasesError, "no existe la fase"):
            approve(repo, "f9", "2026-10-09")
        self.assertFalse(list((repo / ".hq").glob("*.tmp")))

    def test_aprobada_sigue_aprobada_si_se_reabren(self):
        repo = repo_con_fases("Diseño")
        write_milestone(repo, "m-0", "Diseño")
        write_task(repo, 1, "Hecho", "m-0")
        approve(repo, "f1", "2026-10-09")
        write_task(repo, 1, "En curso", "m-0")
        self.assertEqual(estados(repo)[0][0], "aprobada")

    @unittest.skipUnless(shutil.which("node"), "node no disponible")
    def test_compatibilidad_con_node(self):
        repo = repo_con_fases("Diseño")
        write_milestone(repo, "m-0", "Diseño")
        write_task(repo, 1, "Hecho", "m-0")
        approve(repo, "f1", "2026-10-09")
        lib = (HQ_ROOT / "lib" / "fases.mjs").as_uri()
        js = f"import('{lib}').then(m=>console.log(JSON.stringify(m.projectPhases(process.argv[1]).map(f=>[f.estado,f.aprobada]))))"
        out = subprocess.run(["node", "-e", js, str(repo)], capture_output=True, text=True, timeout=30)
        self.assertEqual(json.loads(out.stdout), [["aprobada", "2026-10-09"]], out.stderr)


if __name__ == "__main__":
    unittest.main()
