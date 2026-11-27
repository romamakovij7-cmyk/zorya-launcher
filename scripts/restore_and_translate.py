"""Restore src/ from the original Eternal fork, then apply safe translations."""
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ORIG = Path(r"C:\Users\Роман\AppData\Local\Temp\EternalLauncher-src\EternalLauncher-main")
SRC = ROOT / "src"
KEEP = {"i18n.js", "i18n-dict.json", "zorya-theme.css"}

# Preserve custom files.
saved = {name: (SRC / name).read_bytes() for name in KEEP if (SRC / name).exists()}
shutil.rmtree(SRC)
shutil.copytree(ORIG / "src", SRC)
for name, data in saved.items():
    (SRC / name).write_bytes(data)

for script in ["rebrand.py", "translate_en.py", "auto_translate.py"]:
    r = subprocess.run(["python", f"scripts/{script}"], cwd=ROOT,
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    print(script, r.stdout.strip()[:200])
print("restored + translated")
