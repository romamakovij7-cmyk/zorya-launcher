"""Translate Russian fragments inside template literals and JSX text nodes.

Splits on ${...} and {...} expressions, translating only literal text.
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


def translate_parts(s, splitter):
    parts = splitter.split(s)
    out = []
    for part in parts:
        if CYR.search(part) and "://" not in part and not re.match(r"^\s*[{}$]", part):
            out.append(translate(part))
        else:
            out.append(part)
    return splitter.join if False else "".join(out)


paths = [p for p in ROOT.joinpath("src").rglob("*")
         if p.suffix in (".js", ".jsx", ".html") and p.name not in SKIP]
found = set()
for p in paths:
    t = p.read_text(encoding="utf-8")
    for m in BACKTICK.finditer(t):
        for part in EXPR.split(m.group(1)):
            if CYR.search(part) and "://" not in part:
                found.add(part)
    for m in JSXTEXT.finditer(t):
        for part in JSXEXPR.split(m.group(1)):
            if CYR.search(part) and "://" not in part:
                found.add(part)

print("translating", len(found), "fragments")
with ThreadPoolExecutor(max_workers=10) as ex:
    mapping = dict(zip(found, ex.map(translate, sorted(found))))

count = 0
for p in paths:
    t = p.read_text(encoding="utf-8")
    new = t
    for pattern, splitter in [(BACKTICK, EXPR), (JSXTEXT, JSXEXPR)]:
        def sub(m):
            global count
            parts = splitter.split(m.group(1))
            out = []
            for part in parts:
                if part in mapping:
                    en = mapping[part]
                    if m.group(0)[0] == '"':
                        en = en.replace('"', '\\"')
                    out.append(en)
                    count += 1
                else:
                    out.append(part)
            return m.group(0)[0] + "".join(out) + m.group(0)[-1]
        new = pattern.sub(sub, new)
    if new != t:
        p.write_text(new, encoding="utf-8")

print("replaced", count, "fragments")
