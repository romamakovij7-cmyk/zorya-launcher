const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { app, BrowserWindow, nativeImage, clipboard, dialog, ClipboardItem } = require('electron');
const paths = require('./paths');
const store = require('../store');

async function listAll() {
  const instances = store.get('instances');
  const results = [];
  for (const inst of instances) {
    const dir = path.join(paths.instanceGameDir(inst.id), 'screenshots');
    let entries;
    try {
      // eslint-disable-next-line no-await-in-loop
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    const names = entries.filter((e) => e.isFile() && /\.(png|jpe?g)$/i.test(e.name)).map((e) => e.name);
    // stat in batches instead of one by one: thousands of files on a slow disk or a network drive
    for (let i = 0; i < names.length; i += 64) {
      // eslint-disable-next-line no-await-in-loop
      const stats = await Promise.all(names.slice(i, i + 64).map((n) => fsp.stat(path.join(dir, n)).catch(() => null)));
      stats.forEach((stat, k) => {
        if (!stat) return; // deleted while listing
        results.push({ instanceId: inst.id, instanceName: inst.name, filename: names[i + k], mtime: stat.mtimeMs, size: stat.size });
      });
    }
  }
  return results.sort((a, b) => b.mtime - a.mtime);
}

function resolveShot(instanceId, filename) {
  if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    throw new Error('Некорректное имя файла');
  }
  return path.join(paths.instanceGameDir(instanceId), 'screenshots', filename);
}

// nativeImage decoding/resizing is unavoidably synchronous CPU work in
// Electron's API, but reading the file itself off disk doesn't have to
// block the main process — createFromBuffer() skips that part of the cost.
async function loadImage(instanceId, filename) {
  const buf = await fsp.readFile(resolveShot(instanceId, filename));
  const img = nativeImage.createFromBuffer(buf);
  if (img.isEmpty()) throw new Error('Failed прочитать изображение');
  return img;
}

// ---- thumbnails ----
// A small JPEG per screenshot, made ONCE and kept on disk (userData/screenshot-thumbs), so opening the gallery again reads tiny files instead of
// decoding every 4K screenshot again. Before this, every visit decoded the whole file on the main thread (the whole launcher froze for seconds),
// re-encoded it as a PNG and sent ~700 KB of base64 text per picture to the page.
const THUMB_WIDTH = 640;
const THUMB_QUALITY = 82;

function thumbDir() {
  const dir = path.join(app.getPath('userData'), 'screenshot-thumbs');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// The key changes when the file is edited/replaced (time or size), so a stale thumbnail is never shown.
const thumbKey = (instanceId, filename, st) => crypto.createHash('sha1')
  .update(`${instanceId}|${filename}|${Math.floor(st.mtimeMs)}|${st.size}|${THUMB_WIDTH}`).digest('hex');

// Two thumbnails are made at a time at most.
const GEN_SLOTS = 2;
let genActive = 0;
const genWaiters = [];
async function withGenerationSlot(task) {
  if (genActive >= GEN_SLOTS) await new Promise((resolve) => { genWaiters.push(resolve); });
  genActive += 1;
  try { return await task(); } finally { genActive -= 1; const next = genWaiters.shift(); if (next) next(); }
}

// Decoding a 4K screenshot is heavy, and nativeImage does it ON THE MAIN THREAD (the whole launcher stutters). So the picture is decoded and scaled
// by a hidden Chromium window instead (a separate process); the main process only reads the file and passes the bytes. The window is created on
// the first need and destroyed after 20 s without work (and when the main window closes, so it never keeps the app alive).
let worker = null;
let workerReady = null;
let idleTimer = null;
function disposeWorker() {
  clearTimeout(idleTimer);
  idleTimer = null;
  const w = worker;
  worker = null;
  workerReady = null;
  if (w && !w.isDestroyed()) { try { w.destroy(); } catch { /* already gone */ } }
}
function getWorker() {
  if (worker && !worker.isDestroyed()) return workerReady;
  worker = new BrowserWindow({
    show: false, width: 64, height: 64,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  worker.on('closed', () => { worker = null; workerReady = null; });
  const w = worker;
  workerReady = w.loadURL('data:text/html;charset=utf-8,<!doctype html><meta charset="utf-8"><canvas id="c"></canvas>').then(() => w);
  return workerReady;
}

// The helper window is dropped after 20 s without work. Called when a task starts (cancel) and when it ends (start counting).
let busyTasks = 0;
function armIdleTimer() {
  clearTimeout(idleTimer);
  idleTimer = busyTasks === 0 ? setTimeout(disposeWorker, 20000) : null;
}

async function thumbnailWithWorker(file) {
  const buf = await fsp.readFile(file);
  busyTasks += 1;
  armIdleTimer();
  let timer = null;
  try {
    return await runThumbnailTask(buf, (t) => { timer = t; });
  } finally {
    clearTimeout(timer); // a finished task must not leave a timer that later destroys the window under another task
    busyTasks -= 1;
    armIdleTimer();
  }
}

async function runThumbnailTask(buf, setTimer) {
  const win = await getWorker();
  const script = `(async () => {
    const res = await fetch('data:application/octet-stream;base64,' + ${JSON.stringify(buf.toString('base64'))});
    const bmp = await createImageBitmap(await res.blob());
    const w = Math.min(${THUMB_WIDTH}, bmp.width);
    const h = Math.max(1, Math.round(bmp.height * w / bmp.width));
    const c = document.getElementById('c'); c.width = w; c.height = h;
    const x = c.getContext('2d'); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.drawImage(bmp, 0, 0, w, h); bmp.close();
    const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/jpeg', ${THUMB_QUALITY / 100}));
    return await new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(blob); });
  })()`;
  const timeout = new Promise((_, reject) => { setTimer(setTimeout(() => { disposeWorker(); reject(new Error('timeout')); }, 30000)); });
  const dataUrl = await Promise.race([win.webContents.executeJavaScript(script), timeout]);
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(typeof dataUrl === 'string' ? dataUrl : '');
  if (!m) throw new Error('bad thumbnail');
  return Buffer.from(m[1], 'base64');
}

// The fallback (the worker could not do it): nativeImage on the main thread.
async function thumbnailWithNativeImage(file) {
  const buf = await fsp.readFile(file);
  const full = nativeImage.createFromBuffer(buf);
  if (full.isEmpty()) throw new Error('Failed прочитать изображение');
  const img = full.getSize().width > THUMB_WIDTH ? full.resize({ width: THUMB_WIDTH, quality: 'good' }) : full;
  return img.toJPEG(THUMB_QUALITY);
}

// JPEG bytes of the thumbnail. The page turns them into a blob URL (no base64 round trip).
async function getThumbnailBytes(instanceId, filename) {
  const file = resolveShot(instanceId, filename);
  const st = await fsp.stat(file);
  const cache = path.join(thumbDir(), `${thumbKey(instanceId, filename, st)}.jpg`);
  try { return await fsp.readFile(cache); } catch { /* not made yet */ }
  return withGenerationSlot(async () => {
    try { return await fsp.readFile(cache); } catch { /* still not there */ }
    let jpg;
    try { jpg = await thumbnailWithWorker(file); } catch { jpg = await thumbnailWithNativeImage(file); }
    const tmp = `${cache}.${process.pid}.${Date.now()}.tmp`;
    try { await fsp.writeFile(tmp, jpg); await fsp.rename(tmp, cache); } catch { try { await fsp.unlink(tmp); } catch { /* nothing */ } }
    return jpg;
  });
}

// Thumbnails of screenshots that are gone are removed (a fire-and-forget housekeeping step after listing).
async function pruneThumbs(items) {
  const dir = thumbDir();
  const keep = new Set(items.map((i) => `${thumbKey(i.instanceId, i.filename, { mtimeMs: i.mtime, size: i.size })}.jpg`));
  let removed = 0;
  const left = [];
  for (const name of await fsp.readdir(dir)) {
    const file = path.join(dir, name);
    // half-written leftovers of an interrupted run
    if (/\.tmp$/.test(name)) { try { if (Date.now() - (await fsp.stat(file)).mtimeMs > 3600e3) await fsp.unlink(file); } catch { /* gone */ } continue; }
    if (!/^[0-9a-f]{40}\.jpg$/.test(name)) continue;
    if (!keep.has(name)) {
      if (removed < 500) { try { await fsp.unlink(file); removed += 1; } catch { /* in use */ } }
      continue;
    }
    left.push(file);
  }
  // The cache is only a speed-up: past ~400 MB the oldest thumbnails go (they are made again when needed).
  if (left.length > 3000) {
    const info = (await Promise.all(left.map((f) => fsp.stat(f).then((s) => ({ f, size: s.size, at: s.mtimeMs })).catch(() => null)))).filter(Boolean);
    let total = info.reduce((n, i) => n + i.size, 0);
    if (total > 400 * 1048576) {
      info.sort((a, b) => a.at - b.at);
      for (const i of info) { if (total <= 300 * 1048576) break; try { await fsp.unlink(i.f); total -= i.size; } catch { /* in use */ } }
    }
  }
}

async function getFull(instanceId, filename) {
  const img = await loadImage(instanceId, filename);
  // Cap at a sane display size — full-res screenshots can be huge, and this
  // is for on-screen preview, not the saved file (Save uses the raw bytes).
  // A JPEG: a 1920 px PNG would take longer to encode and be several times bigger as text (screenshots have no transparency).
  const { width } = img.getSize();
  const preview = width > 1920 ? img.resize({ width: 1920 }) : img;
  return `data:image/jpeg;base64,${preview.toJPEG(90).toString('base64')}`;
}

async function saveAs(instanceId, filename, win) {
  const source = resolveShot(instanceId, filename);
  const result = await dialog.showSaveDialog(win, {
    title: 'Save скриншот',
    defaultPath: filename,
    filters: [{ name: 'Изображение', extensions: [path.extname(filename).slice(1) || 'png'] }],
  });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };
  await fsp.copyFile(source, result.filePath);
  return { ok: true };
}

// Several screenshots into one chosen folder. Two shots can share a file name
// (same timestamp in different instances) — the later one gets a numeric suffix.
async function saveMany(items, win) {
  const result = await dialog.showOpenDialog(win, {
    title: 'Куда сохранить скриншоты',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
  const folder = result.filePaths[0];
  let saved = 0;
  for (const { instanceId, filename } of items) {
    const source = resolveShot(instanceId, filename);
    const ext = path.extname(filename);
    const base = path.basename(filename, ext);
    let target = path.join(folder, filename);
    for (let n = 2; fs.existsSync(target); n++) target = path.join(folder, `${base} (${n})${ext}`);
    // eslint-disable-next-line no-await-in-loop
    await fsp.copyFile(source, target);
    saved += 1;
  }
  return { ok: true, count: saved, folder };
}

// В новых Electron у clipboard нет writeImage: картинку кладут как ClipboardItem с PNG.
async function writeImageToClipboard(img) {
  await clipboard.write([new ClipboardItem({ 'image/png': new Blob([img.toPNG()], { type: 'image/png' }) })]);
}

async function copyToClipboard(instanceId, filename) {
  const img = await loadImage(instanceId, filename);
  await writeImageToClipboard(img);
}

async function deleteShot(instanceId, filename) {
  await fsp.unlink(resolveShot(instanceId, filename));
}

// The untouched file as a data URL — the editor works on the real pixels,
// not the 1920px preview.
async function getOriginal(instanceId, filename) {
  const buf = await fsp.readFile(resolveShot(instanceId, filename));
  const mime = path.extname(filename).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

// Stores an edited PNG next to the original: as a new "<name>_edit.png"
// (mode "copy"), or over the original (mode "replace" — a JPEG original is
// swapped for a PNG of the same name, since the bytes are PNG).
async function saveEdited(instanceId, filename, bytes, mode) {
  const source = resolveShot(instanceId, filename);
  const dir = path.dirname(source);
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  const buf = Buffer.from(bytes);
  if (buf.length < 8) throw new Error('Пустое изображение');

  if (mode === 'replace') {
    const target = ext.toLowerCase() === '.png' ? source : path.join(dir, `${base}.png`);
    await fsp.writeFile(target, buf);
    if (target !== source) await fsp.unlink(source);
    return path.basename(target);
  }
  let n = 1;
  let name = `${base}_edit.png`;
  while (fs.existsSync(path.join(dir, name))) { n += 1; name = `${base}_edit${n}.png`; }
  await fsp.writeFile(path.join(dir, name), buf);
  return name;
}

async function copyBytesToClipboard(bytes) {
  const img = nativeImage.createFromBuffer(Buffer.from(bytes));
  if (img.isEmpty()) throw new Error('Failed прочитать изображение');
  await writeImageToClipboard(img);
}

module.exports = {
  listAll, getThumbnailBytes, pruneThumbs, disposeWorker, getFull, getOriginal, saveAs, saveMany, saveEdited, copyToClipboard, copyBytesToClipboard, deleteShot,
};
