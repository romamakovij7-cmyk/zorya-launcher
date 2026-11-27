// Technic Platform (technicpack.net) modpacks: search, details and install.
//
// A Technic pack is either
//   * a Solder pack: a list of builds, each build a list of small zips (mods,
//     configs, one of them carrying `bin/modpack.jar`), or
//   * a plain pack: one direct zip with the same layout.
// Every zip is extracted into the game folder. `bin/modpack.jar` is Technic's
// way of describing the Forge install — its `version.json` names the Forge
// version, which we read to pick the loader and let our own Forge installer
// set it up at launch (the jar itself is not used).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');
const AdmZip = require('adm-zip');
const paths = require('./paths');
const { downloadAll } = require('./download');
const { collectOverrideJobs, extractJobs, entryData } = require('./zipExtract');
const { discardPartialInstall } = require('./installControl');
const { assertVersionString } = require('./safe');

const fsp = fs.promises;
const API = 'https://api.technicpack.net';
const API_PLAIN = 'http://api.technicpack.net'; // the https endpoint is flaky; plain http is the fallback
const LAUNCHER_BUILD = 999; // the API wants a launcher build number; any recent one works
const UA = 'ZoryaLauncher/0.1';

async function getJson(url, timeout = 20000) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(timeout) });
  if (!res.ok) {
    const err = new Error(`Technic: сервер ответил ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function api(pathAndQuery) {
  const q = `${pathAndQuery}${pathAndQuery.includes('?') ? '&' : '?'}build=${LAUNCHER_BUILD}`;
  try {
    return await getJson(API + q);
  } catch (err) {
    if (err.status) throw err; // a real answer (404 etc.) — retrying elsewhere won't change it
    return getJson(API_PLAIN + q);
  }
}

// Search hits and trending carry only a name and icon; the full record has the
// description, author and install count the cards show.
const packCache = new Map(); // slug -> { at, pack, images }
const PACK_TTL_MS = 10 * 60 * 1000;

// Technic's image CDN (Cloudflare) often hangs forever when the app's browser
// window asks for it — probably Chromium's HTTP/3 attempt being blocked on the
// network — while a plain Node request answers at once. So the images come
// through here and reach the UI as ready-made data URLs.
async function fetchDataUrl(url, timeout = 8000) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(timeout) });
    if (!res.ok) return null;
    const type = (res.headers.get('content-type') || 'image/png').split(';')[0];
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > 900 * 1024) return null;
    return `data:${type};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

function normalizePack(raw) {
  return {
    ...raw,
    project_id: raw.name, // the slug doubles as the id everywhere else in the app
    slug: raw.name,
    title: raw.displayName || raw.name,
    icon_url: raw.icon?.url || null,
    platform: 'technic',
  };
}

// `images: true` also fetches the big logo / background (for the pack's own page).
async function getModpack(slug, { images = false } = {}) {
  let entry = packCache.get(slug);
  if (!entry || Date.now() - entry.at >= PACK_TTL_MS) {
    const raw = await api(`/modpack/${encodeURIComponent(slug)}`);
    if (raw.error) throw new Error(raw.error === 'Modpack does not exist' ? 'Instance не найдена на Technic' : `Technic: ${raw.error}`);
    const pack = normalizePack(raw);
    if (pack.icon_url) pack.icon_url = (await fetchDataUrl(pack.icon_url)) || pack.icon_url;
    entry = { at: Date.now(), pack, images: false };
    packCache.set(slug, entry);
  }
  if (images && !entry.images) {
    entry.images = true;
    const { pack } = entry;
    await Promise.all(['logo', 'background'].map(async (k) => {
      if (pack[k]?.url) pack[k] = { ...pack[k], url: (await fetchDataUrl(pack[k].url, 12000)) || pack[k].url };
    }));
  }
  return entry.pack;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

// Card-shaped results (same fields the Modrinth / CurseForge cards use).
async function search(query) {
  const q = (query || '').trim();
  const list = q ? await api(`/search?q=${encodeURIComponent(q)}`) : await api('/trending');
  const hits = (list.modpacks || []).slice(0, 24);
  const packs = await mapLimit(hits, 6, async (h) => {
    try { return await getModpack(h.slug); } catch { return null; }
  });
  return packs.filter(Boolean).map((p) => ({
    project_id: p.slug,
    slug: p.slug,
    title: p.title,
    author: p.user || '',
    description: p.description || '',
    icon_url: p.icon_url,
    downloads: p.installs || 0,
    follows: 0,
    date_modified: p.feed?.[0]?.date ? new Date(p.feed[0].date * 1000).toISOString() : null,
    platform: 'technic',
  }));
}

function solderBase(pack) {
  return pack.solder ? pack.solder.replace(/\/?$/, '/') : null;
}

// Builds newest-first. A plain (non-Solder) pack has exactly one: its zip.
async function getBuilds(slug) {
  const pack = await getModpack(slug);
  const base = solderBase(pack);
  if (base) {
    const s = await getJson(`${base}modpack/${encodeURIComponent(pack.name)}`);
    const builds = [...(s.builds || [])].reverse();
    if (!builds.length) throw new Error('У этой сборки на Technic нет ни одной версии');
    return { builds, recommended: s.recommended || null, latest: s.latest || null };
  }
  if (pack.url) return { builds: [pack.version || '1'], recommended: pack.version || '1', latest: pack.version || '1' };
  throw new Error('Для этой сборки на Technic нет файлов для скачивания');
}

// What one build consists of: its zips, the Minecraft/Java it wants, the size.
async function getBuild(slug, build) {
  const pack = await getModpack(slug);
  const base = solderBase(pack);
  if (base) {
    const b = await getJson(`${base}modpack/${encodeURIComponent(pack.name)}/${encodeURIComponent(build)}?include=mods`, 30000);
    if (b.error) throw new Error(`Technic: ${b.error}`);
    const mods = (b.mods || []).filter((m) => m.url);
    return {
      minecraft: b.minecraft || pack.minecraft || null,
      java: b.java || null,
      memory: Number(b.memory) || 0,
      mods: mods.map((m) => ({ name: m.name, version: m.version, url: m.url, size: m.filesize || 0 })),
      modCount: mods.length,
      totalBytes: mods.reduce((s, m) => s + (m.filesize || 0), 0),
    };
  }
  return {
    minecraft: pack.minecraft || null,
    java: null,
    memory: 0,
    mods: [{ name: pack.name, version: pack.version || '', url: pack.url, size: 0 }],
    modCount: 1,
    totalBytes: 0,
  };
}

// "1.7.10" < "1.12.2" — numeric compare of the dotted parts.
function mcAtLeast(version, major, minor) {
  const [a, b] = String(version || '').split('.').map((x) => parseInt(x, 10) || 0);
  return a > major || (a === major && b >= minor);
}

// Loader + Minecraft version from the `version.json` inside bin/modpack.jar.
function loaderFromVersionJson(vj, fallbackMc) {
  const mc = vj.inheritsFrom || vj.jar || fallbackMc;
  const libs = (vj.libraries || []).map((l) => l.name || '');
  const forge = libs.find((n) => n.startsWith('net.minecraftforge:forge:') || n.startsWith('net.minecraftforge:minecraftforge:'));
  if (forge) {
    const full = forge.split(':')[2];
    return { mcVersion: mc, loader: 'forge', loaderVersion: mc && full.startsWith(`${mc}-`) ? full.slice(mc.length + 1) : full };
  }
  const neo = libs.find((n) => n.startsWith('net.neoforged:neoforge:'));
  if (neo) return { mcVersion: mc, loader: 'neoforge', loaderVersion: neo.split(':')[2] };
  const fabric = libs.find((n) => n.startsWith('net.fabricmc:fabric-loader:'));
  if (fabric) return { mcVersion: mc, loader: 'fabric', loaderVersion: fabric.split(':')[2] };
  return { mcVersion: mc, loader: 'vanilla', loaderVersion: null };
}

// Downloads every zip of the chosen build, unpacks them into a fresh instance
// and works out which loader it needs. Returns the instance record.
async function installModpack({
  project, version, onProgress, control,
}) {
  const report = (stage, extra) => onProgress && onProgress({ stage, ...extra });
  const slug = project.slug || project.name;
  const build = version.build;
  report('download-files', { completed: 0, total: 0 });

  const info = await getBuild(slug, build);
  if (info.minecraft && !mcAtLeast(info.minecraft, 1, 7)) {
    throw new Error(`Эта сборка для Minecraft ${info.minecraft}: так рано Technic ставил mods прямо в minecraft.jar, и наш лаунчер такие версии запустить не умеет. Подходят сборки на 1.7 и новее.`);
  }

  const id = randomUUID();
  if (control) control.instanceId = id;
  const gameDir = paths.instanceGameDir(id);
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'zorya-technic-'));

  try {
    const tasks = info.mods.map((m, i) => ({
      url: m.url, dest: path.join(tmp, `${i}.zip`), size: m.size || undefined, label: `${m.name} ${m.version}`.trim(),
    }));
    report('download-files', { completed: 0, total: tasks.length });
    await downloadAll(tasks, { concurrency: 6, onProgress: (p) => report('download-files', p), control });

    report('extract-overrides', { completed: 0, total: tasks.length });
    let modpackJar = null;
    for (let i = 0; i < tasks.length; i++) {
      if (control) await control.gate(); // eslint-disable-line no-await-in-loop
      const zip = new AdmZip(await fsp.readFile(tasks[i].dest)); // eslint-disable-line no-await-in-loop
      const jarEntry = zip.getEntry('bin/modpack.jar');
      if (jarEntry) modpackJar = await entryData(jarEntry); // eslint-disable-line no-await-in-loop
      // bin/ is Technic's own launch machinery; everything else is game content.
      await extractJobs(collectOverrideJobs(zip, [''], gameDir, { skip: (rel) => rel.startsWith('bin/') }), { control }); // eslint-disable-line no-await-in-loop
      await fsp.rm(tasks[i].dest, { force: true }); // eslint-disable-line no-await-in-loop
      report('extract-overrides', { completed: i + 1, total: tasks.length });
    }

    let target = { mcVersion: info.minecraft, loader: 'vanilla', loaderVersion: null };
    if (modpackJar) {
      const vjEntry = new AdmZip(modpackJar).getEntry('version.json');
      if (!vjEntry) {
        throw new Error('Эта сборка устроена по-старому (патчит minecraft.jar), такие сборки лаунчер не поддерживает.');
      }
      target = loaderFromVersionJson(JSON.parse(vjEntry.getData().toString('utf8')), info.minecraft);
    }
    if (!target.mcVersion) throw new Error('Failed определить версию Minecraft этой сборки');
    assertVersionString(String(target.mcVersion), 'Minecraft version в сборке');
    if (target.loaderVersion) assertVersionString(String(target.loaderVersion), 'loader version в сборке');

    const cap = Math.max(2048, Math.floor((os.totalmem() / 1048576) * 0.75));
    return {
      id,
      name: project.title || project.displayName || slug,
      mcVersion: target.mcVersion,
      loader: target.loader,
      loaderVersion: target.loaderVersion,
      icon: project.icon_url || project.icon?.url || null,
      source: 'technic',
      projectId: slug,
      versionId: build,
      // The pack says how much memory it was built for; never below 2 GB, never above 75% of the machine.
      minMemoryMb: 512,
      maxMemoryMb: Math.min(cap, Math.max(2048, info.memory || 0)),
      createdAt: Date.now(),
      lastPlayed: null,
      totalPlaytimeMs: 0,
    };
  } catch (err) {
    await discardPartialInstall(id); // cancelled or failed half-way: no leftover folder
    throw err;
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = {
  search, getModpack, getBuilds, getBuild, installModpack, mcAtLeast,
};
