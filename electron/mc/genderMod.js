// Интеграция с модом Wildfire's Female Gender Mod: настройки игрока лежат в JSON-файле на каждого игрока и на каждую сборку:
//   мод 5.x (Minecraft 26.1+):  <папка игры>/config/FemaleGenderMod/<uuid игрока>.json   (много полей, в том числе раскладка текстур)
//   мод 3.x–4.x (1.20 и т.д.):  <папка игры>/config/WildfireGender/<uuid игрока>.json    (короткий файл)
// UUID — тот, под которым игрок заходит в игру (у аккаунта лаунчера это account.id), с чёрточками, строчными буквами.
// Лаунчер читает файл, показывает окно настроек и записывает изменённые поля обратно, не трогая остальные (раскладку текстур и т.п.).
// Mod сам перезаписывает файл при выходе из игры, поэтому запущенную сборку не трогаем.
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const paths = require('./paths');

const MOD_IDS = new Set(['female_gender_mod', 'wildfire_gender', 'wildfire_female_gender']);
const FORMATS = {
  v5: { dir: 'FemaleGenderMod', label: 'мод 5.x' },
  v3: { dir: 'WildfireGender', label: 'мод 3.x–4.x' },
};

const HEX32 = /^[0-9a-fA-F]{32}$/;
const dashed = (id) => String(id).toLowerCase().replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');

// Поля, которыми управляет окно: тип, пределы и в каких форматах файла они есть.
const FIELDS = {
  gender: { type: 'gender', formats: ['v5', 'v3'] },
  bust_size: { type: 'num', min: 0, max: 1, formats: ['v5', 'v3'] },
  hurt_sounds: { type: 'bool', formats: ['v5', 'v3'] },
  voice_pitch: { type: 'num', min: 0.5, max: 1.5, formats: ['v5'] },
  breasts_xOffset: { type: 'num', min: -1, max: 1, formats: ['v5', 'v3'] },
  breasts_yOffset: { type: 'num', min: -1, max: 1, formats: ['v5', 'v3'] },
  breasts_zOffset: { type: 'num', min: -1, max: 1, formats: ['v5', 'v3'] },
  breasts_uniboob: { type: 'bool', formats: ['v5', 'v3'] },
  breasts_cleavage: { type: 'num', min: 0, max: 0.2, formats: ['v5', 'v3'] },
  breast_physics: { type: 'bool', formats: ['v5', 'v3'] },
  breast_physics_armor: { type: 'bool', formats: ['v3'] },
  show_in_armor: { type: 'bool', formats: ['v5', 'v3'] },
  bounce_multiplier: { type: 'num', min: 0, max: 1, formats: ['v5', 'v3'] },
  floppy_multiplier: { type: 'num', min: 0, max: 1, formats: ['v5', 'v3'] },
  holiday_themes: { type: 'bool', formats: ['v5'] },
};
const GENDERS = ['female', 'male', 'other']; // порядок как в моде: 0 — женский, 1 — мужской, 2 — другой

// Что подставить, если у игрока в этой сборке файла ещё нет (значения как у мода по умолчанию).
const DEFAULTS = {
  gender: 0, bust_size: 0.6, hurt_sounds: true, voice_pitch: 1.0, breasts_xOffset: 0, breasts_yOffset: 0, breasts_zOffset: 0,
  breasts_uniboob: true, breasts_cleavage: 0, breast_physics: true, breast_physics_armor: false, show_in_armor: true,
  bounce_multiplier: 0.333, floppy_multiplier: 0.75, holiday_themes: true,
};

// ---- is the mod in an instance? ----
const modCache = new Map(); // "путь|mtime|размер" -> { id, version } | null
function readModInfo(jarPath) {
  let st;
  try { st = fs.statSync(jarPath); } catch { return null; }
  const key = `${jarPath}|${st.mtimeMs}|${st.size}`;
  if (modCache.has(key)) return modCache.get(key);
  let info = null;
  try {
    const zip = new AdmZip(jarPath);
    let id = null;
    let version = null;
    const fabric = zip.getEntry('fabric.mod.json');
    if (fabric) { const j = JSON.parse(fabric.getData().toString('utf8').replace(/^﻿/, '')); id = j.id; version = j.version; }
    if (!id) {
      const quilt = zip.getEntry('quilt.mod.json');
      if (quilt) { const j = JSON.parse(quilt.getData().toString('utf8').replace(/^﻿/, '')); id = j.quilt_loader?.id; version = j.quilt_loader?.version; }
    }
    if (!id) {
      for (const name of ['META-INF/neoforge.mods.toml', 'META-INF/mods.toml']) {
        const e = zip.getEntry(name);
        if (!e) continue;
        const text = e.getData().toString('utf8');
        id = (/modId\s*=\s*"([^"]+)"/.exec(text) || [])[1] || null;
        version = (/^\s*version\s*=\s*"([^"$]+)"/m.exec(text) || [])[1] || null;
        if (id) break;
      }
    }
    info = id ? { id: String(id), version: version ? String(version) : '' } : null;
  } catch { info = null; }
  if (modCache.size > 500) modCache.clear();
  modCache.set(key, info);
  return info;
}

// "5.0.0+mc26.1" -> 5, "1.20-3.0.1" -> 3
function majorOf(version, fileName) {
  for (const src of [version, fileName]) {
    const s = String(src || '').replace(/\+.*$/, '');
    const all = [...s.matchAll(/(\d+)\.(\d+)(?:\.(\d+))?/g)];
    if (all.length) return Number(all[all.length - 1][1]);
  }
  return 0;
}

// { present, version, file, format } for the instance's game folder
function inspectInstance(gameDir) {
  const modsDir = path.join(gameDir, 'mods');
  let names = [];
  try { names = fs.readdirSync(modsDir); } catch { return { present: false }; }
  for (const name of names) {
    if (!/\.jar$/i.test(name) || !/gender|wildfire/i.test(name)) continue;
    const info = readModInfo(path.join(modsDir, name));
    if (!info || !(MOD_IDS.has(info.id) || /female.?gender|wildfire.?gender/i.test(info.id))) continue;
    const config = path.join(gameDir, 'config');
    let format;
    if (fs.existsSync(path.join(config, FORMATS.v5.dir))) format = 'v5';
    else if (fs.existsSync(path.join(config, FORMATS.v3.dir))) format = 'v3';
    else format = majorOf(info.version, name) >= 5 ? 'v5' : 'v3';
    return { present: true, version: info.version, file: name, format };
  }
  return { present: false };
}

function playerFile(gameDir, format, accountId) {
  if (!HEX32.test(String(accountId))) throw new Error('Некорректный идентификатор аккаунта');
  return path.join(gameDir, 'config', FORMATS[format].dir, `${dashed(accountId)}.json`);
}

// ---- reading / writing ----
const genderIndex = (v) => {
  if (typeof v === 'number' && v >= 0 && v < GENDERS.length) return Math.trunc(v);
  const i = GENDERS.indexOf(String(v).toLowerCase());
  return i >= 0 ? i : 0;
};

// The file's content as the window's settings (only the fields that exist in this format; missing ones get the defaults)
function toSettings(format, data) {
  const out = {};
  for (const [key, def] of Object.entries(FIELDS)) {
    if (!def.formats.includes(format)) continue;
    const v = data ? data[key] : undefined;
    if (def.type === 'gender') out[key] = GENDERS[genderIndex(v === undefined ? DEFAULTS.gender : v)];
    else if (def.type === 'bool') out[key] = typeof v === 'boolean' ? v : DEFAULTS[key];
    else out[key] = typeof v === 'number' && Number.isFinite(v) ? v : DEFAULTS[key];
  }
  return out;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { return null; }
}

function read(gameDir, accountId) {
  const mod = inspectInstance(gameDir);
  if (!mod.present) return { ok: true, present: false };
  const file = playerFile(gameDir, mod.format, accountId);
  const data = fs.existsSync(file) ? readJson(file) : null;
  // the texture layouts of the breasts (5.x files carry them): the picture of the character uses the player's own
  const uv = {};
  if (data) for (const k of Object.keys(V5_UV)) if (data[k] && typeof data[k] === 'object') uv[k] = data[k];
  return { ok: true, present: true, format: mod.format, version: mod.version, exists: !!data, settings: toSettings(mod.format, data), uv: Object.keys(uv).length ? uv : null };
}

// Checks one incoming value against its field; returns { ok, value }
function clean(def, v) {
  if (def.type === 'bool') return typeof v === 'boolean' ? { ok: true, value: v } : { ok: false };
  if (def.type === 'gender') return GENDERS.includes(v) ? { ok: true, value: GENDERS.indexOf(v) } : { ok: false };
  if (typeof v !== 'number' || !Number.isFinite(v)) return { ok: false };
  return { ok: true, value: Math.round(Math.min(def.max, Math.max(def.min, v)) * 1e6) / 1e6 };
}

// Texture layout of the breasts that a 5.x file also carries (the mod's own defaults, as in a file the mod itself wrote)
const face = (x1, y1, x2, y2) => ({ x1, y1, x2, y2 });
const V5_UV = {
  leftBreastUVLayout: { east: face(24, 21, 27, 26), west: face(16, 21, 20, 26), down: face(20, 17, 24, 21), up: face(20, 25, 24, 27), north: face(20, 21, 24, 26) },
  rightBreastUVLayout: { east: face(28, 21, 32, 26), west: face(21, 21, 24, 26), down: face(24, 17, 28, 21), up: face(24, 25, 28, 27), north: face(24, 21, 28, 26) },
  leftBreastOverlayUVLayout: { east: face(0, 0, 0, 0), west: face(17, 37, 20, 42), down: face(20, 34, 24, 37), up: face(20, 42, 24, 45), north: face(20, 37, 24, 42) },
  rightBreastOverlayUVLayout: { east: face(28, 37, 31, 42), west: face(0, 0, 0, 0), down: face(24, 34, 28, 37), up: face(24, 42, 28, 45), north: face(24, 37, 28, 42) },
};

// Template for a player who has no file yet in this instance
function template(format, accountId) {
  const t = {};
  if (format === 'v3') t.username = dashed(accountId);
  for (const [key, def] of Object.entries(FIELDS)) if (def.formats.includes(format)) t[key] = DEFAULTS[key];
  if (format === 'v5') Object.assign(t, JSON.parse(JSON.stringify(V5_UV)));
  return t;
}

// Writes the given settings into the player's file of one instance (other fields of the file stay as they are).
function write(gameDir, accountId, settings) {
  const mod = inspectInstance(gameDir);
  if (!mod.present) return { ok: false, error: 'В сборке нет мода Female Gender' };
  const file = playerFile(gameDir, mod.format, accountId);
  const existing = fs.existsSync(file) ? readJson(file) : null;
  if (fs.existsSync(file) && !existing) return { ok: false, error: 'File настроек мода повреждён: не трогаю его' };
  const data = existing || template(mod.format, accountId);
  let changed = 0;
  for (const [key, def] of Object.entries(FIELDS)) {
    if (!def.formats.includes(mod.format) || !settings || !(key in settings)) continue;
    const c = clean(def, settings[key]);
    if (!c.ok) return { ok: false, error: `Недопустимое значение: ${key}` };
    // a text gender ("female") stays text if the file already uses text
    data[key] = def.type === 'gender' && typeof data[key] === 'string' ? GENDERS[c.value] : c.value;
    changed += 1;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (existing) { try { fs.copyFileSync(file, `${file}.zorya-bak`); } catch { /* a failed copy must not stop saving */ } }
  const tmp = `${file}.zorya-tmp`;
  fs.writeFileSync(tmp, mod.format === 'v3' ? JSON.stringify(data) : JSON.stringify(data, null, '\t'));
  fs.renameSync(tmp, file);
  return { ok: true, changed, format: mod.format };
}

// Instances that have the mod: [{ id, name, mcVersion, loader, format, version }]
function detect(instances) {
  const out = [];
  for (const inst of instances || []) {
    let gameDir;
    try { gameDir = paths.instanceGameDir(inst.id); } catch { continue; }
    const mod = inspectInstance(gameDir);
    if (mod.present) out.push({ id: inst.id, name: inst.name, mcVersion: inst.mcVersion, loader: inst.loader, format: mod.format, version: mod.version });
  }
  return out;
}

module.exports = { detect, read, write, inspectInstance, readModInfo, FIELDS, GENDERS, majorOf, toSettings, dashed };
