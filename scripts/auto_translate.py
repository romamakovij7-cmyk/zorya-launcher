"""Translate every remaining Russian UI string to English, then build an
EN -> UK runtime dictionary for the language switch.

Uses the public Google Translate endpoint; runs once at development time.
"""
import json
import re
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
EXCLUDE = {"i18n.js", "auto_translate.py"}
STRING_RE = re.compile(r"(?P<q>['\"])(?P<s>[^'\"\n]{4,180})(?P=q)")
CYR = re.compile("[\u0400-\u04ff]")
ENDPOINT = "https://translate.googleapis.com/translate_a/single"


def translate(text, sl, tl):
    url = ENDPOINT + "?" + urllib.parse.urlencode({
        "client": "gtx", "sl": sl, "tl": tl, "dt": "t", "q": text,
    })
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=20) as r:
                data = json.load(r)
            return "".join(part[0] for part in data[0] if part and part[0])
        except Exception:
            if attempt == 2:
                return None


paths = [
    p for p in SRC.rglob("*")
    if p.suffix in (".js", ".jsx", ".html") and p.name not in EXCLUDE
]

# --- 1. RU -> EN in source ---
russian = set()
for p in paths:
    try:
        text = p.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError):
        continue
    for m in STRING_RE.finditer(text):
        s = m.group("s")
        if CYR.search(s) and "${" not in s:
            russian.add(s)

print(f"found {len(russian)} Russian strings")
with ThreadPoolExecutor(max_workers=12) as ex:
    results = list(ex.map(lambda s: (s, translate(s, "ru", "en")), sorted(russian)))
ru_en = {s: t for s, t in results if t}

replaced = 0
for p in paths:
    try:
        text = p.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError):
        continue
    new = text

    def sub(m):
        global replaced
        s = m.group("s")
        if s not in ru_en:
            return m.group(0)
        en = ru_en[s]
        q = m.group("q")
        if q == "'":
            en = en.replace("\\", "\\\\").replace("'", "\\'")
        replaced += 1
        return q + en + q

    new = STRING_RE.sub(sub, text)
    if new != text:
        p.write_text(new, encoding="utf-8")

print(f"replaced {replaced} strings")

# --- 2. EN -> UK dictionary for runtime switching ---
english = set()
for p in paths:
    try:
        text = p.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError):
        continue
    for m in STRING_RE.finditer(text):
        s = m.group("s")
        if (re.fullmatch(r"[A-Za-z0-9 .,_!?:;—–()'\"%/-]+", s) and len(s) > 3
                and "${" not in s and "://" not in s and ".com" not in s
                and "\\" not in s and "=" not in s):
            english.add(s)

print(f"building UK dictionary for {len(english)} English strings")
with ThreadPoolExecutor(max_workers=12) as ex:
    uk_results = list(ex.map(lambda s: (s, translate(s, "en", "uk")), sorted(english)))
en_uk = {s: u for s, u in uk_results if u and u != s}
(ROOT / "src" / "i18n-dict.json").write_text(
    json.dumps(en_uk, ensure_ascii=False, indent=2), encoding="utf-8"
)
print(f"wrote i18n-dict.json with {len(en_uk)} entries")
