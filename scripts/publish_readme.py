import base64
import json
import os
import urllib.request
from pathlib import Path

T = os.environ["GH_TOKEN"]
ROOT = Path(__file__).resolve().parents[1]
OWNER = "romamakovij7-cmyk"
REPO = "zorya-launcher"
API = f"https://api.github.com/repos/{OWNER}/{REPO}"
H = {
    "Authorization": f"Bearer {T}",
    "Accept": "application/vnd.github+json",
    "User-Agent": "zorya-publish",
    "X-GitHub-Api-Version": "2022-11-28",
}


def api(path, method="GET", body=None):
    data = json.dumps(body).encode() if body is not None else None
    h = dict(H)
    if data:
        h["Content-Type"] = "application/json"
    req = urllib.request.Request(API + path, data=data, headers=h, method=method)
    with urllib.request.urlopen(req, timeout=60) as r:
        out = r.read()
        return json.loads(out) if out else {}


files = ["README.md", "SECURITY.md", "docs/zorya-home.png"]
tree = []
for rel in files:
    p = ROOT / rel
    blob = api("/git/blobs", "POST", {
        "content": base64.b64encode(p.read_bytes()).decode(),
        "encoding": "base64",
    })
    tree.append({"path": rel, "mode": "100644", "type": "blob", "sha": blob["sha"]})
    print("blob", rel)

new_tree = api("/git/trees", "POST", {"tree": tree})
commit = api("/git/commits", "POST", {
    "message": "English README/SECURITY and Zorya home screenshot",
    "tree": new_tree["sha"],
})
api("/git/refs/heads/main", "PATCH", {"sha": commit["sha"], "force": True})
print("pushed:", "https://github.com/" + OWNER + "/" + REPO)
