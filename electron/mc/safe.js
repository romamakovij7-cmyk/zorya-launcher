// Guards for values that come from outside the launcher: a modpack's file list,
// a server's API answer, an argument sent by the UI. Anything that ends up in a
// file path goes through one of these first.
const path = require('path');

// Minecraft / loader version strings ("1.21.1", "47.2.0", "0.16.9", "26.1.2-pre1",
// even Mojang's "1.14.3 - Combat Test"): letters, digits and a few separators — no slashes.
const VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._+ -]{0,63}$/;

function assertVersionString(value, what = 'версия') {
  if (typeof value !== 'string' || !VERSION_RE.test(value)) throw new Error(`Некорректная ${what}`);
  return value;
}

// root + relative path, guaranteed to stay inside root (".." and absolute paths throw).
function safeJoin(root, ...segments) {
  const base = path.resolve(root);
  const target = path.resolve(base, ...segments.map((s) => String(s ?? '')));
  if (target !== base && !target.startsWith(base + path.sep)) throw new Error('Недопустимый путь');
  return target;
}

// A bare file name: no folders, nothing Windows refuses to create.
function safeFileName(name) {
  const n = path.basename(String(name ?? '').replace(/\\/g, '/'));
  if (!n || n === '.' || n === '..' || /[<>:"|?*\x00-\x1f]/.test(n) || /[. ]$/.test(n)) {
    throw new Error('Недопустимое имя файла');
  }
  return n;
}

// Only web links the OS may open on the user's behalf.
function isSafeExternalUrl(url) {
  try {
    const u = new URL(String(url));
    return u.protocol === 'https:' || u.protocol === 'http:' || u.protocol === 'mailto:';
  } catch {
    return false;
  }
}

module.exports = {
  VERSION_RE, assertVersionString, safeJoin, safeFileName, isSafeExternalUrl,
};
