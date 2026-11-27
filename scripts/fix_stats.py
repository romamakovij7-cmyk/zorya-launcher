from pathlib import Path

p = Path(__file__).resolve().parents[1] / "src" / "pages" / "Stats.jsx"
t = p.read_text(encoding="utf-8")

t = t.replace(
    "const WEEKDAYS_SHORT = ['pond', 'volt', 'pp', 'figure', 'pt', 'board', 'pop']; // Monday first",
    "const WEEKDAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']; // Monday first",
)
t = t.replace(
    "const MONTHS_SHORT = ['jan', 'fem', 'mar', 'pra', 'May', 'June', 'July', 'aug', 'sen', 'octa', 'noah', 'dec'];",
    "const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];",
)
old = """  if (h === 0) return `${m} mine`;
  return m ? `${h} ? ${m} mine` : `${h} ?`;
}
const formatTiny = (ms) => formatShort(ms).replace(' mine', 'n').replace(' ? ', '? ');"""
new = """  if (h === 0) return `${m} min`;
  return m ? `${h}h ${m}m` : `${h}h`;
}
const formatTiny = (ms) => formatShort(ms).replace(' min', 'm');"""
if old not in t:
    raise SystemExit("duration block not found")
t = t.replace(old, new)
t = t.replace("'ru-RU'", "'en-US'")
t = t.replace("Time's game.", "Time in game")
t = t.replace("Automobile", "Auto")
t = t.replace("By the day.", "By day")
t = t.replace("Weekly.", "By week")
t = t.replace("Monthly.", "By month")
t = t.replace("Days of the week.", "By day of week")
t = t.replace("By the hour of the day.", "By hour of day")
t = t.replace("Midterm session", "Average session")
t = t.replace("Best day ever.", "Best day")
t = t.replace("Instance'", "Instances'")
p.write_text(t, encoding="utf-8")
print("stats formatting fixed")
