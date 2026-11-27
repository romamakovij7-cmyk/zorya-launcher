// Запасной путь для maven-репозиториев Forge/NeoForge: если официальный адрес не открывается (провайдер его блокирует), файл можно взять у
// сайта Zorya. Server отдаёт байты репозитория как есть; доверять им лаунчер не обязан: контрольные
// суммы приходят из самих установщиков и из .sha1 репозитория, и несовпавший файл отбрасывается.
//
// Токен аккаунта сайта уходит только на сам сайт (адрес строится от адреса сайта, не от чужого адреса), и только для адресов из этого списка.
// (license is loaded on first use: it needs Electron, and this file is also required by code that can run without it)
const license = { siteBearer: () => require('./license').siteBearer(), siteUrl: () => require('./license').siteUrl() };

// официальный хост -> [ключ на сервере, начало пути, с которого считается путь внутри репозитория]
const SOURCES = {
  'maven.neoforged.net': ['neoforged', '/releases/'],
  'maven.minecraftforge.net': ['forge', '/'],
};

// { url, headers } на сайте для официального адреса или null (адрес не из списка / нет входа на сайт)
function mirrorFor(officialUrl) {
  try {
    const u = new URL(officialUrl);
    const src = u.protocol === 'https:' ? SOURCES[u.hostname] : null;
    if (!src || !u.pathname.startsWith(src[1]) || u.search || u.hash) return null;
    const inRepo = u.pathname.slice(src[1].length);
    if (!inRepo || inRepo.includes('..') || inRepo.includes('//')) return null;
    const bearer = license.siteBearer();
    if (!bearer) return null;
    const site = license.siteUrl();
    const url = new URL(`/api/mirror/${src[0]}/${inRepo}`, site);
    if (url.origin !== site.origin) return null;
    return { url: url.href, headers: { Authorization: `Bearer ${bearer}`, 'User-Agent': 'ZoryaLauncher' }, host: site.host };
  } catch {
    return null;
  }
}

// Сбой, после которого имеет смысл идти на зеркало: сеть не отвечает или адрес режут (403/429/451/5xx). 404 — файла нет и там тоже.
function worthMirror(err) {
  if (!err) return false;
  if (err.httpStatus) return [403, 429, 451].includes(err.httpStatus) || err.httpStatus >= 500;
  return true; // "fetch failed", таймаут, сброс соединения
}

module.exports = { mirrorFor, worthMirror, SOURCES };
