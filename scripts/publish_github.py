"""Publish Zorya Launcher to GitHub: repo + source + release with installer."""
import base64
import json
import os
import urllib.error
import urllib.request
from pathlib import Path

TOKEN = os.environ["GH_TOKEN"]
ROOT = Path(__file__).resolve().parents[1]
API = "https://api.github.com"
HEADERS = {
    "Authorization": f"Bearer {TOKEN}",
    "Accept": "application/vnd.github+json",
    "User-Agent": "zorya-launcher-publish",
    "X-GitHub-Api-Version": "2022-11-28",
}


def api(path, method="GET", body=None, raw=False, headers=None):
    data = json.dumps(body).encode() if body is not None else None
    h = dict(HEADERS)
    if data:
        h["Content-Type"] = "application/json"
    if headers:
        h.update(headers)
    req = urllib.request.Request(API + path, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            out = r.read()
            return out if raw else (json.loads(out) if out else {})
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:500]
        raise RuntimeError(f"{method} {path}: HTTP {e.code}: {detail}")


def upload(url, file_path, name):
    data = file_path.read_bytes()
    req = urllib.request.Request(
        url + "?name=" + urllib.parse.quote(name), data=data,
        headers={**HEADERS, "Content-Type": "application/octet-stream"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.load(r)


import urllib.parse

user = api("/user")
login = user["login"]
print("owner:", login)

repo_name = "zorya-launcher"
try:
    repo = api(f"/repos/{login}/{repo_name}")
    print("repo exists")
except RuntimeError:
    repo = api("/user/repos", "POST", {
        "name": repo_name,
        "description": "Zorya Launcher — a Horizon 26.3 focused Minecraft launcher",
        "public": True,
        "auto_init": True,
    })
    print("repo created")

full = f"{login}/{repo_name}"
branch = repo.get("default_branch", "main")

# Collect source files (skip heavy/unneeded dirs).
skip = {"node_modules", "release", "dist", ".git"}
files = []
for p in ROOT.rglob("*"):
    if not p.is_file():
        continue
    if any(part in skip for part in p.relative_to(ROOT).parts):
        continue
    if p.name in {"remaining_ru.txt"}:
        continue
    files.append(p)
print("uploading", len(files), "files")

tree = []
for i, p in enumerate(files):
    rel = p.relative_to(ROOT).as_posix()
    content = base64.b64encode(p.read_bytes()).decode()
    blob = api(f"/repos/{full}/git/blobs", "POST", {"content": content, "encoding": "base64"})
    tree.append({"path": rel, "mode": "100644", "type": "blob", "sha": blob["sha"]})
    if (i + 1) % 25 == 0:
        print(" blobs", i + 1)

new_tree = api(f"/repos/{full}/git/trees", "POST", {"tree": tree})
commit = api(f"/repos/{full}/git/commits", "POST", {
    "message": "Zorya Launcher 0.1.0 (Eternal frontend fork)",
    "tree": new_tree["sha"],
})
try:
    api(f"/repos/{full}/git/refs/heads/{branch}", "PATCH", {"sha": commit["sha"], "force": True})
except RuntimeError:
    api(f"/repos/{full}/git/refs", "POST", {"ref": f"refs/heads/{branch}", "sha": commit["sha"]})
print("source pushed")

# Release with installer.
tag = "v0.1.0"
try:
    rel = api(f"/repos/{full}/releases/tags/{tag}")
    print("release exists")
except RuntimeError:
    rel = api(f"/repos/{full}/releases", "POST", {
        "tag_name": tag,
        "name": "Zorya Launcher 0.1.0",
        "body": "Horizon 26.3 focused launcher. Windows x64 installer included.",
        "draft": False,
        "prerelease": False,
    })
    print("release created")

setup = ROOT / "release" / "Zorya-Launcher-Setup-0.1.0.exe"
asset = upload(rel["upload_url"], setup, setup.name)
print("asset uploaded:", asset["name"], asset["size"])
print("REPO:", f"https://github.com/{full}")
print("RELEASE:", rel["html_url"])
