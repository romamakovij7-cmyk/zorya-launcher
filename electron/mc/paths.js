const path = require('path');
const fs = require('fs');
const { app } = require('electron');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const INVALID_CHARS_RE = /[<>:"/\\|?*\x00-\x1F]/g;
const RESERVED_NAMES_RE = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

function slugifyInstanceName(name) {
  let cleaned = (name || '')
    .replace(INVALID_CHARS_RE, '')
    .trim()
    .replace(/\.+$/, '')
    .slice(0, 60)
    .trim();
  if (!cleaned || RESERVED_NAMES_RE.test(cleaned)) cleaned = 'Instance';
  return cleaned;
}

// Resolves (and lazily assigns + persists) a human-readable, on-disk folder
// name for an instance, derived from its display name. Falls back to the raw
// id when the instance isn't in the store yet (e.g. mid-creation).
// An id that isn't in the store yet (mid-creation) is used as the folder name
// as-is — so it must look like the UUID we generate, never like a path.
const ID_RE = /^[0-9a-fA-F-]{8,64}$/;

// The instance list as it was last read, reused until something is written to the store (see store.version). READ ONLY: whoever changes an
// instance reads its own fresh copy with store.get('instances'). Looking up a build's folder happens once per build in loops over all builds.
let instancesCache = null; // { v, at, list }
function instancesSnapshot() {
  let store;
  try { store = require('../store'); } catch { return []; }
  const now = Date.now();
  if (instancesCache && instancesCache.v === store.version && now - instancesCache.at < 3000) return instancesCache.list;
  const list = store.get('instances') || [];
  instancesCache = { v: store.version, at: now, list };
  return list;
}

function resolveFolderName(id) {
  let store;
  try {
    store = require('../store');
  } catch {
    store = null;
  }
  const known = store ? instancesSnapshot().find((i) => i.id === id) : null;
  if (known && known.folderName) return known.folderName; // the usual case: no need to read the store again
  const list = (store && store.get('instances')) || [];
  const instance = list.find((i) => i.id === id);
  if (!instance) {
    if (typeof id !== 'string' || !ID_RE.test(id)) throw new Error('Некорректный id сборки');
    return id;
  }
  if (instance.folderName) return instance.folderName;

  const base = slugifyInstanceName(instance.name);
  const taken = new Set(
    list.filter((i) => i.id !== id && i.folderName).map((i) => i.folderName)
  );
  let candidate = base;
  let n = 2;
  while (taken.has(candidate) || fs.existsSync(path.join(instancesDirRaw(), candidate))) {
    candidate = `${base} (${n++})`;
  }

  // Migrate a pre-existing legacy folder (named by the raw id, from before
  // this naming scheme existed) so its files aren't orphaned.
  const legacyDir = path.join(instancesDirRaw(), id);
  if (fs.existsSync(legacyDir)) {
    try {
      fs.renameSync(legacyDir, path.join(instancesDirRaw(), candidate));
    } catch {
      instance.folderName = id;
      store.set('instances', list);
      return id;
    }
  }

  instance.folderName = candidate;
  store.set('instances', list);
  return candidate;
}

// Two folders can be moved off the system drive in Settings -> «Folders»: the builds (instances) and the game files (meta: versions,
// libraries, assets, Java; plus the Horizon files). The choice lives in the launcher settings as an absolute path; empty = the default
// place inside the launcher's data folder. It is set only through dataFolders.js (validated), never straight from the page.
const DEFAULT_SUBDIR = { instancesDir: 'instances', gameFilesDir: 'meta' };

function defaultDirOf(key) {
  return path.join(app.getPath('userData'), DEFAULT_SUBDIR[key]);
}

// Reading the settings means reading and parsing the whole launcher-config.json (close to 1 MB for a big library), and these paths are asked
// for thousands of times in a row (every library, every asset). So the folder settings are reused until the store is written to, and the
// game-file folders are created once per half minute instead of on every call. invalidate() drops all of it (called when the folders change).
let settingsCache = null; // { at, value }
const ensured = new Map(); // dir -> when it was last created/checked
function invalidate() { settingsCache = null; instancesCache = null; ensured.clear(); }

function folderSettings() {
  const now = Date.now();
  let version = -1;
  try { version = require('../store').version; } catch { /* store not ready */ }
  // reused until anything is written to the store (store.version) or a few seconds pass
  if (settingsCache && settingsCache.v === version && now - settingsCache.at < 5000) return settingsCache.value;
  let value = {};
  try { value = require('../store').get('settings') || {}; } catch { /* store not ready: use the defaults */ }
  settingsCache = { at: now, v: version, value };
  return value;
}

function customDir(key) {
  const value = folderSettings()[key];
  if (typeof value === 'string' && value.trim() && path.isAbsolute(value)) return path.normalize(value.trim());
  return null;
}

// ensureDir for the game-file folders, at most once per 30 s per folder.
function ensureOnce(dir, make = ensureDir) {
  const at = ensured.get(dir);
  if (at && Date.now() - at < 30000) return dir;
  const result = make(dir);
  ensured.set(dir, Date.now());
  return result;
}

// A moved folder can be unavailable (an unplugged drive, a deleted folder). Say so instead of silently starting an empty library elsewhere.
function ensureUserDir(dir, what) {
  try {
    return ensureDir(dir);
  } catch (err) {
    throw new Error(`Folder ${what} недоступна: ${dir} (${err.code || err.message}). Подключите диск или выберите другую папку в Настройках → Folders.`);
  }
}

function instancesDirRaw() {
  return customDir('instancesDir') || defaultDirOf('instancesDir');
}

function root() {
  return ensureDir(app.getPath('userData'));
}

function metaDir() {
  const custom = customDir('gameFilesDir');
  return custom ? ensureOnce(custom, (d) => ensureUserDir(d, 'файлов игры')) : ensureOnce(defaultDirOf('gameFilesDir'));
}

// Horizon (the Rust edition) keeps its own versions, Java and game files; they follow the "game files" folder.
function horizonRoot() {
  const custom = customDir('gameFilesDir');
  return custom ? ensureUserDir(path.join(custom, 'horizon'), 'файлов игры') : ensureDir(path.join(root(), 'horizon'));
}

function versionsDir() {
  return ensureOnce(path.join(metaDir(), 'versions'));
}

function librariesDir() {
  return ensureOnce(path.join(metaDir(), 'libraries'));
}

function assetsDir() {
  return ensureOnce(path.join(metaDir(), 'assets'));
}

function assetIndexesDir() {
  return ensureOnce(path.join(assetsDir(), 'indexes'));
}

function assetObjectsDir() {
  return ensureOnce(path.join(assetsDir(), 'objects'));
}

function nativesDir(key) {
  return ensureOnce(path.join(metaDir(), 'natives', key));
}

function instancesDir() {
  const custom = customDir('instancesDir');
  return custom ? ensureUserDir(custom, 'сборок') : ensureDir(defaultDirOf('instancesDir'));
}

function instanceDir(id) {
  return ensureDir(path.join(instancesDir(), resolveFolderName(id)));
}

// An instance imported with "use in place" has no game folder of its own: it points at the other launcher's folder (never created or
// removed from here). Only importers.js sets externalGameDir, and only to folders it found itself.
function externalGameDirOf(id) {
  try {
    const instance = instancesSnapshot().find((i) => i.id === id);
    return instance && typeof instance.externalGameDir === 'string' && path.isAbsolute(instance.externalGameDir) ? path.normalize(instance.externalGameDir) : null;
  } catch {
    return null;
  }
}

function instanceGameDir(id) {
  const external = externalGameDirOf(id);
  if (external) return external;
  return ensureDir(path.join(instanceDir(id), '.minecraft'));
}

module.exports = {
  ensureDir,
  slugifyInstanceName,
  root,
  metaDir,
  horizonRoot,
  customDir,
  invalidate,
  defaultDirOf,
  versionsDir,
  librariesDir,
  assetsDir,
  assetIndexesDir,
  assetObjectsDir,
  nativesDir,
  instancesDir,
  instanceDir,
  instanceGameDir,
  externalGameDirOf,
};
