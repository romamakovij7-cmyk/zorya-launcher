const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { shell, dialog } = require('electron');
const paths = require('./paths');

const MAX_TEXT_BYTES = 2 * 1024 * 1024; // larger files aren't opened in the built-in editor
const MAX_SEARCH_RESULTS = 300;
const MAX_SEARCH_VISITS = 60000;

// Resolves a relative path against an instance's .minecraft directory and
// guarantees the result cannot escape it (blocks "../../" traversal).
function resolveSafe(instanceId, relPath) {
  const root = paths.instanceGameDir(instanceId);
  const target = path.normalize(path.join(root, relPath || ''));
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error('Недопустимый путь');
  }
  // (Symlinks/junctions the user made themselves — e.g. saves/ on another drive — are
  // deliberately followed: an archive can't create them, so they're not an attack path.)
  return target;
}

// A single file/folder name (no separators, no traversal, nothing Windows rejects).
function assertValidName(name) {
  const n = String(name || '').trim();
  if (!n || n === '.' || n === '..' || /[\\/:*?"<>|\x00-\x1f]/.test(n) || /[. ]$/.test(n)) {
    throw new Error('Недопустимое имя. Нельзя использовать символы \\ / : * ? " < > | и заканчивать точкой или пробелом.');
  }
  return n;
}

async function listDir(instanceId, relPath) {
  const dir = resolveSafe(instanceId, relPath);
  await fsp.mkdir(dir, { recursive: true });
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const rows = await Promise.all(entries.map(async (e) => {
    try {
      const stat = await fsp.stat(path.join(dir, e.name));
      return {
        name: e.name,
        isDir: e.isDirectory(),
        size: stat.size,
        mtime: stat.mtimeMs,
      };
    } catch {
      return null; // broken link, vanished mid-listing, ...
    }
  }));
  return rows
    .filter(Boolean)
    .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name, 'ru') : a.isDir ? -1 : 1));
}

// Case-insensitive name search below relPath (breadth-first, bounded so a
// huge world folder can't stall the app).
async function searchEntries(instanceId, relPath, query) {
  const root = resolveSafe(instanceId, relPath);
  const gameRoot = paths.instanceGameDir(instanceId);
  const q = String(query || '').trim().toLowerCase();
  if (!q) return { results: [], truncated: false };
  const results = [];
  const queue = [root];
  let visited = 0;
  let truncated = false;
  while (queue.length && !truncated) {
    const dir = queue.shift();
    let entries;
    try {
      // eslint-disable-next-line no-await-in-loop
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      visited += 1;
      if (visited > MAX_SEARCH_VISITS || results.length >= MAX_SEARCH_RESULTS) { truncated = true; break; }
      const full = path.join(dir, e.name);
      if (e.name.toLowerCase().includes(q)) {
        let stat = null;
        try {
          // eslint-disable-next-line no-await-in-loop
          stat = await fsp.stat(full);
        } catch { /* skip stat details */ }
        results.push({
          name: e.name,
          isDir: e.isDirectory(),
          size: stat ? stat.size : 0,
          mtime: stat ? stat.mtimeMs : 0,
          relPath: path.relative(gameRoot, full).split(path.sep).join('/'),
        });
      }
      if (e.isDirectory()) queue.push(full);
    }
  }
  return { results, truncated };
}

async function deleteEntry(instanceId, relPath) {
  const target = resolveSafe(instanceId, relPath);
  if (target === paths.instanceGameDir(instanceId)) throw new Error('Нельзя удалить корневую папку');
  await fsp.rm(target, { recursive: true, force: true });
}

async function renameEntry(instanceId, relPath, newName) {
  const target = resolveSafe(instanceId, relPath);
  if (target === paths.instanceGameDir(instanceId)) throw new Error('Нельзя переименовать корневую папку');
  const dest = path.join(path.dirname(target), assertValidName(newName));
  resolveSafe(instanceId, path.relative(paths.instanceGameDir(instanceId), dest)); // stays inside the instance
  if (dest.toLowerCase() !== target.toLowerCase() && fs.existsSync(dest)) {
    throw new Error('File или папка с таким именем уже существуют');
  }
  await fsp.rename(target, dest);
}

async function createFolder(instanceId, relPath, name) {
  const dir = resolveSafe(instanceId, relPath);
  const target = path.join(dir, assertValidName(name));
  if (fs.existsSync(target)) throw new Error('File или папка с таким именем уже существуют');
  await fsp.mkdir(target, { recursive: true });
}

async function createFile(instanceId, relPath, name) {
  const dir = resolveSafe(instanceId, relPath);
  await fsp.mkdir(dir, { recursive: true });
  const target = path.join(dir, assertValidName(name));
  if (fs.existsSync(target)) throw new Error('File или папка с таким именем уже существуют');
  await fsp.writeFile(target, '');
}

// --- text files (built-in editor) ---

// Reads a text file for editing. Reports what's needed to write it back
// unchanged in style: a UTF-8 BOM flag and the line-ending convention.
async function readText(instanceId, relPath) {
  const target = resolveSafe(instanceId, relPath);
  const stat = await fsp.stat(target);
  if (stat.isDirectory()) throw new Error('Это папка');
  if (stat.size > MAX_TEXT_BYTES) {
    throw new Error(`File слишком большой для редактора (${(stat.size / 1024 / 1024).toFixed(1)} МБ, лимит 2 МБ). Откройте его во внешней программе.`);
  }
  let buf = await fsp.readFile(target);
  if (buf.subarray(0, 8000).includes(0)) throw new Error('Похоже на двоичный файл — в текстовом редакторе он не откроется.');
  let bom = false;
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) { bom = true; buf = buf.subarray(3); }
  const raw = buf.toString('utf8');
  const crlf = (raw.match(/\r\n/g) || []).length;
  const lf = (raw.match(/(?<!\r)\n/g) || []).length;
  const eol = crlf > lf ? '\r\n' : '\n';
  return {
    content: raw.replace(/\r\n/g, '\n'), bom, eol, size: stat.size, mtime: stat.mtimeMs,
  };
}

// Writes atomically (temp file + rename) so a crash mid-save can't leave a
// half-written config. `backup` keeps the previous version as "<name>.bak".
async function writeText(instanceId, relPath, { content, bom, eol, backup }) {
  const target = resolveSafe(instanceId, relPath);
  const text = (eol === '\r\n' ? String(content).replace(/\n/g, '\r\n') : String(content));
  const data = Buffer.concat([bom ? Buffer.from([0xef, 0xbb, 0xbf]) : Buffer.alloc(0), Buffer.from(text, 'utf8')]);
  if (backup && fs.existsSync(target)) {
    try { await fsp.copyFile(target, `${target}.bak`); } catch { /* a failed backup shouldn't block saving */ }
  }
  const tmp = `${target}.zorya-tmp`;
  await fsp.writeFile(tmp, data);
  await fsp.rename(tmp, target);
  const stat = await fsp.stat(target);
  return { size: stat.size, mtime: stat.mtimeMs };
}

// Files an instance can hold that Windows would *run* when opened (a downloaded
// modpack can contain anything). They are shown in Explorer instead of started.
const RUNNABLE_RE = /\.(exe|com|bat|cmd|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|msi|msp|scr|pif|lnk|hta|cpl|reg|jar|sh|appref-ms|url)$/i;

async function openEntry(instanceId, relPath) {
  const target = resolveSafe(instanceId, relPath);
  if (RUNNABLE_RE.test(target)) {
    shell.showItemInFolder(target);
    return;
  }
  // shell.openPath resolves to an error string rather than throwing. A path
  // that was only just created on disk can briefly be invisible to
  // Explorer's own namespace cache, so retry once before giving up.
  let err = await shell.openPath(target);
  if (err) {
    await new Promise((r) => setTimeout(r, 200));
    err = await shell.openPath(target);
  }
  if (err) throw new Error(err);
}

function revealEntry(instanceId, relPath) {
  const target = resolveSafe(instanceId, relPath);
  shell.showItemInFolder(target);
}

async function addFiles(instanceId, relPath, win) {
  const dir = resolveSafe(instanceId, relPath);
  const result = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] });
  if (result.canceled) return [];
  return copyIn(instanceId, relPath, result.filePaths, dir);
}

// Copies files/folders (absolute paths, e.g. dropped from Explorer) into a
// folder of the instance, never overwriting: a name clash becomes "name (2)".
async function copyIn(instanceId, relPath, sources, resolvedDir) {
  const dir = resolvedDir || resolveSafe(instanceId, relPath);
  await fsp.mkdir(dir, { recursive: true });
  const added = [];
  for (const src of sources) {
    const base = path.basename(src);
    const ext = path.extname(base);
    const stem = ext ? base.slice(0, -ext.length) : base;
    let dest = path.join(dir, base);
    let n = 2;
    while (fs.existsSync(dest)) { dest = path.join(dir, `${stem} (${n})${ext}`); n += 1; }
    // eslint-disable-next-line no-await-in-loop
    await fsp.cp(src, dest, { recursive: true });
    added.push(path.basename(dest));
  }
  return added;
}

module.exports = {
  listDir,
  searchEntries,
  deleteEntry,
  renameEntry,
  createFolder,
  createFile,
  readText,
  writeText,
  openEntry,
  revealEntry,
  addFiles,
  copyIn,
};
