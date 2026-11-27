"""Extract unique Russian user-facing fragments from source."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CYR = re.compile("[\u0400-\u04ff]")
SKIP = {"i18n.js"}

# Match quoted strings, backtick strings and JSX text between tags.
PATTERNS = [
    re.compile(r"'((?:[^'\\\n]|\\.)*)'"),
    re.compile(r'"((?:[^"\\\n]|\\.)*)"'),
    re.compile(r"`([^`\n]*)`"),
    re.compile(r">([^<>]*)<"),
]

found = set()
for p in ROOT.joinpath("src").rglob("*"):
    if p.suffix not in (".js", ".jsx", ".html") or p.name in SKIP:
        continue
    for line in p.read_text(encoding="utf-8", errors="ignore").splitlines():
        s = line.strip()
        if s.startswith("//") or s.startswith("*") or s.startswith("/*"):
            continue
        for pat in PATTERNS:
            for m in pat.finditer(line):
                text = m.group(1)
                if CYR.search(text) and "://" not in text and "${" not in text:
                    for part in re.split(r"[\r\n]", text):
                        part = part.strip()
                        if CYR.search(part) and 1 < len(part) < 200:
                            found.add(part)

items = sorted(found, key=lambda s: (-len(s), s))
(ROOT / "scripts" / "ru_strings.json").write_text(
    json.dumps(items, ensure_ascii=False, indent=1), encoding="utf-8")
print("unique fragments:", len(items))
