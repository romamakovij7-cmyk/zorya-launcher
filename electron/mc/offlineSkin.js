// Skins for offline accounts.
//
// An offline account has no Mojang profile, so the game never downloads a
// skin for it: the client just shows one of its built-in default skins, picked
// from the player's UUID. We hook exactly that lookup: before launch we build
// a tiny resource pack that replaces the one default-skin texture this UUID
// resolves to with the skin the user picked, and switch the pack on in
// options.txt. No mods, no servers, works on every version from 1.6.1 up.
//
// What the pack has to get right (all handled here):
//   * WHICH texture — 1.19.3+ picks one of 18 (slim/wide x 9 names) by
//     floorMod(uuid.hashCode(), 18); 1.8-1.19.2 picks alex/steve by hash & 1;
//     1.6-1.7 only have steve.
//   * the arm model — it is fixed by that texture (slim/ or wide/), not by the
//     skin, so the picked skin's arms are re-laid out to fit when they differ.
//   * the format — pre-1.8 wants 64x32, newer 64x64 (legacy skins get upgraded
//     the same way the game does it), and the pack's own pack_format comes
//     from the game jar so it always matches.
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { decodePng } = require('./pngLite');
const { encodePng } = require('./worldmap/regionRender');

const PACK_FILE = 'ZoryaLauncher-skin.zip';
const MODERN_NAMES = ['alex', 'ari', 'efe', 'kai', 'makena', 'noor', 'steve', 'sunny', 'zuri'];

// java.util.UUID#hashCode
function uuidHash(uuid) {
  const hex = String(uuid).replace(/-/g, '');
  const msb = BigInt(`0x${hex.slice(0, 16)}`);
  const lsb = BigInt(`0x${hex.slice(16, 32)}`);
  const hilo = BigInt.asIntN(64, msb ^ lsb);
  const hi = Number(BigInt.asIntN(32, hilo >> 32n));
  const lo = Number(BigInt.asIntN(32, hilo));
  return (hi ^ lo) | 0;
}

// ---- pixel work --------------------------------------------------------------

function newImage(w, h) {
  return { w, h, d: Buffer.alloc(w * h * 4) };
}

function fromPng(buf) {
  // The size is in the PNG header: a picture far bigger than any skin is refused before it is unpacked in memory
  if (buf.length < 24 || buf.readUInt32BE(16) > 2048 || buf.readUInt32BE(20) > 2048) throw new Error('Skin слишком большой (допустимо до 2048×2048).');
  const { width, height, data } = decodePng(buf);
  return { w: width, h: height, d: data };
}

const px = (img, x, y) => (y * img.w + x) * 4;

function copyRect(img, s, x, y, xo, yo, wd, ht, flipH) {
  for (let j = 0; j < ht * s; j++) {
    for (let i = 0; i < wd * s; i++) {
      const sx = x * s + i;
      const sy = y * s + j;
      const dx = (x + xo) * s + (flipH ? wd * s - 1 - i : i);
      const dy = (y + yo) * s + j;
      img.d.copy(img.d, px(img, dx, dy), px(img, sx, sy), px(img, sx, sy) + 4);
    }
  }
}

function setOpaque(img, s, x0, y0, x1, y1) {
  for (let y = y0 * s; y < y1 * s; y++) {
    for (let x = x0 * s; x < x1 * s; x++) img.d[px(img, x, y) + 3] = 255;
  }
}

// 64x32 (pre-1.8 layout) -> 64x64: the left arm/leg are mirrored copies of the
// right ones — same steps the game applies to old skins.
function upgradeLegacy(img) {
  const s = img.w / 64;
  const out = newImage(img.w, img.w);
  img.d.copy(out.d, 0, 0, img.d.length);
  setOpaque(out, s, 0, 0, 32, 16);
  const steps = [
    [4, 16, 16, 32, 4, 4], [8, 16, 16, 32, 4, 4], [0, 20, 24, 32, 4, 12], [4, 20, 16, 32, 4, 12],
    [8, 20, 8, 32, 4, 12], [12, 20, 16, 32, 4, 12], [44, 16, -8, 32, 4, 4], [48, 16, -8, 32, 4, 4],
    [40, 20, 0, 32, 4, 12], [44, 20, -8, 32, 4, 12], [48, 20, -16, 32, 4, 12], [52, 20, -8, 32, 4, 12],
  ];
  for (const [x, y, xo, yo, w, h] of steps) copyRect(out, s, x, y, xo, yo, w, h, true);
  return out;
}

// 64x64 -> 64x32 for the oldest versions (keeps head, body, right arm/leg).
function downgradeToLegacy(img) {
  const out = newImage(img.w, img.w / 2);
  img.d.copy(out.d, 0, 0, out.d.length);
  return out;
}

// The game forces the base layers of a skin opaque; do the same because a
// default-skin texture doesn't go through that step.
function opaqueBase(img) {
  const s = img.w / 64;
  // The head: the top and bottom (8..24 × 0..8) and the four sides (0..32 × 8..16). The corners 0..8 × 0..8 and 24..32 × 0..8 are not part of
  // the model; Fresh Moves keeps the pixels of the eyes there (see freshMoves.js), so they stay as the skin has them.
  setOpaque(img, s, 8, 0, 24, 8);
  setOpaque(img, s, 0, 8, 32, 16);
  setOpaque(img, s, 0, 16, 64, 32);
  setOpaque(img, s, 16, 48, 48, 64);
}

// Re-lays out the four arm blocks (arm + sleeve, right + left) between the
// 4px "wide" and 3px "slim" layouts.
function convertArms(img, fromSlim, toSlim) {
  if (fromSlim === toSlim) return;
  const s = img.w / 64;
  const wSrc = fromSlim ? 3 : 4;
  const wDst = toSlim ? 3 : 4;
  for (const [ox, oy] of [[40, 16], [40, 32], [32, 48], [48, 48]]) {
    const snap = Buffer.alloc(16 * s * 16 * s * 4);
    for (let y = 0; y < 16 * s; y++) {
      for (let x = 0; x < 16 * s; x++) {
        img.d.copy(snap, (y * 16 * s + x) * 4, px(img, ox * s + x, oy * s + y), px(img, ox * s + x, oy * s + y) + 4);
      }
    }
    // clear the block, then paint each face at its new width
    for (let y = 0; y < 16 * s; y++) {
      for (let x = 0; x < 16 * s; x++) img.d.fill(0, px(img, ox * s + x, oy * s + y), px(img, ox * s + x, oy * s + y) + 4);
    }
    const faces = [
      { dx: 4, sx: 4, dw: wDst, sw: wSrc, y0: 0, h: 4 }, // top
      { dx: 4 + wDst, sx: 4 + wSrc, dw: wDst, sw: wSrc, y0: 0, h: 4 }, // bottom
      { dx: 0, sx: 0, dw: 4, sw: 4, y0: 4, h: 12 }, // outer side
      { dx: 4, sx: 4, dw: wDst, sw: wSrc, y0: 4, h: 12 }, // front
      { dx: 4 + wDst, sx: 4 + wSrc, dw: 4, sw: 4, y0: 4, h: 12 }, // inner side
      { dx: 8 + wDst, sx: 8 + wSrc, dw: wDst, sw: wSrc, y0: 4, h: 12 }, // back
    ];
    for (const f of faces) {
      const dstCols = f.dw * s;
      const srcCols = f.sw * s;
      for (let y = f.y0 * s; y < (f.y0 + f.h) * s; y++) {
        for (let c = 0; c < dstCols; c++) {
          const sc = Math.min(srcCols - 1, Math.floor(((c + 0.5) * srcCols) / dstCols));
          const from = (y * 16 * s + f.sx * s + sc) * 4;
          snap.copy(img.d, px(img, ox * s + f.dx * s + c, oy * s + y), from, from + 4);
        }
      }
    }
  }
}

// Ready-to-use PNG for a slot that needs `slim` arms (and optionally the old
// 64x32 layout).
function prepareSkin(skinPng, skinIsSlim, slotIsSlim, legacy32) {
  let img = fromPng(skinPng);
  if (img.w < 64 || img.w % 64 !== 0 || (img.h !== img.w && img.h !== img.w / 2)) {
    throw new Error(`Skin должен быть 64×64 (или 64×32), а у этого ${img.w}×${img.h}.`);
  }
  if (img.h === img.w / 2) img = upgradeLegacy(img);
  opaqueBase(img);
  convertArms(img, skinIsSlim, slotIsSlim);
  opaqueBase(img);
  if (legacy32) img = downgradeToLegacy(img);
  return encodePng(img.d, img.w, img.h);
}

// ---- game version facts -------------------------------------------------------

function parseMinor(mcVersion) {
  const m = /^1\.(\d+)/.exec(String(mcVersion || ''));
  return m ? Number(m[1]) : null; // null = snapshot / year-based version (very new)
}

// Which default-skin textures does this game jar have?
function detectLayout(zip) {
  const has = (n) => !!zip.getEntry(n);
  if (has('assets/minecraft/textures/entity/player/wide/steve.png')) return 'modern';
  if (has('assets/minecraft/textures/entity/alex.png')) return 'alexsteve';
  if (has('assets/minecraft/textures/entity/steve.png')) return 'steve';
  return null;
}

function packMcmeta(zip, mcVersion) {
  let version = null;
  try {
    const e = zip.getEntry('version.json');
    if (e) version = JSON.parse(e.getData().toString('utf8')).pack_version;
  } catch { /* fall back to the version table below */ }
  const description = 'Skin оффлайн-аккаунта (Zorya Launcher)';
  if (version && typeof version === 'object' && version.resource_major != null) {
    // 1.21.9+: a format range instead of a single number
    return { pack: { description, min_format: version.resource_major, max_format: version.resource_major } };
  }
  let format = null;
  if (typeof version === 'number') format = version;
  else if (version && typeof version === 'object' && version.resource != null) format = version.resource;
  if (format == null) {
    const minor = parseMinor(mcVersion) ?? 12;
    format = minor <= 8 ? 1 : minor <= 10 ? 2 : 3;
  }
  return { pack: { pack_format: format, description } };
}

// ---- options.txt ---------------------------------------------------------------

function packEntry(mcVersion, packFile = PACK_FILE) {
  const minor = parseMinor(mcVersion);
  return minor !== null && minor < 13 ? packFile : `file/${packFile}`;
}

// packFile: another of our packs (e.g. the hearts pack) can be switched on/off the same way
function setPackEnabled(gameDir, mcVersion, enabled, packFile = PACK_FILE) {
  const file = path.join(gameDir, 'options.txt');
  const entry = packEntry(mcVersion, packFile);
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { /* first launch: no options yet */ }
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.length ? text.split(/\r?\n/) : [];
  let idx = lines.findIndex((l) => l.startsWith('resourcePacks:'));
  let list = [];
  if (idx >= 0) {
    try { list = JSON.parse(lines[idx].slice('resourcePacks:'.length)); } catch { list = []; }
    if (!Array.isArray(list)) list = [];
  }
  const cleaned = list.filter((n) => n !== entry && n !== packFile && n !== `file/${packFile}`);
  let next = cleaned;
  if (enabled) {
    if (parseMinor(mcVersion) === null || parseMinor(mcVersion) >= 13) {
      if (!cleaned.includes('vanilla')) cleaned.unshift('vanilla');
    }
    next = [...cleaned, entry]; // last = highest priority
  }
  if (idx < 0 && !enabled) return; // nothing to add and nothing to remove
  if (JSON.stringify(next) === JSON.stringify(list) && idx >= 0) return;
  const line = `resourcePacks:${JSON.stringify(next)}`;
  if (idx >= 0) lines[idx] = line;
  else lines.push(line);
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  fs.mkdirSync(gameDir, { recursive: true });
  fs.writeFileSync(file, `${lines.join(eol)}${eol}`);
}

// ---- entry point ----------------------------------------------------------------

// Builds the pack for this account/skin and enables it — or, with no skin,
// removes it again. Returns a short status object; never throws for "normal"
// problems (unsupported version etc.), so launching is never blocked by it.
function sync({ gameDir, mcVersion, jarPath, uuid, skin }) {
  const packDir = path.join(gameDir, 'resourcepacks');
  const packPath = path.join(packDir, PACK_FILE);
  const remove = () => {
    try { setPackEnabled(gameDir, mcVersion, false); } catch { /* options.txt unreadable */ }
    try { fs.rmSync(packPath, { force: true }); } catch { /* already gone */ }
  };
  if (!skin) { remove(); return { ok: true, active: false }; }

  let zip;
  try {
    zip = new AdmZip(jarPath);
  } catch (err) {
    return { ok: false, error: `failed открыть jar игры: ${err.message}` };
  }
  const layout = detectLayout(zip);
  if (!layout) { remove(); return { ok: false, error: 'эта Minecraft version не поддерживает подмену скина' }; }

  const hash = uuidHash(uuid);
  const out = new AdmZip();
  let target;
  try {
    if (layout === 'modern') {
      const idx = ((hash % 18) + 18) % 18;
      const slim = idx < 9;
      target = `assets/minecraft/textures/entity/player/${slim ? 'slim' : 'wide'}/${MODERN_NAMES[idx % 9]}.png`;
      out.addFile(target, prepareSkin(skin.buf, skin.slim, slim, false));
    } else if (layout === 'alexsteve') {
      const slim = (hash & 1) === 1;
      target = `assets/minecraft/textures/entity/${slim ? 'alex' : 'steve'}.png`;
      out.addFile(target, prepareSkin(skin.buf, skin.slim, slim, false));
    } else {
      target = 'assets/minecraft/textures/entity/steve.png';
      out.addFile(target, prepareSkin(skin.buf, skin.slim, false, true));
    }
  } catch (err) {
    remove();
    return { ok: false, error: err.message };
  }
  out.addFile('pack.mcmeta', Buffer.from(JSON.stringify(packMcmeta(zip, mcVersion), null, 2)));

  fs.mkdirSync(packDir, { recursive: true });
  const tmp = `${packPath}.tmp`;
  out.writeZip(tmp);
  fs.renameSync(tmp, packPath);
  setPackEnabled(gameDir, mcVersion, true);
  return { ok: true, active: true, target };
}

module.exports = { sync, uuidHash, prepareSkin, packMcmeta, setPackEnabled, PACK_FILE };
