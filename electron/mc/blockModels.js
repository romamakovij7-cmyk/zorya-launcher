// Resolves a block's real geometry the same way the game does: the block's
// blockstate JSON picks model(s) for its property combo (either one
// "variant", or a "multipart" list whose parts are switched on by property
// conditions — that's how fences/walls/panes connect, and since litematica
// stores the full block state, north=true etc. are already in the props, no
// neighbor lookup needed), and each model (walking its parent chain) lists
// "elements": cuboids with per-face texture/UV/rotation. All of it comes
// straight from the user's own client jar.
//
// Returns plain JSON parts; the renderer builds the actual meshes.

function readJson(zip, entryPath) {
  const entry = zip.getEntry(entryPath);
  if (!entry) return null;
  try {
    return JSON.parse(entry.getData().toString('utf8'));
  } catch {
    return null;
  }
}

function stripNs(id) {
  return typeof id === 'string' ? id.replace(/^minecraft:/, '') : id;
}

// Walks the parent chain merging texture variables (child wins). Elements
// come from the nearest ancestor that defines any.
function resolveModel(zip, modelId, cache) {
  const id = stripNs(modelId);
  if (cache.has(id)) return cache.get(id);
  cache.set(id, null); // guards against a parent cycle
  const json = readJson(zip, `assets/minecraft/models/${id}.json`);
  if (!json) return null;

  let textures = { ...(json.textures || {}) };
  let elements = json.elements || null;
  if (json.parent) {
    const parent = resolveModel(zip, json.parent, cache);
    if (parent) {
      textures = { ...parent.textures, ...textures };
      if (!elements) elements = parent.elements;
    }
  }
  const resolved = { textures, elements };
  cache.set(id, resolved);
  return resolved;
}

function cleanPath(raw) {
  // "block/" in 1.13+, "blocks/" in older versions.
  return stripNs(raw).replace(/^blocks?\//, '');
}

// A texture value can chain through "#other_var" references, and in newer
// versions may be an object ({ sprite: "..." }) instead of a plain string.
function resolveTextureVar(textures, varName, depth = 0) {
  if (depth > 8) return null;
  let raw = textures[varName];
  if (raw && typeof raw === 'object') raw = raw.sprite || raw.texture || null;
  if (!raw || typeof raw !== 'string') return null;
  if (raw.startsWith('#')) return resolveTextureVar(textures, raw.slice(1), depth + 1);
  return cleanPath(raw);
}

function faceTexture(textures, ref) {
  if (typeof ref !== 'string') return null;
  if (ref.startsWith('#')) return resolveTextureVar(textures, ref.slice(1));
  return cleanPath(ref);
}

function cubeElement(tex) {
  const face = { uv: null, tex, rotation: 0, tint: false };
  return {
    from: [0, 0, 0],
    to: [16, 16, 16],
    rotation: null,
    faces: {
      down: face, up: face, north: face, south: face, west: face, east: face,
    },
  };
}

function partFromModel(model, rotX, rotY) {
  let elements = (model.elements || []).map((el) => {
    const faces = {};
    for (const [dir, f] of Object.entries(el.faces || {})) {
      const tex = faceTexture(model.textures, f.texture);
      if (!tex) continue;
      faces[dir] = {
        uv: f.uv || null,
        tex,
        rotation: f.rotation || 0,
        tint: typeof f.tintindex === 'number' && f.tintindex >= 0,
      };
    }
    return {
      from: el.from, to: el.to, rotation: el.rotation || null, faces,
    };
  }).filter((el) => Object.keys(el.faces).length > 0);

  // Entity-rendered blocks (chests, beds, signs, banners, shulker boxes…)
  // have no elements at all, only a particle texture — a cube in that
  // texture beats nothing.
  if (elements.length === 0) {
    const particle = resolveTextureVar(model.textures, 'particle');
    if (!particle) return null;
    elements = [cubeElement(particle)];
  }
  return { rotX, rotY, elements };
}

// Blockstate "variants" key like "facing=north,half=bottom": every k=v it
// names must match; the most specific match wins.
function pickVariant(variants, props) {
  let best = null;
  let bestScore = -1;
  for (const [key, val] of Object.entries(variants)) {
    const parts = key ? key.split(',') : [];
    let matches = true;
    for (const part of parts) {
      const [k, v] = part.split('=');
      if (props[k] !== undefined && props[k] !== v) { matches = false; break; }
    }
    if (matches && parts.length > bestScore) { best = val; bestScore = parts.length; }
  }
  return Array.isArray(best) ? best[0] : best;
}

// Multipart "when": { prop: "a|b" } (all listed props must match one of
// their alternatives), or { OR: [...] } / { AND: [...] } of the same.
function matchesCondition(cond, props) {
  if (!cond) return true;
  if (Array.isArray(cond.OR)) return cond.OR.some((c) => matchesCondition(c, props));
  if (Array.isArray(cond.AND)) return cond.AND.every((c) => matchesCondition(c, props));
  return Object.entries(cond).every(([k, v]) => String(v).split('|').includes(props[k]));
}

function resolveBlockParts(zip, cache, blockName, props) {
  const blockstate = readJson(zip, `assets/minecraft/blockstates/${stripNs(blockName)}.json`);
  if (!blockstate) return null;

  const applies = [];
  if (blockstate.variants) {
    const v = pickVariant(blockstate.variants, props);
    if (v) applies.push(v);
  } else if (Array.isArray(blockstate.multipart)) {
    for (const part of blockstate.multipart) {
      if (!matchesCondition(part.when, props)) continue;
      applies.push(Array.isArray(part.apply) ? part.apply[0] : part.apply);
    }
  }

  const parts = [];
  for (const a of applies) {
    if (!a || !a.model) continue;
    const model = resolveModel(zip, a.model, cache);
    if (!model) continue;
    const part = partFromModel(model, a.x || 0, a.y || 0);
    if (part) parts.push(part);
  }
  return parts.length ? parts : null;
}

module.exports = { resolveBlockParts, cubeElement };
