import json
import os
import urllib.parse
import urllib.request

h = {"Authorization": "Bearer " + os.environ["GH_TOKEN"], "User-Agent": "zorya",
     "Accept": "application/vnd.github+json"}
queries = [
    "slot CAPE repo:millida/launcher",
    "geometry cape repo:millida/launcher",
    "cosmetics wardrobe repo:millida/launcher",
    "cosmetic model repo:millida/launcher",
]
for q in queries:
    u = "https://api.github.com/search/code?q=" + urllib.parse.quote(q)
    try:
        d = json.load(urllib.request.urlopen(urllib.request.Request(u, headers=h), timeout=30))
        print(q, "->", d.get("total_count"))
        for x in d.get("items", [])[:15]:
            print("   ", x["path"])
    except Exception as e:
        print(q, "ERR", e)
