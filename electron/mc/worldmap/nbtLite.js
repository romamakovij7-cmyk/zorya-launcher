// A small, fast NBT reader for the map renderer. Unlike the general parser it
// never builds BigInts for long arrays: array payloads come back as Buffer
// views into the original data, which is what the bit-unpacking code wants.
//   byte/short/int/float/double -> number      long -> number (approximate)
//   string -> string       list -> array        compound -> object
//   byte/int/long array -> Buffer (raw big-endian bytes)

function readNbt(buf) {
  let p = 0;

  function readString() {
    const len = buf.readUInt16BE(p);
    p += 2;
    const s = buf.toString('utf8', p, p + len);
    p += len;
    return s;
  }

  function readPayload(type) {
    switch (type) {
      case 1: { const v = buf.readInt8(p); p += 1; return v; }
      case 2: { const v = buf.readInt16BE(p); p += 2; return v; }
      case 3: { const v = buf.readInt32BE(p); p += 4; return v; }
      case 4: { const v = buf.readInt32BE(p) * 4294967296 + buf.readUInt32BE(p + 4); p += 8; return v; }
      case 5: { const v = buf.readFloatBE(p); p += 4; return v; }
      case 6: { const v = buf.readDoubleBE(p); p += 8; return v; }
      case 7: { const n = buf.readInt32BE(p); p += 4; const v = buf.subarray(p, p + n); p += n; return v; }
      case 8: return readString();
      case 9: {
        const itemType = buf.readInt8(p);
        const n = buf.readInt32BE(p + 1);
        p += 5;
        const out = new Array(Math.max(0, n));
        for (let i = 0; i < n; i++) out[i] = readPayload(itemType);
        return out;
      }
      case 10: {
        const obj = {};
        for (;;) {
          const t = buf.readInt8(p);
          p += 1;
          if (t === 0) break;
          const name = readString();
          obj[name] = readPayload(t);
        }
        return obj;
      }
      case 11: { const n = buf.readInt32BE(p); p += 4; const v = buf.subarray(p, p + n * 4); p += n * 4; return v; }
      case 12: { const n = buf.readInt32BE(p); p += 4; const v = buf.subarray(p, p + n * 8); p += n * 8; return v; }
      default: throw new Error(`Unknown NBT tag ${type}`);
    }
  }

  const rootType = buf.readInt8(p);
  p += 1;
  if (rootType !== 10) throw new Error('NBT root is not a compound');
  readString(); // root name
  return readPayload(10);
}

// Reads `len` (<= 32) bits starting at bit `start` (0 = least significant) of
// the big-endian 64-bit long stored at `off` in `buf`.
function longBits(buf, off, start, len) {
  const hi = buf.readUInt32BE(off);
  const lo = buf.readUInt32BE(off + 4);
  const mask = len >= 32 ? 0xffffffff : (1 << len) - 1;
  if (start >= 32) return (hi >>> (start - 32)) & mask;
  if (start + len <= 32) return (lo >>> start) & mask;
  return (((lo >>> start) | (hi << (32 - start))) >>> 0) & mask;
}

// Value number `index` of a packed array of `bits`-wide entries.
//  - straddling=false (Minecraft 1.16+): entries never cross a long boundary
//  - straddling=true  (1.13-1.15): entries run continuously across longs
function unpack(buf, index, bits, straddling) {
  if (!straddling) {
    const perLong = Math.floor(64 / bits);
    const long = Math.floor(index / perLong);
    return longBits(buf, long * 8, (index % perLong) * bits, bits);
  }
  const bitIndex = index * bits;
  const long = Math.floor(bitIndex / 64);
  const start = bitIndex % 64;
  if (start + bits <= 64) return longBits(buf, long * 8, start, bits);
  const lowLen = 64 - start;
  const low = longBits(buf, long * 8, start, lowLen);
  const high = longBits(buf, (long + 1) * 8, 0, bits - lowLen);
  return (low | (high << lowLen)) >>> 0;
}

module.exports = { readNbt, unpack };
