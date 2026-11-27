// "Main" оффлайн-аккаунт: тот, у которого ник совпадает с ником в игре на сайте Zorya.
// Offline-аккаунтов можно держать до limits.MAX_OFFLINE_ACCOUNTS (основной тоже считается), но системы Zorya — сервер скинов,
// плащи, сердечки, цвет ника — работают только на основном. Остальные — обычные оффлайн-аккаунты «как в любом лаунчере».
// Server сайта проверяет то же самое (новый оффлайн-ник для скинов обязан совпасть с ником на сайте), здесь — чтобы человек
// понимал это заранее и лаунчер не слал серверу заведомо отказные запросы.

const SITE_NICK_RE = /^[A-Za-z0-9_]{3,16}$/;
const FREE_NAME_RE = /^[\p{L}\p{N}_]{1,16}$/u;

const sameNick = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

// Nickname с сайта, как его видел лаунчер в последний раз (хранится в настройках приложения). null — неизвестен / не вошли на сайт.
function getSiteNick(store) {
  const n = store.get('siteNick');
  return typeof n === 'string' && SITE_NICK_RE.test(n) ? n : null;
}
function setSiteNick(store, nick) {
  if (typeof nick === 'string' && SITE_NICK_RE.test(nick)) { if (store.get('siteNick') !== nick) store.set('siteNick', nick); } else if (store.get('siteNick') != null) store.delete('siteNick');
}

// Main ли это оффлайн-аккаунт. Если ник сайта неизвестен — никакой аккаунт основным не считается.
function isMainOffline(account, siteNick) {
  return !!account && account.type === 'offline' && !!siteNick && sameNick(account.name, siteNick);
}

// Можно ли аккаунту пользоваться системами Zorya (скины на сервере, плащи, сердечки, цвет ника).
// Microsoft-аккаунтам можно всегда (их плащи/цвет ника привязаны к аккаунту сайта отдельно), оффлайн — только основному.
function zoryaAllowed(account, siteNick) {
  if (!account) return false;
  if (account.type !== 'offline') return true;
  return isMainOffline(account, siteNick);
}

// Что делать с просьбой «добавить оффлайн-аккаунт». name — то, что ввёл человек (пусто = основной с ником сайта).
// Возвращает { ok, name, main } или { ok:false, error }.
function planAddOffline({ accounts, name, siteNick, max, signedIn = true }) {
  const offline = (accounts || []).filter((a) => a.type === 'offline');
  const typed = String(name ?? '').trim();
  const wantMain = !typed || (siteNick && sameNick(typed, siteNick));
  let finalName;
  if (wantMain) {
    if (!siteNick) {
      return { ok: false, error: signedIn
        ? 'Nickname в игре ещё не задан. Задайте его на сайте (страница аккаунта) и попробуйте снова.'
        : 'Main аккаунт берёт ник с сайта: войдите в аккаунт Zorya (Settings → Account Zorya) и попробуйте снова.' };
    }
    finalName = siteNick;
  } else {
    if (!FREE_NAME_RE.test(typed)) return { ok: false, error: 'Nickname: до 16 символов — только буквы, цифры и _' };
    finalName = typed;
  }
  // Тот же ник другим регистром — это другой UUID, но для человека тот же аккаунт: не разрешаем.
  const dup = offline.find((a) => sameNick(a.name, finalName));
  if (dup) {
    // Уже добавленный основной с верным регистром — не error (просто сделаем его активным).
    if (dup.name === finalName) return { ok: true, name: finalName, main: !!wantMain, existing: true };
    return { ok: false, error: `Offline-аккаунт «${dup.name}» уже есть (ники различаются только регистром — для игры это один и тот же ник).` };
  }
  if (offline.length >= max) {
    return { ok: false, error: `Можно добавить не больше ${max} оффлайн-аккаунтов (основной тоже считается). Удалите ненужный аккаунт.` };
  }
  return { ok: true, name: finalName, main: !!wantMain };
}

const NOT_MAIN_MESSAGE = 'Skins, capes, hearts and Zorya nickname colours work on every offline account. На этом аккаунте они выключены.';

module.exports = { SITE_NICK_RE, FREE_NAME_RE, sameNick, getSiteNick, setSiteNick, isMainOffline, zoryaAllowed, planAddOffline, NOT_MAIN_MESSAGE };
