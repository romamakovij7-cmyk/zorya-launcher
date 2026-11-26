// Mods, shader packs and resource packs of a Horizon ("Rust") instance, as Horizon reads them from the game folder:
//   content mod   <game>/horizon-mods/<id>.hmod         on/off: horizon-mods.txt   line "mod.<id>:true"
//   native mod    <game>/horizon-native-mods/<id>.hnmod  the same line; runs only in a game built with it
//   shader pack   <game>/shaderpacks/<name>              chosen one: horizon-graphics.txt  "pickedShaderPack:<name>"
//   resource pack <game>/resourcepacks/<name>            chosen in the game's own menu
// Plus the Horizon mod registry (index.json), and installing any file dropped in (the type is detected).
// A port of the "Minecraft RUST" launcher's mods.rs.
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const paths = require('./paths');
const { downloadChecked } = require('./horizon');
const { safeFileName } = require('./safe');

const fsp = fs.promises;
const INDEX_URL = 'https://horizon-rust.github.io/horizon-mods/index.json';
const MAX_FILE = 64 * 1024 * 1024;
const FOLDERS = {
  mod: 'horizon-mods', native: 'horizon-native-mods', shader: 'shaderpacks', resourcepack: 'resourcepacks',
};
const KIND_LABELS = {
  mod: 'Mod', native: 'Нативный мод', shader: 'Шейдер', resourcepack: 'Resource pack',
};

// ---------- the game folder's switches ----------

const modsTxt = (game) => path.join(game, 'horizon-mods.txt');
const graphicsTxt = (game) => path.join(game, 'horizon-graphics.txt');

function readLines(file) {
  try { return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((l, i, a) => !(i === a.length - 1 && l === '')); } catch { return []; }
}

function writeLines(file, lines) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
}

// A mod id is a file name and a line key ("mod.<id>:true"): lower-case letters, digits and _ only,
// so a manifest can't smuggle a new line or a path into either.
const validId = (id) => typeof id === 'string' && /^[a-z0-9_]+$/.test(id) && id.length <= 64;

function modEnabled(game, id) {
  const key = `mod.${id}:`;
  const line = [...readLines(modsTxt(game))].reverse().find((l) => l.startsWith(key));
  return line ? line.slice(key.length).trim() === 'true' : false;
}

function setModEnabled(game, id, on) {
  if (!validId(id)) throw new Error('Недопустимый id мода');
  const key = `mod.${id}:`;
  const lines = readLines(modsTxt(game)).filter((l) => !l.startsWith(key));
  lines.push(`${key}${on ? 'true' : 'false'}`);
  writeLines(modsTxt(game), lines);
}

function pickedShader(game) {
  const line = readLines(graphicsTxt(game)).find((l) => l.startsWith('pickedShaderPack:'));
  const v = line ? line.slice('pickedShaderPack:'.length).trim() : '';
  return v || null;
}

function setShader(game, name) {
  const lines = readLines(graphicsTxt(game)).filter((l) => !l.startsWith('pickedShaderPack:'));
  lines.push(`pickedShaderPack:${name || ''}`);
  writeLines(graphicsTxt(game), lines);
}

// ---------- manifests ----------

// The two forms of horizon-mod.toml: "[mod]\nid = ..." or the same keys at the top level. Strings only, which is all it needs.
function parseToml(text) {
  const root = {};
  let section = root;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const sec = /^\[([A-Za-z0-9_.-]+)\]$/.exec(line);
    if (sec) { section = root[sec[1]] = root[sec[1]] && typeof root[sec[1]] === 'object' ? root[sec[1]] : {}; continue; }
    const kv = /^([A-Za-z0-9_-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)')\s*(?:#.*)?$/.exec(line);
    if (!kv) continue;
    if (kv[2] !== undefined) {
      let v;
      try { v = JSON.parse(`"${kv[2]}"`); } catch { v = kv[2]; }
      section[kv[1]] = v;
    } else section[kv[1]] = kv[3];
  }
  return root;
}

function contentManifest(text) {
  let v;
  try { v = parseToml(text); } catch { return null; }
  const table = v.mod && typeof v.mod === 'object' ? v.mod : v;
  if (!validId(table.id)) return null;
  return { id: table.id, name: typeof table.name === 'string' && table.name ? table.name : table.id, version: typeof table.version === 'string' ? table.version : '' };
}

function nativeManifest(text) {
  let v;
  try { v = JSON.parse(text); } catch { return null; }
  if (!v || !validId(v.id)) return null;
  return { id: v.id, version: typeof v.version === 'string' ? v.version : '' };
}

function zipEntries(file) {
  try { return new AdmZip(file).getEntries(); } catch { return null; }
}

function zipText(file, entry) {
  const entries = zipEntries(file);
  const e = entries && entries.find((x) => x.entryName === entry);
  if (!e || e.header.size > 1024 * 1024) return null;
  try { return e.getData().toString('utf8'); } catch { return null; }
}

function zipHasPrefix(file, prefix) {
  const entries = zipEntries(file);
  return !!entries && entries.some((e) => {
    const n = e.entryName;
    return n.startsWith(prefix) || (n.includes('/') && n.slice(n.indexOf('/') + 1).startsWith(prefix));
  });
}

// ---------- reading what is installed ----------

function listDir(dir) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names.filter((n) => !n.startsWith('.') && !n.endsWith('.txt') && !n.endsWith('.part')).sort();
}

// -> [{ kind, id, name, version, file, enabled }]; `file` is the name inside the kind's folder
function list(game) {
  const out = [];
  for (const file of listDir(path.join(game, FOLDERS.mod))) {
    const full = path.join(game, FOLDERS.mod, file);
    let text = null;
    try { text = fs.statSync(full).isDirectory() ? fs.readFileSync(path.join(full, 'horizon-mod.toml'), 'utf8') : zipText(full, 'horizon-mod.toml'); } catch { /* unreadable */ }
    const m = text && contentManifest(text);
    if (m) out.push({ kind: 'mod', ...m, file, enabled: modEnabled(game, m.id) });
  }
  for (const file of listDir(path.join(game, FOLDERS.native))) {
    if (!file.endsWith('.hnmod')) continue;
    const text = zipText(path.join(game, FOLDERS.native, file), 'horizon-native.json');
    const m = text && nativeManifest(text);
    if (m) out.push({ kind: 'native', id: m.id, name: m.id, version: m.version, file, enabled: modEnabled(game, m.id) });
  }
  const picked = pickedShader(game);
  for (const file of listDir(path.join(game, FOLDERS.shader))) {
    out.push({ kind: 'shader', id: file, name: file, version: '', file, enabled: picked === file });
  }
  for (const file of listDir(path.join(game, FOLDERS.resourcepack))) {
    out.push({ kind: 'resourcepack', id: file, name: file, version: '', file, enabled: true });
  }
  return out;
}

// An item named by the UI, found among what is really installed — never a path from the UI.
function find(game, kind, file) {
  const item = list(game).find((i) => i.kind === kind && i.file === file);
  if (!item) throw new Error('Этого файла уже нет в сборке');
  safeFileName(item.file);
  return { item, full: path.join(game, FOLDERS[kind], item.file) };
}

function setEnabled(game, kind, file, on) {
  const { item } = find(game, kind, file);
  if (kind === 'mod' || kind === 'native') setModEnabled(game, item.id, on);
  else if (kind === 'shader') setShader(game, on ? item.file : null);
  else throw new Error('Ресурспаки включаются в самой игре (меню паков)');
}

function remove(game, kind, file) {
  const { item, full } = find(game, kind, file);
  fs.rmSync(full, { recursive: true, force: true });
  if (kind === 'mod' || kind === 'native') {
    const key = `mod.${item.id}:`;
    writeLines(modsTxt(game), readLines(modsTxt(game)).filter((l) => !l.startsWith(key)));
  } else if (kind === 'shader' && item.enabled) setShader(game, null);
}

// ---------- installing a file ----------

function detect(file) {
  const name = path.basename(file).toLowerCase();
  if (name.endsWith('.hnmod')) return 'native';
  if (name.endsWith('.hmod')) return 'mod';
  if (name.endsWith('.hshader')) return 'shader';
  if (name.endsWith('.jar')) throw new Error(`${name}: это Java-мод (Fabric/Forge). Horizon написан на Rust и Java-mods не запускает.`);
  if (name.endsWith('.zip')) {
    if (zipText(file, 'horizon-native.json') !== null) return 'native';
    if (zipText(file, 'horizon-mod.toml') !== null) return 'mod';
    if (zipHasPrefix(file, 'shaders/') || zipText(file, 'horizon-shaders.toml') !== null) return 'shader';
    if (zipHasPrefix(file, 'pack.mcmeta')) return 'resourcepack';
  }
  throw new Error(`${name}: не похоже ни на мод Horizon, ни на шейдер, ни на ресурспак`);
}

// Copies a file into the right folder and turns it on. Returns a line to show.
function installFile(game, src) {
  const kind = detect(src);
  const size = fs.statSync(src).size;
  if (size > MAX_FILE * 8) throw new Error(`${path.basename(src)}: слишком большой файл`);
  let name = safeFileName(path.basename(src));
  let id = null;
  if (kind === 'mod') id = (contentManifest(zipText(src, 'horizon-mod.toml') || '') || {}).id || null;
  if (kind === 'native') id = (nativeManifest(zipText(src, 'horizon-native.json') || '') || {}).id || null;
  if ((kind === 'mod' || kind === 'native') && !id) throw new Error(`${name}: в манифесте мода нет допустимого id (a–z, 0–9, _)`);
  // A mod's file is named after its id, as Horizon Launcher names it.
  if (id) name = `${id}.${kind === 'native' ? 'hnmod' : 'hmod'}`;
  const dir = path.join(game, FOLDERS[kind]);
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, name);
  if (path.resolve(dest) !== path.resolve(src)) fs.copyFileSync(src, dest);
  if (id) setModEnabled(game, id, true);
  else if (kind === 'shader') setShader(game, name);
  const note = kind === 'native' ? ' — нативному моду нужна сборка игры с ним (Horizon Launcher: Mods, Build)' : '';
  return `Установлено: ${name} (${KIND_LABELS[kind]})${note}`;
}

// ---------- the registry ----------

let indexCache = null;

async function fetchIndex(force = false) {
  if (indexCache && !force && Date.now() - indexCache.at < 10 * 60 * 1000) return indexCache.index;
  const res = await fetch(INDEX_URL, { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'ZoryaLauncher' } });
  if (!res.ok) throw new Error(`Mod catalog Horizon ответил ${res.status}`);
  const index = await res.json();
  if (!index || index.schema > 1) throw new Error(`Mod catalog новее, чем понимает лаунчер (schema ${index && index.schema})`);
  indexCache = { at: Date.now(), index };
  return index;
}

const INSTALLABLE = ['mod', 'native-mod', 'shader', 'shaderpack', 'resourcepack'];
const KIND_OF = {
  mod: 'mod', 'native-mod': 'native', shader: 'shader', shaderpack: 'shader', resourcepack: 'resourcepack',
};

// The registry's pictures live on its own site; anything else in an index is ignored, not loaded.
// The registry adds a cache-busting "?v=<hex>" to its icon addresses (since November 2026): that one query is allowed, nothing else.
const iconUrl = (u) => (typeof u === 'string' && /^https:\/\/horizon-rust\.github\.io\/horizon-mods\/icons\/[A-Za-z0-9_.-]+(\?v=[A-Za-z0-9]{1,40})?$/.test(u) ? u : null);

// What the UI shows: only what this launcher can install, and only plain fields.
function catalog(index, gameVersion) {
  return (index.projects || []).filter((p) => INSTALLABLE.includes(p.kind) && Array.isArray(p.versions) && p.versions.length).map((p) => {
    const v = p.versions.find((x) => !x.game || x.game === gameVersion) || null;
    return {
      id: String(p.id),
      kind: KIND_OF[p.kind],
      name: String(p.name || p.id),
      summary: String(p.summary || '').slice(0, 300),
      icon: iconUrl(p.icon),
      authors: (p.authors || []).map(String).slice(0, 5),
      downloads: Number.isFinite(p.downloads) ? p.downloads : null,
      version: v ? String(v.version) : null,
      compatible: !!v,
    };
  });
}

// The registry accepts files only from GitHub releases (docs/api/mod-index.md).
function urlAllowed(url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'https:' || u.hostname !== 'github.com') return false;
  const parts = u.pathname.split('/').filter(Boolean);
  return parts.length >= 5 && parts[2] === 'releases' && parts[3] === 'download';
}

async function installProject(game, projectId, gameVersion) {
  const index = await fetchIndex();
  const project = (index.projects || []).find((p) => String(p.id) === String(projectId));
  if (!project || !INSTALLABLE.includes(project.kind)) throw new Error('Такого проекта нет в каталоге');
  const version = (project.versions || []).find((v) => !v.game || v.game === gameVersion);
  if (!version) throw new Error(`${project.name}: нет версии для Minecraft ${gameVersion}`);
  const file = version.file || {};
  const revoked = (index.revoked || []).find((r) => String(r.id) === String(project.id)
    && (!r.sha256 || String(r.sha256).toLowerCase() === String(file.sha256).toLowerCase()));
  if (revoked) throw new Error(`${project.name} отозван из каталога: ${revoked.reason || 'без причины'}`);
  if (!urlAllowed(file.url)) throw new Error(`${project.name}: файл не с GitHub-релиза, не устанавливаю`);
  if (!Number.isFinite(file.size) || file.size > MAX_FILE) throw new Error(`${project.name}: файл больше 64 МБ`);
  if (!/^[0-9a-fA-F]{64}$/.test(String(file.sha256))) throw new Error(`${project.name}: в каталоге нет контрольной суммы`);
  const safe = String(file.name || 'mod').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 100);
  const tmpDir = paths.ensureDir(path.join(paths.horizonRoot(), 'downloads'));
  const tmp = path.join(tmpDir, safe);
  try {
    await downloadChecked(file.url, tmp, file.sha256);
    return `${installFile(game, tmp)} · ${project.name} ${version.version}`;
  } finally {
    await fsp.rm(tmp, { force: true });
  }
}

module.exports = {
  list, setEnabled, remove, installFile, fetchIndex, catalog, installProject, parseToml, contentManifest, nativeManifest, urlAllowed, detect,
  FOLDERS,
};
