"""Polish a few awkward button labels."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIX = {
    "Stop it.": "Stop", "Launch...": "Preparing…",
    "Show me the skin.": "Show equipped skin",
    "Cloaks.": "Capes", "Drop the skin": "Remove skin",
    "Repeat.": "Retry", "Testing...": "Checking…",
    "Check for updates": "Check for updates",
}
for p in ROOT.joinpath("src").rglob("*"):
    if p.suffix not in (".js", ".jsx"):
        continue
    t = p.read_text(encoding="utf-8")
    new = t
    for a, b in FIX.items():
        new = new.replace(a, b)
    if new != t:
        p.write_text(new, encoding="utf-8")
        print("polished", p.relative_to(ROOT))
