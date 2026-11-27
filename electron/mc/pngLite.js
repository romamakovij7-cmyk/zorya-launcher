// Tiny PNG decoder (8/16-bit, all colour types, non-interlaced) — just enough
// to read skin files into RGBA without pulling in a dependency. Encoding lives
// in worldmap/regionRender.js (encodePng).
const zlib = require('zlib');

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

// Returns { width, height, data: Buffer(RGBA) }.
function decodePng(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('Это не PNG-файл');
  let pos = 8;
  let ihdr = null;
  let plte = null;
  let trns = null;
  const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === 'IHDR') {
      ihdr = {
        width: body.readUInt32BE(0), height: body.readUInt32BE(4), depth: body[8], color: body[9], interlace: body[12],
      };
    } else if (type === 'PLTE') plte = body;
    else if (type === 'tRNS') trns = body;
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
  }
  if (!ihdr) throw new Error('Повреждённый PNG');
  if (ihdr.interlace) throw new Error('Чересстрочный PNG не поддерживается — пересохраните скин без interlace');
  const { width, height, depth, color } = ihdr;
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color];
  if (!channels) throw new Error('Неподдерживаемый тип PNG');
  const bitsPerPixel = channels * depth;
  const bpp = Math.max(1, bitsPerPixel >> 3);
  if (!width || !height || width > 8192 || height > 8192) throw new Error('Слишком большое или пустое изображение');
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const raw = zlib.inflateSync(Buffer.concat(idat), { maxOutputLength: (stride + 1) * height + 4096 });
  if (raw.length < (stride + 1) * height) throw new Error('Повреждённый PNG (мало данных)');

  // Undo per-row filters.
  const rows = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const ft = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? rows[dst + x - bpp] : 0;
      const b = y > 0 ? rows[dst - stride + x] : 0;
      const c = x >= bpp && y > 0 ? rows[dst - stride + x - bpp] : 0;
      let v = raw[src + x];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) v += paeth(a, b, c);
      rows[dst + x] = v & 0xff;
    }
  }

  // Read sample `i` (0-based, within the row) as its raw value.
  const sample = (row, i) => {
    if (depth === 8) return rows[row * stride + i];
    if (depth === 16) return rows[row * stride + i * 2]; // keep the high byte
    const perByte = 8 / depth;
    const byte = rows[row * stride + Math.floor(i / perByte)];
    const shift = 8 - depth * ((i % perByte) + 1);
    return (byte >> shift) & ((1 << depth) - 1);
  };

  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      let r; let g; let b; let a = 255;
      if (color === 6) {
        r = sample(y, x * 4); g = sample(y, x * 4 + 1); b = sample(y, x * 4 + 2); a = sample(y, x * 4 + 3);
      } else if (color === 2) {
        r = sample(y, x * 3); g = sample(y, x * 3 + 1); b = sample(y, x * 3 + 2);
        if (trns && depth === 8 && trns.length >= 6 && trns.readUInt16BE(0) === r && trns.readUInt16BE(2) === g && trns.readUInt16BE(4) === b) a = 0;
      } else if (color === 0) {
        const v = sample(y, x);
        const scaled = depth < 8 ? Math.round((v * 255) / ((1 << depth) - 1)) : v;
        r = scaled; g = scaled; b = scaled;
      } else if (color === 4) {
        r = sample(y, x * 2); g = r; b = r; a = sample(y, x * 2 + 1);
      } else { // palette
        const idx = sample(y, x);
        if (!plte || idx * 3 + 2 >= plte.length) throw new Error('Повреждённая палитра PNG');
        r = plte[idx * 3]; g = plte[idx * 3 + 1]; b = plte[idx * 3 + 2];
        a = trns && idx < trns.length ? trns[idx] : 255;
      }
      data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = a;
    }
  }
  return { width, height, data };
}

module.exports = { decodePng };
