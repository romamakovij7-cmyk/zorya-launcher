from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "src"
changed = 0
for p in ROOT.rglob("*"):
    if p.suffix not in (".js", ".jsx"):
        continue
    t = p.read_text(encoding="utf-8")
    if "ru-RU" not in t:
        continue
    p.write_text(t.replace("ru-RU", "en-US"), encoding="utf-8")
    changed += 1
print("locales fixed in", changed, "files")
