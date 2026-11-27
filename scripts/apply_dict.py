"""Apply the exact RU->EN dictionary to source files (safe substring replace)."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DICT = json.loads((ROOT / "scripts" / "ru_en_dict.json").read_text(encoding="utf-8"))
items = sorted(DICT.items(), key=lambda kv: -len(kv[0]))
changed = 0

for p in ROOT.joinpath("src").rglob("*"):
    if p.suffix not in (".js", ".jsx", ".html") or p.name == "i18n.js":
        continue
    t = p.read_text(encoding="utf-8")
    new = t
    for ru, en in items:
        if ru in new:
            new = new.replace(ru, en)
    if new != t:
        p.write_text(new, encoding="utf-8")
        changed += 1

print("changed", changed, "files")
