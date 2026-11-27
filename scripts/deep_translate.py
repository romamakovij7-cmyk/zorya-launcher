"""Translate all remaining Russian text in source files to English."""
import json
import re
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CYR = re.compile("[\u0400-\u04ff]")
SKIP = {"i18n.js", "auto_translate.py", "deep_translate.py"}
PATTERNS = [
    (re.compile(r"`([^`\n]*)`"), "`"),
    (re.compile(r"'((?:\\.|[^'\\\n])*)'"), "'"),
    (re.compile(r'"((?:\\.|[^"\\\n])*)"'), '"'),
    (re.compile(r">([^<>\n]*)<"), ">"),
]


def translate(text):
    url = "https://translate.googleapis.com/translate_a/single?" + urllib.parse.urlencode({
        "client": "gtx", "sl": "ru", "tl": "en", "dt": "t", "q": text,
    })
    for _ in range(3):
        try:
            with urllib.request.urlopen(url, timeout=25) as r:
                data = json.load(r)
            return "".join(p[0] for p in data[0] if p and p[0])
        except Exception:
            pass
    return text


paths = [p for p in ROOT.joinpath("src").rglob("*")
         if p.suffix in (".js", ".jsx", ".html") and p.name not in SKIP]
found = set()

for p in paths:
    text = p.read_text(encoding="utf-8")
    for pattern, _ in PATTERNS:
        for m in pattern.finditer(text):
            s = m.group(1)
            if CYR.search(s) and "${" not in s and "://" not in s:
                found.add(s)

print("translating", len(found), "fragments")
with ThreadPoolExecutor(max_workers=12) as ex:
    mapping = dict(zip(found, ex.map(translate, sorted(found))))

count = 0
for p in paths:
    text = p.read_text(encoding="utf-8")
    new = text
    for pattern, delim in PATTERNS:
        def sub(m):
            global count
            s = m.group(1)
            if s not in mapping:
                return m.group(0)
            en = mapping[s]
            if delim == "'":
                en = en.replace("\\", "\\\\").replace("'", "\\'")
            elif delim == '"':
                en = en.replace("\\", "\\\\").replace('"', '\\"')
            elif delim == "`":
                en = en.replace("`", "")
            count += 1
            return m.group(0)[0] + en + m.group(0)[-1]
        new = pattern.sub(sub, new)
    if new != text:
        p.write_text(new, encoding="utf-8")

print("replaced", count, "fragments")
