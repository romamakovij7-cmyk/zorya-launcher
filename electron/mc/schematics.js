const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const paths = require('./paths');
const store = require('../store');
const { parseNbtFile } = require('./nbt');
const { safeFileName } = require('./safe');

const EXTS = ['.litematic', '.schem', '.schematic'];
const AIR_NAMES = new Set(['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air']);

function schematicsDir(instanceId) {
  return path.join(paths.instanceGameDir(instanceId), 'schematics');
}

// A file in the instance's schematics folder; `filename` comes from the UI, so it
// must be a bare name (no "..\..\" tricks).
function schematicPath(instanceId, filename) {
  return path.join(schematicsDir(instanceId), safeFileName(filename));
}

function findInstance(instanceId) {
  return (store.get('instances') || []).find((i) => i.id === instanceId);
}

async function readMetaSafe(filePath, ext) {
  const meta = {
    name: null, author: null, description: null, size: null, regionCount: null, totalBlocks: null, hasPreview: false,
  };
  if (ext !== '.litematic') return meta;
  try {
    const nbt = parseNbtFile(await fsp.readFile(filePath));
    const m = nbt.Metadata;
    if (!m) return meta;
    meta.name = m.Name || null;
    meta.author = m.Author || null;
    meta.description = m.Description || null;
    meta.regionCount = m.RegionCount != null ? Number(m.RegionCount) : null;
    meta.totalBlocks = m.TotalBlocks != null ? Number(m.TotalBlocks) : null;
    meta.hasPreview = Array.isArray(m.PreviewImageData) && m.PreviewImageData.length > 0;
    if (m.EnclosingSize) {
      meta.size = {
        x: Math.abs(Number(m.EnclosingSize.x)), y: Math.abs(Number(m.EnclosingSize.y)), z: Math.abs(Number(m.EnclosingSize.z)),
      };
    }
  } catch {
    /* unreadable/corrupt/unsupported — still list the file by name */
  }
  return meta;
}

async function scanInstance(inst) {
  const dir = schematicsDir(inst.id);
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!EXTS.includes(ext)) continue;
    const filePath = path.join(dir, entry.name);
    // eslint-disable-next-line no-await-in-loop
    const stat = await fsp.stat(filePath);
    // eslint-disable-next-line no-await-in-loop
    const meta = await readMetaSafe(filePath, ext);
    out.push({
      instanceId: inst.id,
      instanceName: inst.name,
      instanceIcon: inst.icon || null,
      filename: entry.name,
      ext,
      mtime: stat.mtimeMs,
      fileSize: stat.size,
      ...meta,
      name: meta.name || entry.name,
    });
  }
  return out;
}

async function listAll() {
  const instances = store.get('instances') || [];
  const out = [];
  for (const inst of instances) {
    // eslint-disable-next-line no-await-in-loop
    out.push(...(await scanInstance(inst)));
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

// Litematica's own bit array packs palette-index values contiguously, with
// no padding — unlike vanilla's post-1.16 chunk storage, a value CAN span
// across two adjacent longs. Longs must be treated as unsigned 64-bit for
// the shifts below (BigInt's >> is sign-based on the mathematical value, so
// a negative i64 has to be normalized to its unsigned bit pattern first).
function toU64(v) {
  return v < 0n ? v + (1n << 64n) : v;
}

function bitsPerEntryFor(paletteSize) {
  return Math.max(2, Math.ceil(Math.log2(Math.max(paletteSize, 2))));
}

function decodeRegion(region) {
  const sizeX = Math.abs(Number(region.Size.x));
  const sizeY = Math.abs(Number(region.Size.y));
  const sizeZ = Math.abs(Number(region.Size.z));
  // Properties (slab type, stair facing/shape, etc.) come along for the
  // ride so the renderer can at least get slab height/position right —
  // dropping them here previously meant every block, slabs included,
  // reconstructed as a full 1x1x1 cube.
  const palette = (region.BlockStatePalette || []).map((p) => ({
    name: p.Name || 'minecraft:air',
    props: p.Properties || {},
  }));
  const bitsPerEntry = bitsPerEntryFor(palette.length);
  const mask = (1n << BigInt(bitsPerEntry)) - 1n;
  const longs = (region.BlockStates || []).map(toU64);
  const total = sizeX * sizeY * sizeZ;

  const blocks = [];
  for (let idx = 0; idx < total; idx++) {
    const bitIndex = idx * bitsPerEntry;
    const startLong = Math.floor(bitIndex / 64);
    const startOffset = bitIndex % 64;
    const lo = longs[startLong] ?? 0n;
    let value;
    if (startOffset + bitsPerEntry <= 64) {
      value = (lo >> BigInt(startOffset)) & mask;
    } else {
      const hi = longs[startLong + 1] ?? 0n;
      const bitsInFirst = 64 - startOffset;
      value = ((lo >> BigInt(startOffset)) | (hi << BigInt(bitsInFirst))) & mask;
    }
    const entry = palette[Number(value)] || { name: 'minecraft:air', props: {} };
    if (AIR_NAMES.has(entry.name)) continue;
    const y = Math.floor(idx / (sizeX * sizeZ));
    const rem = idx % (sizeX * sizeZ);
    const z = Math.floor(rem / sizeX);
    const x = rem % sizeX;
    blocks.push({ x, y, z, name: entry.name, props: entry.props });
  }
  return {
    sizeX, sizeY, sizeZ, blocks,
  };
}

// Two blocks with the same name but different properties (a log lying on
// its side vs standing up, a stair facing a different way) can need a
// different texture/rotation — group by name+properties, not name alone.
function blockRenderKey(name, props) {
  if (!props || Object.keys(props).length === 0) return name;
  const sorted = Object.keys(props).sort().map((k) => `${k}=${props[k]}`).join(',');
  return `${name}[${sorted}]`;
}

const MAX_VOXELS = 60000;

// Best-effort 3D reconstruction from the raw region data — only .litematic
// is supported (WorldEdit's .schem/.schematic use a completely different
// palette+varint encoding). Not verified against a real file in this
// environment; if positions come out visibly wrong, the bit-unpacking
// details above are the place to double-check first.
const MAX_VOLUME = 4_000_000;

async function getVoxels(instanceId, filename) {
  const filePath = schematicPath(instanceId, filename);
  const nbt = parseNbtFile(await fsp.readFile(filePath));
  const regions = nbt.Regions || {};
  const regionNames = Object.keys(regions);
  if (!regionNames.length) throw new Error('В файле нет регионов');

  // The bit-unpacking below is pure CPU work with no natural yield point —
  // for a huge schematic it would otherwise block the whole app (all IPC,
  // not just this page) for seconds. Refuse up front instead of freezing.
  const totalVolume = regionNames.reduce((sum, name) => {
    const size = regions[name].Size || { x: 0, y: 0, z: 0 };
    return sum + Math.abs(Number(size.x)) * Math.abs(Number(size.y)) * Math.abs(Number(size.z));
  }, 0);
  if (totalVolume > MAX_VOLUME) {
    throw new Error('Схематика слишком большая для 3D-просмотра в лаунчере.');
  }

  // Merge every region into one block list, offsetting by its Position so
  // multi-region schematics render as a single coherent structure.
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  const parsed = regionNames.map((name) => {
    const region = regions[name];
    const decoded = decodeRegion(region);
    const pos = region.Position || { x: 0, y: 0, z: 0 };
    const ox = Number(pos.x);
    const oy = Number(pos.y);
    const oz = Number(pos.z);
    for (const b of decoded.blocks) {
      minX = Math.min(minX, b.x + ox);
      minY = Math.min(minY, b.y + oy);
      minZ = Math.min(minZ, b.z + oz);
    }
    return { decoded, ox, oy, oz };
  });

  const blocks = [];
  let truncated = false;
  outer:
  for (const { decoded, ox, oy, oz } of parsed) {
    for (const b of decoded.blocks) {
      if (blocks.length >= MAX_VOXELS) { truncated = true; break outer; }
      blocks.push({
        x: b.x + ox - minX,
        y: b.y + oy - minY,
        z: b.z + oz - minZ,
        name: b.name,
        props: b.props,
        key: blockRenderKey(b.name, b.props),
      });
    }
  }
  return { blocks, truncated };
}

// Blocks whose item differs from the block id.
const ITEM_ALIASES = {
  wall_torch: 'torch',
  redstone_wall_torch: 'redstone_torch',
  soul_wall_torch: 'soul_torch',
  redstone_wire: 'redstone',
  tripwire: 'string',
  bamboo_sapling: 'bamboo',
  kelp_plant: 'kelp',
  weeping_vines_plant: 'weeping_vines',
  twisting_vines_plant: 'twisting_vines',
  cave_vines_plant: 'glow_berries',
  cave_vines: 'glow_berries',
  sweet_berry_bush: 'sweet_berries',
  wheat: 'wheat_seeds',
  carrots: 'carrot',
  potatoes: 'potato',
  beetroots: 'beetroot_seeds',
  melon_stem: 'melon_seeds',
  pumpkin_stem: 'pumpkin_seeds',
  attached_melon_stem: 'melon_seeds',
  attached_pumpkin_stem: 'pumpkin_seeds',
  cocoa: 'cocoa_beans',
  frosted_ice: 'ice',
  lava_cauldron: 'cauldron',
  water_cauldron: 'cauldron',
  powder_snow_cauldron: 'cauldron',
  piston_head: null,
  moving_piston: null,
  nether_portal: null,
  end_portal: null,
  end_gateway: null,
  fire: null,
  soul_fire: null,
  water: null,
  lava: null,
  bubble_column: null,
};

// Turns one palette entry into { item, count } the way litematica's material
// list does: double slabs are two, the upper half of a door/tall plant and a
// bed's head aren't counted again, wall signs/banners/heads fold back into
// their standing item. Returns null for things that aren't obtainable blocks.
function paletteItem(entry) {
  const props = entry.props || {};
  let name = entry.name.replace(/^minecraft:/, '');
  if (props.half === 'upper') return null;
  if (props.part === 'head') return null;
  if (name in ITEM_ALIASES) {
    name = ITEM_ALIASES[name];
    if (!name) return null;
  }
  if (name.startsWith('potted_')) name = 'flower_pot';
  name = name.replace(/^(.*)_wall_(sign|hanging_sign|banner|head|skull)$/, '$1_$2');
  let count = 1;
  if (name.endsWith('_slab') && props.type === 'double') count = 2;
  if (name === 'sea_pickle' || name === 'candle' || name.endsWith('_candle')) {
    count = Number(props.pickles || props.candles || 1);
  }
  if (name === 'snow' && props.layers) count = Number(props.layers);
  return { item: name, count };
}

const MAX_MATERIAL_VOLUME = 30_000_000;

// Per-block totals across every region, counted straight from the packed
// data (no per-block objects), yielding to the event loop now and then so a
// big schematic doesn't stall the app.
async function getMaterials(instanceId, filename) {
  const filePath = schematicPath(instanceId, filename);
  const nbt = parseNbtFile(await fsp.readFile(filePath));
  const regions = nbt.Regions || {};
  const regionNames = Object.keys(regions);
  if (!regionNames.length) throw new Error('В файле нет регионов');

  const totalVolume = regionNames.reduce((sum, name) => {
    const s = regions[name].Size || { x: 0, y: 0, z: 0 };
    return sum + Math.abs(Number(s.x)) * Math.abs(Number(s.y)) * Math.abs(Number(s.z));
  }, 0);
  if (totalVolume > MAX_MATERIAL_VOLUME) {
    throw new Error('Схематика слишком большая для подсчёта ресурсов.');
  }

  const totals = new Map();
  for (const rName of regionNames) {
    const region = regions[rName];
    const total = Math.abs(Number(region.Size.x)) * Math.abs(Number(region.Size.y)) * Math.abs(Number(region.Size.z));
    const palette = (region.BlockStatePalette || []).map((p) => ({ name: p.Name || 'minecraft:air', props: p.Properties || {} }));
    const bitsPerEntry = bitsPerEntryFor(palette.length);
    const mask = (1n << BigInt(bitsPerEntry)) - 1n;
    const longs = (region.BlockStates || []).map(toU64);
    const counts = new Array(palette.length).fill(0);

    for (let idx = 0; idx < total; idx++) {
      const bitIndex = idx * bitsPerEntry;
      const startLong = Math.floor(bitIndex / 64);
      const startOffset = bitIndex % 64;
      const lo = longs[startLong] ?? 0n;
      let value;
      if (startOffset + bitsPerEntry <= 64) {
        value = (lo >> BigInt(startOffset)) & mask;
      } else {
        const hi = longs[startLong + 1] ?? 0n;
        value = ((lo >> BigInt(startOffset)) | (hi << BigInt(64 - startOffset))) & mask;
      }
      const v = Number(value);
      if (v < counts.length) counts[v]++;
      if (idx % 500000 === 499999) await new Promise((r) => setImmediate(r));
    }

    palette.forEach((entry, i) => {
      if (!counts[i] || AIR_NAMES.has(entry.name)) return;
      const res = paletteItem(entry);
      if (!res) return;
      totals.set(res.item, (totals.get(res.item) || 0) + counts[i] * res.count);
    });
  }

  const items = [...totals].map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
  return { items, total: items.reduce((s, i) => s + i.count, 0) };
}

async function getPreviewImage(instanceId, filename) {
  const filePath = schematicPath(instanceId, filename);
  const nbt = parseNbtFile(await fsp.readFile(filePath));
  const m = nbt.Metadata;
  if (!m || !Array.isArray(m.PreviewImageData) || !m.PreviewImageData.length) return null;
  // Litematica stores the preview as a square ARGB int array (side length
  // is its square root).
  const pixels = m.PreviewImageData;
  const side = Math.round(Math.sqrt(pixels.length));
  if (side * side !== pixels.length) return null;
  const rgba = Buffer.alloc(pixels.length * 4);
  for (let i = 0; i < pixels.length; i++) {
    const argb = pixels[i] | 0;
    rgba[i * 4] = (argb >> 16) & 0xff; // R
    rgba[i * 4 + 1] = (argb >> 8) & 0xff; // G
    rgba[i * 4 + 2] = argb & 0xff; // B
    rgba[i * 4 + 3] = (argb >>> 24) & 0xff; // A
  }
  return { side, rgba: rgba.toString('base64') };
}

async function deleteSchematic(instanceId, filename) {
  await fsp.rm(schematicPath(instanceId, filename), { force: true });
}

function copyTo(instanceId, filename, targetInstanceId) {
  const src = schematicPath(instanceId, filename);
  const destDir = schematicsDir(targetInstanceId);
  fs.mkdirSync(destDir, { recursive: true });
  let destName = filename;
  let n = 2;
  while (fs.existsSync(path.join(destDir, destName))) {
    const ext = path.extname(filename);
    const base = filename.slice(0, -ext.length);
    destName = `${base} (${n++})${ext}`;
  }
  fs.copyFileSync(src, path.join(destDir, destName));
  return destName;
}

module.exports = {
  listAll, getVoxels, getMaterials, getPreviewImage, deleteSchematic, copyTo, schematicsDir, schematicPath, findInstance,
};
