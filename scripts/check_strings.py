import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
t = (ROOT / "dist/assets/index-BoK25l4J.js").read_text(encoding="utf-8", errors="ignore")
for s in ["Играть", "Сборка", "Настройки", "Скины", "Главная", "Поиск",
          "Подготовка", "Идёт", "Не удалось", "Ошибка", "Выйти", "Удалить",
          "Перезагрузить", "Оффлайн", "Моды", "Файлы", "Миры", "Сервера"]:
    print(s, t.count(s))
