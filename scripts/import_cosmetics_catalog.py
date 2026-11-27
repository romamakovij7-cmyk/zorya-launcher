"""Download the public millida cosmetics catalog (previews + metadata).

Shop UI, prices and purchase actions are stripped — only the cosmetic looks
and their slot/rarity labels are kept.
"""
import json
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "src" / "assets" / "cosmetics"
UA = {"User-Agent": "Mozilla/5.0"}

catalog = json.load(urllib.request.urlopen(
    urllib.request.Request("https://api.millida.net/v2/cosmetics/catalog", headers=UA), timeout=60))
items = catalog["items"]

meta = []
for it in items:
    if it.get("staffOnly") or not it.get("preview"):
        continue
    meta.append({
        "id": it["id"],
        "name": it.get("name") or it["id"],
        "slot": it.get("slot", "OTHER"),
        "rarity": it.get("rarity", "COMMON"),
        "channel": it.get("channel", ""),
        "preview": it["preview"],
    })

(ROOT / "catalog.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
print("metadata", len(meta))


def dl(item):
    slot = item["slot"].lower()
    dest = ROOT / "previews" / slot / f"{item['id']}.png"
    if dest.exists() and dest.stat().st_size > 100:
        return 0
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        data = urllib.request.urlopen(
            urllib.request.Request(item["preview"], headers=UA), timeout=40).read()
        dest.write_bytes(data)
        return len(data)
    except Exception:
        return 0


with ThreadPoolExecutor(max_workers=10) as ex:
    sizes = list(ex.map(dl, meta))
print("downloaded", sum(1 for s in sizes if s), "previews,", round(sum(sizes) / 1048576, 1), "MB")
