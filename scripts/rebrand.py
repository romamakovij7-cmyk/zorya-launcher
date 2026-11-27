"""Rebrand the forked Eternal Launcher source to Zorya Launcher."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEXT_EXT = {".js", ".jsx", ".mjs", ".css", ".html", ".json", ".md", ".txt", ".toml", ".yml", ".yaml"}
SKIP_PARTS = {"node_modules", ".git", "dist", "release", "build"}

REPL = [
    ("Eternal Launcher", "Zorya Launcher"),
    ("EternalLauncher", "ZoryaLauncher"),
    ("eternalLauncher", "zoryaLauncher"),
    ("eternal-launcher", "zorya-launcher"),
    ("Eternal", "Zorya"),
    ("eternal", "zorya"),
]

changed = 0
for path in ROOT.rglob("*"):
    if not path.is_file() or path.suffix.lower() not in TEXT_EXT:
        continue
    if any(p in SKIP_PARTS for p in path.parts):
        continue
    try:
        text = path.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError):
        continue
    new = text
    for a, b in REPL:
        new = new.replace(a, b)
    if new != text:
        path.write_text(new, encoding="utf-8")
        changed += 1

print(f"rebranded {changed} files")
