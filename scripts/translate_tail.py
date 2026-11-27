"""Translate trailing JSX text nodes that end at a newline (missed by regex)."""
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
TAIL = re.compile(r">([^<>\n]*?)(?=<|$)")


def translator():
    from argostranslate import translate as tr
    langs = tr.get_installed_languages()
    ru = next(l for l in langs if l.code == "ru")
    en = next(l for l in langs if l.code == "en")
    return ru.get_translation(en)


def main():
    t = translator()
    changed = 0
    for p in ROOT.joinpath("src").rglob("*"):
        if p.suffix not in (".js", ".jsx", ".html") or p.name in SKIP:
            continue
        lines = p.read_text(encoding="utf-8").splitlines(keepends=True)
        new_lines = []
        for line in lines:
            def sub(m):
                seg = m.group(1)
                if not CYR.search(seg):
                    return m.group(0)
                key = seg.strip()
                if key not in CACHE:
                    en = t.translate(key).replace("\r", " ").replace("\n", " ")
                    en = re.sub(r"\bAssembl(?:y|ies)\b", "Instance", en)
                    en = en.replace("«", "\u201c").replace("»", "\u201d")
                    CACHE[key] = en
                en = CACHE[key]
                lead = seg[:len(seg) - len(seg.lstrip())]
                tail = seg[len(seg.rstrip()):]
                return ">" + lead + en + tail
            new_lines.append(TAIL.sub(sub, line))
        new = "".join(new_lines)
        if new != "".join(lines):
            p.write_text(new, encoding="utf-8")
            changed += 1
    CACHE_F.write_text(json.dumps(CACHE, ensure_ascii=False, indent=1), encoding="utf-8")
    print("changed", changed, "files")


if __name__ == "__main__":
    main()
