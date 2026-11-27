const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { dialog } = require('electron');
const AdmZip = require('adm-zip');
const paths = require('./paths');
const { downloadFile } = require('./download');
const { safeFileName } = require('./safe');

const KIND_DIRS = { mod: 'mods', shader: 'shaderpacks', resourcepack: 'resourcepacks' };
const KIND_EXT = { mod: '.jar', shader: '.zip', resourcepack: '.zip' };

function cachePath(instanceId) {
  return path.join(paths.instanceDir(instanceId), 'content-cache.json');
}

function loadCache(instanceId) {
  try {
    return JSON.parse(fs.readFileSync(cachePath(instanceId), 'utf8'));
  } catch {
    return {};
  }
}

function saveCache(instanceId, cache) {
  fs.writeFileSync(cachePath(instanceId), JSON.stringify(cache));
}

// Lets an installer (Modrinth/CurseForge) tag a file with its real platform
// provenance right away, instead of leaving it to scanKind()'s hash-guess —
// which only ever checks Modrinth's hash API, so a file installed from
// CurseForge that *also* happens to be byte-identical to a Modrinth upload
// (common when an author dual-publishes the same build) would otherwise get
// mislabeled "MR", and a CurseForge-only file would show no badge at all.
function recordResolved(instanceId, filename, resolved) {
  const cache = loadCache(instanceId);
  cache[filename] = { ...(cache[filename] || {}), resolved };
  saveCache(instanceId, cache);
}

function sha1File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha1');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (c) => hash.update(c));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

function baseName(filename) {
  return filename.endsWith('.disabled') ? filename.slice(0, -'.disabled'.length) : filename;
}

async function scanKind(instanceId, kind) {
  const dir = path.join(paths.instanceGameDir(instanceId), KIND_DIRS[kind]);
  fs.mkdirSync(dir, { recursive: true });
  const ext = KIND_EXT[kind];
  const entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => {
    if (!e.isFile()) return false;
    const b = baseName(e.name);
    if (b === 'ZoryaLauncher-hearts.zip' || b === 'ZoryaLauncher-skin.zip') return false; // the launcher's own packs (hearts / offline skin)
    return b.toLowerCase().endsWith(ext);
  });

  const cache = loadCache(instanceId);
  const items = [];
  const toResolve = [];

  for (const entry of entries) {
    const filePath = path.join(dir, entry.name);
    const stat = fs.statSync(filePath);
    const fingerprint = `${stat.size}:${stat.mtimeMs}`;
    const cached = cache[entry.name];
    let sha1 = cached && cached.fingerprint === fingerprint ? cached.sha1 : null;
    if (!sha1) {
      sha1 = await sha1File(filePath);
      cache[entry.name] = { ...(cache[entry.name] || {}), fingerprint, sha1 };
    }
    const item = {
      filename: entry.name,
      displayName: baseName(entry.name),
      kind,
      enabled: !entry.name.endsWith('.disabled'),
      size: stat.size,
      sha1,
      resolved: cache[entry.name].resolved || null,
    };
    items.push(item);
    // Re-resolve unresolved items, and also items resolved by an older
    // version of this cache that predates author lookups — but never a
    // CurseForge-tagged item (this lookup only ever checks Modrinth's hash
    // API, so re-running it on a CF file would risk mislabeling it "MR"
    // again if the same build also happens to be published on Modrinth).
    const needsAuthorBackfill = item.resolved && item.resolved.platform === 'modrinth' && item.resolved.author === undefined;
    if (!item.resolved || needsAuthorBackfill) toResolve.push({ item, sha1 });
  }

  if (toResolve.length) {
    try {
      const resolvedMap = await lookupModrinthHashes(toResolve.map((t) => t.sha1));
      for (const t of toResolve) {
        const info = resolvedMap[t.sha1];
        if (info) {
          t.item.resolved = info;
          cache[t.item.filename] = { ...cache[t.item.filename], resolved: info };
        }
      }
    } catch {
      /* offline or API error — leave unresolved, UI falls back to filename */
    }
  }

  saveCache(instanceId, cache);
  return items;
}

async function lookupModrinthHashes(hashes) {
  if (!hashes.length) return {};
  const res = await fetch('https://api.modrinth.com/v2/version_files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hashes, algorithm: 'sha1' }),
  });
  if (!res.ok) return {};
  const data = await res.json(); // { [hash]: versionObject }
  const projectIds = [...new Set(Object.values(data).map((v) => v.project_id))];
  const projects = await lookupModrinthProjects(projectIds);
  const teamIds = [...new Set(Object.values(projects).map((p) => p.team).filter(Boolean))];
  const authors = await lookupModrinthTeamAuthors(teamIds);

  const out = {};
  for (const [hash, version] of Object.entries(data)) {
    const project = projects[version.project_id];
    out[hash] = {
      platform: 'modrinth',
      projectId: version.project_id,
      versionId: version.id,
      versionNumber: version.version_number,
      title: project ? project.title : version.name,
      icon: project ? project.icon_url : null,
      author: project ? authors[project.team] || null : null,
      gameVersions: version.game_versions,
      loaders: version.loaders,
    };
  }
  return out;
}

async function lookupModrinthProjects(ids) {
  if (!ids.length) return {};
  const res = await fetch(`https://api.modrinth.com/v2/projects?ids=${encodeURIComponent(JSON.stringify(ids))}`);
  if (!res.ok) return {};
  const list = await res.json();
  const map = {};
  for (const p of list) map[p.id] = p;
  return map;
}

// Modrinth's project object only carries a team id, not an author's
// username — resolve it via the bulk teams endpoint (one request for every
// project at once) and take the owner (falling back to the first member).
async function lookupModrinthTeamAuthors(teamIds) {
  if (!teamIds.length) return {};
  const res = await fetch(`https://api.modrinth.com/v2/teams?ids=${encodeURIComponent(JSON.stringify(teamIds))}`);
  if (!res.ok) return {};
  const list = await res.json(); // array of arrays of team members
  const map = {};
  for (const members of list) {
    for (const m of members || []) {
      if (!m.team_id) continue;
      if (m.role && m.role.toLowerCase() === 'owner') map[m.team_id] = m.user?.username;
      else if (!map[m.team_id]) map[m.team_id] = m.user?.username;
    }
  }
  return map;
}

// One kind after another: each scan loads and rewrites the same content-cache.json,
// so scanning them in parallel made the last writer drop the others' new entries.
async function listContent(instanceId) {
  const mods = await scanKind(instanceId, 'mod');
  const shaders = await scanKind(instanceId, 'shader');
  const resourcepacks = await scanKind(instanceId, 'resourcepack');
  return [...mods, ...shaders, ...resourcepacks];
}

function kindDir(instanceId, kind) {
  if (!KIND_DIRS[kind]) throw new Error('Неизвестный тип контента');
  return path.join(paths.instanceGameDir(instanceId), KIND_DIRS[kind]);
}

async function toggleContent(instanceId, filename, kind) {
  const dir = kindDir(instanceId, kind);
  const from = path.join(dir, safeFileName(filename));
  const enabled = filename.endsWith('.disabled');
  const to = enabled ? path.join(dir, baseName(filename)) : path.join(dir, `${filename}.disabled`);
  fs.renameSync(from, to);

  const cache = loadCache(instanceId);
  if (cache[filename]) {
    cache[path.basename(to)] = cache[filename];
    if (path.basename(to) !== filename) delete cache[filename];
    saveCache(instanceId, cache);
  }
  return path.basename(to);
}

function deleteContent(instanceId, filename, kind) {
  const dir = kindDir(instanceId, kind);
  fs.rmSync(path.join(dir, safeFileName(filename)), { force: true });
  const cache = loadCache(instanceId);
  delete cache[filename];
  saveCache(instanceId, cache);
}

const KIND_DIALOG_TITLE = { mod: 'Выбрать mods', shader: 'Выбрать шейдерпаки', resourcepack: 'Выбрать текстурпаки' };
const KIND_DIALOG_FILTER = { mod: 'Mod files', shader: 'Shader packs', resourcepack: 'Resource packs' };

async function addContentFiles(instanceId, kind, win) {
  const ext = KIND_EXT[kind].replace('.', '');
  const result = await dialog.showOpenDialog(win, {
    title: KIND_DIALOG_TITLE[kind] || 'Выбрать files',
    filters: [{ name: KIND_DIALOG_FILTER[kind] || 'Files', extensions: [ext] }],
    properties: ['openFile', 'multiSelections'],
  });
  if (result.canceled) return [];
  const dir = path.join(paths.instanceGameDir(instanceId), KIND_DIRS[kind]);
  fs.mkdirSync(dir, { recursive: true });
  const added = [];
  for (const src of result.filePaths) {
    const dest = path.join(dir, path.basename(src));
    fs.copyFileSync(src, dest);
    added.push(path.basename(dest));
  }
  return added;
}

// Guesses whether a dropped file is a mod, shader pack, or resource pack.
// .jar is unambiguous (mod). .zip is ambiguous between shader/resource packs,
// so peek inside: Iris/OptiFine shader packs have a top-level "shaders/"
// folder; everything else with a pack.mcmeta is a resource pack.
function detectKindFromFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jar') return 'mod';
  if (ext !== '.zip') return null;
  try {
    const zip = new AdmZip(filePath);
    const names = zip.getEntries().map((e) => e.entryName);
    if (names.some((n) => n.startsWith('shaders/'))) return 'shader';
    return 'resourcepack';
  } catch {
    return 'resourcepack';
  }
}

// Copies already-on-disk files (e.g. dropped from the OS file explorer)
// into the right content folder. `kind` forces every file into that
// bucket (used when a specific tab is active); pass null to auto-detect
// each file individually (used from the "all" view / mixed drops).
function addContentFilePaths(instanceId, filePaths, kind) {
  const added = [];
  const skipped = [];
  for (const src of filePaths) {
    const resolvedKind = kind || detectKindFromFile(src);
    if (!resolvedKind || !KIND_DIRS[resolvedKind]) {
      skipped.push(path.basename(src));
      continue;
    }
    const dir = path.join(paths.instanceGameDir(instanceId), KIND_DIRS[resolvedKind]);
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, path.basename(src));
    fs.copyFileSync(src, dest);
    added.push({ filename: path.basename(dest), kind: resolvedKind });
  }
  return { added, skipped };
}

async function checkContentUpdate(instanceId, item, mcVersion, loader) {
  if (!item.resolved || item.resolved.platform !== 'modrinth') return null;
  const res = await fetch(`https://api.modrinth.com/v2/project/${item.resolved.projectId}/version`);
  if (!res.ok) return null;
  const versions = await res.json();
  const candidate = versions.find(
    (v) => v.game_versions.includes(mcVersion) && (item.kind === 'shader' || v.loaders.includes(loader))
  );
  if (!candidate || candidate.id === item.resolved.versionId) return null;
  return {
    versionId: candidate.id,
    versionNumber: candidate.version_number,
    file: candidate.files.find((f) => f.primary) || candidate.files[0],
  };
}

async function applyContentUpdate(instanceId, item, update) {
  // the update comes from the window: only Modrinth's CDN is a valid source
  let host = '';
  try { const u = new URL(String(update?.file?.url)); host = u.protocol === 'https:' ? u.hostname : ''; } catch { /* invalid */ }
  if (host !== 'cdn.modrinth.com') throw new Error('Недопустимый адрес файла: скачивание только с cdn.modrinth.com');
  const dir = kindDir(instanceId, item.kind);
  const oldPath = path.join(dir, safeFileName(item.filename));
  const newFilename = item.enabled ? safeFileName(update.file.filename) : `${safeFileName(update.file.filename)}.disabled`;
  const newPath = path.join(dir, newFilename);
  await downloadFile(update.file.url, newPath, {
    expectedSize: update.file.size,
    expectedSha1: update.file.hashes?.sha1,
  });
  if (oldPath !== newPath) fs.rmSync(oldPath, { force: true });

  const cache = loadCache(instanceId);
  delete cache[item.filename];
  cache[newFilename] = {
    sha1: update.file.hashes?.sha1,
    fingerprint: null,
    resolved: {
      ...item.resolved,
      versionId: update.versionId,
      versionNumber: update.versionNumber,
    },
  };
  saveCache(instanceId, cache);
  return newFilename;
}

module.exports = {
  listContent,
  toggleContent,
  deleteContent,
  addContentFiles,
  addContentFilePaths,
  detectKindFromFile,
  checkContentUpdate,
  applyContentUpdate,
  recordResolved,
  KIND_DIRS,
};
