// CurseForge public API client (https://docs.curseforge.com). Requires a
// free personal API key from console.curseforge.com — the user supplies
// their own key in Settings; we never ship or hardcode one.
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

const API = 'https://api.curseforge.com/v1';
const MINECRAFT_GAME_ID = 432;
const CLASS_MOD = 6;
const CLASS_MODPACK = 4471;
const CLASS_RESOURCEPACK = 12;
const CLASS_SHADER = 6552;
const CLASS_BY_TYPE = {
  mod: CLASS_MOD, modpack: CLASS_MODPACK, resourcepack: CLASS_RESOURCEPACK, shader: CLASS_SHADER,
};

const MOD_LOADER_TYPE = { fabric: 4, forge: 1, quilt: 5, neoforge: 6 };

// A key pasted from the website often brings invisible characters along (a newline, a zero-width space, quotes): the API then answers 403
// as for a wrong key. Everything that cannot be part of a key is taken out; a real key looks like $2a$10$ + 53 characters.
function sanitizeKey(apiKey) {
  return String(apiKey || '').replace(/[\s\u00A0\u200B-\u200D\uFEFF"'`]/g, '');
}
const KEY_SHAPE = /^\$2[aby]\$\d\d\$[./A-Za-z0-9]{53}$/;

function requireKey(apiKey) {
  if (!sanitizeKey(apiKey)) {
    const err = new Error('CurseForge API key not set. Add one in Settings (get a free key at console.curseforge.com).');
    err.code = 'NO_API_KEY';
    throw err;
  }
}

// What a 401/403 from CurseForge can mean and what to do — shown instead of a bare "отклонил запрос (403)".
const FORBIDDEN_HELP = [
  'CurseForge не принял запрос (403). Возможные причины:',
  '1) Ключ введён не целиком или с лишними символами. Настоящий ключ выглядит как «$2a$10$…» (около 60 знаков). Скопируйте его заново кнопкой «Copy» на console.curseforge.com и вставьте в Settings целиком.',
  '2) Ключ уже недействителен: после пересоздания старый ключ перестаёт работать, а новый иногда включается не сразу. Вставьте самый свежий и подождите несколько минут.',
  '3) CurseForge блокирует ваш адрес (VPN, регион, провайдер). Попробуйте включить или выключить VPN и повторить.',
  'Check key и увидеть, какая из причин ваша, можно кнопкой «Check key» в Настройках.',
].join('\n');

async function cfFetch(apiKey, pathAndQuery, options = {}) {
  requireKey(apiKey);
  const key = sanitizeKey(apiKey);
  const res = await fetch(`${API}${pathAndQuery}`, {
    ...options,
    headers: {
      'x-api-key': key,
      Accept: 'application/json',
      // Some CDN-fronted APIs (CurseForge included) reject requests with no
      // descriptive User-Agent as bot traffic before the key is even checked,
      // which looks identical to "invalid key" from the response status alone.
      'User-Agent': 'ZoryaLauncher/0.1.0',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    let detail = '';
    try {
      const json = JSON.parse(bodyText);
      detail = json.errorMessage || json.message || json.error || '';
    } catch {
      // Non-JSON body (e.g. an HTML block page from the CDN in front of the
      // API) — this is the tell that it's not really the key's fault.
      if (bodyText && /<html/i.test(bodyText)) {
        detail = 'сервер вернул не JSON, а страницу-блокировку (похоже на защиту CDN, а не на ошибку ключа)';
      }
    }
    if (res.status === 403 || res.status === 401) {
      throw new Error(`${FORBIDDEN_HELP}${detail ? `\n\nОтвет сервера: ${detail}` : ''}`);
    }
    throw new Error(`CurseForge API error (${res.status})${detail ? `: ${detail}` : ''}`);
  }
  return res.json();
}

// "Check key" in Settings: one harmless request, and an answer that tells the key problem from a blocked connection.
async function checkKey(apiKey) {
  const key = sanitizeKey(apiKey);
  if (!key) return { ok: false, kind: 'empty', message: 'Ключ не введён.' };
  const shape = KEY_SHAPE.test(key);
  let res;
  try {
    res = await fetch(`${API}/games/${MINECRAFT_GAME_ID}`, {
      headers: { 'x-api-key': key, Accept: 'application/json', 'User-Agent': 'ZoryaLauncher/0.1.0' },
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    return { ok: false, kind: 'network', message: `Failed связаться с CurseForge: ${err.message}. Проверьте интернет и VPN.` };
  }
  if (res.ok) return { ok: true, kind: 'ok', message: shape ? 'Ключ работает.' : 'Ключ работает (хотя выглядит необычно).' };
  const text = await res.text().catch(() => '');
  const html = /<html/i.test(text) || /cloudflare/i.test(String(res.headers.get('server') || ''));
  if (res.status === 403 || res.status === 401) {
    if (html) {
      return { ok: false, kind: 'blocked', message: 'CurseForge отвечает страницей-блокировкой, а не ошибкой ключа: он блокирует ваш адрес (VPN, регион или провайдер). Попробуйте включить или выключить VPN. Сам ключ при этом может быть правильным.' };
    }
    if (!shape) {
      return { ok: false, kind: 'format', message: `Ключ выглядит неполным или с лишними знаками: он состоит из ${key.length} знаков, а настоящий — 60 и начинается с «$2a$10$». Скопируйте его заново кнопкой «Copy» на console.curseforge.com.` };
    }
    return { ok: false, kind: 'rejected', message: 'CurseForge отклонил этот ключ. Формат правильный, значит, ключ отозван или ещё не включился: после пересоздания работает только самый новый, и ему иногда нужно несколько минут. Проверьте на console.curseforge.com, что вставлен последний ключ.' };
  }
  return { ok: false, kind: 'other', message: `CurseForge ответил ошибкой ${res.status}. Попробуйте позже.` };
}

function normalizeSearchHit(mod) {
  const latest = mod.latestFilesIndexes || [];
  return {
    platform: 'curseforge',
    project_id: String(mod.id),
    title: mod.name,
    description: mod.summary,
    icon_url: mod.logo?.url || null,
    author: (mod.authors || []).map((a) => a.name).join(', '),
    downloads: mod.downloadCount || 0,
    follows: 0,
    date_modified: mod.dateModified,
    game_versions: [...new Set(latest.map((l) => l.gameVersion).filter(Boolean))],
    loaders: [...new Set(latest.map((l) => loaderName(l.modLoader)).filter(Boolean))],
  };
}

function loaderName(modLoaderType) {
  const entry = Object.entries(MOD_LOADER_TYPE).find(([, v]) => v === modLoaderType);
  return entry ? entry[0] : null;
}

// CurseForge's sort fields the search page offers: 2 popularity, 3 last updated, 6 total downloads, 11 release date.
const SORT_FIELDS = new Set([2, 3, 6, 11]);

async function search({
  apiKey, query = '', projectType = 'mod', pageSize = 20, index = 0, gameVersion, loader, categoryId, sortField,
}) {
  const classId = CLASS_BY_TYPE[projectType] || CLASS_MOD;
  const params = new URLSearchParams({
    gameId: String(MINECRAFT_GAME_ID),
    classId: String(classId),
    searchFilter: query,
    sortField: String(SORT_FIELDS.has(Number(sortField)) ? Number(sortField) : 2),
    sortOrder: 'desc',
    pageSize: String(pageSize),
    index: String(index),
  });
  if (gameVersion) params.set('gameVersion', gameVersion);
  // Loaders only mean anything for mods — CurseForge doesn't tag
  // resource packs or shaders by loader at all, so this facet would
  // otherwise wrongly filter almost everything out (same class of bug
  // already fixed for Modrinth's loader facet).
  if ((projectType === 'mod' || projectType === 'modpack') && loader && MOD_LOADER_TYPE[loader] != null) {
    params.set('modLoaderType', String(MOD_LOADER_TYPE[loader]));
  }
  if (categoryId) params.set('categoryId', String(categoryId));
  const data = await cfFetch(apiKey, `/mods/search?${params.toString()}`);
  return { hits: data.data.map(normalizeSearchHit), totalCount: data.pagination?.totalCount ?? data.data.length };
}

async function getCategories(apiKey, projectType = 'mod') {
  const classId = CLASS_BY_TYPE[projectType] || CLASS_MOD;
  const data = await cfFetch(apiKey, `/categories?gameId=${MINECRAFT_GAME_ID}&classId=${classId}`);
  return (data.data || []).map((c) => ({ id: c.id, name: c.name, iconUrl: c.iconUrl }));
}

async function getMod(apiKey, modId) {
  const data = await cfFetch(apiKey, `/mods/${modId}`);
  return normalizeSearchHit(data.data);
}

// Everything the project page shows (beyond what search hits carry).
async function getModDetails(apiKey, modId) {
  const data = (await cfFetch(apiKey, `/mods/${modId}`)).data;
  const base = normalizeSearchHit(data);
  return {
    ...base,
    slug: data.slug,
    categories: (data.categories || []).map((c) => c.name),
    links: {
      website: data.links?.websiteUrl || null,
      source: data.links?.sourceUrl || null,
      issues: data.links?.issuesUrl || null,
      wiki: data.links?.wikiUrl || null,
    },
    screenshots: (data.screenshots || []).map((s) => ({
      url: s.url, thumb: s.thumbnailUrl || s.url, title: s.title || '', description: s.description || '',
    })),
    authors: (data.authors || []).map((a) => ({ name: a.name, url: a.url })),
    published: data.dateCreated,
    updated: data.dateModified,
    likes: data.thumbsUpCount || 0,
  };
}

// The long description is HTML.
async function getModDescription(apiKey, modId) {
  const data = await cfFetch(apiKey, `/mods/${modId}/description`);
  return data.data || '';
}

async function getFileChangelog(apiKey, modId, fileId) {
  const data = await cfFetch(apiKey, `/mods/${modId}/files/${fileId}/changelog`);
  return data.data || '';
}

async function getModFiles(apiKey, modId, { gameVersion, modLoaderType } = {}) {
  const params = new URLSearchParams({ pageSize: '50' });
  if (gameVersion) params.set('gameVersion', gameVersion);
  if (modLoaderType != null) params.set('modLoaderType', String(modLoaderType));
  const data = await cfFetch(apiKey, `/mods/${modId}/files?${params.toString()}`);
  return data.data;
}

async function getFilesBulk(apiKey, fileIds) {
  const data = await cfFetch(apiKey, '/mods/files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileIds }),
  });
  return data.data;
}

function fileDownloadUrl(file) {
  if (file.downloadUrl) return file.downloadUrl;
  // Fallback CDN pattern used when the mod author disabled the API download URL.
  const id = file.id;
  return `https://edge.forgecdn.net/files/${Math.floor(id / 1000)}/${id % 1000}/${encodeURIComponent(file.fileName)}`;
}

function fileLoaders(file) {
  return (file.gameVersions || []).filter((g) => Object.keys(MOD_LOADER_TYPE).includes(g.toLowerCase())).map((g) => g.toLowerCase());
}

function fileGameVersions(file) {
  return (file.gameVersions || []).filter((g) => /^\d/.test(g));
}

const KIND_DIRS = { mod: 'mods', shader: 'shaderpacks', resourcepack: 'resourcepacks' };

// CurseForge lists hashes per file; algo 1 is SHA-1.
function cfSha1(file) {
  const h = (file.hashes || []).find((x) => x.algo === 1);
  return h && /^[0-9a-f]{40}$/i.test(h.value) ? h.value : undefined;
}

async function installModFile({
  apiKey, instanceId, modId, fileId, kind = 'mod',
}) {
  const file = (await getFilesBulk(apiKey, [fileId]))[0];
  if (!file) throw new Error('File не найден');
  const dest = path.join(paths.instanceGameDir(instanceId), KIND_DIRS[kind] || 'mods', safeFileName(file.fileName));
  await downloadFile(fileDownloadUrl(file), dest, { expectedSize: file.fileLength, expectedSha1: cfSha1(file) });
  let mod = null;
  try {
    mod = await getMod(apiKey, modId);
  } catch {
    /* best-effort — installed file is still tagged as curseforge below without a title/icon */
  }
  return { dest, file, mod };
}

function loaderFromModLoaders(modLoaders) {
  const entry = (modLoaders || []).find((l) => l.primary) || modLoaders?.[0];
  if (!entry) return { loader: 'vanilla', loaderVersion: null };
  const [name, version] = entry.id.split('-');
  if (!['fabric', 'quilt', 'forge', 'neoforge'].includes(name)) {
    throw new Error(`Эта сборка использует ${name}, пока не поддерживается.`);
  }
  return { loader: name, loaderVersion: version };
}

// Shared by both the "install from CurseForge search" and "import a local
// modpack .zip" paths — extracts overrides and resolves+downloads every
// mod listed in manifest.json into a freshly-made instance directory.
// `existingId`: when set, writes into an already-existing instance instead of
// creating a new one (see modrinth.js's installFromMrpackZip for the same
// pattern and why — used here for updatePack below).
async function installFromCurseManifestZip(zip, apiKey, onProgress, control, existingId) {
  const report = (stage, extra) => onProgress && onProgress({ stage, ...extra });
  const manifestEntry = zip.getEntry('manifest.json');
  if (!manifestEntry) throw new Error('Некорректная сборка: нет manifest.json');
  const manifest = JSON.parse(zip.readAsText(manifestEntry));

  const mcVersion = manifest.minecraft?.version;
  if (!mcVersion) throw new Error('В сборке не указана Minecraft version');
  assertVersionString(String(mcVersion), 'Minecraft version в сборке');
  const { loader, loaderVersion } = loaderFromModLoaders(manifest.minecraft.modLoaders);
  if (loaderVersion) assertVersionString(String(loaderVersion), 'loader version в сборке');

  const id = existingId || randomUUID();
  if (control) control.instanceId = existingId ? null : id;
  const gameDir = paths.instanceGameDir(id);

  report('extract-overrides');
  const overridesFolder = `${manifest.overrides || 'overrides'}/`;
  await extractJobs(collectOverrideJobs(zip, [overridesFolder], gameDir), {
    control, onProgress: (p) => report('extract-overrides', p),
  });

  const fileIds = (manifest.files || []).map((f) => f.fileID);
  report('download-files', { total: fileIds.length });
  const files = fileIds.length ? await getFilesBulk(apiKey, fileIds) : [];
  const tasks = files.map((f) => ({
    url: fileDownloadUrl(f),
    dest: path.join(gameDir, 'mods', safeFileName(f.fileName)),
    size: f.fileLength,
    sha1: cfSha1(f),
    label: f.fileName,
  }));
  await downloadAll(tasks, { concurrency: 8, onProgress: (p) => report('download-files', p), control });

  const manifestPath = path.join(paths.instanceDir(id), 'pack-manifest.json');
  const newRelPaths = tasks.map((t) => path.relative(gameDir, t.dest));
  let oldRelPaths = [];
  try { oldRelPaths = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).files || []; } catch { /* first install, or unreadable */ }
  const keep = new Set(newRelPaths);
  for (const rel of oldRelPaths) {
    if (keep.has(rel)) continue;
    try { fs.rmSync(safeJoin(gameDir, rel), { force: true }); } catch { /* already gone, or not ours to touch */ }
  }
  fs.writeFileSync(manifestPath, JSON.stringify({ files: newRelPaths, updatedAt: Date.now() }));

  return {
    id, name: manifest.name, mcVersion, loader, loaderVersion,
  };
}

// Newest file for this mod (any release type) — used both to check whether a
// newer pack version exists and, if so, to install it.
async function latestFile(apiKey, projectId) {
  const files = await getModFiles(apiKey, projectId, {});
  if (!files.length) return null;
  return [...files].sort((a, b) => new Date(b.fileDate) - new Date(a.fileDate))[0];
}

async function checkPackUpdate(apiKey, projectId, currentVersionId) {
  const latest = await latestFile(apiKey, projectId);
  if (!latest || String(latest.id) === String(currentVersionId)) return null;
  return latest;
}

// Re-installs a modpack instance in place to a different (usually newer)
// file: same instance id, so its saves/screenshots/etc. are untouched.
async function updatePack({
  apiKey, instanceId, project, file, onProgress, control,
}) {
  const report = (stage, extra) => onProgress && onProgress({ stage, ...extra });
  report('download-pack');
  const url = fileDownloadUrl(file);
  let tmpFile = null;
  let result;
  try {
    const buf = await fetchBuffer(url, { control, onProgress: (loaded, total) => report('download-pack', { completed: loaded, total }) });
    tmpFile = path.join(os.tmpdir(), `cfpack-update-${randomUUID()}.zip`);
    fs.writeFileSync(tmpFile, buf);
    const zip = new AdmZip(tmpFile);
    result = await installFromCurseManifestZip(zip, apiKey, onProgress, control, instanceId);
  } finally {
    if (tmpFile) fs.rmSync(tmpFile, { force: true });
  }
  return {
    patch: {
      mcVersion: result.mcVersion, loader: result.loader, loaderVersion: result.loaderVersion, versionId: String(file.id), projectId: String(project.project_id),
    },
  };
}

async function installModpack({ apiKey, project, file, onProgress, control }) {
  const report = (stage, extra) => onProgress && onProgress({ stage, ...extra });
  report('download-pack');
  const url = fileDownloadUrl(file);
  let tmpFile = null;
  let result;
  try {
    const buf = await fetchBuffer(url, { control, onProgress: (loaded, total) => report('download-pack', { completed: loaded, total }) });
    tmpFile = path.join(os.tmpdir(), `cfpack-${randomUUID()}.zip`);
    fs.writeFileSync(tmpFile, buf);

    const zip = new AdmZip(tmpFile);
    result = await installFromCurseManifestZip(zip, apiKey, onProgress, control);
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
    source: 'curseforge',
    projectId: project.project_id,
    versionId: String(file.id),
    createdAt: Date.now(),
    lastPlayed: null,
    totalPlaytimeMs: 0,
  };
}

// Same as installModpack, but for a modpack .zip already sitting on disk
// ("Импортировать" — no CurseForge project/file metadata to draw a name or
// icon from, so those fall back to the manifest's own name and no icon).
async function installModpackFromLocalZip({
  apiKey, filePath, onProgress, control, zip: preloaded,
}) {
  let result;
  try {
    const zip = preloaded || new AdmZip(await fs.promises.readFile(filePath));
    result = await installFromCurseManifestZip(zip, apiKey, onProgress, control);
  } catch (err) {
    // Cancelled or failed (bad pack, no network…): don't leave a half-built folder behind.
    await discardPartialInstall(control?.instanceId);
    throw err;
  }
  return {
    ...result,
    name: result.name || path.basename(filePath, path.extname(filePath)),
    icon: null,
    source: 'curseforge-import',
    createdAt: Date.now(),
    lastPlayed: null,
    totalPlaytimeMs: 0,
  };
}

module.exports = {
  checkKey, sanitizeKey,
  search,
  getCategories,
  getMod,
  getModDetails,
  checkPackUpdate,
  updatePack,
  getModDescription,
  getFileChangelog,
  getModFiles,
  getFilesBulk,
  fileDownloadUrl,
  fileLoaders,
  fileGameVersions,
  installModFile,
  installModpack,
  installModpackFromLocalZip,
  MOD_LOADER_TYPE,
};
