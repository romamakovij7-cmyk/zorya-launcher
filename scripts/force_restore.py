"""Force-restore every source file that exists in the clean original, then reapply Zorya patches."""
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ORIG = Path(r"C:\Users\Роман\AppData\Local\Temp\EternalLauncher-src\EternalLauncher-main")
SRC = ROOT / "src"

restored = 0
for p in SRC.rglob("*"):
    if not p.is_file():
        continue
    rel = p.relative_to(ROOT)
    src = ORIG / rel
    if src.exists():
        shutil.copy2(src, p)
        restored += 1
print("restored", restored, "files from clean original")
print(subprocess.run(["python", "scripts/reapply_patches.py"], cwd=ROOT,
                     capture_output=True, text=True).stdout[-2000:])
