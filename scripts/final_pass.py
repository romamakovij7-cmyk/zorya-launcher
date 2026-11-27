"""Final pass: translate every remaining visible Russian string in the UI."""
import json
import os
import re
from pathlib import Path

os.environ["ARGOS_PACKAGES_DIR"] = r"C:\Users\Public\argos-packages"

ROOT = Path(__file__).resolve().parents[1]
F = ROOT / "scripts" / "argos_cache.json"
CACHE = json.loads(F.read_text(encoding="utf-8")) if F.exists() else {}
CYR = re.compile("[\u0400-\u04ff]")

# Remaining user-visible strings (comments are intentionally excluded).
STRS = [
    "Оффлайн", "Оффлайн · основной", "Оффлайн · дополнительный",
    "Horizon — Minecraft Java, переписанный на Rust. Лаунчер сам скачает последнюю сборку, Java и файлы Mojang.",
    "Первый запуск займёт несколько минут.",
    "Это настройки для аккаунта Microsoft — у оффлайн-аккаунта нет профиля Mojang, поэтому",
    "здесь нечего менять. Для оффлайн-скинов, видимых другим, см. блок про ely.by на странице «Скины».",
    "Текст", "Найти", "Найти…", "совп.", "Все", "Простых параметров «ключ = значение» в файле не нашлось — откройте вкладку «Текст».",
    "стр.", "Файл", "Папка", "Править",
    "готово", "Найдены:", "У этого скина нет пикселей глаз Fresh Moves: они рисуются в свободных углах текстуры (0–8, 24–40 и 56–64 по горизонтали, верхние 8 строк),",
    "и пак без них ничего не добавит. Скин с готовыми глазами можно выбрать на странице «Скины».",
    "На персонаже в лаунчере глаза неподвижные (зрачок по центру, моргание); взгляд за курсором и движения бровей работают только play.",
    "Прыжок",
    "Экономит место и время: сборка остаётся там, где лежит. Но это одна и та же папка для обоих лаунчеров: моды, настройки и",
    "а если папку переместят или отключат диск, сборка перестанет запускаться. При удалении сборки здесь папка другого лаунче",
    "«Last» — лаунчер сам берёт новую сборку Horizon (проверяет раз в сутки при запуске). Дативрованную версию можно закрепить",
    "пока вы не смените выбор. Это помогает, если новая сборка сломала игру или мод. Java и файлы Mojang лаунчер подбирает сам",
    "Если у сборки включены нативные моды и она собрана, играется собранная версия, а не выбранная.",
    "из", "общих серверов.", "Перед каждым запуском сборки недостающие общие серверы добавляются сами. Они идут в конец вашего списка в игре, ваши серве",
    "Сервер, который вы удалили в игре, сам не вернётся: его возвращает эта кнопка. Игра при этом должна быть закрыта. Список",
    "Навсегда удаляет сборку с устройства, в том числе миры, настройки и весь установленный контент.",
    "Учтите, что после удаления сборку невозможно восстановить.",
    "Вылет", "Удалить",
    "Новые сборки при первом запуске сами получают язык и ваши настройки игры (звук, дальность, клавиши, графику).",
    "Уже готовые сборки не меняются: чтобы применить эталон к такой сборке, запустите её один раз, выйдите из игры и нажмите ",
    "Не задано. Как задать: 1) запустите любую свою сборку, настройте игру как вам нравится и выйдите из игры; 2) откройте ",
    "{instanceA.name}» и «{instanceB.name}They will be in one new folder.",
    "Процесс включает и служебную память Java, поэтому может слегка превышать лимит.",
    "Proven mods for FPS under", "Лаунчер найдёт на Modrinth подходящие версии",
    "и установит нужные зависимости; то, что уже стоит, пропустится.",
    "Вид:", "Галерея", "Версии", "Играть", "Закрыть", "Карта",
    "колёсо — масштаб, перетаскивание — перемещение", "сетка",
    "Модов:", "Стоп", "Скачать",
    "Можно добавить несколько аккаунтов (и Microsoft, и оффлайн) и быстро переключаться между ними — нажмите на аватар в само",
    "Offline账户ов до 5, основной тоже считается. Скины, плащи, сердечки и цвет ника Eternal работают только на основном ",
    "столько памяти получает каждая сборка, у которой нет своего значения. Для отдельной сборки можно задать своё в её настрой",
    "Выйти", "(у вас", "). The buttons are in the card on the bottom righ",
    "лицензия LGPL-3.0. Лаунчер не включает Horizon в себя: он скачивает официальные сборки с GitHub и запускает их отдельной",
    "Hearts появляются вокруг вас в игре при следующем запуске и видны игрокам с лаунчером Eternal. Работают на Minecraft 26.",
    "<1 мин", "Сборка:",
    "сервер ответил", "код", "об успешной", "ошибке",
    "И持续的", "Сборщик", "Ничего", "Найдено",
]


def translator():
    from argostranslate import translate as tr
    langs = tr.get_installed_languages()
    ru = next(l for l in langs if l.code == "ru")
    en = next(l for l in langs if l.code == "en")
    return ru.get_translation(en)


MANUAL = {
    "Оффлайн": "Offline", "Оффлайн · основной": "Offline · main",
    "Оффлайн · дополнительный": "Offline · additional",
    "Текст": "Text", "Найти": "Find", "Найти…": "Search…", "совп.": "matches",
    "Все": "All", "стр.": "lines", "Файл": "File", "Папка": "Folder",
    "Править": "Edit", "готово": "ready", "Найдены:": "Found:",
    "Прыжок": "Jump", "из": "of", "общих серверов.": "shared servers.",
    "Вылет": "Crash", "Удалить": "Delete", "Вид:": "View:",
    "Галерея": "Gallery", "Версии": "Versions", "Играть": "Play",
    "Закрыть": "Close", "Карта": "Map", "сетка": "grid",
    "Модов:": "Mods:", "Стоп": "Stop", "Скачать": "Download",
    "Выйти": "Sign out", "Сборка:": "Instance:", "<1 мин": "<1 min",
    "Процесс включает и служебную память Java, поэтому может слегка превышать лимит.":
        "The process includes Java service memory, so it may slightly exceed the limit.",
    "Лаунчер найдёт на Modrinth подходящие версии": "The launcher will find suitable versions on Modrinth",
    "и установит нужные зависимости; то, что уже стоит, пропустится.":
        "and install required dependencies; already installed ones are skipped.",
    "колёсо — масштаб, перетаскивание — перемещение": "wheel — zoom, drag — pan",
    "лицензия LGPL-3.0. Лаунчер не включает Horizon в себя: он скачивает официальные сборки с GitHub и запускает их отдельной":
        "licensed LGPL-3.0. The launcher does not include Horizon: it downloads official builds from GitHub and runs them separately",
    "Hearts появляются вокруг вас в игре при следующем запуске и видны игрокам с лаунчером Eternal. Работают на Minecraft 26.":
        "Hearts appear around you in game on next launch and are visible to players using Eternal launcher. Works on Minecraft 26.",
}


def safe(en):
    return (en.replace("\r", " ").replace("\n", " ")
               .replace("«", "\u201c").replace("»", "\u201d")
               .replace("'", "\u2019").replace('"', "\u201c")
               .replace("`", "'").replace("${", "$ {"))


def main():
    t = translator()
    items = []
    for s in STRS:
        if s in MANUAL:
            en = MANUAL[s]
        elif s in CACHE:
            en = CACHE[s]
        else:
            en = t.translate(s).replace("\r", " ").replace("\n", " ")
            en = re.sub(r"\bAssembl(?:y|ies)\b", "Instance", en)
            CACHE[s] = en
        items.append((s, safe(en)))
    items.sort(key=lambda kv: -len(kv[0]))
    applied = 0
    for p in ROOT.joinpath("src").rglob("*"):
        if p.suffix not in (".js", ".jsx") or p.name == "i18n.js":
            continue
        text = p.read_text(encoding="utf-8")
        new = text
        for ru, en in items:
            if ru in new:
                new = new.replace(ru, en)
                applied += 1
        if new != text:
            p.write_text(new, encoding="utf-8")
    F.write_text(json.dumps(CACHE, ensure_ascii=False, indent=1), encoding="utf-8")
    print("applied", applied, "replacements")


if __name__ == "__main__":
    main()
