// Installs the mods another mod requires, right after it was installed from
// Modrinth or CurseForge (what the site's own launchers do): required
// dependencies are looked up for this instance's Minecraft version and loader,
// downloaded, and their own dependencies followed in turn.
const path = require('path');
const paths = require('./paths');
const content = require('./content');
const modrinth = require('./modrinth');
const curseforge = require('./curseforge');
const { downloadFile } = require('./download');

const MR = 'https://api.modrinth.com/v2';
const MAX_DEPTH = 6;
const CF_REQUIRED = 3; // FileRelationType: 1 embedded, 2 optional, 3 required, 5 incompatible

async function mrGet(pathAndQuery) {
  const res = await fetch(`${MR}${pathAndQuery}`, { headers: { 'User-Agent': 'ZoryaLauncher/0.1' } });
  if (!res.ok) throw new Error(`Modrinth (${res.status})`);
  return res.json();
}

// What the instance already has, so nothing is downloaded twice — matched by
// project id (per platform), by file hash and by name.
async function installedIndex(instanceId) {
  const idx = { mr: new Set(), cf: new Set(), sha1: new Set(), files: new Set(), titles: new Set(), stems: new Set() };
  let items = [];
  try { items = await content.listContent(instanceId); } catch { /* treat as empty */ }
  for (const it of items) {
    if (it.kind !== 'mod') continue;
    if (it.sha1) idx.sha1.add(it.sha1);
    idx.files.add(it.filename.replace(/\.disabled$/, '').toLowerCase());
    idx.stems.add(modStem(it.filename));
    if (it.resolved?.projectId) {
      (it.resolved.platform === 'curseforge' ? idx.cf : idx.mr).add(String(it.resolved.projectId));
      if (it.resolved.title) idx.titles.add(it.resolved.title.trim().toLowerCase());
    }
  }
  return idx;
}

// "sodium-fabric-0.8.12-beta.1+mc1.21.1.jar" -> "sodium-fabric": the mod without its version,
// so another build of an already-installed mod (even from the other site) counts as installed.
function modStem(filename) {
  return filename.replace(/\.disabled$/, '').replace(/\.jar$/i, '').split(/[-_+ ](?=v?\d)/)[0].toLowerCase();
}

const loaderList = (loader) => (loader === 'quilt' ? ['quilt', 'fabric'] : [loader]);

async function pickModrinthVersion(projectId, instance) {
  const q = new URLSearchParams({
    game_versions: JSON.stringify([instance.mcVersion]),
    loaders: JSON.stringify(loaderList(instance.loader)),
  });
  const list = await mrGet(`/project/${encodeURIComponent(projectId)}/version?${q}`);
  return list.find((v) => v.version_type === 'release') || list[0] || null;
}

// ---- Modrinth ------------------------------------------------------------------

// `version` is the Modrinth version object that was just installed.
async function installForModrinth({ instanceId, instance, version }) {
  const result = { installed: [], failed: [] };
  const idx = await installedIndex(instanceId);
  if (version.project_id) idx.mr.add(version.project_id);
  const seen = new Set([version.project_id]);

  async function walk(ver, depth) {
    if (depth > MAX_DEPTH) return;
    for (const dep of ver.dependencies || []) {
      if (dep.dependency_type !== 'required') continue;
      let projectId = dep.project_id;
      let depVersion = null;
      try {
        if (dep.version_id) {
          depVersion = await mrGet(`/version/${encodeURIComponent(dep.version_id)}`);
          projectId = projectId || depVersion.project_id;
        }
        if (!projectId || seen.has(projectId) || idx.mr.has(projectId)) continue;
        seen.add(projectId);
        if (!depVersion) depVersion = await pickModrinthVersion(projectId, instance);
        let title = depVersion?.name || projectId;
        try { title = (await mrGet(`/project/${encodeURIComponent(projectId)}`)).title || title; } catch { /* keep name */ }
        if (!depVersion) { result.failed.push({ title, error: 'нет версии под эту сборку' }); continue; }
        const file = depVersion.files.find((f) => f.primary) || depVersion.files[0];
        if (idx.sha1.has(file.hashes?.sha1) || idx.files.has(file.filename.toLowerCase()) || idx.stems.has(modStem(file.filename)) || idx.titles.has(title.trim().toLowerCase())) continue;
        await modrinth.installModFile({
          instanceId, kind: 'mod',
          file: { url: file.url, filename: file.filename, sha1: file.hashes?.sha1, size: file.size },
        });
        idx.mr.add(projectId);
        idx.files.add(file.filename.toLowerCase());
        idx.stems.add(modStem(file.filename));
        result.installed.push({ title, filename: file.filename });
        await walk(depVersion, depth + 1);
      } catch (err) {
        result.failed.push({ title: projectId || dep.file_name || 'зависимость', error: err.message });
      }
    }
  }
  await walk(version, 0);
  return result;
}

// ---- CurseForge ------------------------------------------------------------------

function cfFileFits(file, instance) {
  const gv = (file.gameVersions || []).map((g) => g.toLowerCase());
  return loaderList(instance.loader).some((l) => gv.includes(l));
}

// `file` is the CurseForge file object that was just installed.
async function installForCurseforge({ apiKey, instanceId, instance, modId, file }) {
  const result = { installed: [], failed: [] };
  const idx = await installedIndex(instanceId);
  idx.cf.add(String(modId));
  const seen = new Set([String(modId)]);

  async function walk(f, depth) {
    if (depth > MAX_DEPTH) return;
    for (const dep of f.dependencies || []) {
      if (dep.relationType !== CF_REQUIRED) continue;
      const depId = String(dep.modId);
      if (seen.has(depId) || idx.cf.has(depId)) continue;
      seen.add(depId);
      let title = depId;
      try {
        const mod = await curseforge.getMod(apiKey, depId);
        title = mod.title || title;
        if (idx.titles.has(title.trim().toLowerCase())) continue;
        const files = await curseforge.getModFiles(apiKey, depId, { gameVersion: instance.mcVersion });
        const fits = files.filter((x) => cfFileFits(x, instance));
        const pick = fits.find((x) => x.releaseType === 1) || fits[0];
        if (!pick) { result.failed.push({ title, error: 'нет файла под эту сборку' }); continue; }
        if (idx.files.has(pick.fileName.toLowerCase()) || idx.stems.has(modStem(pick.fileName))) continue;
        const { dest, file: full } = await curseforge.installModFile({
          apiKey, instanceId, modId: depId, fileId: pick.id, kind: 'mod',
        });
        content.recordResolved(instanceId, path.basename(dest), {
          platform: 'curseforge',
          projectId: depId,
          versionId: String(full.id),
          versionNumber: full.displayName || full.fileName,
          title,
          icon: mod.icon_url || null,
          author: mod.author || null,
        });
        idx.cf.add(depId);
        idx.files.add(pick.fileName.toLowerCase());
        idx.stems.add(modStem(pick.fileName));
        result.installed.push({ title, filename: pick.fileName });
        await walk(full, depth + 1);
      } catch (err) {
        result.failed.push({ title, error: err.message });
      }
    }
  }
  await walk(file, 0);
  return result;
}

module.exports = { installForModrinth, installForCurseforge };
