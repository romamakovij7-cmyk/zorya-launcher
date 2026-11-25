// GitHub token for Horizon Launcher's native-mod compiler. Without one GitHub answers its API with "rate limit" after 60 requests an hour
// per address (a shared network hits that quickly) and the build fails. Horizon Launcher reads the token from HORIZON_GITHUB_TOKEN /
// GITHUB_TOKEN. Kept encrypted with Windows (DPAPI, like the site login), handed only to that child process, never to the window: the
// window can say "is there one" and set or remove it, not read it back. A token with no permissions at all is enough (public repositories).
const { safeStorage } = require('electron');
const store = require('../store');

const KEY = 'githubTokenSealed';
const SHAPE = /^[A-Za-z0-9_]{20,255}$/;

function isSet() { return !!store.get(KEY); }

function set(token) {
  const t = String(token ?? '').trim();
  if (!SHAPE.test(t)) throw new Error('Это не похоже на токен GitHub: он состоит из латинских букв, цифр и «_», без пробелов (обычно начинается с ghp_ или github_pat_).');
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Защищённое хранилище Windows недоступно: токен не сохраняю.');
  store.set(KEY, safeStorage.encryptString(t).toString('base64'));
}

function clear() { store.delete(KEY); }

// The token or null (also null when it cannot be opened, e.g. the data came from another Windows user).
function get() {
  const sealed = store.get(KEY);
  if (!sealed) return null;
  try { return safeStorage.decryptString(Buffer.from(sealed, 'base64')); } catch { return null; }
}

module.exports = { isSet, set, clear, get, SHAPE };