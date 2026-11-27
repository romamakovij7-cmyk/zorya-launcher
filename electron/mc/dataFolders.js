// Settings -> «Folders»: moving the builds and the game files off the system drive.
// The launcher does NOT move anything itself: the person copies the old files by hand (or starts clean) — we only check that the new
// folder is usable, remember it, and say how much of the old library is already in it.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const paths = require('./paths');
const store = require('../store');

const KINDS = {
  instances: { key: 'instancesDir', label: 'сборок', other: 'gameFilesDir' },
  game: { key: 'gameFilesDir', label: 'файлов игры', other: 'instancesDir' },
};

const norm = (p) => path.normalize(p).replace(/[\\/]+$/, '').toLowerCase();
const isSameOrInside = (child, parent) => {
  const c = norm(child); const p = norm(parent);
  return c === p || c.startsWith(`${p}${path.sep}`);
};

function currentDir(kind) {
  const k = KINDS[kind];
  return paths.customDir(k.key) || paths.defaultDirOf(k.key);
}

function freeBytes(dir) {
  try {
    let probe = dir;
    while (probe && !fs.existsSync(probe)) { const up = path.dirname(probe); if (up === probe) break; probe = up; }
    const st = fs.statfsSync(probe);
    return Number(st.bavail) * Number(st.bsize);
  } catch { return null; }
}

// How much of the old library is already in the folder: builds present / builds in the list, or whether the game files are there.
function inspectFolder(kind, dir) {
  if (kind === 'instances') {
    const list = (store.get('instances') || []).filter((i) => i && !i.externalGameDir && i.folderName);
    let found = 0;
    for (const i of list) { try { if (fs.existsSync(path.join(dir, i.folderName))) found += 1; } catch { /* unreadable */ } }
    return { found, total: list.length };
  }
  const has = ['versions', 'libraries', 'assets'].filter((n) => { try { return fs.existsSync(path.join(dir, n)); } catch { return false; } });
  return { found: has.length, total: 3 };
}

function info(kind) {
  const k = KINDS[kind];
  const dir = currentDir(kind);
  return {
    kind,
    dir,
    defaultDir: paths.defaultDirOf(k.key),
    custom: !!paths.customDir(k.key),
    free: freeBytes(dir),
    // A default folder that has not been created yet is fine (the launcher makes it on demand); only a CHOSEN folder that is gone
    // (an unplugged drive, a deleted folder) is a problem worth warning about.
    available: !paths.customDir(k.key) || (() => { try { return fs.existsSync(dir); } catch { return false; } })(),
    ...inspectFolder(kind, dir),
  };
}

// Deleting a build removes its whole folder (<builds folder>\<name>). So the builds folder must hold only our own build folders (they
// contain ".minecraft", or are still empty): otherwise an unrelated folder that happens to share a build's name would be wiped with it.
const IGNORED_ENTRY = /^(\.zorya-write-test-\d+|desktop\.ini|thumbs\.db|\.ds_store)$/i;
function foreignEntries(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  const foreign = [];
  for (const e of entries) {
    if (IGNORED_ENTRY.test(e.name)) continue;
    if (!e.isDirectory()) { foreign.push(e.name); continue; }
    let inner;
    try { inner = fs.readdirSync(path.join(dir, e.name)); } catch { foreign.push(e.name); continue; }
    if (inner.length && !inner.includes('.minecraft')) foreign.push(e.name);
  }
  return foreign;
}

// Checks a folder the person picked. Returns { ok, dir } or { ok:false, error }, plus an optional warning.
function validate(kind, input) {
  const k = KINDS[kind];
  if (typeof input !== 'string' || !input.trim() || input.length > 400) return { ok: false, error: 'Folder не выбрана.' };
  if (!path.isAbsolute(input)) return { ok: false, error: 'Нужен полный путь к папке.' };
  const dir = path.normalize(input.trim()).replace(/[\\/]+$/, '') || input;
  if (/^[\\/]{2}/.test(dir)) return { ok: false, error: 'Сетевые папки не поддерживаются: игра будет тормозить и вылетать. Выберите папку на локальном диске.' };
  if (path.parse(dir).root.replace(/[\\/]+$/, '').toLowerCase() === dir.toLowerCase()) return { ok: false, error: 'Выберите папку, а не корень диска. Создайте на диске отдельную папку, например «Zorya».' };
  // Inside the program's own folder the updater would wipe it on the next update.
  try {
    if (app.isPackaged && isSameOrInside(dir, path.dirname(process.execPath))) return { ok: false, error: 'Эту папку занимает сам лаунчер, выберите другую.' };
  } catch { /* ignore */ }
  const otherDir = paths.customDir(k.other);
  const other = otherDir || paths.defaultDirOf(k.other);
  if (norm(dir) === norm(other) || (otherDir && (isSameOrInside(dir, otherDir) || isSameOrInside(otherDir, dir)))) {
    return { ok: false, error: 'Эта папка уже занята другим разделом (сборки и files игры должны лежать в разных папках, не одна в другой).' };
  }
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.zorya-write-test-${process.pid}`);
    fs.writeFileSync(probe, 'ok');
    fs.rmSync(probe, { force: true });
  } catch (err) {
    return { ok: false, error: `В эту папку нельзя писать (${err.code || err.message}). Выберите другую.` };
  }
  if (kind === 'instances') {
    const foreign = foreignEntries(dir);
    if (foreign.length) {
      const shown = foreign.slice(0, 3).join(', ') + (foreign.length > 3 ? ` и ещё ${foreign.length - 3}` : '');
      return { ok: false, error: `В этой папке уже лежат чужие files и папки (${shown}). При удалении сборки лаунчер удаляет её папку целиком, поэтому сборки нельзя хранить вместе с чужими данными. Создайте новую пустую папку, например «Zorya», и выберите её.` };
    }
  }
  let warning = '';
  const oneDrive = [process.env.OneDrive, process.env.OneDriveConsumer, process.env.OneDriveCommercial].filter(Boolean);
  if (oneDrive.some((o) => isSameOrInside(dir, o)) || /[\\/]onedrive[^\\/]*([\\/]|$)/i.test(dir)) {
    warning = 'Folder лежит внутри OneDrive: он будет синхронизировать гигабайты игровых файлов, а это тормозит игру и забивает облако. Лучше выбрать папку вне OneDrive.';
  }
  return { ok: true, dir, warning };
}

function save(kind, dirOrNull) {
  const k = KINDS[kind];
  const settings = { ...(store.get('settings') || {}) };
  if (dirOrNull) settings[k.key] = dirOrNull; else delete settings[k.key];
  store.set('settings', settings);
  paths.invalidate(); // the folder settings and the "folder exists" checks are remembered for a short time (see paths.js)
}

// Picks a folder: the default one means "reset".
function apply(kind, input) {
  const check = validate(kind, input);
  if (!check.ok) return check;
  const isDefault = norm(check.dir) === norm(paths.defaultDirOf(KINDS[kind].key));
  save(kind, isDefault ? null : check.dir);
  return { ok: true, warning: check.warning, info: info(kind) };
}

function reset(kind) {
  save(kind, null);
  return { ok: true, info: info(kind) };
}

module.exports = { KINDS, info, validate, apply, reset, currentDir, _test: { norm, isSameOrInside, inspectFolder, foreignEntries } };
