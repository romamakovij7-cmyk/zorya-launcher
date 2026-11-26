import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
h = (ROOT / "dist" / "index.html").read_text(encoding="utf-8")
main = re.findall(r'src="([^"]+\.js)"', h)
print("main:", main)
for m in main:
    t = (ROOT / "dist" / m.lstrip("/")).read_text(encoding="utf-8", errors="ignore")
    print(m, "cyrillic:", len(re.findall("[\u0400-\u04ff]", t)))

# All lazy chunks referenced by the main bundle
seen = set()
for m in main:
    t = (ROOT / "dist" / m.lstrip("/")).read_text(encoding="utf-8", errors="ignore")
    for name in set(re.findall(r'["\'](\./)?([\w-]+\.js)["\']', t)):
        pass
    for name in set(re.findall(r"(?:\./)?([A-Za-z][\w-]*-[\w-]+\.js)", t)):
        seen.add(name)
print("referenced lazy chunks:", len(seen))
bad = []
for name in seen:
    p = ROOT / "dist" / "assets" / name
    if p.exists():
        c = len(re.findall("[\u0400-\u04ff]", p.read_text(encoding="utf-8", errors="ignore")))
        if c:
            bad.append((name, c))
print("lazy chunks with Cyrillic:", bad[:20], "count", len(bad))
