// Runtime EN ↔ UK translation for the Zorya fork.
// The source UI is English; when the user picks Ukrainian we translate text
// nodes in place and keep the originals so switching back restores English.

import GENERATED from './i18n-dict.json';

const MANUAL = {
  'Never launched': 'Ще не запускалась',
  'Licenses and sources': 'Ліцензії та джерела',
  'Minecraft Java': 'Minecraft Java',
  'Rust (Horizon)': 'Rust (Horizon)',
  'Sign in': 'Увійти', 'Sign out': 'Вийти',
  'Already running': 'Вже запущено',
  'Instance not found': 'Збірку не знайдено',
  'No account signed in': 'Немає активного акаунта',
  'Home': 'Головна', 'Search': 'Пошук', 'Library': 'Бібліотека',
  'Settings': 'Налаштування', 'Skins': 'Скіни', 'Screenshots': 'Скріншоти',
  'Project': 'Проєкт', 'Schematics': 'Схеми', 'Stats': 'Stats',
  'Mods': 'Моди', 'Files': 'Файли', 'Worlds': 'Світи', 'Servers': 'Сервери',
  'Log': 'Log', 'All': 'Усі', 'Create': 'Створити', 'Cancel': 'Скасувати',
  'Delete': 'Видалити', 'Save': 'Зберегти', 'Close': 'Закрити',
  'Launch': 'Запустити', 'Import': 'Імпорт', 'Export': 'Експорт',
  'Account': 'Акаунт', 'Authors': 'Автори', 'Size': 'Вага',
  'mods': 'модів', 'seconds': 'seconds', 'Instance': 'Збірка',
  'Instances': 'Збірки', 'Folder': 'Folder', 'Folders': 'Folders',
  'Copy': 'Копіювати', 'Open': 'Відкрити', 'Name': 'Назва',
  'Version': 'Версія', 'Loader': 'Завантажник', 'Memory': 'Памʼять',
  'Language': 'Мова', 'Theme': 'Theme', 'Appearance': 'Оформлення',
  'Keybinds': 'Клавіші', 'Updates': 'Оновлення', 'Data': 'Дані',
  'Control': 'Керування', 'Other': 'Інше', 'Interface': 'Інтерфейс',
  'Failed': 'Не вдалося', 'failed': 'не вдалося', 'error': 'помилка',
  'Error': 'Помилка', 'Warning': 'Попередження', 'Info': 'Інформація',
  'Loading': 'Завантаження', 'Done': 'Done', 'Refresh': 'Оновити',
  'Add': 'Додати', 'Rename': 'Перейменувати', 'Duplicate': 'Дублювати',
  'Clear': 'Очистити', 'Enable': 'Увімкнути', 'Disable': 'Вимкнути',
  'Enabled': 'Увімкнено', 'Disabled': 'Вимкнуто', 'Yes': 'Так', 'No': 'Ні',
  'Continue': 'Продовжити', 'Player': 'Гравець', 'World': 'Світ',
  'Server': 'Server', 'Status': 'Status', 'Time': 'Час',
  'Search...': 'Пошук...', 'Save and close': 'Зберегти й закрити',
  'Game files': 'Файли гри', 'Server list': 'Список серверів',
  'Address': 'Адреса', 'Port': 'Port', 'Players': 'Гравці',
  'Support': 'Підтримка', 'Supporters': 'Прихильники',
  'Create instance': 'Створити збірку', 'Edit instance': 'Edit instance',
  'Open folder': 'Відкрити папку', 'Build native mods': 'Зібрати нативні моди',
  'Resource packs': 'Пакети ресурсів', 'Game log': 'Log гри',
  'Current instance': 'Поточна збірка', 'Ready': 'Done',
  'No instance selected': 'Збірку не вибрано',
  'Import your Eternal instance or create a new one.': 'Імпортуйте збірку Eternal або створіть нову.',
  'Play': 'Грати', 'Stop': 'Зупинити', 'Restart': 'Перезапустити',
  'English': 'Англійська', 'Ukrainian': 'Українська',
  'Good evening': 'Добрий вечір', 'Good afternoon': 'Добрий день',
  'Running instances': 'Запущені збірки', 'No running instances': 'Немає запущених збірок',
  'Platforms': 'Платформи', 'CurseForge API key': 'API-ключ CurseForge',
  'Needed to search and install mods/packs from CurseForge.': 'Потрібен для пошуку та встановлення модів/збірок з CurseForge.',
  'Free key — console.curseforge.com.': 'Безкоштовний ключ — console.curseforge.com.',
  'Check key': 'Перевірити ключ', 'Show Discord activity': 'Показувати активність у Discord',
  'Your Discord profile will show what you are doing': 'У профілі Discord буде видно, чим ви зайняті',
  'Looking at instances': 'Дивиться на збірки', 'Searching mods': 'Шукає моди',
  'Playing': 'Грає', 'Idling': 'Бездіє', 'Performance': 'Продуктивність',
  'Save resources in background': 'Економити ресурси у фоні',
  'When the launcher is unfocused or minimized (e.g. while playing), animations, the 3D character and glass blur are disabled to save GPU.': 'Коли лаунчер не у фокусі або згорнутий (наприклад, під час гри), анімації, 3D-персонаж і розмиття скла вимикаються, щоб не навантажувати відеокарту.',
  'Everything turns back on when you return.': 'Коли ви повернетеся, усе знову вмикається.',
  'Animation rate': 'Частота анімацій',
  'For the 3D character. 30 fps is twice as light on CPU/GPU but slightly less smooth.': 'Для 3D-персонажа. 30 кадр/с удвічі легше для процесора та відеокарти, але трохи менш плавно.',
  'same as monitor': 'як у монітора', 'Use only on weak PCs.': 'Використовуйте лише на слабких ПК.',
  'Auto': 'Auto', 'Cosmetics': 'Cosmetics', 'Our cosmetics': 'Our cosmetics',
  'Capes, skins, nickname colours and hearts of Zorya players: you see theirs and they see yours.': 'Capeі, скіни, кольори ніка та сердечка гравців Zorya: ви бачите їхні, а вони — ваші.',
  'Configure skin': 'Налаштувати скін',
  'These are Microsoft account settings — an offline account has no Mojang profile, so there is nothing to change here.': 'Це налаштування акаунта Microsoft — у офлайн-акаунта немає профілю Mojang, тому тут нічого змінювати.',
  'For offline skins visible to others, see the section on the page': 'Для офлайн-скінів, видимих іншим, дивіться розділ на сторінці',
  'ARM TYPE': 'ARM TYPE', 'Arm type': 'Arm type',
  'Reapplies the current skin with a different arm width — the texture stays the same.': 'Перезастосовує поточний скін з іншою шириною рук — текстура не змінюється.',
  'SKIN TEXTURE': 'SKIN TEXTURE', 'Skin texture': 'Skin texture',
  'Upload skin': 'Завантажити скін', 'No capes available for this account.': 'На цьому акаунті немає доступних плащів.',
  'SELECTED INSTANCE': 'ВИБРАНА ЗБІРКА', 'selected instance': 'вибрана збірка',
  'Total playtime': 'Загальний час у грі', 'Capes': 'Capeі',
  'Mods & packs': 'Моди та збірки', 'No cape': 'No cape',
  '0/20 online': '0/20 online', 'Create instance': 'Створити збірку',
  'You can add several accounts (Microsoft and offline) and switch quickly — click the avatar at the top of the sidebar.': 'Можна додати кілька акаунтів (Microsoft і оффлайн) і швидко перемикатися — натисніть аватар угорі панелі.',
  'Up to 5 offline accounts, including the main one.': 'До 5 офлайн-акаунтів, включно з основним.',
  'Skins, capes, hearts and Zorya nickname colours work on every offline account.': 'Скіни, плащі, сердечка та кольори ніка Zorya працюють на всіх офлайн-акаунтах.',
};

const DICT = { ...GENERATED, ...MANUAL };
const ordered = Object.entries(DICT).sort((a, b) => b[0].length - a[0].length);

const originalText = new WeakMap();
const originalAttrs = new WeakMap();
let current = 'en';
let observer = null;

function translateText(text) {
  let out = text;
  for (const [en, uk] of ordered) {
    out = out.replace(new RegExp(`(?<![A-Za-zА-Яа-яІіЇїЄєҐґ])${en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-zА-Яа-яІіЇїЄєҐґ])`, 'g'), uk);
  }
  return out;
}

function walk(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    if (!node.nodeValue || !node.nodeValue.trim()) continue;
    if (!originalText.has(node)) originalText.set(node, node.nodeValue);
    const source = originalText.get(node);
    const next = current === 'uk' ? translateText(source) : source;
    if (node.nodeValue !== next) node.nodeValue = next;
  }
  const all = root.querySelectorAll ? root.querySelectorAll('*') : [];
  for (const el of all) {
    let map = originalAttrs.get(el);
    if (!map) { map = new Map(); originalAttrs.set(el, map); }
    for (const attr of ['placeholder', 'title', 'aria-label']) {
      const value = el.getAttribute(attr);
      if (!value) continue;
      if (!map.has(attr)) map.set(attr, value);
      const source = map.get(attr);
      const next = current === 'uk' ? translateText(source) : source;
      if (value !== next) el.setAttribute(attr, next);
    }
  }
}

export function applyLanguage(lang) {
  current = lang === 'uk' ? 'uk' : 'en';
  document.documentElement.dataset.lang = current;
  if (!observer) {
    observer = new MutationObserver(() => { if (current === 'uk') walk(document.body); });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
  }
  walk(document.body);
}
