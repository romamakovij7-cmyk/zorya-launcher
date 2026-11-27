"""Translate remaining Russian in plain strings, backticks and JSX text.

JSX text is only touched in .jsx files; expressions are skipped.
"""
import json
import re
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CYR = re.compile("[\u0400-\u04ff]")
SKIP = {"i18n.js"}
EXPR = re.compile(r"(\$\{[^}]*\})")
JSXEXPR = re.compile(r"(\{[^}]*\})")
BACKTICK = re.compile(r"`([^`\n]*)`")
JSXTEXT = re.compile(r">([^<>]*)<")
QUOTED = [re.compile(r"'((?:[^'\\\n]|\\.)*)'"), re.compile(r'"((?:[^"\\\n]|\\.)*)"')]


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
    for m in BACKTICK.finditer(t):
        for part in EXPR.split(m.group(1)):
            if CYR.search(part) and "://" not in part and len(part) < 200:
                found.add(part)
    if p.suffix == ".jsx":
        for m in JSXTEXT.finditer(t):
            for part in JSXEXPR.split(m.group(1)):
                if CYR.search(part) and "://" not in part and len(part) < 200:
                    found.add(part)
    for pattern in QUOTED:
        for m in pattern.finditer(t):
            s = m.group(1)
            if CYR.search(s) and "://" not in s and "${" not in s and len(s) < 180:
                found.add(s)

print("translating", len(found), "fragments")
with ThreadPoolExecutor(max_workers=10) as ex:
    mapping = dict(zip(found, ex.map(translate, sorted(found))))

count = 0
for p in paths:
    t = p.read_text(encoding="utf-8")
    new = t
    # backticks first
    def bt(m):
        global count
        parts = EXPR.split(m.group(1))
        out = []
        for part in parts:
            if part in mapping:
                out.append(mapping[part]); count += 1
            else:
                out.append(part)
        return "`" + "".join(out) + "`"
    new = BACKTICK.sub(bt, new)
    if p.suffix == ".jsx":
        def jx(m):
            global count
            parts = JSXEXPR.split(m.group(1))
            out = []
            for part in parts:
                if part in mapping:
                    en = mapping[part]
                    if m.group(0)[0] == '"':
                        en = en.replace('"', '\\"')
                    out.append(en); count += 1
                else:
                    out.append(part)
            return m.group(0)[0] + "".join(out) + m.group(0)[-1]
        new = JSXTEXT.sub(jx, new)
    for pattern in QUOTED:
        def q(m):
            global count
            s = m.group(1)
            if s not in mapping:
                return m.group(0)
            en = mapping[s]
            if m.group(0)[0] == "'":
                en = en.replace("'", "\\'")
            else:
                en = en.replace('"', '\\"')
            count += 1
            return m.group(0)[0] + en + m.group(0)[-1]
        new = pattern.sub(q, new)
    if new != t:
        p.write_text(new, encoding="utf-8")

print("replaced", count, "fragments")
