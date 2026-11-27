const zlib = require('zlib');

const TAG = {
  END: 0, BYTE: 1, SHORT: 2, INT: 3, LONG: 4, FLOAT: 5, DOUBLE: 6,
  BYTE_ARRAY: 7, STRING: 8, LIST: 9, COMPOUND: 10, INT_ARRAY: 11, LONG_ARRAY: 12,
};

class Reader {
  constructor(buf) {
    this.buf = buf;
    this.pos = 0;
  }

  u8() { return this.buf[this.pos++]; }
  i16() { const v = this.buf.readInt16BE(this.pos); this.pos += 2; return v; }
  i32() { const v = this.buf.readInt32BE(this.pos); this.pos += 4; return v; }
  i64() { const v = this.buf.readBigInt64BE(this.pos); this.pos += 8; return v; }
  f32() { const v = this.buf.readFloatBE(this.pos); this.pos += 4; return v; }
  f64() { const v = this.buf.readDoubleBE(this.pos); this.pos += 8; return v; }
  bytes(n) { const v = this.buf.subarray(this.pos, this.pos + n); this.pos += n; return v; }

  string() {
    const len = this.buf.readUInt16BE(this.pos);
    this.pos += 2;
    const s = this.buf.toString('utf8', this.pos, this.pos + len);
    this.pos += len;
    return s;
  }
}

function readPayload(r, type) {
  switch (type) {
    case TAG.BYTE: return r.u8();
    case TAG.SHORT: return r.i16();
    case TAG.INT: return r.i32();
    case TAG.LONG: return r.i64();
    case TAG.FLOAT: return r.f32();
    case TAG.DOUBLE: return r.f64();
    case TAG.BYTE_ARRAY: { const len = r.i32(); return r.bytes(len); }
    case TAG.STRING: return r.string();
    case TAG.LIST: {
      const itemType = r.u8();
      const len = r.i32();
      const items = [];
      for (let i = 0; i < len; i++) items.push(readPayload(r, itemType));
      return items;
    }
    case TAG.COMPOUND: {
      const obj = {};
      for (;;) {
        const t = r.u8();
        if (t === TAG.END) break;
        const name = r.string();
        obj[name] = readPayload(r, t);
      }
      return obj;
    }
    case TAG.INT_ARRAY: { const len = r.i32(); const arr = []; for (let i = 0; i < len; i++) arr.push(r.i32()); return arr; }
    case TAG.LONG_ARRAY: { const len = r.i32(); const arr = []; for (let i = 0; i < len; i++) arr.push(r.i64()); return arr; }
    default: throw new Error(`Unsupported NBT tag type ${type}`);
  }
}

// Parses an NBT file buffer (gzip-wrapped, as level.dat/servers.dat are)
// into a plain JS object — the root compound's own fields become the
// returned object's keys (the unnamed root wrapper itself is unwrapped).
// TAG_Long values come back as BigInt.
function parseNbtFile(buf) {
  // The cap keeps a gzip bomb disguised as a .litematic/level.dat from eating all memory.
  const data = (buf[0] === 0x1f && buf[1] === 0x8b) ? zlib.gunzipSync(buf, { maxOutputLength: 256 * 1024 * 1024 }) : buf;
  const r = new Reader(data);
  const rootType = r.u8();
  if (rootType !== TAG.COMPOUND) throw new Error('Expected root TAG_Compound');
  r.string(); // root name — normally empty
  return readPayload(r, TAG.COMPOUND);
}

class Writer {
  constructor() {
    this.chunks = [];
  }

  u8(v) { this.chunks.push(Buffer.from([v & 0xff])); }
  string(s) {
    const buf = Buffer.from(s || '', 'utf8');
    const len = Buffer.alloc(2);
    len.writeUInt16BE(buf.length, 0);
    this.chunks.push(len, buf);
  }
  i32(v) {
    const buf = Buffer.alloc(4);
    buf.writeInt32BE(v, 0);
    this.chunks.push(buf);
  }
  tagHeader(type, name) { this.u8(type); this.string(name); }
  buffer() { return Buffer.concat(this.chunks); }
}

// Not a general-purpose NBT writer — servers.dat's schema is small, fixed,
// and stable (unlike level.dat, it isn't part of Mojang's versioned world
// format), so this hand-writes exactly that shape rather than trying to
// serialize arbitrary values back from parseNbtFile()'s lossy plain-object
// representation (which discards the original int/short/byte tag types).
// servers.dat is also stored uncompressed on disk, unlike gzip-wrapped
// level.dat — parseNbtFile() auto-detects either way on read regardless.
function writeServersDat(servers) {
  const w = new Writer();
  w.tagHeader(TAG.COMPOUND, '');
  w.tagHeader(TAG.LIST, 'servers');
  w.u8(TAG.COMPOUND);
  w.i32(servers.length);
  for (const s of servers) {
    w.tagHeader(TAG.STRING, 'ip'); w.string(s.ip || '');
    w.tagHeader(TAG.STRING, 'name'); w.string(s.name || s.ip || '');
    if (s.icon) { w.tagHeader(TAG.STRING, 'icon'); w.string(s.icon); }
    // Absent in the file = the game asks about the server's resource pack. Keep it absent: writing 1 would silently turn "ask" into "accept".
    if (typeof s.acceptTextures === 'number') { w.tagHeader(TAG.BYTE, 'acceptTextures'); w.u8(s.acceptTextures); }
    // Newer games mark some entries "hidden"; rewriting the file must not lose that.
    if (s.hidden !== undefined && s.hidden !== null) { w.tagHeader(TAG.BYTE, 'hidden'); w.u8(s.hidden ? 1 : 0); }
    w.u8(TAG.END);
  }
  w.u8(TAG.END); // root compound end
  return w.buffer();
}

module.exports = { parseNbtFile, writeServersDat, TAG };
