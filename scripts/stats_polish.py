from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
p = ROOT / "src" / "pages" / "Stats.jsx"
t = p.read_text(encoding="utf-8")
FIX = {
    "All in play.": "Total playtime",
    "Everything in this instance": "Playtime in this instance",
    "Za. ${periodDef.label}": "Over ${periodDef.label.toLowerCase()}",
    "All the time.": "All time",
    "percentage": "%",
    "Average per day": "Average per day",
    "day-to-day": "per active day",
    "Time's game.": "Time in game",
    "Sessions": "Sessions",
    "record:": "record:",
}
for a, b in FIX.items():
    t = t.replace(a, b)
p.write_text(t, encoding="utf-8")
print("stats polished")
