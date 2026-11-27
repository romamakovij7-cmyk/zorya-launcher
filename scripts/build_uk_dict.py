"""Build EN->UK dictionary for the runtime language switcher (offline Argos)."""
import json
import os
import re
from pathlib import Path

os.environ["ARGOS_PACKAGES_DIR"] = r"C:\Users\Public\argos-packages"

ROOT = Path(__file__).resolve().parents[1]
EN = json.loads((ROOT / "scripts" / "en_dict.json").read_text(encoding="utf-8"))

phrases = set()
for en in EN.values():
    en = en.strip()
    if 1 < len(en) <= 70 and not re.search(r"[{}<>|]", en):
        phrases.add(en)
for en in [
    "Home", "Search", "Library", "Skins", "Capes", "Mods & packs", "Screenshots",
    "Stats", "Settings", "Play", "Stop", "Open", "Close", "Create instance",
    "Selected instance", "Never launched", "Played", "Total playtime", "builds",
    "build", "Preparing…", "Launch…", "Ready", "Running instances",
    "No running instances", "English", "Ukrainian", "Interface", "Theme",
    "Appearance", "Language", "Authors", "Account", "Accounts", "Sign in",
    "Sign out", "Install", "Update", "Enable", "Disable", "Files", "Worlds",
    "Servers", "Log", "All", "Copy", "Monitor", "Actions", "Update available",
    "Add files", "Find projects", "Nothing found", "Selected", "Folder",
    "Folders", "Save", "Cancel", "Delete", "Rename", "Duplicate", "Import",
    "Export", "Version", "Memory", "Loader", "Size", "Name", "Address", "Port",
    "Players", "Player", "Time", "Status", "Error", "Warning", "Info",
    "Loading", "Done", "Refresh", "Add", "Clear", "Yes", "No", "Continue",
    "Instance", "Instances", "Optimization", "Play view", "Home screen",
]:
    phrases.add(en)

items = sorted(phrases)
print("phrases:", len(items), flush=True)
from argostranslate import translate as tr
langs = tr.get_installed_languages()
en_l = next(l for l in langs if l.code == "en")
uk_l = next(l for l in langs if l.code == "uk")
t = en_l.get_translation(uk_l)
mapping = {}
for i, s in enumerate(items):
    uk = t.translate(s).replace("\r", " ").replace("\n", " ")
    mapping[s] = uk
    if (i + 1) % 200 == 0:
        print("translated", i + 1, flush=True)
(ROOT / "src" / "i18n-dict.json").write_text(
    json.dumps(mapping, ensure_ascii=False, indent=1), encoding="utf-8")
print("saved", len(mapping), "entries", flush=True)
