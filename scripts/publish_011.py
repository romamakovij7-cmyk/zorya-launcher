import base64
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

T = os.environ["GH_TOKEN"]
ROOT = Path(__file__).resolve().parents[1]
OWNER = "romamakovij7-cmyk"
REPO = "zorya-launcher"
API = f"https://api.github.com/repos/{OWNER}/{REPO}"
H = {"Authorization": f"Bearer {T}", "Accept": "application/vnd.github+json",
     "User-Agent": "zorya-publish", "X-GitHub-Api-Version": "2022-11-28"}


def api(path, method="GET", body=None):
    data = json.dumps(body).encode() if body is not None else None
    h = dict(H)
    if data:
        h["Content-Type"] = "application/json"
    req = urllib.request.Request(API + path, data=data, headers=h, method=method)
    with urllib.request.urlopen(req, timeout=120) as r:
        out = r.read()
        return json.loads(out) if out else {}


def upload(url, file):
    req = urllib.request.Request(
        url.split("{")[0] + "?name=" + urllib.parse.quote(file.name),
        data=file.read_bytes(), headers={**H, "Content-Type": "application/octet-stream"}, method="POST")
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.load(r)


# 1. source
files = [p for p in ROOT.rglob("*") if p.is_file()
         and not any(x in p.relative_to(ROOT).parts for x in {"node_modules", "release", "dist", ".git"})]
tree = []
for p in files:
    blob = api("/git/blobs", "POST", {"content": base64.b64encode(p.read_bytes()).decode(), "encoding": "base64"})
    tree.append({"path": p.relative_to(ROOT).as_posix(), "mode": "100644", "type": "blob", "sha": blob["sha"]})
t = api("/git/trees", "POST", {"tree": tree})
c = api("/git/commits", "POST", {"message": "Zorya Launcher 0.1.1: clean UI, authors, skins, updates", "tree": t["sha"]})
api("/git/refs/heads/main", "PATCH", {"sha": c["sha"], "force": True})
print("source pushed", len(files), "files")

# 2. release
try:
    rel = api("/releases/tags/v0.1.1")
except urllib.error.HTTPError:
    rel = api("/releases", "POST", {
        "tag_name": "v0.1.1", "name": "Zorya Launcher 0.1.1",
        "body": "Clean rebuild: fixed buttons, skins, Java/Horizon split, update banner, authors.",
        "draft": False, "prerelease": False,
    })
setup = ROOT / "release" / "Zorya-Launcher-Setup-0.1.1.exe"
asset = upload(rel["upload_url"], setup)
print("release asset:", asset["name"], asset["size"])
print("release:", rel["html_url"])
