from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

p = ROOT / "src" / "utils" / "launchStages.js"
t = p.read_text(encoding="utf-8")
old_start = t.index("const STAGE_LABELS = {")
old_end = t.index("};", old_start) + 2
new = """const STAGE_LABELS = {
  preparing: 'Preparing…',
  downloading: 'Downloading Horizon',
  extracting: 'Unpacking Horizon (first time takes a few minutes)…',
  'version-info': 'Getting version information…',
  'loader-profile': 'Getting loader profile…',
  'resolve-libraries': 'Resolving libraries…',
  'download-java': 'Downloading Java…',
  'download-client': 'Downloading the game client…',
  'download-libraries': 'Downloading libraries…',
  'extract-natives': 'Extracting native libraries…',
  'download-assets': 'Downloading assets…',
  'horizon-check': 'Checking the Horizon instance…',
  'horizon-build': 'Downloading Horizon…',
  'horizon-unpack': 'Unpacking Horizon…',
  'horizon-resources': 'Preparing Horizon resources…',
  'horizon-java': 'Downloading Java…',
  'horizon-minecraft': 'Downloading Minecraft files…',
  'horizon-prepare': 'Preparing Horizon resources (first time — a few minutes)…',
  ready: 'Ready',
  starting: 'Starting…',
  running: 'Running',
  error: 'Error',
};"""
t = t[:old_start] + new + t[old_end:]
t = t.replace(".replace('.', ',')", "")
p.write_text(t, encoding="utf-8")

p = ROOT / "electron" / "ipc.js"
t = p.read_text(encoding="utf-8")
t = t.replace(
    "stage: 'downloading', completed: loaded, total: expectedSize });",
    "stage: 'downloading', completed: loaded, total: expectedSize, bytes: true });",
)
t = t.replace(
    "          const versionDir = path.join(dataDir, 'ZoryaLauncher', 'meta', 'versions', 'nightly-2026-11-22-f1bb66f');",
    "          send('launch:progress', { instanceId: id, stage: 'extracting' });\n"
    "          const versionDir = path.join(dataDir, 'ZoryaLauncher', 'meta', 'versions', 'nightly-2026-11-22-f1bb66f');",
)
p.write_text(t, encoding="utf-8")
print("stages fixed")
