"""Curated corrections for Argos output: consistent UI terminology."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
F = ROOT / "scripts" / "en_dict.json"
d = json.loads(F.read_text(encoding="utf-8"))

FIX = {
    "Главная": "Home", "Главный экран": "Home screen",
    "Поиск": "Search", "Поиск...": "Search...",
    "Библиотека": "Library", "Настройки": "Settings",
    "Скины": "Skins", "Скин": "Skin", "Плащи": "Capes", "Плащ": "Cape",
    "Моды": "Mods", "Мод": "Mod", "Модпаки": "Modpacks", "Модпак": "Modpack",
    "Файлы": "Files", "Файл": "File", "Файлы игры": "Game files",
    "Миры": "Worlds", "Мир": "World", "Сервера": "Servers", "Сервер": "Server",
    "Список серверов": "Server list",
    "Статистика": "Stats", "Скриншоты": "Screenshots",
    "Схематики": "Schematics", "Проект": "Project", "Проекты": "Projects",
    "Папка": "Folder", "Папки": "Folders", "Новая папка": "New folder",
    "Версия": "Version", "Память": "Memory", "Загрузчик": "Loader",
    "Сборка": "Instance", "Сборки": "Instances", "сборка": "instance",
    "сборки": "instances", "сборок": "instances",
    "Скачать": "Download", "Обновить": "Refresh", "Обновление": "Update",
    "Обновления": "Updates", "Проверить": "Check",
    "Создать": "Create", "Создать сборку": "Create instance",
    "Удалить": "Delete", "Сохранить": "Save", "Отмена": "Cancel",
    "Закрыть": "Close", "Открыть": "Open", "Сохранить и закрыть": "Save and close",
    "Войти": "Sign in", "Выйти": "Sign out", "Вход…": "Signing in…",
    "Аккаунт": "Account", "Аккаунты": "Accounts", "Авторы": "Authors",
    "Поддержали лаунчер": "Supporters", "Лицензии и источники": "Licenses and sources",
    "Не удалось": "Failed", "не удалось": "failed", "Ошибка": "Error",
    "ошибка": "error", "Ошибки": "Errors", "Предупреждение": "Warning",
    "Информация": "Info", "Включить": "Enable", "Выключить": "Disable",
    "Включено": "Enabled", "Выключено": "Disabled",
    "Да": "Yes", "Нет": "No", "Продолжить": "Continue",
    "Загрузка": "Loading", "Готово": "Done", "Ожидание": "Waiting",
    "Отменено": "Cancelled", "Успешно": "Success", "Сохранено": "Saved",
    "Запустить": "Launch", "Запуск": "Launch", "Запущена": "Running",
    "Играть": "Play", "Игра": "Game", "Стоп": "Stop",
    "Название": "Name", "Имя": "Name", "Ник": "Nickname",
    "Адрес": "Address", "Порт": "Port", "Игрок": "Player", "Игроки": "Players",
    "Время": "Time", "Статус": "Status", "Процесс": "Process",
    "Размер": "Size", "Вес": "Size", "Тема": "Theme", "Язык": "Language",
    "Оформление": "Appearance", "Интерфейс": "Interface", "Клавиши": "Keybinds",
    "Данные": "Data", "Управление": "Control", "Разное": "Other",
    "Игры": "Games", "Другая картинка": "Another picture",
    "Выбрать картинку": "Choose picture", "Заменить…": "Replace…",
    "Выбрать…": "Choose…", "Убрать": "Remove", "Вернуть сцену": "Restore scene",
    "Все": "All", "Всё": "All", "Найти проекты": "Find projects",
    "Добавить файлы": "Add files", "Добавить": "Add", "Импорт": "Import",
    "Импортировать": "Import", "Экспорт": "Export", "Переименовать": "Rename",
    "Дублировать": "Duplicate", "Очистить": "Clear", "Копировать": "Copy",
    "Скопировать": "Copy", "Выбрано": "Selected", "Действия": "Actions",
    "Новый мир": "New world", "Создать мир": "Create world",
    "Ещё не запускалась": "Never launched", "Не запускалась": "Never launched",
    "Выбрана сборка": "Selected instance", "Последняя игра": "Last played",
    "Всего в игре": "Total playtime", "модов": "mods", "секунд": "seconds",
    "Идёт подготовка…": "Preparing…", "Подготовка…": "Preparing…",
    "Идёт сборка…": "Building…", "Идет сборка…": "Building…",
    "Открыть папку": "Open folder", "Папки": "Folders",
    "Настройки игры": "Game settings", "Доп. аргументы JVM": "Extra JVM args",
    "Путь к Java": "Java path", " Java не найдена": " Java not found",
    "Основной": "Main", "Премиум": "Premium", "Подписка": "Subscription",
    "Бесплатно": "Free", "Рекорд": "Record", "Рекорд:": "Record:",
    "Статус": "Status", "Монитор": "Monitor", "Журнал": "Log",
    "Горячие клавиши": "Keybinds", "Раздел": "Section",
    "О лаунчере": "About", "Версия": "Version",
    "Текущая версия": "Current version", "Дом": "Home",
}

d.update(FIX)

# Argos adds a trailing period to many isolated words; strip it when the
# Russian source has no terminal punctuation and the result is a short label.
for ru, en in list(d.items()):
    if (len(en) < 28 and en.endswith(".") and ru
            and ru[-1] not in ".!?…:;" and not re.search(r"\d", en)):
        d[ru] = en[:-1]

F.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")
print("fixed", len(FIX), "entries; total", len(d))
