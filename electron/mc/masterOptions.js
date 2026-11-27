// "Эталон настроек игры": remember a safe part of one build's options.txt (language, sound, view distance, FOV, keys, ...) and give it to
// new builds, so nobody has to set the same things up again and again.
//
// How it is applied (and why in two steps):
//   1. FIRST launch of a new build (no options.txt yet): only the plain, version-independent settings are written (language, sound,
//      distance, FPS, GUI scale, ...). The game has not saved its own file yet, and a file without its "version:" line is run through
//      the game's old-format converters, so nothing the converters touch (key bindings, FOV, graphics) is written at this point.
//   2. NEXT launch (the game has written its own options.txt with "version:"): the rest is merged in — graphics, FOV and key bindings.
//      These differ between the pre-1.13 and the newer games, so they are only copied between builds of the same "era".
// The button "Apply эталон" does step 2 at once, for a build that is not running (the old file is kept as options.txt.zorya-bak).
// Only a fixed list of keys is ever stored or written, and every value must be plain printable text: nothing else can get into the file.
const fs = require('fs');
const path = require('path');

const LANGS = ['ru_ru', 'uk_ua', 'be_by', 'kk_kz', 'en_us', 'en_gb', 'de_de', 'fr_fr', 'es_es', 'it_it', 'pl_pl', 'pt_br', 'tr_tr', 'zh_cn', 'ja_jp', 'ko_kr'];

// Safe to write before the game has created its own file.
const FIRST_KEYS = new Set([
  'renderDistance', 'maxFps', 'guiScale', 'sensitivity', 'fullscreen', 'autoJump', 'showSubtitles', 'enableVsync',
  'chatOpacity', 'chatScale', 'chatVisibility', 'chatColors', 'chatLinks', 'chatLinksPrompt',
]);
const FIRST_RE = /^soundCategory_(master|music|record|weather|block|hostile|neutral|player|ambient|voice)$/;
// Merged in after the game has written its file (see the header).
const LATER_KEYS = new Set([
  'particles', 'entityShadows', 'mipmapLevels', 'biomeBlendRadius', 'bobView', 'viewBobbing', 'reducedDebugInfo', 'invertYMouse',
  'forceUnicodeFont',
]);
// Meaning/format differs between the old (before 1.13) and the newer games: copied only inside the same era.
const ERA_KEYS = new Set(['fov', 'ao', 'renderClouds', 'graphicsMode', 'fancyGraphics']);
const KEYBIND_RE = /^key_[A-Za-z0-9_.-]{1,80}$/;
const VALUE_RE = /^[\x20-\x7E]{0,200}$/;

const isFirstKey = (k) => FIRST_KEYS.has(k) || FIRST_RE.test(k);
const isEraKey = (k) => ERA_KEYS.has(k) || KEYBIND_RE.test(k);
const isAllowedKey = (k) => isFirstKey(k) || LATER_KEYS.has(k) || isEraKey(k);
const validValue = (v) => typeof v === 'string' && VALUE_RE.test(v);

// 'legacy' = before 1.13 (numeric key codes, old FOV scale), 'modern' = 1.13 and newer (including the 26.x numbering).
function eraOf(mcVersion) {
  const s = String(mcVersion || '');
  let m = /^1\.(\d+)/.exec(s);
  if (m) return Number(m[1]) >= 13 ? 'modern' : 'legacy';
  m = /^(\d\d)w\d\d/.exec(s);
  if (m) return Number(m[1]) >= 17 ? 'modern' : 'legacy';
  if (/^(a|b|c|inf-|rd-)/i.test(s)) return 'legacy';
  return 'modern';
}

// Before 1.11 the language code is written as ru_RU, from 1.11 on as ru_ru.
function langFor(mcVersion, code) {
  if (!LANGS.includes(code)) return null;
  const s = String(mcVersion || '');
  let old = false;
  const m = /^1\.(\d+)/.exec(s);
  if (m) old = Number(m[1]) < 11;
  else if (/^(\d\d)w\d\d/.test(s)) old = Number(/^(\d\d)w/.exec(s)[1]) < 16;
  else if (/^(a|b|c|inf-|rd-)/i.test(s)) old = true;
  if (!old) return code;
  const [a, b] = code.split('_');
  return `${a}_${b.toUpperCase()}`;
}

// ---------- options.txt text ----------
function readEntries(text) {
  const map = new Map();
  for (const line of String(text || '').split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) map.set(line.slice(0, i), line.slice(i + 1));
  }
  return map;
}

// Replaces the values of keys that are already there, appends the rest; every other line stays as it was.
function mergeOptions(text, entries) {
  const nl = /\r\n/.test(text) ? '\r\n' : '\n';
  const lines = text ? text.split(/\r?\n/) : [];
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const seen = new Set();
  let changed = 0;
  const out = lines.map((line) => {
    const i = line.indexOf(':');
    if (i <= 0) return line;
    const key = line.slice(0, i);
    if (!Object.prototype.hasOwnProperty.call(entries, key)) return line;
    seen.add(key);
    if (line.slice(i + 1) !== entries[key]) changed += 1;
    return `${key}:${entries[key]}`;
  });
  for (const key of Object.keys(entries)) {
    if (!seen.has(key)) { out.push(`${key}:${entries[key]}`); changed += 1; }
  }
  return { text: out.join(nl) + nl, changed };
}

// The allowed settings of an options.txt text: { key: value }.
function pickAllowed(text) {
  const out = {};
  for (const [k, v] of readEntries(text)) {
    if (isAllowedKey(k) && validValue(v)) out[k] = v;
  }
  return out;
}

// ---------- the stored template ----------
const KEY = 'masterOptions';
const DEFAULTS = { enabled: false, lang: '', entries: {}, era: null, source: null };

function getMaster(store) {
  const m = store.get(KEY) || {};
  const entries = {};
  for (const [k, v] of Object.entries(m.entries || {})) if (isAllowedKey(k) && validValue(v)) entries[k] = v;
  return {
    enabled: m.enabled === true,
    lang: LANGS.includes(m.lang) ? m.lang : '',
    entries,
    era: m.era === 'legacy' || m.era === 'modern' ? m.era : null,
    source: m.source && typeof m.source === 'object' ? { name: String(m.source.name || '').slice(0, 80), mcVersion: String(m.source.mcVersion || '').slice(0, 40), at: Number(m.source.at) || 0 } : null,
  };
}

function summary(store) {
  const m = getMaster(store);
  return { enabled: m.enabled, lang: m.lang, hasTemplate: Object.keys(m.entries).length > 0, count: Object.keys(m.entries).length, era: m.era, source: m.source };
}

function setMaster(store, patch) {
  const m = getMaster(store);
  if (patch && typeof patch.enabled === 'boolean') m.enabled = patch.enabled;
  if (patch && typeof patch.lang === 'string') m.lang = LANGS.includes(patch.lang) ? patch.lang : '';
  store.set(KEY, { ...DEFAULTS, ...m });
  return summary(store);
}

function clearTemplate(store) {
  const m = getMaster(store);
  store.set(KEY, { ...DEFAULTS, enabled: m.enabled, lang: m.lang });
  return summary(store);
}

// Remembers the settings of one build (its options.txt must exist: the game has to have been started once).
function capture(store, instance, gameDir) {
  const file = path.join(gameDir, 'options.txt');
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return { ok: false, error: 'У этой сборки ещё нет файла настроек игры: запустите её один раз и выйдите из игры.' }; }
  const entries = pickAllowed(text);
  if (!Object.keys(entries).length) return { ok: false, error: 'В настройках игры не нашлось ничего, что можно запомнить.' };
  const m = getMaster(store);
  const lang = readEntries(text).get('lang');
  const code = lang ? lang.toLowerCase() : '';
  store.set(KEY, {
    ...DEFAULTS, enabled: m.enabled, lang: LANGS.includes(code) ? code : m.lang,
    entries, era: eraOf(instance.mcVersion), source: { name: instance.name, mcVersion: instance.mcVersion, at: Date.now() },
  });
  return { ok: true, ...summary(store) };
}

// What goes into a build of this Minecraft version: stage 'first' = the plain part (+ language), 'full' = everything that fits its era.
function entriesFor(master, mcVersion, stage) {
  const out = {};
  const sameEra = master.era && master.era === eraOf(mcVersion);
  for (const [k, v] of Object.entries(master.entries)) {
    if (isFirstKey(k)) out[k] = v;
    else if (stage === 'full' && LATER_KEYS.has(k)) out[k] = v;
    else if (stage === 'full' && isEraKey(k) && sameEra) out[k] = v;
  }
  const lang = langFor(mcVersion, master.lang);
  if (lang) out.lang = lang;
  return out;
}

// ---------- applying ----------
// Before a launch. Returns { applied, stage? , reason? } and keeps the build's own flag so that it is done once.
function applyOnLaunch(store, instance, gameDir) {
  if (!instance || instance.loader === 'horizon') return { applied: false, reason: 'horizon' };
  // A build "used in place" lives in another launcher's folder: nothing is written there by itself (the button in the build's settings still works).
  if (instance.externalGameDir) return { applied: false, reason: 'external' };
  const state = instance.masterOptionsState;
  if (state === 'done') return { applied: false, reason: 'done' };
  const master = getMaster(store);
  if (!master.enabled) return { applied: false, reason: 'off' };
  const file = path.join(gameDir, 'options.txt');
  const setState = (s) => {
    const list = store.get('instances') || [];
    const cur = list.find((i) => i.id === instance.id);
    if (cur) { cur.masterOptionsState = s; store.set('instances', list); }
  };
  if (state === 'pending') {
    // Step 2: the game has written its own file by now (it has a "version:" line).
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch { return { applied: false, reason: 'waiting' }; }
    if (!readEntries(text).has('version')) return { applied: false, reason: 'waiting' };
    const { text: next, changed } = mergeOptions(text, entriesFor(master, instance.mcVersion, 'full'));
    if (changed) fs.writeFileSync(file, next);
    setState('done');
    return { applied: true, stage: 'full', changed };
  }
  // Step 1: a build that has no options.txt yet. One that came with its own file (a modpack, an import) is left alone.
  if (fs.existsSync(file)) { setState('done'); return { applied: false, reason: 'has-file' }; }
  // Before 1.13 the game has no old-format converters (and older ones have no "version:" line at all): everything goes in at once.
  const stage = eraOf(instance.mcVersion) === 'legacy' ? 'full' : 'first';
  const entries = entriesFor(master, instance.mcVersion, stage);
  if (!Object.keys(entries).length) { setState('done'); return { applied: false, reason: 'nothing' }; }
  fs.mkdirSync(gameDir, { recursive: true });
  fs.writeFileSync(file, mergeOptions('', entries).text);
  setState(stage === 'full' ? 'done' : 'pending');
  return { applied: true, stage, changed: Object.keys(entries).length };
}

// The button: everything that fits, into the existing file (kept as options.txt.zorya-bak once).
function applyNow(store, instance, gameDir) {
  if (!instance || instance.loader === 'horizon') return { ok: false, error: 'Для сборок Horizon это не поддерживается.' };
  const master = getMaster(store);
  const entries = entriesFor(master, instance.mcVersion, 'full');
  if (!Object.keys(entries).length) return { ok: false, error: 'Эталон не задан: сначала запомните настройки одной из сборок или выберите язык.' };
  const file = path.join(gameDir, 'options.txt');
  let text = '';
  let existed = true;
  try { text = fs.readFileSync(file, 'utf8'); } catch { existed = false; }
  if (!existed) {
    // No file yet: only the plain part (see the header for why), the rest follows at a later launch.
    const legacy = eraOf(instance.mcVersion) === 'legacy';
    const first = entriesFor(master, instance.mcVersion, legacy ? 'full' : 'first');
    fs.mkdirSync(gameDir, { recursive: true });
    fs.writeFileSync(file, mergeOptions('', first).text);
    const list = store.get('instances') || [];
    const cur = list.find((i) => i.id === instance.id);
    if (cur) { cur.masterOptionsState = legacy ? 'done' : 'pending'; store.set('instances', list); }
    return { ok: true, changed: Object.keys(first).length, note: legacy ? 'У сборки ещё не было файла настроек: записан весь эталон.' : 'У сборки ещё не было файла настроек: записана основная часть, остальное применится перед следующим запуском.' };
  }
  const bak = `${file}.zorya-bak`;
  try { if (!fs.existsSync(bak)) fs.copyFileSync(file, bak); } catch { /* the backup is a courtesy */ }
  const { text: next, changed } = mergeOptions(text, entries);
  if (changed) fs.writeFileSync(file, next);
  const list = store.get('instances') || [];
  const cur = list.find((i) => i.id === instance.id);
  if (cur) { cur.masterOptionsState = 'done'; store.set('instances', list); }
  return { ok: true, changed };
}

module.exports = {
  LANGS, getMaster, summary, setMaster, clearTemplate, capture, applyOnLaunch, applyNow,
  _test: { eraOf, langFor, mergeOptions, pickAllowed, readEntries, entriesFor, isAllowedKey, isFirstKey, isEraKey },
};
