"""Translate the fork's user-facing Russian strings to English."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

WORDS = {
    "Главная": "Home", "Поиск": "Search", "Библиотека": "Library",
    "Настройки": "Settings", "Скины": "Skins", "Скриншоты": "Screenshots",
    "Проект": "Project", "Схематики": "Schematics", "Статистика": "Stats",
    "Моды": "Mods", "Файлы": "Files", "Миры": "Worlds", "Сервера": "Servers",
    "Журнал": "Log", "Все": "All", "Ошибка": "Error", "Предупреждение": "Warning",
    "Информация": "Info", "Создать": "Create", "Отмена": "Cancel",
    "Удалить": "Delete", "Сохранить": "Save", "Закрыть": "Close",
    "Запустить": "Launch", "Запуск": "Launch", "Войти": "Sign in",
    "Выйти": "Sign out", "Аккаунт": "Account", "Авторы": "Authors",
    "Лицензии и источники": "Licenses and sources", "Поддержали лаунчер": "Supporters",
    "Ещё не запускалась": "Never launched", "Не запускалась": "Never launched",
    "Вес": "Size", "Модов": "mods", "секунд": "seconds", "Ошибки": "Errors",
    "Сборка": "Instance", "Сборки": "Instances", "Папка": "Folder",
    "Папки": "Folders", "Скопировать": "Copy", "Копировать": "Copy",
    "Открыть": "Open", "Название": "Name", "Версия": "Version",
    "Загрузчик": "Loader", "Память": "Memory", "Язык": "Language",
    "Тема": "Theme", "Оформление": "Appearance", "Клавиши": "Keybinds",
    "Обновления": "Updates", "Данные": "Data", "Управление": "Control",
    "Разное": "Other", "Игры": "Games", "Мод": "Mod", "Модпак": "Modpack",
    "Модпаки": "Modpacks", "Ресурспак": "Resource pack", "Шейдеры": "Shaders",
    "Настройки игры": "Game settings", "Основной": "Main", "Скин": "Skin",
    "Плащ": "Cape", "Сердце": "Heart", "Сердечки": "Hearts", "Ник": "Nickname",
    "Премиум": "Premium", "Подписка": "Subscription", "Бесплатно": "Free",
    "Скачать": "Download", "Обновить": "Refresh", "Проверить": "Check",
    "Добавить": "Add", "Импорт": "Import", "Экспорт": "Export",
    "Переименовать": "Rename", "Дублировать": "Duplicate", "Очистить": "Clear",
    "Поиск...": "Search...", "Сохранить и закрыть": "Save and close",
    "Включить": "Enable", "Выключить": "Disable", "Включено": "Enabled",
    "Выключено": "Disabled", "Да": "Yes", "Нет": "No", "Продолжить": "Continue",
    "Не удалось": "Failed", "не удалось": "failed", "ошибка": "error",
    "Ответил": "responded", "Загрузка": "Loading", "Готово": "Done",
    "Ожидание": "Waiting", "Отменено": "Cancelled", "Успешно": "Success",
    "Файл": "File", "Файлы игры": "Game files", "Мир": "World",
    "Сервер": "Server", "Список серверов": "Server list", "Адрес": "Address",
    "Порт": "Port", "Игрок": "Player", "Игроки": "Players", "Время": "Time",
    "Статус": "Status", "Процесс": "Process", "Память": "Memory",
    "Придумайте название сборки": "Enter an instance name",
    "Введите название сборки": "Enter an instance name",
    "Выберите версию Minecraft": "Select a Minecraft version",
    "Выберите версию загрузчика": "Select a loader version",
    "Моя сборка": "My instance", "Игра": "Game", "Стиль оформления": "Interface style",
    "Интерфейс": "Interface", "Командная палитра": "Command palette",
    "Быстрый переход к разделу или сборке.": "Quick jump to a page or instance.",
    "Неизвестный загрузчик": "Unknown loader", "версия Minecraft": "Minecraft version",
    "версия загрузчика": "loader version", "Название не может быть пустым": "Name cannot be empty",
    "Такой иконки нет": "No such icon", "Создать сборку": "Create instance",
    "Редагувати збірку": "Edit instance", "Скопировать сборку": "Duplicate instance",
    "Сборка числится запущенной": "Instance is marked as running",
    "Перезапустить принудительно?": "Force restart?",
    "Папка сборки недоступна": "Instance folder is unavailable",
    "Возможно, диск не подключён": "The drive may be disconnected",
    "Сессия Microsoft истекла": "Microsoft session expired",
    "Войдите в аккаунт заново": "Sign in again",
    "Не удалось обновить сессию Microsoft": "Failed to refresh Microsoft session",
    "это не основной оффлайн-аккаунт": "is not the main offline account",
    "Скины, плащи и сердечки": "Skins, capes and hearts",
    "игра запускается как обычная оффлайн": "the game starts as a regular offline player",
    "Загрузчик не найден": "Loader not found", "Нет файлов": "No files",
    "Настройки игры": "Game settings", "Общие": "General", "Дополнительно": "Advanced",
    "Внешний вид": "Appearance", "Поведение": "Behavior", "Совместимость": "Compatibility",
    "Удалить сборку": "Delete instance", "Переименовать сборку": "Rename instance",
    "Открыть папку": "Open folder", "Показать": "Show", "Скрыть": "Hide",
    "По умолчанию": "Default", "Сбросить": "Reset", "Применить": "Apply",
    "Проверка файлов": "File check", "Восстановить": "Repair", "Резервная копия": "Backup",
    "Резервные копии": "Backups", "Миры": "Worlds", "Скриншоты": "Screenshots",
    "Статистика игрока": "Player stats", "Схематики": "Schematics",
    "Каталог модов": "Mod catalog", "Модпаки": "Modpacks", "Шейдеры": "Shaders",
    "Импорт сборки": "Import instance", "Экспорт сборки": "Export instance",
    "Создать папку": "Create folder", "Переместить": "Move", "Объединить": "Merge",
    "Закрепить": "Pin", "Открепить": "Unpin", "Избранное": "Favorites",
    "Недавние": "Recent", "Все сборки": "All instances", "Поиск сборок": "Search instances",
    "Можно добавить несколько аккаунтов (и Microsoft, и оффлайн) и быстро переключаться между ними — нажмите на аватар в самом верху боковой панели.": "You can add several accounts (Microsoft and offline) and switch quickly — click the avatar at the top of the sidebar.",
    "Оффлайн-аккаунтов до 5, основной тоже считается.": "Up to 5 offline accounts, including the main one.",
    "Skins, плащи, сердечки и цвет ника Zorya работают только на основном оффлайн-аккаунте — том, у которого ник с сайта.": "Skins, capes, hearts and Zorya nickname colours work on every offline account.",
    "По запущенных сборках": "Running instances", "Нет запущенных сборок": "No running instances",
    "Площадки": "Platforms", "CurseForge API-ключ": "CurseForge API key",
    "Нужен для поиска и установки модов/сборок с CurseForge.": "Needed to search and install mods/packs from CurseForge.",
    "Бесплатный ключ — console.curseforge.com.": "Free key — console.curseforge.com.",
    "Check ключ": "Check key", "Показывать активность в Discord": "Show Discord activity",
    "В профиле Discord будет видно, чем вы заняты": "Your Discord profile will show what you are doing",
    "Смотрит на сборки": "Looking at instances", "Ищет моды": "Searching mods", "Играет": "Playing",
    "Бездельничает": "Idling", "Производительность": "Performance",
    "Экономить ресурсы в фоне": "Save resources in background",
    "Когда окно лаунчера не в фокусе или свёрнуто (например, идет игра), анимации, 3D-персонаж и размытие стекла отключаются и не нагружают видеокарту.": "When the launcher is unfocused or minimized (e.g. while playing), animations, the 3D character and glass blur are disabled to save GPU.",
    "При возвращении всё включается снова.": "Everything turns back on when you return.",
    "Частота анимаций": "Animation rate",
    "Для 3D-персонажа. 30 кадров/с вдвое легче для процессора и видеокарты, но чуть менее плавно.": "For the 3D character. 30 fps is twice as light on CPU/GPU but slightly less smooth.",
    "как у монитора": "same as monitor", "Используйте только на слабых ПК.": "Use only on weak PCs.",
    "Авто": "Auto", "Косметика": "Cosmetics", "Наша косметика": "Our cosmetics",
    "Плащи, скины, цвет ника и сердечки игроков Zorya: вы видите их, а они видят ваши.": "Capes, skins, nickname colours and hearts of Zorya players: you see theirs and they see yours.",
    "Настроить скин": "Configure skin",
    "Это настройки для аккаунта Microsoft — у оффлайн-аккаунта нет профиля Mojang, поэтому здесь нечего менять.": "These are Microsoft account settings — an offline account has no Mojang profile, so there is nothing to change here.",
    "Для оффлайн-скинов, видимых другим, см. блок про ely.by на странице": "For offline skins visible to others, see the section on the page",
    "ТИП РУК": "ARM TYPE", "Тип рук": "Arm type",
    "Переприменяет текущий скин с другой шириной рук — картинка не меняется.": "Reapplies the current skin with a different arm width — the texture stays the same.",
    "ТЕКСТУРА СКИНА": "SKIN TEXTURE", "Текстура скина": "Skin texture",
    "Загрузить скин": "Upload skin", "На этом аккаунте нет доступных плащей.": "No capes available for this account.",
    "ВЫБРАНА СБОРКА": "SELECTED INSTANCE", "выбрана сборка": "selected instance",
    "Всего в игре": "Total playtime", "Добрый вечер": "Good evening", "Добрый день": "Good afternoon",
    "Плащи": "Capes", "Моды и сборки": "Mods & packs", "Без плаща": "No cape",
    "0/20 онлайн": "0/20 online", "Создать сборку": "Create instance",
}
# Keep this order: longest phrases first.
ordered = sorted(WORDS.items(), key=lambda kv: -len(kv[0]))

changed = 0
for path in list(ROOT.joinpath("src").rglob("*.jsx")) + list(ROOT.joinpath("src").rglob("*.js")) + list(ROOT.joinpath("src").rglob("*.html")) + list(ROOT.joinpath("electron").glob("*.js")) + list(ROOT.joinpath("electron").glob("**/*.js")):
    if "node_modules" in path.parts:
        continue
    try:
        text = path.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError):
        continue
    new = text
    for ru, en in ordered:
        new = re.sub(r"(?<![А-Яа-яЁё])" + re.escape(ru) + r"(?![А-Яа-яЁё])", en, new)
    if new != text:
        path.write_text(new, encoding="utf-8")
        changed += 1
print(f"translated {changed} files")
