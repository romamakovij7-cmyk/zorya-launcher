"""Last targeted pass for fragments left after earlier passes."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Exact fragments still present in the source -> English.
FIX = {
    "займёт несколько минут.": "will take a few minutes.",
    "ровно": "exactly", "от": "from", "до": "to",
    "Включён": "Enabled",
    "Стоит": "Installed", "нужна": "needed", "другую": "other",
    "требует": "requires", "версию": "version",
    "а на Modrinth для вашей игры такой нет": "but there is none on Modrinth for your game",
    "для вашей игры, обновлять нечего": "for your game, nothing to update",
    "из": "from", "игры": "game", "игру": "game",
    "Новые сборки при первом запуске сами получают язык и ваши настройки игры (звук, дальность, клавиши, графику).":
        "New instances get your language and game settings (sound, render distance, keys, graphics) on first launch.",
    "Не задано. Как задать: 1) запустите любую свою сборку, настройте игру как вам нравится и выйдите из игры; 2) откройте ":
        "Not set. To set it: 1) launch any instance, configure the game as you like and exit; 2) open ",
    "выйдите из игры; 2) откройте": "exit the game; 2) open",
    "«Last» — лаунчер сам берёт новую сборку Horizon (проверяет раз в сутки при запуске). Дативрованную версию можно закрепить":
        "“Last” — the launcher fetches the latest Horizon build automatically (checks once a day on launch). You can pin a dated version",
    "мodes": "mods",
    "На персонаже в лаунчере глаза неподвижные (зрачок по центру, моргание); взгляд за курсором и движения бровей работают только play.":
        "In the launcher the character's eyes are static (centered pupils, blinking); cursor tracking and eyebrow movement work only in game.",
    " сервер ответил ": " server responded ", "код": "code", "об успешной": "successful", "ошибке": "error",
    "модификатор": "modifier", "Сборщик": "Builder", "Найдено": "Found",
    "Ничего": "Nothing", "модов": "mods", "Показать": "Show",
}

# Also translate arbitrary remaining Cyrillic runs via Argos.
import json
import os
os.environ["ARGOS_PACKAGES_DIR"] = r"C:\Users\Public\argos-packages"
CACHE_F = ROOT / "scripts" / "argos_cache.json"
CACHE = json.loads(CACHE_F.read_text(encoding="utf-8")) if CACHE_F.exists() else {}
RUN = re.compile(r"[\u0400-\u04ff][\u0400-\u04ffA-Za-z0-9 ,.…—:!?%()·+-]*")


def main():
    from argostranslate import translate as tr
    langs = tr.get_installed_languages()
    ru = next(l for l in langs if l.code == "ru")
    en = next(l for l in langs if l.code == "en")
    t = ru.get_translation(en)

    def safe(s):
        return (s.replace("«", "\u201c").replace("»", "\u201d")
                 .replace("'", "\u2019").replace('"', "\u201c"))

    for p in ROOT.joinpath("src").rglob("*"):
        if p.suffix not in (".js", ".jsx") or p.name == "i18n.js":
            continue
        text = p.read_text(encoding="utf-8")
        lines = text.splitlines(keepends=True)
        out = []
        for line in lines:
            stripped = line.strip()
            if stripped.startswith("//") or stripped.startswith("*") or stripped.startswith("/*"):
                out.append(line)
                continue
            new = line
            for k, v in sorted(FIX.items(), key=lambda kv: -len(kv[0])):
                if k in new:
                    new = new.replace(k, v)
            def sub(m):
                s = m.group(0).strip()
                if s in CACHE:
                    en_s = CACHE[s]
                else:
                    en_s = t.translate(s).replace("\r", " ").replace("\n", " ")
                    en_s = re.sub(r"\bAssembl(?:y|ies)\b", "Instance", en_s)
                    CACHE[s] = en_s
                lead = m.group(0)[:len(m.group(0)) - len(m.group(0).lstrip())]
                tail = m.group(0)[len(m.group(0).rstrip()):]
                return lead + safe(en_s) + tail
            new = RUN.sub(sub, new)
            out.append(new)
        new_text = "".join(out)
        if new_text != text:
            p.write_text(new_text, encoding="utf-8")
    CACHE_F.write_text(json.dumps(CACHE, ensure_ascii=False, indent=1), encoding="utf-8")
    print("last pass done")


if __name__ == "__main__":
    main()
