// Renders one Anvil region file (.mca, 32x32 chunks = 512x512 blocks) into a
// top-down 512x512 RGBA image: for every column the topmost solid block's
// colour, water shaded by its depth, and a light "sun from the north-west"
// relief shading from height differences. Supports chunk formats from
// Minecraft 1.13 on (palette-based sections); older worlds are reported as
// unsupported.
const zlib = require('zlib');
const { readNbt, unpack } = require('./nbtLite');
const { colorOf, isWater, isAir } = require('./blockColors');

const SIZE = 512;

// DataVersion thresholds
const DV_1_13 = 1519; // palette-based sections
const DV_1_16 = 2529; // packed arrays no longer straddle longs
const DV_1_18 = 2825; // sections at chunk root, minY = -64

function log2ceil(n) {
  return n <= 1 ? 0 : Math.ceil(Math.log2(n));
}

function inflateChunk(region, offset) {
  const length = region.readInt32BE(offset);
  const compression = region[offset + 4];
  const data = region.subarray(offset + 5, offset + 4 + length);
  // A chunk is a few hundred KB of NBT at most; the cap stops a crafted world from inflating gigabytes.
  const limit = { maxOutputLength: 64 * 1024 * 1024 };
  if (compression === 2) return zlib.inflateSync(data, limit);
  if (compression === 1) return zlib.gunzipSync(data, limit);
  if (compression === 3) return data;
  return null; // LZ4 (custom compression) and unknown types aren't supported
}

// Decoded chunk with lazy per-section palette expansion.
function openChunk(root) {
  const dataVersion = root.DataVersion || 0;
  const level = root.Level || root; // 1.13-1.17 wrap everything in "Level"
  const sectionsRaw = level.sections || level.Sections;
  if (!Array.isArray(sectionsRaw)) return null;
  const status = level.Status || root.Status;
  if (status && !/full$/.test(status)) return null; // half-generated chunk

  const minY = dataVersion >= DV_1_18 ? (typeof level.yPos === 'number' ? level.yPos * 16 : -64) : 0;
  const sections = new Map(); // section Y -> { palette, indices|null }
  for (const s of sectionsRaw) {
    const palette = dataVersion >= DV_1_18 ? s.block_states?.palette : s.Palette;
    const data = dataVersion >= DV_1_18 ? s.block_states?.data : s.BlockStates;
    if (!palette || !palette.length) continue;
    sections.set(s.Y, { palette, data, indices: null });
  }
  return {
    dataVersion,
    minY,
    sections,
    heightmap: level.Heightmaps?.MOTION_BLOCKING || null,
    straddling: dataVersion < DV_1_16,
    is118: dataVersion >= DV_1_18,
  };
}

function nameAt(chunk, lx, y, lz) {
  const sy = y >> 4;
  const section = chunk.sections.get(sy);
  if (!section) return 'minecraft:air';
  const { palette } = section;
  if (palette.length === 1) return palette[0].Name;
  if (!section.indices) {
    // Expand the whole section once (4096 entries).
    const bits = Math.max(4, log2ceil(palette.length));
    const idx = new Uint16Array(4096);
    if (section.data) for (let i = 0; i < 4096; i++) idx[i] = unpack(section.data, i, bits, chunk.straddling);
    section.indices = idx;
  }
  const entry = palette[section.indices[((y & 15) << 8) | (lz << 4) | lx]];
  return entry ? entry.Name : 'minecraft:air';
}

// Highest y with something solid-ish, scanning downward from `from`.
function scanDown(chunk, lx, lz, from, floor) {
  for (let y = from; y >= floor; y--) {
    const n = nameAt(chunk, lx, y, lz);
    if (!isAir(n)) return y;
  }
  return null;
}

// Region file -> { rgba, chunks } or throws for unsupported/empty regions.
function renderRegion(fileBuf, dimension = 'overworld') {
  const rgba = Buffer.alloc(SIZE * SIZE * 4); // fully transparent to start
  const heights = new Int16Array(SIZE * SIZE).fill(-32768);
  const water = new Uint8Array(SIZE * SIZE);
  let chunks = 0;
  let unsupported = 0;

  if (fileBuf.length < 8192) return { rgba, chunks: 0, unsupported: 0 };

  for (let cz = 0; cz < 32; cz++) {
    for (let cx = 0; cx < 32; cx++) {
      const loc = fileBuf.readUInt32BE((cx + cz * 32) * 4);
      if (loc === 0) continue;
      const offset = (loc >>> 8) * 4096;
      if (offset + 5 > fileBuf.length) continue;
      let root;
      try {
        const raw = inflateChunk(fileBuf, offset);
        if (!raw) { unsupported += 1; continue; }
        root = readNbt(raw);
      } catch {
        continue;
      }
      const chunk = openChunk(root);
      if (!chunk) continue;
      if (chunk.dataVersion < DV_1_13) { unsupported += 1; continue; }
      chunks += 1;

      const nether = dimension === 'nether';
      const topFallback = nether ? 120 : chunk.minY + (chunk.is118 ? 383 : 255);
      const floorY = chunk.minY;

      for (let lz = 0; lz < 16; lz++) {
        for (let lx = 0; lx < 16; lx++) {
          let y = null;
          if (!nether && chunk.heightmap) {
            const hv = unpack(chunk.heightmap, lz * 16 + lx, 9, chunk.straddling);
            y = hv - 1 + chunk.minY;
            if (isAir(nameAt(chunk, lx, y, lz))) y = scanDown(chunk, lx, lz, y, floorY);
          } else {
            y = scanDown(chunk, lx, lz, topFallback, floorY);
          }
          if (y === null) continue;

          let name = nameAt(chunk, lx, y, lz);
          let col;
          let waterDepth = 0;
          if (isWater(name)) {
            // How deep is the water, and what's the bed underneath?
            let d = 0;
            let yy = y;
            while (yy >= floorY && d < 24 && isWater(nameAt(chunk, lx, yy, lz))) { d += 1; yy -= 1; }
            waterDepth = d;
            const bed = yy >= floorY ? nameAt(chunk, lx, yy, lz) : 'minecraft:sand';
            const bedColor = colorOf(isAir(bed) ? 'minecraft:sand' : bed);
            const wc = colorOf('minecraft:water');
            const t = Math.min(0.94, 0.55 + d * 0.05); // deeper = more water colour
            col = [
              Math.round(bedColor[0] * (1 - t) + wc[0] * t),
              Math.round(bedColor[1] * (1 - t) + wc[1] * t),
              Math.round(bedColor[2] * (1 - t) + wc[2] * t),
            ];
            const k = 1 - Math.min(0.4, d * 0.022);
            col = col.map((c) => Math.round(c * k));
          } else {
            col = colorOf(name);
          }

          const px = cx * 16 + lx;
          const pz = cz * 16 + lz;
          const i = pz * SIZE + px;
          heights[i] = y;
          water[i] = waterDepth > 0 ? 1 : 0;
          rgba[i * 4] = col[0];
          rgba[i * 4 + 1] = col[1];
          rgba[i * 4 + 2] = col[2];
          rgba[i * 4 + 3] = 255;
        }
      }
    }
  }

  // Relief shading across the whole region (so chunk borders are seamless).
  for (let z = 1; z < SIZE; z++) {
    for (let x = 1; x < SIZE; x++) {
      const i = z * SIZE + x;
      if (rgba[i * 4 + 3] === 0 || water[i]) continue;
      const nw = heights[(z - 1) * SIZE + (x - 1)];
      if (nw === -32768) continue;
      const diff = heights[i] - nw;
      const f = diff > 0 ? Math.min(1.28, 1 + diff * 0.06) : diff < 0 ? Math.max(0.72, 1 + diff * 0.05) : 1;
      rgba[i * 4] = Math.min(255, Math.round(rgba[i * 4] * f));
      rgba[i * 4 + 1] = Math.min(255, Math.round(rgba[i * 4 + 1] * f));
      rgba[i * 4 + 2] = Math.min(255, Math.round(rgba[i * 4 + 2] * f));
    }
  }
  return { rgba, chunks, unsupported };
}

// ---- PNG encoding (RGBA8, no filtering) -------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(rgba, width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

module.exports = { renderRegion, encodePng, SIZE };
