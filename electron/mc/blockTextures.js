const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const paths = require('./paths');
const versions = require('./versions');
const { resolveBlockParts, cubeElement } = require('./blockModels');

// Grass/foliage textures in the real game are grayscale masks tinted per-
// biome at render time (via a colormap lookup). We don't model biomes, so
// this is a fixed "plains-ish" color per block, applied to whichever model
// faces are flagged with a tintindex — an approximation, not real biome
// color.
const GRASS_TINT = 0x91bd59;
const FOLIAGE_TINT = 0x77ab2f;
const TINT_COLORS = {
  grass_block: GRASS_TINT,
  grass: GRASS_TINT,
  short_grass: GRASS_TINT,
  tall_grass: GRASS_TINT,
  fern: GRASS_TINT,
  large_fern: GRASS_TINT,
  vine: FOLIAGE_TINT,
  sugar_cane: FOLIAGE_TINT,
  oak_leaves: FOLIAGE_TINT,
  jungle_leaves: FOLIAGE_TINT,
  acacia_leaves: FOLIAGE_TINT,
  dark_oak_leaves: FOLIAGE_TINT,
  mangrove_leaves: FOLIAGE_TINT,
  azalea_leaves: FOLIAGE_TINT,
  flowering_azalea_leaves: FOLIAGE_TINT,
  // Birch/spruce foliage use their own fixed (non-biome) tones in-game.
  birch_leaves: 0x80a755,
  spruce_leaves: 0x619961,
};

// Last-resort fallback (no blockstate/model at all — modded blocks, odd
// names): guess a same-named texture file and put it on a plain cube.
const FACE_SUFFIXES = ['_top', '_side', '_front', '_all', '_still'];
const REUSE_SUFFIXES = [
  '_stairs', '_slab', '_wall', '_fence_gate', '_fence',
  '_pressure_plate', '_button', '_door', '_trapdoor',
];

function baseBlockName(fullName) {
  const idx = fullName.indexOf(':');
  return idx >= 0 ? fullName.slice(idx + 1) : fullName;
}

function candidateNames(base) {
  const out = [base];
  for (const suf of FACE_SUFFIXES) out.push(base + suf);
  for (const suf of REUSE_SUFFIXES) {
    if (base.endsWith(suf) && base.length > suf.length) {
      const stripped = base.slice(0, -suf.length);
      out.push(stripped, `${stripped}_planks`);
    }
  }
  return out;
}

function makeTextureLoader(zip) {
  const cache = new Map();
  return (name) => {
    if (!name) return null;
    if (cache.has(name)) return cache.get(name);
    // Names normally are relative to textures/block/ (1.13+; textures/blocks/
    // before that); a path with a slash (item/...) is relative to textures/.
    const entry = (name.includes('/') && zip.getEntry(`assets/minecraft/textures/${name}.png`))
      || zip.getEntry(`assets/minecraft/textures/block/${name}.png`)
      || zip.getEntry(`assets/minecraft/textures/blocks/${name}.png`);
    const dataUrl = entry ? `data:image/png;base64,${entry.getData().toString('base64')}` : null;
    cache.set(name, dataUrl);
    return dataUrl;
  };
}

// The instance's own version's client jar is the right source, but it may
// be unknown to the manifest, not downloadable right now, or ancient — fall
// back to whichever vanilla client jar is already in the shared versions
// folder rather than giving up on textures wholesale.
async function openClientJar(mcVersion) {
  try {
    const vanillaJson = await versions.getVersionJson(mcVersion);
    const jarPath = await versions.downloadClient(vanillaJson);
    return new AdmZip(jarPath);
  } catch (primaryErr) {
    const root = paths.versionsDir();
    let candidates = [];
    try {
      candidates = fs.readdirSync(root, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => path.join(root, d.name, `${d.name}.jar`))
        .filter((p) => fs.existsSync(p))
        .map((p) => ({ p, mtime: fs.statSync(p).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
    } catch { /* rethrow below */ }
    if (candidates.length === 0) throw primaryErr;
    return new AdmZip(candidates[0].p);
  }
}

// blocks: array of { key, name, props }.
// Returns { blocks, textures }:
//   blocks[key] = { parts: [{ rotX, rotY, elements: [...] }], tint }
//   textures[path] = data URL (shared by every block that uses it)
// A key with no entry in `blocks` falls back to a flat-colored cube.
async function getTexturesForBlocks(mcVersion, blockList) {
  const zip = await openClientJar(mcVersion);
  const loadTexture = makeTextureLoader(zip);
  const modelCache = new Map();

  const blocks = {};
  const textures = {};
  const register = (tex) => {
    if (tex in textures) return true;
    const dataUrl = loadTexture(tex);
    if (!dataUrl) return false;
    textures[tex] = dataUrl;
    return true;
  };

  const seen = new Set();
  for (const { key, name, props } of blockList) {
    if (seen.has(key)) continue;
    seen.add(key);
    // One odd block (bad JSON, unexpected shape...) shouldn't take the
    // whole schematic's textures down with it.
    try {
      const base = baseBlockName(name);
      const tint = TINT_COLORS[base] || null;

      const parts = resolveBlockParts(zip, modelCache, name, props || {});
      if (parts) {
        // Drop faces whose texture file doesn't exist, then anything left
        // empty — so a partially-resolvable model still renders what it can.
        const usable = [];
        for (const part of parts) {
          const elements = [];
          for (const el of part.elements) {
            const faces = {};
            for (const [dir, face] of Object.entries(el.faces)) {
              if (register(face.tex)) faces[dir] = face;
            }
            if (Object.keys(faces).length) elements.push({ ...el, faces });
          }
          if (elements.length) usable.push({ ...part, elements });
        }
        if (usable.length) {
          blocks[key] = { parts: usable, tint };
          continue;
        }
      }

      for (const candidate of candidateNames(base)) {
        if (register(candidate)) {
          const face = { uv: null, tex: candidate, rotation: 0, tint: !!tint };
          const cube = cubeElement(candidate);
          for (const dir of Object.keys(cube.faces)) cube.faces[dir] = face;
          blocks[key] = { parts: [{ rotX: 0, rotY: 0, elements: [cube] }], tint };
          break;
        }
      }
    } catch {
      /* skip this block — it just falls back to a flat color */
    }
  }
  return { blocks, textures };
}

module.exports = { getTexturesForBlocks };
