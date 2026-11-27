// Detects instances already set up in other launchers (Prism Launcher /
// MultiMC, and ATLauncher) and copies one into Zorya Launcher as a new,
// independent instance — the source launcher's own files are left untouched
// (copied, never moved).
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const paths = require('./paths');
const { readTable } = require('./sqliteLite');
const { discardPartialInstall } = require('./installControl');
const store = require('../store');
const { assertVersionString } = require('./safe');

const fsp = fs.promises;

const LOADER_COMPONENTS = {
  'net.fabricmc.fabric-loader': 'fabric',
  'org.quiltmc.quilt-loader': 'quilt',
  'net.minecraftforge': 'forge',
  'net.neoforged': 'neoforge',
};

// Async on purpose: a Modrinth profile can be tens of GB, and walking one
// synchronously froze the whole app (and the picker) for a minute. The picker
// asks for sizes one by one, after the list itself has already appeared.
async function dirSize(dir) {
  let total = 0;
  let entries;
  try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) total += await dirSize(p);
    else { try { total += (await fs.promises.stat(p)).size; } catch { /* race, skip */ } }
  }
  return total;
}

function safeReadJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

// instance.cfg is a flat INI file (`key=value` per line, no nesting worth
// parsing here) — pull out just the display name.
function iniName(file) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    const m = /^name=(.*)$/m.exec(text);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

// Time played in the other launcher, in ms, for the statistics of the imported instance (0 when unknown or not a sane number).
// Prism / MultiMC: instance.cfg `totalTimePlayed=<seconds>`, `lastLaunchTime=<ms>`. Modrinth App: app.db `submitted_time_played` +
// `recent_time_played` (seconds; the second part is the time it has not reported yet) and `last_played` (seconds).
// ATLauncher and CurseForge keep no total time (only the last start), so nothing is imported from them.
const MAX_PLAYTIME_MS = 10 * 365 * 24 * 3600 * 1000;
const saneMs = (ms) => (Number.isFinite(ms) && ms > 0 && ms <= MAX_PLAYTIME_MS ? Math.round(ms) : 0);
// A moment in time (ms since 1970): after 2000 and not in the future (a wrong value would put "last played" years ahead in the lists)
const saneTs = (ms) => (Number.isFinite(ms) && ms > 946684800000 && ms <= Date.now() + 86400000 ? Math.round(ms) : 0);
function iniNumber(file, key) {
  try {
    const m = new RegExp(`^${key}=(\\d+)\\s*$`, 'm').exec(fs.readFileSync(file, 'utf8'));
    return m ? Number(m[1]) : 0;
  } catch {
    return 0;
  }
}

// Prism Launcher / MultiMC: `<root>/instances/<name>/mmc-pack.json` lists
// components (Minecraft + loader); the game folder is `.minecraft` or
// (older MultiMC) `minecraft`.
function prismRoots() {
  const appData = process.env.APPDATA;
  const candidates = [
    appData && path.join(appData, 'PrismLauncher'),
    appData && path.join(appData, 'PolyMC'),
    appData && path.join(appData, 'MultiMC'),
    'C:\\PrismLauncher', 'C:\\MultiMC',
  ].filter(Boolean);
  return candidates.filter((p) => fs.existsSync(path.join(p, 'instances')));
}

function listPrismInstances(root) {
  const instancesDir = path.join(root, 'instances');
  const out = [];
  for (const name of fs.readdirSync(instancesDir)) {
    if (name === '.tmp') continue;
    const dir = path.join(instancesDir, name);
    if (!fs.statSync(dir).isDirectory()) continue;
    const pack = safeReadJson(path.join(dir, 'mmc-pack.json'));
    if (!pack) continue;
    let mcVersion = null;
    let loader = 'vanilla';
    let loaderVersion = null;
    for (const c of pack.components || []) {
      if (c.uid === 'net.minecraft') mcVersion = c.version;
      else if (LOADER_COMPONENTS[c.uid]) { loader = LOADER_COMPONENTS[c.uid]; loaderVersion = c.version; }
    }
    if (!mcVersion) continue;
    const gameDir = ['.minecraft', 'minecraft'].map((n) => path.join(dir, n)).find((p) => fs.existsSync(p));
    if (!gameDir) continue;
    const displayName = iniName(path.join(dir, 'instance.cfg')) || name;
    const cfg = path.join(dir, 'instance.cfg');
    out.push({
      key: name, name: displayName, mcVersion, loader, loaderVersion, gameDir,
      playtimeMs: saneMs(iniNumber(cfg, 'totalTimePlayed') * 1000), lastPlayedMs: saneTs(iniNumber(cfg, 'lastLaunchTime')),
    });
  }
  return out;
}

// ATLauncher: `<root>/instances/<name>/instance.json`, mods/saves/etc. sit
// directly in the instance folder (no nested .minecraft).
function atlauncherRoots() {
  const appData = process.env.APPDATA;
  const candidates = [appData && path.join(appData, 'ATLauncher'), 'C:\\ATLauncher'].filter(Boolean);
  return candidates.filter((p) => fs.existsSync(path.join(p, 'instances')));
}

function listAtlauncherInstances(root) {
  const instancesDir = path.join(root, 'instances');
  const out = [];
  for (const name of fs.readdirSync(instancesDir)) {
    const dir = path.join(instancesDir, name);
    if (!fs.statSync(dir).isDirectory()) continue;
    const info = safeReadJson(path.join(dir, 'instance.json'));
    if (!info) continue;
    const mcVersion = info.id?.minecraftVersion || info.minecraftVersion || info.launcher?.minecraftVersion;
    if (!mcVersion) continue;
    const loaderType = (info.launcher?.loaderVersion?.type || info.loaderVersion?.type || '').toLowerCase();
    const loader = ['fabric', 'quilt', 'forge', 'neoforge'].includes(loaderType) ? loaderType : 'vanilla';
    const loaderVersion = info.launcher?.loaderVersion?.version || info.loaderVersion?.version || null;
    out.push({
      key: name, name: info.launcher?.name || info.name || name, mcVersion, loader, loaderVersion, gameDir: dir,
    });
  }
  return out;
}

function normalizeLoader(raw) {
  const l = String(raw || '').toLowerCase().replace(/[^a-z]/g, '');
  return ['fabric', 'quilt', 'forge', 'neoforge'].includes(l) ? l : 'vanilla';
}

function iconDataUrl(file) {
  try {
    if (!file || fs.statSync(file).size > 600 * 1024) return null;
    const ext = path.extname(file).slice(1).toLowerCase();
    const mime = ext === 'jpg' ? 'jpeg' : ext || 'png';
    return `data:image/${mime};base64,${fs.readFileSync(file).toString('base64')}`;
  } catch {
    return null;
  }
}

// Modrinth App: game folders are `<root>/profiles/<path>` (files sit directly
// in the folder), the name / Minecraft version / loader live in `app.db`.
// Newer app versions split that over `instances` + `instance_content_sets`;
// older ones had a single `profiles` table with everything in it.
function modrinthRoots() {
  const appData = process.env.APPDATA;
  const candidates = [appData && path.join(appData, 'ModrinthApp'), appData && path.join(appData, 'com.modrinth.theseus')].filter(Boolean);
  return candidates.filter((p) => fs.existsSync(path.join(p, 'app.db')) && fs.existsSync(path.join(p, 'profiles')));
}

function listModrinthInstances(root) {
  const dbFile = path.join(root, 'app.db');
  let rows = [];
  const instances = readTable(dbFile, 'instances');
  if (instances.length) {
    const sets = new Map(readTable(dbFile, 'instance_content_sets').map((s) => [s.id, s]));
    rows = instances.map((i) => {
      const set = sets.get(i.applied_content_set_id) || {};
      return {
        path: i.path, name: i.name, icon: i.icon_path, mcVersion: set.game_version, loader: set.loader, loaderVersion: set.loader_version,
        playSec: (Number(i.submitted_time_played) || 0) + (Number(i.recent_time_played) || 0), lastSec: Number(i.last_played) || 0,
      };
    });
  } else {
    rows = readTable(dbFile, 'profiles').map((p) => ({
      path: p.path, name: p.name, icon: p.icon_path, mcVersion: p.game_version, loader: p.mod_loader, loaderVersion: p.mod_loader_version,
      playSec: (Number(p.submitted_time_played) || 0) + (Number(p.recent_time_played) || 0), lastSec: Number(p.last_played) || 0,
    }));
  }
  const out = [];
  for (const r of rows) {
    if (!r.path || !r.mcVersion) continue;
    const gameDir = path.join(root, 'profiles', r.path);
    if (!fs.existsSync(gameDir)) continue;
    const loader = normalizeLoader(r.loader);
    out.push({
      key: r.path, name: r.name || r.path, mcVersion: r.mcVersion, loader, loaderVersion: loader === 'vanilla' ? null : r.loaderVersion || null,
      gameDir, icon: iconDataUrl(r.icon), playtimeMs: saneMs(r.playSec * 1000), lastPlayedMs: saneTs(r.lastSec * 1000),
    });
  }
  return out;
}

// CurseForge app: `<...>/curseforge/minecraft/Instances/<name>/` with a
// `minecraftinstance.json` describing it; game files sit directly inside.
function curseforgeRoots() {
  const home = process.env.USERPROFILE;
  const candidates = [
    home && path.join(home, 'curseforge', 'minecraft', 'Instances'),
    home && path.join(home, 'Documents', 'curseforge', 'minecraft', 'Instances'),
    'C:\\curseforge\\minecraft\\Instances',
  ].filter(Boolean);
  return candidates.filter((p) => fs.existsSync(p));
}

const CURSE_METADATA_FILES = new Set(['minecraftinstance.json', 'manifest.json', 'modlist.html', 'profile.json']);

function listCurseforgeInstances(root) {
  const out = [];
  for (const name of fs.readdirSync(root)) {
    const dir = path.join(root, name);
    if (!fs.statSync(dir).isDirectory()) continue;
    const info = safeReadJson(path.join(dir, 'minecraftinstance.json'));
    if (!info) continue;
    const mcVersion = info.gameVersion || info.baseModLoader?.minecraftVersion;
    if (!mcVersion) continue;
    const base = String(info.baseModLoader?.name || '').toLowerCase();
    const loader = ['neoforge', 'fabric', 'quilt', 'forge'].find((l) => base.startsWith(`${l}-`)) || 'vanilla';
    // "forge-47.2.0" / "neoforge-21.1.172" / "fabric-0.16.9-1.21.1" -> just the loader's own version.
    const loaderVersion = loader === 'vanilla' ? null : base.slice(loader.length + 1).replace(new RegExp(`-${mcVersion.replace(/\./g, '\\.')}$`), '') || null;
    out.push({
      key: name, name: info.name || name, mcVersion, loader, loaderVersion, gameDir: dir, skipTopLevel: CURSE_METADATA_FILES,
    });
  }
  return out;
}

// ---- other drives and folders the user points at ----
// The usual places above are all on the system drive. A launcher kept on another drive (D:\Games\PrismLauncher, E:\MultiMC…) is looked
// for under the common names on every drive, and a folder picked by hand ("Указать папку") is remembered in the settings store.
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const VALID_ROOT = {
  prism: (p) => isDir(path.join(p, 'instances')),
  atlauncher: (p) => isDir(path.join(p, 'instances')),
  modrinth: (p) => fs.existsSync(path.join(p, 'app.db')) && isDir(path.join(p, 'profiles')),
  curseforge: (p) => isDir(p),
};
const DRIVE_NAMES = {
  prism: ['PrismLauncher', 'Prism Launcher', 'MultiMC', 'PolyMC', 'Games\\PrismLauncher', 'Games\\MultiMC'],
  atlauncher: ['ATLauncher', 'Games\\ATLauncher'],
  modrinth: ['ModrinthApp', 'Games\\ModrinthApp'],
  curseforge: ['curseforge\\minecraft\\Instances', 'CurseForge\\Minecraft\\Instances', 'Games\\curseforge\\minecraft\\Instances'],
};
let drivesCache = null; // asked a few times in a row (list, sizes, import): a disconnected network drive can be slow to answer
function drives() {
  if (drivesCache && Date.now() - drivesCache.at < 30000) return drivesCache.list;
  const out = [];
  for (let c = 67; c <= 90; c += 1) { // C..Z
    const d = `${String.fromCharCode(c)}:\\`;
    try { if (fs.existsSync(d)) out.push(d); } catch { /* a drive that does not answer */ }
  }
  drivesCache = { at: Date.now(), list: out };
  return out;
}
const savedRoots = (id) => { const all = store.get('importerRoots'); return all && Array.isArray(all[id]) ? all[id].filter((p) => typeof p === 'string') : []; };
function extraRoots(id) {
  const found = [];
  for (const d of drives()) for (const n of DRIVE_NAMES[id]) found.push(path.join(d, n));
  return [...found, ...savedRoots(id)].filter((p) => { try { return VALID_ROOT[id](p); } catch { return false; } });
}
const withExtra = (id, base) => [...new Set([...base(), ...extraRoots(id)].map((p) => path.normalize(p)))];

const LAUNCHERS = {
  prism: { label: 'Prism Launcher / MultiMC', roots: () => withExtra('prism', prismRoots), list: listPrismInstances },
  atlauncher: { label: 'ATLauncher', roots: () => withExtra('atlauncher', atlauncherRoots), list: listAtlauncherInstances },
  modrinth: { label: 'Modrinth App', roots: () => withExtra('modrinth', modrinthRoots), list: listModrinthInstances },
  curseforge: { label: 'CurseForge', roots: () => withExtra('curseforge', curseforgeRoots), list: listCurseforgeInstances },
};

// A folder chosen by hand: which launcher's data folder is it (it may be the folder itself, its parent, or — for CurseForge — the
// Instances folder inside)? Remembered when it holds at least one instance we can read.
function addFolder(folder) {
  const base = path.normalize(String(folder || ''));
  if (!path.isAbsolute(base) || !isDir(base)) throw new Error('Folder не найдена');
  const tries = (id) => (id === 'curseforge'
    ? [base, path.join(base, 'Instances'), path.join(base, 'minecraft', 'Instances')]
    : [base, path.dirname(base)]);
  for (const id of Object.keys(LAUNCHERS)) {
    for (const cand of tries(id)) {
      let ok = false;
      try { ok = VALID_ROOT[id](cand) && LAUNCHERS[id].list(cand).length > 0; } catch { ok = false; }
      if (!ok) continue;
      const all = { ...(store.get('importerRoots') || {}) };
      const have = Array.isArray(all[id]) ? all[id] : [];
      if (!have.includes(cand)) all[id] = [...have, cand].slice(-20);
      store.set('importerRoots', all);
      return { launcherId: id, root: cand, label: LAUNCHERS[id].label };
    }
  }
  throw new Error('В этой папке не нашлось сборок Prism Launcher / MultiMC, ATLauncher, Modrinth App или CurseForge. Выберите папку с данными лаунчера (где лежит instances, profiles или Instances).');
}

// Every launcher we know how to read, installed or not — the picker shows the
// missing ones greyed out instead of silently leaving them out.
const KNOWN = Object.entries(LAUNCHERS).map(([id, def]) => ({ id, label: def.label }));

// { launcherId: { label, instances: [...] } } for every launcher that's
// actually installed and has at least one importable instance.
function detect() {
  const out = {};
  for (const [id, def] of Object.entries(LAUNCHERS)) {
    const found = [];
    for (const root of def.roots()) {
      try { found.push(...def.list(root).map((i) => ({ ...i, root }))); } catch { /* unreadable — skip this root */ }
    }
    if (found.length) out[id] = { label: def.label, instances: found };
  }
  return out;
}

function findEntry(launcherId, root, key) {
  const def = LAUNCHERS[launcherId];
  if (!def) throw new Error('Неизвестный лаунчер');
  // `root` arrives from the UI: only the folders we detected ourselves are allowed.
  if (!def.roots().includes(root)) throw new Error('Неизвестная папка лаунчера');
  const entry = def.list(root).find((i) => i.key === key);
  if (!entry) throw new Error('Instance не найдена — возможно, её уже переименовали или удалили');
  return entry;
}

// Copies one detected instance into Zorya Launcher. control is an
// InstallControl (pause/cancel — see installControl.js); pausing between
// files is best-effort (checked every file, not mid-copy of a single one).
async function importInstance({
  launcherId, root, key, onProgress, mode,
}, control) {
  const entry = findEntry(launcherId, root, key);
  assertVersionString(String(entry.mcVersion), 'Minecraft version в сборке');
  if (entry.loaderVersion) assertVersionString(String(entry.loaderVersion), 'loader version в сборке');
  const id = randomUUID();
  // "Use in place": nothing is copied; the instance simply points at the other launcher's folder (see paths.instanceGameDir). Changes made
  // in either launcher are seen by the other, and deleting the instance here never touches that folder.
  if (mode === 'link') {
    if (!isDir(entry.gameDir)) throw new Error('Folder сборки недоступна: возможно, диск не подключён');
    const already = (store.get('instances') || []).find((i) => i.externalGameDir && path.normalize(i.externalGameDir) === path.normalize(entry.gameDir));
    if (already) throw new Error(`Эта папка уже подключена как сборка «${already.name}»`);
    return {
      id,
      name: entry.name,
      mcVersion: entry.mcVersion,
      loader: entry.loader,
      loaderVersion: entry.loaderVersion,
      icon: entry.icon || null,
      source: `import-${launcherId}-linked`,
      externalGameDir: path.normalize(entry.gameDir),
      createdAt: Date.now(),
      lastPlayed: entry.lastPlayedMs || null,
      totalPlaytimeMs: entry.playtimeMs || 0, // the time played in the other launcher goes into the statistics (see Stats: "Total playtime")
    };
  }
  if (control) control.instanceId = id;
  const gameDir = paths.instanceGameDir(id);
  const report = (stage, extra) => onProgress?.({ stage, ...extra });

  // Everything below is async (fs.promises) and a few files at a time. The
  // previous synchronous walk + copyFileSync loop ran for the whole copy on the
  // main process, so the launcher window stopped responding until it was done.
  try {
    report('scan', { completed: 0 });
    const files = [];
    let scanned = 0;
    const walk = async (rel) => {
      if (control) await control.gate();
      for (const e of await fsp.readdir(path.join(entry.gameDir, rel), { withFileTypes: true })) {
        if (rel === '.' && entry.skipTopLevel?.has(e.name)) continue;
        const r = rel === '.' ? e.name : path.join(rel, e.name);
        if (e.isDirectory()) await walk(r);
        else if (e.isFile()) { files.push({ rel: r, size: 0 }); scanned += 1; }
      }
      report('scan', { completed: scanned });
    };
    await walk('.');

    for (let i = 0; i < files.length; i += 64) {
      if (control) await control.gate();
      // eslint-disable-next-line no-await-in-loop
      await Promise.all(files.slice(i, i + 64).map(async (f) => {
        try { f.size = (await fsp.stat(path.join(entry.gameDir, f.rel))).size; } catch { f.size = 0; }
      }));
    }
    const totalBytes = files.reduce((s, f) => s + f.size, 0);

    // Progress is by bytes, so one huge file doesn't look like a stall.
    let copiedBytes = 0;
    let next = 0;
    let lastReport = 0;
    report('copy-files', { completed: 0, total: totalBytes });
    const worker = async () => {
      for (;;) {
        if (control) await control.gate();
        const f = files[next];
        next += 1;
        if (!f) return;
        const to = path.join(gameDir, f.rel);
        await fsp.mkdir(path.dirname(to), { recursive: true });
        try {
          await fsp.copyFile(path.join(entry.gameDir, f.rel), to);
        } catch (err) {
          if (err.code !== 'ENOENT') throw err; // vanished while copying (a cache file, say) — skip it
        }
        copiedBytes += f.size;
        const now = Date.now();
        if (now - lastReport > 150 || copiedBytes >= totalBytes) {
          lastReport = now;
          report('copy-files', { completed: copiedBytes, total: totalBytes });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, Math.max(1, files.length)) }, worker));
  } catch (err) {
    // Cancelled or failed half-way: don't leave a half-copied instance folder behind.
    await discardPartialInstall(id);
    throw err;
  }

  return {
    id,
    name: entry.name,
    mcVersion: entry.mcVersion,
    loader: entry.loader,
    loaderVersion: entry.loaderVersion,
    icon: entry.icon || null,
    source: `import-${launcherId}`,
    createdAt: Date.now(),
    lastPlayed: entry.lastPlayedMs || null,
    totalPlaytimeMs: entry.playtimeMs || 0,
  };
}

function sizeOf({ launcherId, root, key }) {
  return dirSize(findEntry(launcherId, root, key).gameDir);
}

module.exports = { detect, importInstance, sizeOf, addFolder, KNOWN };
