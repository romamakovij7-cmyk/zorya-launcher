"""Push current source tree to the repo's main branch via GitHub API."""
import base64
import json
import os
import urllib.request
from pathlib import Path

T = os.environ["GH_TOKEN"]
ROOT = Path(__file__).resolve().parents[1]
API = "https://api.github.com/repos/romamakovij7-cmyk/zorya-launcher"
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


skip = {"node_modules", "release", "dist", ".git", "__pycache__"}
files = [p for p in ROOT.rglob("*") if p.is_file()
         and not any(x in p.relative_to(ROOT).parts for x in skip)]
tree = []
for p in files:
    blob = api("/git/blobs", "POST",
               {"content": base64.b64encode(p.read_bytes()).decode(), "encoding": "base64"})
    tree.append({"path": p.relative_to(ROOT).as_posix(), "mode": "100644",
                 "type": "blob", "sha": blob["sha"]})
t = api("/git/trees", "POST", {"tree": tree})
c = api("/git/commits", "POST",
        {"message": "Zorya 0.1.1: full EN translation, working UK switch, clean authors",
         "tree": t["sha"]})
api("/git/refs/heads/main", "PATCH", {"sha": c["sha"], "force": True})
print("source pushed:", len(files), "files")
