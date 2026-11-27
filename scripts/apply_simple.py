"""Apply the RU->EN dictionary as exact substring replacements.

Russian text only occurs in string literals, JSX text and comments, so a plain
substring swap cannot break JavaScript syntax (unlike regex-based rewriting).
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
D = json.loads((ROOT / "scripts" / "en_dict.json").read_text(encoding="utf-8"))
CYR = re.compile("[\u0400-\u04ff]")
def safe(en):
    return (en.replace("\r", " ").replace("\n", " ")
               .replace("'", "\u2019").replace('"', "\u201c")
               .replace("`", "'").replace("${", "$ {"))


items = [(k, safe(v)) for k, v in D.items()
         if CYR.search(k) and not re.search(r"[{}\"<>;=`'\n\r]", k)]
items.sort(key=lambda kv: -len(kv[0]))

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
print("applied", len(items), "entries to", changed, "files")
