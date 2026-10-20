from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path

HQ_ROOT = Path(__file__).resolve().parents[2]
USER_CONFIG = Path.home() / ".project-hq" / "config.json"
REQUIRED = ("vaultPath", "projectsRoot", "vaultProjectsDir")


class ConfigError(Exception):
    pass


@dataclass(frozen=True)
class Config:
    vault_path: Path
    projects_root: Path
    vault_projects_dir: str
    data_dir: Path
    registry_file: Path
    events_dir: Path
    state_dir: Path
    config_file: Path
    metrics_dir: Path | None = None
    presupuesto: dict | None = None
    conocimiento_path: Path | None = None


def load_config(path: str | Path | None = None) -> Config:
    # Mismo orden que lib/config.mjs: HQ_CONFIG, ~/.project-hq/config.json y config.json junto al código.
    file = Path(path or os.environ.get("HQ_CONFIG") or (USER_CONFIG if USER_CONFIG.exists() else HQ_ROOT / "config.json"))
    try:
        raw = json.loads(file.read_text(encoding="utf8"))
    except (OSError, ValueError) as e:
        raise ConfigError(f"config: no se pudo leer {file}: {e}") from e
    for k in REQUIRED:
        if not raw.get(k):
            raise ConfigError(f'config: falta "{k}" en {file}')
    dd = raw.get("dataDir")
    if dd is not None and (not isinstance(dd, str) or not os.path.isabs(dd)):
        raise ConfigError('config: "dataDir" debe ser una ruta absoluta')
    data = Path(dd) if dd else file.parent
    presupuesto = None
    if "presupuesto" in raw:
        p = raw["presupuesto"]
        if not isinstance(p, dict):
            raise ConfigError('config: "presupuesto" debe ser un objeto {diaUsd, tarjetaUsd}')
        presupuesto = {"diaUsd": None, "tarjetaUsd": None}
        for k in presupuesto:
            if k not in p:
                continue
            v = p[k]
            if isinstance(v, bool) or not isinstance(v, (int, float)) or v <= 0:
                raise ConfigError(f'config: "presupuesto.{k}" debe ser un número > 0')
            presupuesto[k] = v
    conocimiento = raw.get("conocimientoDir") or "Conocimiento"
    return Config(Path(raw["vaultPath"]), Path(raw["projectsRoot"]), raw["vaultProjectsDir"], data,
                  data / "registry.json", data / "events", data / "state", file, data / "metrics", presupuesto,
                  Path(raw["vaultPath"]) / conocimiento)
