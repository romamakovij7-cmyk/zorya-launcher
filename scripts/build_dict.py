"""Build an exact RU->EN dictionary of remaining UI fragments."""
import json
import re
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CYR = re.compile("[\u0400-\u04ff]")
SKIP = {"i18n.js"}
found = set()

for p in ROOT.joinpath("src").rglob("*"):
    if p.suffix not in (".js", ".jsx", ".html") or p.name in SKIP:
        continue
    for line in p.read_text(encoding="utf-8", errors="ignore").splitlines():
        # Candidate fragments: text between quotes/backticks or JSX tags,
        # split around code expressions.
        parts = re.split(r"[\n\r]|[`'\"]|\$\{[^}]*\}|<[^>]*>|\{[^}]*\}", line)
        for part in parts:
            s = part.strip()
            if (CYR.search(s) and len(s) > 3 and len(s) < 160
                    and "://" not in s and not s.startswith("//")
                    and not re.search(r"[=><()]", s)):
                found.add(s)

print("fragments", len(found))


def translate(text):
    url = "https://translate.googleapis.com/translate_a/single?" + urllib.parse.urlencode({
        "client": "gtx", "sl": "ru", "tl": "en", "dt": "t", "q": text,
    })
    for _ in range(3):
        try:
            with urllib.request.urlopen(url, timeout=25) as r:
                data = json.load(r)
            out = "".join(x[0] for x in data[0] if x and x[0])
            return out.replace("\r", " ").replace("\n", " ")
        except Exception:
            pass
    return text


with ThreadPoolExecutor(max_workers=12) as ex:
    mapping = dict(zip(found, ex.map(translate, sorted(found))))
(ROOT / "scripts" / "ru_en_dict.json").write_text(
    json.dumps(mapping, ensure_ascii=False, indent=1), encoding="utf-8")
print("saved", len(mapping), "entries")
