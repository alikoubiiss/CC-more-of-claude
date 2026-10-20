import re

_CONTROL = re.compile("[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]+")


def limpiar(s) -> str:
    """Quita caracteres de control y bidi (evita inyectar secuencias de escape en la terminal)."""
    return re.sub(r" {2,}", " ", _CONTROL.sub(" ", str(s if s is not None else ""))).strip()


def recortar(s: str, n: int) -> str:
    return s if len(s) <= n else s[: max(n - 1, 0)] + "…"
