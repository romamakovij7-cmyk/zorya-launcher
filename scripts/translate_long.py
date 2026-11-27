"""Translate long descriptive strings in a few complex files (safe substring swap)."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
D = json.loads((ROOT / "scripts" / "en_dict.json").read_text(encoding="utf-8"))
CYR = re.compile("[\u0400-\u04ff]")

def safe(en):
    return (en.replace("\r", " ").replace("\n", " ")
               .replace("«", "\u201c").replace("»", "\u201d")
               .replace("'", "\u2019").replace('"', "\u201c")
               .replace("`", "'").replace("${", "$ {"))

items = [(k, safe(v)) for k, v in D.items()
         if len(k) >= 30 and CYR.search(k) and not re.search(r"[{}<>;=`'\n\r]", k)]
items.sort(key=lambda kv: -len(kv[0]))

targets = [str(p.relative_to(ROOT)).replace("\\", "/")
           for p in ROOT.joinpath("src").rglob("*")
           if p.suffix in (".js", ".jsx", ".html") and p.name != "i18n.js"]
for rel in targets:
    p = ROOT / rel
    t = p.read_text(encoding="utf-8")
    new = t
    for ru, en in items:
        if ru in new:
            new = new.replace(ru, en)
    p.write_text(new, encoding="utf-8")
    print("translated", rel, "changed", new != t)
