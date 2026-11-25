// Fresh Moves (ресурспак анимированных глаз и движений игрока, Modrinth «tras-fresh-player») и то, что ему нужно в игре:
//   • моды Entity Model Features (EMF) и Entity Texture Features (ETF) — рисуют модель пака; их ставит лаунчер вместе с паком;
//   • сам ресурспак в <папка игры>/resourcepacks, включённый в options.txt;
//   • ETF: skinTransparencyMode = ALL — без него игра делает непрозрачными углы скина, где лежат пиксели глаз (в ETF_SKINS_ONLY это
//     только у «ETF-скинов» с особой меткой), и глаза превращаются в чёрные пятна.
// Глаза рисует не пак, а скин: в свободных углах раскладки (0..8×0..8, 24..40×0..8, 56..64×0..8) лежат пиксели белка, зрачка, бровей.
// Ставится ТОЛЬКО по кнопке в окне Fresh Moves (правый клик по персонажу): сам при запуске игры лаунчер ничего не ставит и не включает
// (раньше решал по пикселям в углах скина, и скины с лишними пикселями получали пак и моды без спроса).
// Всё скачивается только с cdn.modrinth.com (modrinth.installModFile проверяет адрес, размер и sha1).
const fs = require('fs');
const path = require('path');
const paths = require('./paths');
const modrinth = require('./modrinth');
const dependencies = require('./dependencies');
const genderMod = require('./genderMod');
const offlineSkin = require('./offlineSkin');

const MR = 'https://api.modrinth.com/v2';
const PACK_PROJECT = 'tras-fresh-player';
const EMF_PROJECT = 'entity-model-features';
const ETF_PROJECT = 'entitytexturefeatures';
const LOADERS = new Set(['fabric', 'quilt', 'forge', 'neoforge']);
const PACK_NAME_RE = /fresh.?moves/i;
const NO_EYES_RE = /no animated|eyeless|\(no eyes\)/i; // варианты пака без глаз

async function mrGet(pathAndQuery) {
  const res = await fetch(`${MR}${pathAndQuery}`, { headers: { 'User-Agent': 'ZoryaLauncher/0.1' } });
  if (!res.ok) throw new Error(`Modrinth (${res.status})`);
  return res.json();
}

const loaderList = (loader) => (loader === 'quilt' ? ['quilt', 'fabric'] : [loader]);

// The skin of a licensed account lives on Mojang's texture server (only that host, only PNG, small)
async function fetchSkinBuffer(skinUrl) {
  let u;
  try { u = new URL(String(skinUrl)); } catch { return null; }
  if (u.hostname !== 'textures.minecraft.net' || !/^https?:$/.test(u.protocol)) return null;
  u.protocol = 'https:';
  const MAX = 512 * 1024;
  try {
    // No redirects (the address must stay on Mojang's host) and a hard cap on what is read, whatever the server claims
    const res = await fetch(u, { signal: AbortSignal.timeout(5000), redirect: 'error' });
    if (!res.ok || !res.body) return null;
    if (Number(res.headers.get('content-length')) > MAX) return null;
    const chunks = [];
    let size = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX) { reader.cancel().catch(() => {}); return null; }
      chunks.push(Buffer.from(value));
    }
    const buf = Buffer.concat(chunks);
    return buf.length > 0 && buf.subarray(1, 4).toString('latin1') === 'PNG' ? buf : null;
  } catch { return null; }
}

// ---- what an instance has ----

function listDir(dir) { try { return fs.readdirSync(dir); } catch { return []; } }

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { return null; }
}

function enabledPacks(gameDir) {
  let text = '';
  try { text = fs.readFileSync(path.join(gameDir, 'options.txt'), 'utf8'); } catch { return []; }
  const line = text.split(/\r?\n/).find((l) => l.startsWith('resourcePacks:'));
  if (!line) return [];
  try { const list = JSON.parse(line.slice('resourcePacks:'.length)); return Array.isArray(list) ? list : []; } catch { return []; }
}

// { emf, etf, pack, packFile, packEnabled, transparency, eyes } of the game folder
function inspect(gameDir) {
  const out = { emf: null, etf: null, pack: null, packEnabled: false, transparency: null, packHasEyes: null };
  const modsDir = path.join(gameDir, 'mods');
  for (const name of listDir(modsDir)) {
    if (!/\.jar$/i.test(name) || !/entity/i.test(name)) continue;
    const info = genderMod.readModInfo(path.join(modsDir, name));
    if (!info) continue;
    if (info.id === 'entity_model_features') out.emf = { file: name, version: info.version };
    else if (info.id === 'entity_texture_features') out.etf = { file: name, version: info.version };
  }
  const packs = listDir(path.join(gameDir, 'resourcepacks')).filter((n) => PACK_NAME_RE.test(n) && /\.zip$/i.test(n));
  const enabled = enabledPacks(gameDir);
  // an enabled one first; among the rest the one with eyes
  packs.sort((a, b) => {
    const ea = enabled.some((e) => e === a || e === `file/${a}`) ? 1 : 0; const eb = enabled.some((e) => e === b || e === `file/${b}`) ? 1 : 0;
    if (ea !== eb) return eb - ea;
    return (NO_EYES_RE.test(a) ? 1 : 0) - (NO_EYES_RE.test(b) ? 1 : 0);
  });
  if (packs.length) {
    out.pack = packs[0];
    out.packEnabled = enabled.some((e) => e === packs[0] || e === `file/${packs[0]}`);
    out.packHasEyes = !NO_EYES_RE.test(packs[0]);
  }
  const cfg = readJson(path.join(gameDir, 'config', 'entity_texture_features.json'));
  out.transparency = cfg && typeof cfg.skinTransparencyMode === 'string' ? cfg.skinTransparencyMode : null;
  return out;
}

// What the window shows per instance: [{ id, name, mcVersion, loader, supported, emf, etf, pack, packEnabled, transparency, ready }]
function status(instances) {
  const out = [];
  for (const inst of instances || []) {
    let gameDir;
    try { gameDir = paths.instanceGameDir(inst.id); } catch { continue; }
    const st = inspect(gameDir);
    const supported = LOADERS.has(inst.loader);
    out.push({
      id: inst.id, name: inst.name, mcVersion: inst.mcVersion, loader: inst.loader, supported,
      emf: st.emf, etf: st.etf, pack: st.pack, packEnabled: st.packEnabled, packHasEyes: st.packHasEyes, transparency: st.transparency,
      ready: !!(st.emf && st.etf && st.pack && st.packEnabled && st.packHasEyes !== false && st.transparency === 'ALL'),
    });
  }
  return out;
}

// ---- install ----

// The pack version for this game version: the newest one that lists it and has the eyes
async function pickPackVersion(mcVersion) {
  const q = new URLSearchParams({ game_versions: JSON.stringify([mcVersion]) });
  const list = await mrGet(`/project/${PACK_PROJECT}/version?${q}`);
  const withEyes = list.filter((v) => !NO_EYES_RE.test(`${v.name} ${v.files?.[0]?.filename || ''}`));
  return withEyes.find((v) => v.version_type === 'release') || withEyes[0] || null;
}

async function pickModVersion(project, instance) {
  const q = new URLSearchParams({ game_versions: JSON.stringify([instance.mcVersion]), loaders: JSON.stringify(loaderList(instance.loader)) });
  const list = await mrGet(`/project/${project}/version?${q}`);
  return list.find((v) => v.version_type === 'release') || list[0] || null;
}

// The file to download. Without Modrinth's SHA-1 the download could not be checked, so such a file is refused.
function primaryFile(v) {
  const f = (v.files || []).find((x) => x.primary) || (v.files || [])[0];
  if (!f || !/^[0-9a-f]{40}$/i.test(String(f.hashes?.sha1 || ''))) throw new Error(`У файла ${f?.filename || ''} нет контрольной суммы Modrinth: не скачиваю`);
  return f;
}

// Merges skinTransparencyMode = ALL into ETF's config (other keys stay; a missing file is created with just this key: ETF fills in the rest)
function setTransparencyAll(gameDir) {
  const file = path.join(gameDir, 'config', 'entity_texture_features.json');
  let data = {};
  if (fs.existsSync(file)) {
    data = readJson(file);
    if (!data || typeof data !== 'object') return { ok: false, error: 'конфиг ETF повреждён: не трогаю его' };
    if (data.skinTransparencyMode === 'ALL') return { ok: true, changed: false };
    try { fs.copyFileSync(file, `${file}.zorya-bak`); } catch { /* a failed copy must not stop the change */ }
  }
  data.skinTransparencyMode = 'ALL';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.zorya-tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
  return { ok: true, changed: true };
}

// Makes the instance ready: pack, EMF/ETF (with what they require), ETF config, the pack switched on. Steps that are already done are skipped.
// log(line) gets human-readable progress. Returns { ok, steps: [..], error? }.
async function install(instance, log = () => {}) {
  const steps = [];
  if (!LOADERS.has(instance.loader)) return { ok: false, steps, error: `Fresh Moves нужны моды (EMF и ETF): на сборке без загрузчика (${instance.loader || 'vanilla'}) их не поставить` };
  const gameDir = paths.instanceGameDir(instance.id);
  let st = inspect(gameDir);

  if (!st.emf) {
    const v = await pickModVersion(EMF_PROJECT, instance);
    if (!v) return { ok: false, steps, error: `Entity Model Features нет под ${instance.mcVersion} (${instance.loader})` };
    const f = primaryFile(v);
    log(`Fresh Moves: ставлю Entity Model Features ${v.version_number}`);
    await modrinth.installModFile({ instanceId: instance.id, kind: 'mod', file: { url: f.url, filename: f.filename, sha1: f.hashes?.sha1, size: f.size } });
    steps.push(`Entity Model Features ${v.version_number}`);
    const deps = await dependencies.installForModrinth({ instanceId: instance.id, instance, version: v });
    for (const d of deps.installed) steps.push(d.title);
    if (deps.failed.length) log(`Fresh Moves: failed поставить зависимости: ${deps.failed.map((d) => `${d.title} (${d.error})`).join(', ')}`);
  }
  st = inspect(gameDir);
  if (!st.etf) {
    const v = await pickModVersion(ETF_PROJECT, instance);
    if (!v) return { ok: false, steps, error: `Entity Texture Features нет под ${instance.mcVersion} (${instance.loader})` };
    const f = primaryFile(v);
    log(`Fresh Moves: ставлю Entity Texture Features ${v.version_number}`);
    await modrinth.installModFile({ instanceId: instance.id, kind: 'mod', file: { url: f.url, filename: f.filename, sha1: f.hashes?.sha1, size: f.size } });
    steps.push(`Entity Texture Features ${v.version_number}`);
    await dependencies.installForModrinth({ instanceId: instance.id, instance, version: v });
  }

  if (!st.pack || st.packHasEyes === false) {
    const v = await pickPackVersion(instance.mcVersion);
    if (!v) return { ok: false, steps, error: `У Fresh Moves нет версии с глазами под Minecraft ${instance.mcVersion}` };
    const f = primaryFile(v);
    log(`Fresh Moves: скачиваю ресурспак ${v.version_number}`);
    await modrinth.installModFile({ instanceId: instance.id, kind: 'resourcepack', file: { url: f.url, filename: f.filename, sha1: f.hashes?.sha1, size: f.size } });
    steps.push(`ресурспак Fresh Moves ${v.version_number}`);
    st = inspect(gameDir);
  }
  if (!st.pack) return { ok: false, steps, error: 'Resource pack скачан, но не найден в папке сборки' };
  if (!st.packEnabled) {
    offlineSkin.setPackEnabled(gameDir, instance.mcVersion, true, st.pack);
    steps.push('ресурспак включён');
  }
  const t = setTransparencyAll(gameDir);
  if (!t.ok) return { ok: false, steps, error: t.error };
  if (t.changed) steps.push('ETF: прозрачность скинов = ALL');
  return { ok: true, steps };
}

// Switches the pack off in options.txt (files and mods stay)
function disable(instance) {
  const gameDir = paths.instanceGameDir(instance.id);
  const st = inspect(gameDir);
  if (st.pack && st.packEnabled) offlineSkin.setPackEnabled(gameDir, instance.mcVersion, false, st.pack);
  return { ok: true };
}

module.exports = { fetchSkinBuffer, inspect, status, install, disable, setTransparencyAll, LOADERS };
