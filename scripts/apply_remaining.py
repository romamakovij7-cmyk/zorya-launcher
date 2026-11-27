"""Final pass: replace remaining medium/long Russian labels safely."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
D = json.loads((ROOT / "scripts" / "en_dict.json").read_text(encoding="utf-8"))

MANUAL = {
    "Перезагрузить": "Refresh", "Обновить все": "Update all",
    "Не получилось": "Failed", "Отключён": "Disabled", "Включён": "Enabled",
    "Не установлен": "Not installed", "Установлен, но выключен": "Installed but disabled",
    "ровно": "exactly", "или выше": "or higher", "неизвестная версия": "unknown version",
    "другая версия": "different version", "Первый запуск": "First launch",
}
D.update(MANUAL)

CYR = re.compile("[\u0400-\u04ff]")

def safe(en):
    return (en.replace("\r", " ").replace("\n", " ")
               .replace("«", "\u201c").replace("»", "\u201d")
               .replace("'", "\u2019").replace('"', "\u201c")
               .replace("`", "'").replace("${", "$ {"))

items = [(k, safe(v)) for k, v in D.items()
         if len(k) >= 8 and CYR.search(k) and not re.search(r"[{}<>;=`'\n\r]", k)]
items.sort(key=lambda kv: -len(kv[0]))
changed_files = 0
for p in ROOT.joinpath("src").rglob("*"):
    if p.suffix not in (".js", ".jsx", ".html") or p.name == "i18n.js":
        continue
    t = p.read_text(encoding="utf-8")
    new = t
    for ru, en in items:
        if ru in new:
            new = new.replace(ru, en)
    if new != t:
        p.write_text(new, encoding="utf-8")
        changed_files += 1
print("applied", len(items), "entries;", changed_files, "files")
