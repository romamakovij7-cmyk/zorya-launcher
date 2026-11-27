"""Import cosmetic assets from millida/launcher (developer allowed), excluding shop UI."""
import base64
import json
import os
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TOKEN = os.environ.get("GH_TOKEN", "")
H = {"User-Agent": "zorya-cosmetics"}
if TOKEN:
    H["Authorization"] = f"Bearer {TOKEN}"


def api(url):
    return json.load(urllib.request.urlopen(urllib.request.Request(url, headers=H), timeout=60))


def raw(path, dest):
    url = "https://raw.githubusercontent.com/millida/launcher/main/" + path
    data = urllib.request.urlopen(urllib.request.Request(url, headers=H), timeout=60).read()
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    return len(data)


tree = api("https://api.github.com/repos/millida/launcher/git/trees/main?recursive=1")["tree"]
paths = [x["path"] for x in tree if x["type"] == "blob"]
base = ROOT / "src" / "assets" / "cosmetics"
count = 0
for p in paths:
    if p.startswith("public/emoji/eltaller/") or p.startswith("public/capes/"):
        count += 1
        raw(p, base / p[len("public/"):])
for p in [
    "public/catalog-art/capes-tile.png",
    "public/catalog-art/skins.png",
    "public/catalog-art/heads.png",
    "public/catalog-art/cheats.png",
]:
    if p in paths:
        raw(p, base / "art" / Path(p).name)
        count += 1
print("imported", count, "cosmetic files")
