// «Починить моды» из панели ошибки: разбор падения (crash.js) называет моды, которых не хватает, которые надо обновить или которые
// вероятно виноваты. Здесь по этим именам находятся нужные файлы: что уже стоит в сборке и что предлагает Modrinth для её версии игры
// и загрузчика. Само скачивание идёт только с Modrinth и только по id версии, пришедшему с его же сервера (рендереру доверять нечего).
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const paths = require('./paths');
const content = require('./content');
const modrinth = require('./modrinth');
const dependencies = require('./dependencies');

const MR = 'https://api.modrinth.com/v2';
const UA = { 'User-Agent': 'ZoryaLauncher/0.1' };
const VERSION_ID = /^[A-Za-z0-9]{8}$/;
const MOD_ID = /^[A-Za-z0-9_.\- ]{1,64}$/;
const MAX_NEEDS = 20;

// Это не моды из каталога, а «зависимости» самого окружения
const IGNORED = new Set(['java', 'minecraft', 'fabricloader', 'fabric-loader', 'quilt_loader', 'quilt-loader', 'forge', 'neoforge', 'mixinextras_dummy']);
// Некоторые id не совпадают с адресом проекта на Modrinth
const ALIAS = { fabric: 'fabric-api', 'fabric-api-base': 'fabric-api', quilted_fabric_api: 'qsl', qsl: 'qsl', 'fabric-language-kotlin': 'fabric-language-kotlin' };

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const loaderList = (loader) => (loader === 'quilt' ? ['quilt', 'fabric'] : [loader]);

async function mrGet(p) {
  const res = await fetch(`${MR}${p}`, { headers: UA });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Modrinth (${res.status})`);
  return res.json();
}

// ---- id мода внутри jar-файла (для случаев, когда по имени файла не понять) ----
const jarIdCache = new Map(); // "путь|размер:mtime" → [id]
function jarModIds(filePath) {
  let st;
  try { st = fs.statSync(filePath); } catch { return []; }
  if (st.size > 120 * 1024 * 1024) return [];
  const key = `${filePath}|${st.size}:${st.mtimeMs}`;
  if (jarIdCache.has(key)) return jarIdCache.get(key);
  const ids = [];
  try {
    const zip = new AdmZip(filePath);
    // Only small metadata files are read: an archive that claims a huge file there ("zip bomb") is skipped, not unpacked
    const text = (name) => {
      const e = zip.getEntry(name);
      if (!e || e.header.size > 1024 * 1024) return null;
      return e.getData().toString('utf8');
    };
    const fabric = text('fabric.mod.json');
    if (fabric) { try { const j = JSON.parse(fabric); if (j.id) ids.push(String(j.id)); } catch { /* ignore */ } }
    const quilt = text('quilt.mod.json');
    if (quilt) { try { const j = JSON.parse(quilt); if (j.quilt_loader?.id) ids.push(String(j.quilt_loader.id)); } catch { /* ignore */ } }
    for (const name of ['META-INF/mods.toml', 'META-INF/neoforge.mods.toml']) {
      const toml = text(name);
      if (toml) for (const m of toml.matchAll(/modId\s*=\s*["']([^"']+)["']/g)) ids.push(m[1]);
    }
  } catch { /* повреждённый jar: ids останутся пустыми */ }
  jarIdCache.set(key, ids);
  return ids;
}

const stemOf = (filename) => filename.replace(/\.disabled$/, '').replace(/\.jar$/i, '').split(/[-_+ ](?=v?\d)/)[0];

// Какой из установленных файлов — этот мод (по имени файла, названию с Modrinth, а в крайнем случае по id внутри jar)
function findInstalled(items, instanceId, need) {
  const idN = norm(need.modId);
  const nameN = norm(need.name);
  const mods = items.filter((i) => i.kind === 'mod');
  const byFile = need.filename ? mods.find((i) => i.filename.replace(/\.disabled$/, '').toLowerCase() === String(need.filename).replace(/\.disabled$/, '').toLowerCase()) : null;
  if (byFile) return byFile;
  if (!idN && !nameN) return null;
  // Только точные совпадения: «sodium-extra» — это другой мод, а не «sodium». К имени файла допустим лишь суффикс загрузчика.
  const withLoader = (s, id) => s === id || ['fabric', 'forge', 'neoforge', 'quilt', 'mc'].some((l) => s === id + l);
  const quick = mods.find((i) => {
    const stem = norm(stemOf(i.filename));
    const title = norm(i.resolved?.title);
    return (idN && (withLoader(stem, idN) || title === idN)) || (nameN && (title === nameN || withLoader(stem, nameN)));
  });
  if (quick) return quick;
  const dir = path.join(paths.instanceGameDir(instanceId), 'mods');
  for (const i of mods) {
    const ids = jarModIds(path.join(dir, i.filename)).map((x) => x.toLowerCase());
    if (need.modId && ids.includes(String(need.modId).toLowerCase())) return i;
  }
  return null;
}

// ---- версии: «0.9.1», «0.5.0 or later», «between 0.9.1- and 0.9.1», «[15.0,)» ----
// Основная версия мода из номера файла: «mc26.1.2-0.9.2-fabric» и «0.9.2+mc26.1.2» → [0, 9, 2] (версия игры вырезается)
function coreOf(str, mc) {
  let s = String(str || '').replace(/mc\d[\d.]*/gi, ' ');
  if (mc) s = s.split(String(mc)).join(' ');
  const m = /(\d+(?:\.\d+){1,3})/.exec(s);
  return m ? m[1].split('.').map(Number) : null;
}
const parseV = (s) => String(s).split('.').map((x) => Number(x) || 0);
function cmpV(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d) return d;
  }
  return 0;
}
// Подходит ли версия core под требуемый диапазон (null — диапазон не разобран или не задан: подходит любая)
function inRange(core, rangeText) {
  const t = String(rangeText || '').trim();
  if (!t || /^any/i.test(t) || !core) return null;
  const between = /between\s+(\d[\d.]*)-?\s*(?:\((?:in|ex)clusive\))?\s+and\s+(\d[\d.]*)-?/i.exec(t);
  if (between) return cmpV(core, parseV(between[1])) >= 0 && cmpV(core, parseV(between[2])) <= 0;
  const br = /^([[(])\s*([\d.]*)\s*,\s*([\d.]*)\s*([\])])$/.exec(t);
  if (br) {
    const lo = br[2] ? parseV(br[2]) : null;
    const hi = br[3] ? parseV(br[3]) : null;
    if (lo && (br[1] === '[' ? cmpV(core, lo) < 0 : cmpV(core, lo) <= 0)) return false;
    if (hi && (br[4] === ']' ? cmpV(core, hi) > 0 : cmpV(core, hi) >= 0)) return false;
    return true;
  }
  const first = /(\d+(?:\.\d+){0,3})/.exec(t);
  if (!first) return null;
  const v = parseV(first[1]);
  if (/or (later|above|newer)/i.test(t)) return cmpV(core, v) >= 0;
  if (/or (earlier|older|below)/i.test(t)) return cmpV(core, v) <= 0;
  return cmpV(core, v) === 0;
}

// Подходящая под сборку версия проекта: самая свежая релизная; если задан диапазон — самая свежая из подходящих под него
// (это и есть «поставить более старую», когда стоящая версия слишком новая). noMatch: подходящих под диапазон нет.
async function pickVersion(projectId, instance, range) {
  const q = new URLSearchParams({ game_versions: JSON.stringify([instance.mcVersion]), loaders: JSON.stringify(loaderList(instance.loader)) });
  const list = await mrGet(`/project/${encodeURIComponent(projectId)}/version?${q}`);
  if (!list || !list.length) return { version: null, noMatch: false };
  const newest = list.find((v) => v.version_type === 'release') || list[0];
  if (!range || /^any/i.test(range)) return { version: newest, noMatch: false };
  const fits = list.filter((v) => inRange(coreOf(v.version_number, instance.mcVersion), range) !== false);
  const stable = fits.find((v) => v.version_type === 'release') || fits[0];
  if (stable) return { version: stable, noMatch: false };
  // диапазон разобран, но ни одна версия не подошла
  const parsedOk = list.some((v) => inRange(coreOf(v.version_number, instance.mcVersion), range) !== null);
  return parsedOk ? { version: null, noMatch: true, newest } : { version: newest, noMatch: false };
}
// Project на Modrinth по id мода: сначала как адрес проекта, потом поиском
async function findProject(need, instance) {
  const raw = String(need.modId || '').trim();
  if (!raw || IGNORED.has(raw.toLowerCase())) return null;
  const slug = (ALIAS[raw.toLowerCase()] || raw).toLowerCase().replace(/_/g, '-').replace(/\s+/g, '-');
  const direct = await mrGet(`/project/${encodeURIComponent(slug)}`).catch(() => null);
  if (direct && direct.project_type === 'mod') return direct;
  const facets = [['project_type:mod'], [`versions:${instance.mcVersion}`], loaderList(instance.loader).map((l) => `categories:${l}`)];
  const q = new URLSearchParams({ query: need.name || raw, limit: '8', facets: JSON.stringify(facets) });
  const res = await mrGet(`/search?${q}`).catch(() => null);
  const hits = res?.hits || [];
  const idN = norm(raw);
  const nameN = norm(need.name);
  const hit = hits.find((h) => norm(h.slug) === idN || (nameN && norm(h.title) === nameN) || norm(h.title) === idN);
  return hit ? { id: hit.project_id, slug: hit.slug, title: hit.title, icon_url: hit.icon_url } : null;
}

const fileOf = (version) => version.files.find((f) => f.primary) || version.files[0];

// Что делать с каждым названным модом. need: { kind: 'install'|'update'|'suspect', modId, name?, filename?, range?, requestedBy? }
async function resolveNeeds(instance, needsIn) {
  const needs = (Array.isArray(needsIn) ? needsIn : []).slice(0, MAX_NEEDS).map((n) => ({
    kind: ['install', 'update', 'suspect'].includes(n?.kind) ? n.kind : 'install',
    modId: typeof n?.modId === 'string' && MOD_ID.test(n.modId) ? n.modId : '',
    name: typeof n?.name === 'string' ? n.name.slice(0, 80) : '',
    filename: typeof n?.filename === 'string' ? path.basename(n.filename).slice(0, 200) : '',
    range: typeof n?.range === 'string' ? n.range.slice(0, 200) : '',
    why: n?.why === 'game' ? 'game' : '',
    gameNeeds: typeof n?.gameNeeds === 'string' ? n.gameNeeds.slice(0, 80) : '',
    gamePresent: typeof n?.gamePresent === 'string' ? n.gamePresent.slice(0, 60) : '',
    present: typeof n?.present === 'string' ? n.present.slice(0, 60) : '',
    requestedBy: (Array.isArray(n?.requestedBy) ? n.requestedBy : []).filter((x) => typeof x === 'string').slice(0, 5).map((x) => x.slice(0, 60)),
  }));
  let items = [];
  try { items = await content.listContent(instance.id); } catch { /* пусто */ }
  const out = [];
  for (const need of needs) {
    const row = { need, state: 'notfound', installed: null, candidate: null };
    try {
      const installed = need.kind === 'install' ? null : findInstalled(items, instance.id, need);
      if (installed) row.installed = { filename: installed.filename, enabled: installed.enabled, versionNumber: installed.resolved?.versionNumber || null, title: installed.resolved?.title || null };
      if (need.kind === 'install') {
        // уже стоит (возможно, выключен)? тогда нужно просто включить
        const present = findInstalled(items, instance.id, need);
        if (present) { row.installed = { filename: present.filename, enabled: present.enabled, versionNumber: present.resolved?.versionNumber || null, title: present.resolved?.title || null }; row.state = present.enabled ? 'present' : 'disabled'; out.push(row); continue; }
      }
      // кандидат с Modrinth
      let project = null;
      if (installed?.resolved?.platform === 'modrinth') {
        project = { id: installed.resolved.projectId, title: installed.resolved.title, icon_url: installed.resolved.icon };
      } else if (need.modId || need.name) {
        project = await findProject({ modId: need.modId || stemOf(need.filename), name: need.name }, instance);
      }
      if (project) {
        const { version, noMatch, newest } = await pickVersion(project.id, instance, need.range);
        row.project = { title: project.title, icon: project.icon_url || null };
        if (noMatch) {
          // нужна версия по диапазону, а на Modrinth для этой игры такой нет
          row.state = 'no-match';
          if (newest) row.latest = newest.version_number;
        } else if (version) {
          const file = fileOf(version);
          row.candidate = { projectId: project.id, title: project.title, icon: project.icon_url || null, versionId: version.id, versionNumber: version.version_number, filename: file.filename };
          const installedCore = coreOf(installed?.resolved?.versionNumber || installed?.filename, instance.mcVersion);
          const candCore = coreOf(version.version_number, instance.mcVersion);
          row.downgrade = !!(installedCore && candCore && cmpV(candCore, installedCore) < 0);
          row.constrained = !!(need.range && !/^any/i.test(need.range) && inRange(candCore, need.range) !== null);
          if (need.kind === 'install') row.state = 'ready';
          else if (installed?.resolved?.versionId === version.id || (installed && String(installed.filename).replace(/\.disabled$/, '').toLowerCase() === String(file.filename).toLowerCase())) row.state = 'same';
          else row.state = 'ready';
        }
      }
      if (row.state === 'notfound' && need.kind !== 'install' && row.installed) row.state = 'installed-only';
    } catch (err) {
      row.state = 'error';
      row.error = err.message;
    }
    out.push(row);
  }
  return out;
}

// Apply выбранное: установить (вместе с обязательными зависимостями) или заменить установленный файл новой версией.
// Data берутся с Modrinth по id версии, а не из того, что прислало окно.
async function applyFix(instance, { action, versionId, filename }) {
  if (!VERSION_ID.test(String(versionId || ''))) throw new Error('Некорректная версия');
  const version = await mrGet(`/version/${encodeURIComponent(versionId)}`);
  if (!version) throw new Error('Version не найдена на Modrinth');
  const file = fileOf(version);
  if (!file) throw new Error('У версии нет файла');
  const fileInfo = { url: file.url, filename: file.filename, sha1: file.hashes?.sha1, size: file.size };
  if (action === 'update') {
    const items = await content.listContent(instance.id);
    const item = items.find((i) => i.kind === 'mod' && i.filename === path.basename(String(filename || '')));
    if (!item) throw new Error('File мода не найден в сборке');
    await content.applyContentUpdate(instance.id, item, { versionId: version.id, versionNumber: version.version_number, file });
  } else {
    await modrinth.installModFile({ instanceId: instance.id, kind: 'mod', file: fileInfo });
  }
  let deps = null;
  try { deps = await dependencies.installForModrinth({ instanceId: instance.id, instance, version }); } catch (err) { deps = { installed: [], failed: [{ title: 'зависимости', error: err.message }] }; }
  return { filename: file.filename, deps };
}

module.exports = { resolveNeeds, applyFix, findInstalled };
