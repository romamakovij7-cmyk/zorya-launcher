"""Final branding + tooltip polish after the translation pass."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIX = {
    "Eternal Launcher": "Zorya Launcher",
    "title=\"Back.\"": "title=\"Back\"",
    "title=\"Go ahead.\"": "title=\"Forward\"",
    "On pause.": "Paused", "Jumping.": "Downloading",
    "title=\"Swerve\"": "title=\"Minimize\"",
    "title=\"Deploy\"": "title=\"Maximize\"",
    "title=\"Close.\"": "title=\"Close\"",
    "Support: Telegram bot @eternal minecraft bot": "Support",
    "title=\"Launched instances\"": "title=\"Running instances\"",
    "title=\"Open instance.\"": "title=\"Open folder\"",
    "title=\"Close the game.\"": "title=\"Stop\"",
    "fashions": "mods",
    "There's a instance in this folder:": "Instances in this folder:",
    " from ${i.total}.": " of ${i.total}.",
    "The launcher itself does not tolerate anything": "The launcher does not move anything itself",
    "Choose...": "Choose…", "Open.": "Open",
}
for p in ROOT.joinpath("src").rglob("*"):
    if p.suffix not in (".js", ".jsx"):
        continue
    t = p.read_text(encoding="utf-8")
    new = t
    for a, b in FIX.items():
        new = new.replace(a, b)
    if new != t:
        p.write_text(new, encoding="utf-8")
        print("polished", p.relative_to(ROOT))
