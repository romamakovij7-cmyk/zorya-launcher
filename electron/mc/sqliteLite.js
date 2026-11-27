// Minimal read-only SQLite reader: just enough to list the rows of one table
// (used for the Modrinth App's app.db, which is the only place it keeps each
// profile's Minecraft version / loader). Pages are read on demand — the file
// can be hundreds of MB — and the -wal file is overlaid so rows the app hasn't
// checkpointed yet are still seen. No writes, no SQL: scan a table, that's it.
const fs = require('fs');

function varint(buf, pos) {
  let value = 0;
  for (let i = 0; i < 8; i++) {
    const b = buf[pos + i];
    value = value * 128 + (b & 0x7f);
    if (!(b & 0x80)) return [value, i + 1];
  }
  return [value * 256 + buf[pos + 8], 9];
}

class SqliteFile {
  constructor(file) {
    this.fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(100);
    fs.readSync(this.fd, head, 0, 100, 0);
    if (head.toString('latin1', 0, 15) !== 'SQLite format 3') throw new Error('Не файл SQLite');
    const ps = head.readUInt16BE(16);
    this.pageSize = ps === 1 ? 65536 : ps;
    this.usable = this.pageSize - head[20];
    this.cache = new Map();
    this.wal = new Map(); // page number -> Buffer (latest committed copy)
    this.loadWal(`${file}-wal`);
  }

  loadWal(walFile) {
    let buf;
    try { buf = fs.readFileSync(walFile); } catch { return; }
    if (buf.length < 32) return;
    const magic = buf.readUInt32BE(0);
    if (magic !== 0x377f0682 && magic !== 0x377f0683) return;
    if (buf.readUInt32BE(8) !== this.pageSize) return;
    const salt1 = buf.readUInt32BE(16);
    const salt2 = buf.readUInt32BE(20);
    const frameSize = 24 + this.pageSize;
    let pending = new Map();
    for (let off = 32; off + frameSize <= buf.length; off += frameSize) {
      if (buf.readUInt32BE(off + 8) !== salt1 || buf.readUInt32BE(off + 12) !== salt2) break;
      const pageNo = buf.readUInt32BE(off);
      pending.set(pageNo, buf.subarray(off + 24, off + frameSize));
      if (buf.readUInt32BE(off + 4) !== 0) { // commit frame
        for (const [n, p] of pending) this.wal.set(n, p);
        pending = new Map();
      }
    }
  }

  page(n) {
    if (this.wal.has(n)) return this.wal.get(n);
    let p = this.cache.get(n);
    if (!p) {
      p = Buffer.alloc(this.pageSize);
      fs.readSync(this.fd, p, 0, this.pageSize, (n - 1) * this.pageSize);
      if (this.cache.size > 256) this.cache.clear();
      this.cache.set(n, p);
    }
    return p;
  }

  payload(pg, pos, size) {
    const maxLocal = this.usable - 35;
    if (size <= maxLocal) return pg.subarray(pos, pos + size);
    const minLocal = Math.floor(((this.usable - 12) * 32) / 255) - 23;
    const k = minLocal + ((size - minLocal) % (this.usable - 4));
    const local = k <= maxLocal ? k : minLocal;
    const parts = [pg.subarray(pos, pos + local)];
    let next = pg.readUInt32BE(pos + local);
    let left = size - local;
    while (left > 0 && next) {
      const op = this.page(next);
      const take = Math.min(left, this.usable - 4);
      parts.push(op.subarray(4, 4 + take));
      left -= take;
      next = op.readUInt32BE(0);
    }
    return Buffer.concat(parts);
  }

  record(buf) {
    const [hdrSize, n0] = varint(buf, 0);
    const types = [];
    let pos = n0;
    while (pos < hdrSize) { const [t, n] = varint(buf, pos); types.push(t); pos += n; }
    const out = [];
    let dp = hdrSize;
    for (const t of types) {
      if (t === 0) out.push(null);
      else if (t >= 1 && t <= 6) {
        const len = [0, 1, 2, 3, 4, 6, 8][t];
        out.push(len === 8 ? Number(buf.readBigInt64BE(dp)) : buf.readIntBE(dp, len));
        dp += len;
      } else if (t === 7) { out.push(buf.readDoubleBE(dp)); dp += 8; }
      else if (t === 8) out.push(0);
      else if (t === 9) out.push(1);
      else {
        const len = t >= 12 && t % 2 === 0 ? (t - 12) / 2 : (t - 13) / 2;
        out.push(t % 2 === 0 ? buf.subarray(dp, dp + len) : buf.toString('utf8', dp, dp + len));
        dp += len;
      }
    }
    return out;
  }

  *scan(root) {
    const pg = this.page(root);
    const h = root === 1 ? 100 : 0;
    const type = pg[h];
    const cells = pg.readUInt16BE(h + 3);
    if (type === 0x0d) {
      for (let i = 0; i < cells; i++) {
        let pos = pg.readUInt16BE(h + 8 + i * 2);
        const [size, a] = varint(pg, pos); pos += a;
        const [, b] = varint(pg, pos); pos += b;
        yield this.record(this.payload(pg, pos, size));
      }
    } else if (type === 0x05) {
      for (let i = 0; i < cells; i++) {
        const pos = pg.readUInt16BE(h + 12 + i * 2);
        yield* this.scan(pg.readUInt32BE(pos));
      }
      yield* this.scan(pg.readUInt32BE(h + 8));
    }
  }

  close() { try { fs.closeSync(this.fd); } catch { /* already closed */ } }
}

function columnNames(sql) {
  const body = sql.slice(sql.indexOf('(') + 1, sql.lastIndexOf(')'));
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of body) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
  }
  parts.push(cur);
  return parts
    .map((p) => p.trim())
    .filter((p) => p && !/^(primary|unique|foreign|constraint|check)\b/i.test(p))
    .map((p) => p.split(/\s+/)[0].replace(/^["'`[]|["'`\]]$/g, ''));
}

// All rows of `table` as objects keyed by column name.
function readTable(file, table) {
  const db = new SqliteFile(file);
  try {
    const master = [...db.scan(1)].find((r) => r[0] === 'table' && r[1] === table);
    if (!master) return [];
    const cols = columnNames(master[4]);
    return [...db.scan(master[3])].map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i] ?? null])));
  } finally {
    db.close();
  }
}

module.exports = { readTable };
