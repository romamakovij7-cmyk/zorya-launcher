"""Translate whole plain-text chunks in string literals / JSX text with Argos.

Code expressions ({...}, <...>, ${...}) are preserved byte-for-byte.
"""
import json
import os
import re
from pathlib import Path

os.environ["ARGOS_PACKAGES_DIR"] = r"C:\Users\Public\argos-packages"

ROOT = Path(__file__).resolve().parents[1]
CACHE_F = ROOT / "scripts" / "argos_cache.json"
CACHE = json.loads(CACHE_F.read_text(encoding="utf-8")) if CACHE_F.exists() else {}
CYR = re.compile("[\u0400-\u04ff]")
SKIP = {"i18n.js"}

QUOTED = [
    re.compile(r"'((?:[^'\\\n]|\\.)*)'"),
    re.compile(r'"((?:[^"\\\n]|\\.)*)"'),
    re.compile(r"`([^`\n]*)`"),
]
JSXTEXT = re.compile(r">([^<>\n]*)<")

OVERRIDES = [
    (r"\bAssembl(?:y|ies)\b", "Instance"),
    (r"\bassembly\b", "instance"), (r"\bassemblies\b", "instances"),
    (r"\bBuilds\b", "Instances"), (r"\bbuilds\b", "instances"),
    (r"\bBuild\b", "Instance"), (r"\bbuild\b", "instance"),
    (r"Preparation is underway\.\.\.", "Preparing…"),
    (r"Forced to restart\?", "Force restart?"),
    (r"\bCapeи\b", "Capes"),
]


def translator():
    from argostranslate import translate as tr
    langs = tr.get_installed_languages()
    ru = next(l for l in langs if l.code == "ru")
    en = next(l for l in langs if l.code == "en")
    return ru.get_translation(en)


def tr(text, t):
    key = text.strip()
    if key not in CACHE:
        en = t.translate(key)
        en = en.replace("\r", " ").replace("\n", " ")
        for pat, rep in OVERRIDES:
            en = re.sub(pat, rep, en)
        CACHE[key] = en
    en = CACHE[key]
    lead = text[:len(text) - len(text.lstrip())]
    tail = text[len(text.rstrip()):]
    return lead + en + tail


def split_chunks(text):
    """Yield (content, is_code) chunks, preserving code expressions verbatim."""
    out = []
    i = 0
    buf = []
    pairs = {"{": "}", "<": ">"}
    while i < len(text):
        c = text[i]
        if c in pairs or (c == "$" and i + 1 < len(text) and text[i + 1] == "{"):
            if buf:
                out.append(("".join(buf), False))
                buf = []
            if c == "$":
                j = i + 2
                depth = 1
                while j < len(text) and depth:
                    if text[j] == "{":
                        depth += 1
                    elif text[j] == "}":
                        depth -= 1
                    j += 1
                out.append((text[i:j], True))
                i = j
                continue
            close = pairs[c]
            depth = 1
            j = i + 1
            while j < len(text) and depth:
                if text[j] == c:
                    depth += 1
                elif text[j] == close:
                    depth -= 1
                j += 1
            out.append((text[i:j], True))
            i = j
        else:
            buf.append(c)
            i += 1
    if buf:
        out.append(("".join(buf), False))
    return out


def clean(en, quote):
    en = en.replace("«", "\u201c").replace("»", "\u201d")
    en = en.replace("`", "'").replace("${", "$ {")
    en = en.replace("\r", " ").replace("\n", " ")
    if quote == "'":
        en = en.replace("\\", "\\\\").replace("'", "\\'")
    elif quote == '"':
        en = en.replace("\\", "\\\\").replace('"', '\\"')
    return en


def process_inner(inner, quote, t):
    out = []
    for content, is_code in split_chunks(inner):
        if is_code or not CYR.search(content):
            out.append(content)
        else:
            out.append(clean(tr(content, t), quote))
    return "".join(out)


def main():
    t = translator()
    changed = 0
    for p in ROOT.joinpath("src").rglob("*"):
        if p.suffix not in (".js", ".jsx", ".html") or p.name in SKIP:
            continue
        text = p.read_text(encoding="utf-8")
        new = text
        def jx(m):
            return m.group(0)[0] + process_inner(m.group(1), '"', t) + m.group(0)[-1]
        new = JSXTEXT.sub(jx, new)
        for pat in QUOTED:
            def sub(m, pat=pat):
                q = m.group(0)[0]
                return q + process_inner(m.group(1), q, t) + q
            new = pat.sub(sub, new)
        if new != text:
            p.write_text(new, encoding="utf-8")
            changed += 1
    CACHE_F.write_text(json.dumps(CACHE, ensure_ascii=False, indent=1), encoding="utf-8")
    print("changed", changed, "files; cache", len(CACHE), "phrases")


if __name__ == "__main__":
    main()
