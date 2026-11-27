"""Restore build-broken files from clean original (no retranslation)."""
import re
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ORIG = Path(r"C:\Users\Роман\AppData\Local\Temp\EternalLauncher-src\EternalLauncher-main")

for i in range(40):
    p = subprocess.run([r"C:\Program Files\nodejs\npm.cmd", "run", "build:renderer"],
                       cwd=ROOT, capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    out = (p.stdout or "") + (p.stderr or "")
    if p.returncode == 0:
        print("BUILD OK after", i, "restores")
        break
    m = re.search(r"(src[/\\][\w/\\.-]+\.(?:jsx|js)):", out)
    if not m:
        print("no file in error:\n", out[-1200:])
        break
    rel = m.group(1).replace("\\", "/")
    src = ORIG / rel
    if not src.exists():
        print("no original for", rel)
        break
    shutil.copy2(src, ROOT / rel)
    print("restored", rel)
else:
    print("repair limit reached")
