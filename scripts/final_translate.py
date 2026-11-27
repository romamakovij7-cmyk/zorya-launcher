"""Final safe pass: translate remaining Russian UI text to English.

Only plain quoted strings and plain JSX text nodes are touched. Anything that
looks like code (expressions, template substitutions, URLs, paths) is skipped.
"""
import json
import re
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CYR = re.compile("[\u0400-\u04ff]")
BAD = re.compile(r"[=><{}()?:;\\\\]|\$\{|//|\s/\s")
SKIP = {"i18n.js", "auto_translate.py", "deep_translate.py", "final_translate.py"}

# (pattern, prefix/suffix length in match group 0)
PATTERNS = [
    (re.compile(r"'((?:[^'\\\n]|\\.)*)'"), 1),
    (re.compile(r'"((?:[^"\\\n]|\\.)*)"'), 1),
    (re.compile(r">([^<>{}]*)<"), 1),
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
    t = p.read_text(encoding="utf-8")
    for pattern, _ in PATTERNS:
        for m in pattern.finditer(t):
            s = m.group(1)
            if CYR.search(s) and not BAD.search(s) and "://" not in s and len(s) < 180:
                found.add(s)

print("translating", len(found), "strings")
with ThreadPoolExecutor(max_workers=10) as ex:
    mapping = dict(zip(found, ex.map(translate, sorted(found))))

count = 0
for p in paths:
    t = p.read_text(encoding="utf-8")
    new = t
    for pattern, _ in PATTERNS:
        def sub(m):
            global count
            s = m.group(1)
            if s not in mapping:
                return m.group(0)
            en = mapping[s]
            en = en.replace("\r\n", " ").replace("\n", " ").replace("\r", " ")
            if m.group(0)[0] == "'":
                en = en.replace("'", "\\'")
            elif m.group(0)[0] == '"':
                en = en.replace('"', '\\"')
            count += 1
            return m.group(0)[0] + en + m.group(0)[-1]
        new = pattern.sub(sub, new)
    if new != t:
        p.write_text(new, encoding="utf-8")

print("replaced", count, "strings")
