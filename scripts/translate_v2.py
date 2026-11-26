"""Build a reliable RU->EN dictionary with offline Argos Translate and apply it.

Only translatable segments (inside string literals / JSX text) are touched, so
code, imports, class names and comments are never damaged.
"""
import json
import os
import re
from pathlib import Path

os.environ["ARGOS_PACKAGES_DIR"] = r"C:\Users\Public\argos-packages"

ROOT = Path(__file__).resolve().parents[1]
CYR = re.compile("[\u0400-\u04ff]")
SKIP = {"i18n.js"}
SPLIT = re.compile(r"\{[^{}]*\}|<[^>]*>")

QUOTED = [
    re.compile(r"'((?:[^'\\\n]|\\.)*)'"),
    re.compile(r'"((?:[^"\\\n]|\\.)*)"'),
    re.compile(r"`([^`\n]*)`"),
]
JSXTEXT = re.compile(r">([^<>\n]*)<")

# Terminology overrides applied to the English result (whole words / phrases).
OVERRIDES = [
    (r"\bAssembl(?:y|ies)\b", "Instance"),
    (r"\bassembly\b", "instance"), (r"\bassemblies\b", "instances"),
    (r"\bBuilds\b", "Instances"), (r"\bbuilds\b", "instances"),
    (r"\bBuild\b", "Instance"), (r"\bbuild\b", "instance"),
    (r"\bExecute\b", "Launch"), (r"\bexecute\b", "launch"),
    (r"Preparation is underway\.\.\.", "Preparing…"),
    (r"Forced to restart\?", "Force restart?"),
    (r"\bCapeи\b", "Capes"),
]


def segments(text):
    parts = []
    last = 0
    for m in SPLIT.finditer(text):
        if m.start() > last:
            parts.append((text[last:m.start()], True))
        parts.append((m.group(0), False))
        last = m.end()
    if last < len(text):
        parts.append((text[last:], True))
    return parts


def collect_segments():
    found = set()
    for p in ROOT.joinpath("src").rglob("*"):
        if p.suffix not in (".js", ".jsx", ".html") or p.name in SKIP:
            continue
        t = p.read_text(encoding="utf-8", errors="ignore")
        blocks = [m.group(1) for m in JSXTEXT.finditer(t)]
        for pat in QUOTED:
            blocks += [m.group(1) for m in pat.finditer(t)]
        for b in blocks:
            for seg, ok in segments(b):
                s = seg.strip()
                if ok and CYR.search(s) and "://" not in s and 0 < len(s) < 300:
                    found.add(s)
    return sorted(found, key=lambda s: (-len(s), s))


def main():
    from argostranslate import translate as tr
    items = collect_segments()
    print("segments:", len(items), flush=True)
    langs = tr.get_installed_languages()
    ru = next(l for l in langs if l.code == "ru")
    en = next(l for l in langs if l.code == "en")
    translator = ru.get_translation(en)
    mapping = {}
    for i, s in enumerate(items):
        mapping[s] = translator.translate(s)
        if (i + 1) % 100 == 0:
            print("translated", i + 1, flush=True)
    for s, en in list(mapping.items()):
        en = en.replace("\r", " ").replace("\n", " ")
        for pat, rep in OVERRIDES:
            en = re.sub(pat, rep, en)
        mapping[s] = en
    (ROOT / "scripts" / "en_dict.json").write_text(
        json.dumps(mapping, ensure_ascii=False, indent=1), encoding="utf-8")
    print("saved", len(mapping), "entries", flush=True)
    cyr = sum(1 for en in mapping.values() if CYR.search(en))
    print("translations still containing Cyrillic:", cyr, flush=True)


if __name__ == "__main__":
    main()
