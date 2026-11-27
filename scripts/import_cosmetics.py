"""Import ALL cosmetic/art assets from millida/launcher (developer allowed).

Shop UI, code, fonts and version manifests are intentionally excluded.
"""
import json
import os
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TOKEN = os.environ.get("GH_TOKEN", "")
H = {"User-Agent": "zorya-cosmetics"}
if TOKEN:
    H["Authorization"] = f"Bearer {TOKEN}"

# Public asset folders that are visual cosmetics / art, not shop logic.
FOLDERS = {
    "emoji", "capes", "catalog-art", "mode-art", "build-icons", "block-icons",
    "lobby", "app-icons", "packs", "plus", "currency", "chests", "bg",
    "presets", "season", "loaders", "mr-icons",
}
ROOT_FILES = {"hero-11.png", "ruby.webp", "millida-logo.svg", "favicon.svg"}

tree = json.load(urllib.request.urlopen(
    urllib.request.Request("https://api.github.com/repos/millida/launcher/git/trees/main?recursive=1", headers=H),
    timeout=60))["tree"]

base = ROOT / "src" / "assets" / "cosmetics"
count = 0
for x in tree:
    if x["type"] != "blob" or not x["path"].startswith("public/"):
        continue
    rel = x["path"][len("public/"):]
    folder = rel.split("/")[0] if "/" in rel else ""
    if folder not in FOLDERS and rel not in ROOT_FILES:
        continue
    dest = base / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    url = "https://raw.githubusercontent.com/millida/launcher/main/" + x["path"]
    dest.write_bytes(urllib.request.urlopen(
        urllib.request.Request(url, headers=H), timeout=60).read())
    count += 1
print("imported", count, "cosmetic files into", base)
