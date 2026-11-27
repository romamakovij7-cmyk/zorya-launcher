"""Release the current package.json version: tag + installer + source.

Versioning convention:
  0.1.1   initial public release
  0.1.1.1 bug-fix only (fourth number)
  0.1.2   new feature / noticeable addition (third number)
  1.0.0   major rewrite (first number)
"""
import base64
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

T = os.environ["GH_TOKEN"]
ROOT = Path(__file__).resolve().parents[1]
VERSION = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
TAG = f"v{VERSION}"
# electron-builder only accepts semver (3 parts), so the raw artifact is named
# after package.json's version and renamed to the public 4-part version here.
RAW_SETUP = ROOT / "release" / "Zorya-Launcher-Setup-0.1.1.exe"
SETUP = ROOT / "release" / f"Zorya-Launcher-Setup-{VERSION}.exe"
if not SETUP.exists() and RAW_SETUP.exists():
    RAW_SETUP.rename(SETUP)
    print("renamed installer to", SETUP.name)
OWNER = "romamakovij7-cmyk"
REPO = "zorya-launcher"
API = f"https://api.github.com/repos/{OWNER}/{REPO}"
H = {"Authorization": f"Bearer {T}", "Accept": "application/vnd.github+json",
     "User-Agent": "zorya-release", "X-GitHub-Api-Version": "2022-11-28"}


def api(path, method="GET", body=None, raw=False, ctype=None):
    data = json.dumps(body).encode() if body is not None else None
    h = dict(H)
    if data:
        h["Content-Type"] = ctype or "application/json"
    req = urllib.request.Request(API + path, data=data, headers=h, method=method)
    with urllib.request.urlopen(req, timeout=180) as r:
        out = r.read()
        if raw:
            return out
        return json.loads(out) if out else {}


if not SETUP.exists():
    raise SystemExit(f"missing {SETUP} — run npm run dist first")

try:
    rel = api(f"/releases/tags/{TAG}")
except urllib.error.HTTPError:
    rel = api("/releases", "POST", {
        "tag_name": TAG,
        "name": f"Zorya Launcher {VERSION}",
        "body": f"Zorya Launcher {VERSION}. See the changelog in VERSIONING.md.",
        "draft": False,
        "prerelease": False,
    })
    print("created release", TAG)

for a in rel.get("assets", []):
    if a["name"] == SETUP.name:
        api(f"/releases/assets/{a['id']}", "DELETE")
        print("deleted old asset", a["name"])

upload_url = rel["upload_url"].split("{")[0] + "?name=" + urllib.parse.quote(SETUP.name)
req = urllib.request.Request(upload_url, data=SETUP.read_bytes(), headers={
    **H, "Content-Type": "application/octet-stream"}, method="POST")
with urllib.request.urlopen(req, timeout=240) as r:
    asset = json.load(r)
print("uploaded", asset["name"], asset["size"])

# Source tree (skip build output and local junk).
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
c = api("/git/commits", "POST", {"message": f"Zorya Launcher {VERSION}", "tree": t["sha"]})
api("/git/refs/heads/main", "PATCH", {"sha": c["sha"], "force": True})
print("source pushed:", len(files), "files")
print("release:", rel["html_url"])
