"""Fix leftover awkward machine translations in visible UI strings."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

FIX = {
    "Gambling": "Play view",
    "assemblage": "instance",
    "Assemblage": "Instance",
    "Testing...": "Checking…",
    "Last game.": "Last played",
    "'instance' : 'instance'": "'instance' : 'instances'",
    "Balance": "General",
    "Cloak.": "Cape",
    "Our cloak": "Our capes",
    '{updater.info?.latest} you {updater.info?.current}':
        '{updater.info?.latest} (you have {updater.info?.current})',
    "The assemblage grid and recent worlds": "Grid of instances and recent worlds",
    "assemblage root": "instance root",
    "There's a instance in this folder:": "There are instances in this folder:",
    "Memorized": "Saved",
    "of игру": "of the game",
    "of игры": "of the game",
    "from игру": "from the game",
    "Play view manually": "Play view manually",
}

for p in ROOT.joinpath("src").rglob("*"):
    if p.suffix not in (".js", ".jsx") or p.name == "i18n.js":
        continue
    text = p.read_text(encoding="utf-8")
    new = text
    for a, b in sorted(FIX.items(), key=lambda kv: -len(kv[0])):
        new = new.replace(a, b)
    if new != text:
        p.write_text(new, encoding="utf-8")
        print("cleaned", p.relative_to(ROOT))
