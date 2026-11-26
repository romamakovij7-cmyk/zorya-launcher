import json
import os
import urllib.parse
import urllib.request
from pathlib import Path

T = os.environ["GH_TOKEN"]
OWNER = "romamakovij7-cmyk"
REPO = "zorya-launcher"
TAG = "v0.1.0"
FILE = Path(__file__).resolve().parents[1] / "release" / "Zorya-Launcher-Setup-0.1.0.exe"
H = {
    "Authorization": f"Bearer {T}",
    "Accept": "application/vnd.github+json",
    "User-Agent": "zorya-release",
    "X-GitHub-Api-Version": "2022-11-28",
}


def req(url, method="GET", data=None, headers=None, ctype=None):
    h = dict(H)
    if headers:
        h.update(headers)
    if ctype:
        h["Content-Type"] = ctype
    r = urllib.request.Request(url, data=data, headers=h, method=method)
    with urllib.request.urlopen(r, timeout=180) as resp:
        out = resp.read()
        return json.loads(out) if out else {}


base = f"https://api.github.com/repos/{OWNER}/{REPO}"
rel = req(f"{base}/releases/tags/{TAG}")
for a in rel.get("assets", []):
    if a["name"] == FILE.name:
        req(a["url"], "DELETE")
        print("deleted old asset")

url = rel["upload_url"].split("{")[0] + "?name=" + urllib.parse.quote(FILE.name)
asset = req(url, "POST", FILE.read_bytes(), ctype="application/octet-stream")
print("uploaded", asset["name"], asset["size"])
print("release:", rel["html_url"])
