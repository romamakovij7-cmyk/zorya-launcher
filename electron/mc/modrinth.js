const fs = require('fs');
const path = require('path');
const os = require('os');
const { randomUUID } = require('crypto');
const AdmZip = require('adm-zip');
const paths = require('./paths');
const { collectOverrideJobs, extractJobs } = require('./zipExtract');
const { downloadAll, downloadFile, fetchBuffer } = require('./download');
const { discardPartialInstall } = require('./installControl');
const { safeJoin, safeFileName, assertVersionString } = require('./safe');

const API = 'https://api.modrinth.com/v2';

// Hosts the .mrpack specification lets a pack download files from.
const PACK_HOSTS = new Set(['cdn.modrinth.com', 'github.com', 'raw.githubusercontent.com', 'gitlab.com']);
function isAllowedPackUrl(url) {
  try {
    const u = new URL(String(url));
    return u.protocol === 'https:' && PACK_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

async function getProject(idOrSlug) {
  const res = await fetch(`${API}/project/${encodeURIComponent(idOrSlug)}`);
  if (!res.ok) throw new Error(require('./netFetch').explainStatus('Failed получить проект Modrinth', res.status, 'api.modrinth.com'));
  return res.json();
}

async function getProjectVersions(idOrSlug) {
  const res = await fetch(`${API}/project/${encodeURIComponent(idOrSlug)}/version`);
  if (!res.ok) throw new Error(require('./netFetch').explainStatus('Failed получить версии мода на Modrinth', res.status, 'api.modrinth.com'));
  return res.json();
}

function loaderFromDependencies(deps) {
  if (deps['fabric-loader']) return { loader: 'fabric', loaderVersion: deps['fabric-loader'] };
  if (deps['quilt-loader']) return { loader: 'quilt', loaderVersion: deps['quilt-loader'] };
  if (deps.forge) return { loader: 'forge', loaderVersion: deps.forge };
  if (deps.neoforge) return { loader: 'neoforge', loaderVersion: deps.neoforge };
  return { loader: 'vanilla', loaderVersion: null };
}

// Shared by both the "install from Modrinth search" and "import a local
// .mrpack file" paths — extracts overrides and downloads every listed file
// into a freshly-made instance directory, returning the bits both callers
// need to build their own instance record around.
// `existingId`: when set, writes into an already-existing instance instead of
// creating a new one — this is also how updating an installed pack works
// (see updatePack below). Files the *previous* version of the pack put there
// but the new one no longer lists are removed once every new file has
// downloaded successfully (never before — so a paused/cancelled update never
// leaves the instance missing a file it still needs), tracked in a small
// pack-manifest.json next to the instance; anything the user added by hand
// isn't in that list and is left alone.
async function installFromMrpackZip(zip, onProgress, control, existingId) {
  const report = (stage, extra) => onProgress && onProgress({ stage, ...extra });
  const indexEntry = zip.getEntry('modrinth.index.json');
  if (!indexEntry) throw new Error('Некорректный .mrpack: нет modrinth.index.json');
  const index = JSON.parse(zip.readAsText(indexEntry));

  const { loader, loaderVersion } = loaderFromDependencies(index.dependencies || {});
  const mcVersion = (index.dependencies || {}).minecraft;
  if (!mcVersion) throw new Error('В сборке не указана Minecraft version');
  assertVersionString(mcVersion, 'Minecraft version в сборке');
  if (loaderVersion) assertVersionString(String(loaderVersion), 'loader version в сборке');

  const id = existingId || randomUUID();
  // Only a fresh install's half-written folder gets discarded on cancel —
  // never an existing instance that's merely being updated.
  if (control) control.instanceId = existingId ? null : id;
  const gameDir = paths.instanceGameDir(id);

  const files = (index.files || []).filter((f) => !f.env || f.env.client !== 'unsupported');
  // modrinth.index.json comes from whoever made the pack: `path` must stay inside
  // the game folder (otherwise a pack could drop a file into Startup, say), the
  // link must be one the .mrpack format allows, and a hash is required. Checked
  // up front, before anything is written.
  const tasks = files.map((f) => {
    let dest;
    try { dest = safeJoin(gameDir, f.path); } catch { throw new Error(`Instance содержит недопустимый путь: ${f.path}`); }
    const url = Array.isArray(f.downloads) ? f.downloads.find(isAllowedPackUrl) : null;
    if (!url) throw new Error(`Instance ссылается на недопустимый источник: ${f.path}`);
    const sha1 = f.hashes && f.hashes.sha1;
    if (!/^[0-9a-f]{40}$/i.test(String(sha1 || ''))) throw new Error(`В сборке нет контрольной суммы для ${f.path}`);
    return {
      url, dest, sha1, size: f.fileSize, label: f.path,
    };
  });

  report('extract-overrides');
  await extractJobs(collectOverrideJobs(zip, ['overrides/', 'client-overrides/'], gameDir), {
    control, onProgress: (p) => report('extract-overrides', p),
  });

  report('download-files', { total: files.length });
  await downloadAll(tasks, { concurrency: 8, onProgress: (p) => report('download-files', p), control });

  // Drop files the previous version of this pack put here that the new one no
  // longer lists — only once every new file is safely down, and only ones we
  // ourselves tracked (never something the user added by hand).
  const manifestPath = path.join(paths.instanceDir(id), 'pack-manifest.json');
  const newRelPaths = tasks.map((t) => path.relative(gameDir, t.dest));
  let oldRelPaths = [];
  try { oldRelPaths = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).files || []; } catch { /* first install, or unreadable — nothing to clean up */ }
  const keep = new Set(newRelPaths);
  for (const rel of oldRelPaths) {
    if (keep.has(rel)) continue;
    try { fs.rmSync(safeJoin(gameDir, rel), { force: true }); } catch { /* already gone, or not ours to touch */ }
  }
  fs.writeFileSync(manifestPath, JSON.stringify({ files: newRelPaths, updatedAt: Date.now() }));

  return {
    id, name: index.name, mcVersion, loader, loaderVersion,
  };
}

// Downloads a .mrpack, creates a new instance from it, and returns the
// instance record (caller is responsible for persisting it in the store).
async function installModpack({ project, version, onProgress, control }) {
  const report = (stage, extra) => onProgress && onProgress({ stage, ...extra });
  const packFile = version.files.find((f) => f.filename.endsWith('.mrpack')) || version.files[0];
  if (!packFile) throw new Error('This version has no downloadable file');

  report('download-pack');
  let tmpFile = null;
  let result;
  try {
    const buf = await fetchBuffer(packFile.url, { control, onProgress: (loaded, total) => report('download-pack', { completed: loaded, total }) });
    tmpFile = path.join(os.tmpdir(), `mrpack-${randomUUID()}.zip`);
    fs.writeFileSync(tmpFile, buf);

    const zip = new AdmZip(tmpFile);
    result = await installFromMrpackZip(zip, onProgress, control);
  } catch (err) {
    // Cancelled or failed (bad pack, no network…): don't leave a half-built folder behind.
    await discardPartialInstall(control?.instanceId);
    throw err;
  } finally {
    if (tmpFile) fs.rmSync(tmpFile, { force: true });
  }

  return {
    ...result,
    name: result.name || project.title,
    icon: project.icon_url || null,
    source: 'modrinth',
    projectId: project.id,
    versionId: version.id,
    createdAt: Date.now(),
    lastPlayed: null,
    totalPlaytimeMs: 0,
  };
}

// Is there a newer version of this modpack itself (not its individual mods)?
// Picks the newest release by publish date; returns null if that's already
// what's installed, or that can't be determined.
async function checkPackUpdate(projectId, currentVersionId) {
  const versions = await getProjectVersions(projectId);
  if (!versions.length) return null;
  const latest = [...versions].sort((a, b) => new Date(b.date_published) - new Date(a.date_published))[0];
  if (!latest || latest.id === currentVersionId) return null;
  return latest;
}

// Re-installs a modpack instance in place to a different (usually newer)
// version: same instance id, so its saves/screenshots/etc. are untouched —
// only the pack's own overrides and listed files change (see
// installFromMrpackZip's existingId path for exactly what that means).
async function updatePack({
  instanceId, project, version, onProgress, control,
}) {
  const report = (stage, extra) => onProgress && onProgress({ stage, ...extra });
  const packFile = version.files.find((f) => f.filename.endsWith('.mrpack')) || version.files[0];
  if (!packFile) throw new Error('У этой версии нет файла для скачивания');

  report('download-pack');
  let tmpFile = null;
  let result;
  try {
    const buf = await fetchBuffer(packFile.url, { control, onProgress: (loaded, total) => report('download-pack', { completed: loaded, total }) });
    tmpFile = path.join(os.tmpdir(), `mrpack-update-${randomUUID()}.zip`);
    fs.writeFileSync(tmpFile, buf);
    const zip = new AdmZip(tmpFile);
    result = await installFromMrpackZip(zip, onProgress, control, instanceId);
  } finally {
    if (tmpFile) fs.rmSync(tmpFile, { force: true });
  }

  return {
    patch: {
      mcVersion: result.mcVersion, loader: result.loader, loaderVersion: result.loaderVersion, versionId: version.id, projectId: project.id,
    },
  };
}

// Same as installModpack, but for a .mrpack file already sitting on disk
// (drag-in / "Import" — no Modrinth project/version metadata to
// draw a name or icon from, so those fall back to the pack's own name and
// no icon respectively).
async function importLocalMrpack(filePath, onProgress, control, preloaded) {
  let result;
  try {
    // Read asynchronously: `new AdmZip(path)` does a synchronous read of the
    // whole archive, which for a big pack stalls the app before it even starts.
    const zip = preloaded || new AdmZip(await fs.promises.readFile(filePath));
    result = await installFromMrpackZip(zip, onProgress, control);
  } catch (err) {
    // Cancelled or failed (bad pack, no network…): don't leave a half-built folder behind.
    await discardPartialInstall(control?.instanceId);
    throw err;
  }
  return {
    ...result,
    name: result.name || path.basename(filePath, path.extname(filePath)),
    icon: null,
    source: 'mrpack-import',
    createdAt: Date.now(),
    lastPlayed: null,
    totalPlaytimeMs: 0,
  };
}

const KIND_DIRS = { mod: 'mods', shader: 'shaderpacks', resourcepack: 'resourcepacks' };

// Files of mods/shaders/packs come only from Modrinth's CDN. The address arrives from the window, so it is checked here too.
function isModrinthCdnUrl(url) {
  try {
    const u = new URL(String(url));
    return u.protocol === 'https:' && u.hostname === 'cdn.modrinth.com';
  } catch {
    return false;
  }
}

async function installModFile({ instanceId, file, kind = 'mod' }) {
  if (!file || !isModrinthCdnUrl(file.url)) throw new Error('Недопустимый адрес файла: скачивание только с cdn.modrinth.com');
  const gameDir = paths.instanceGameDir(instanceId);
  const dest = path.join(gameDir, KIND_DIRS[kind] || 'mods', safeFileName(file.filename));
  await downloadFile(file.url, dest, { expectedSize: file.size, expectedSha1: file.sha1 });
  return dest;
}

module.exports = {
  getProject, getProjectVersions, installModpack, importLocalMrpack, installModFile, checkPackUpdate, updatePack, isModrinthCdnUrl,
};
