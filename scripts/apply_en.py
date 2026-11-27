"""Apply scripts/en_dict.json to the source, touching only string literals / JSX text."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MAPPING = json.loads((ROOT / "scripts" / "en_dict.json").read_text(encoding="utf-8"))
SKIP = {"i18n.js"}
CYR = re.compile("[\u0400-\u04ff]")
SPLIT = re.compile(r"\{[^{}]*\}|<[^>]*>")

QUOTED = [
    re.compile(r"'((?:[^'\\\n]|\\.)*)'"),
    re.compile(r'"((?:[^"\\\n]|\\.)*)"'),
    re.compile(r"`([^`\n]*)`"),
]
JSXTEXT = re.compile(r">([^<>\n]*)<")


def clean(en, quote):
    en = en.replace("\r", " ").replace("\n", " ")
    en = en.replace("`", "'").replace("${", "$ {")
    if quote == "'":
        en = en.replace("\\", "\\\\").replace("'", "\\'")
    elif quote == '"':
        en = en.replace("\\", "\\\\").replace('"', '\\"')
    return en


def process_inner(inner, quote):
    out = []
    last = 0
    for m in SPLIT.finditer(inner):
        part = inner[last:m.start()]
        out.append(repl_part(part, quote))
        out.append(m.group(0))
        last = m.end()
    out.append(repl_part(inner[last:], quote))
    return "".join(out)


def repl_part(part, quote):
    stripped = part.strip()
    if stripped not in MAPPING:
        return part
    en = clean(MAPPING[stripped], quote)
    lead = part[:len(part) - len(part.lstrip())]
    trail = part[len(part.rstrip()):]
    return lead + en + trail


def main():
    changed = 0
    for p in ROOT.joinpath("src").rglob("*"):
        if p.suffix not in (".js", ".jsx", ".html") or p.name in SKIP:
            continue
        t = p.read_text(encoding="utf-8")
        new = t
        # JSX text first (never overlaps attribute strings inside tags).
        def jx(m):
            return m.group(0)[0] + process_inner(m.group(1), '"') + m.group(0)[-1]
        new = JSXTEXT.sub(jx, new)
        for pat in QUOTED:
            def sub(m, pat=pat):
                q = m.group(0)[0]
                return q + process_inner(m.group(1), q) + q
            new = pat.sub(sub, new)
        if new != t:
            p.write_text(new, encoding="utf-8")
            changed += 1
    print("changed files:", changed)


if __name__ == "__main__":
    main()
