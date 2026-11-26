// Icons of builds and folders: any picture the person picks is turned into a small square icon, so the file size no longer matters
// (the icon lives inside launcher-config.json, which is rewritten on every change — see ipc.js).
//   • already small (≤ 300 KB and ≤ 512 px): kept exactly as it is (an animated GIF stays animated);
//   • anything else: cut to a centred square and scaled down to 256 px (never up). PNG is done right here (nativeImage is quick);
//     JPEG, WebP and GIF are decoded by Chromium in a hidden window, because nativeImage does not read WebP/GIF and ignores the
//     "rotated" mark (EXIF) of phone photos, which would put the icon on its side.
// The file is checked by its CONTENT (not its extension) and its pixel size is read from the header BEFORE anything is decoded.
const fs = require('fs');
const { nativeImage, BrowserWindow } = require('electron');

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_PIXELS = 100e6; // 10000 x 10000
const KEEP_BYTES = 300 * 1024;
const KEEP_SIDE = 512;
const OUT_SIDE = 256;
const MAX_OUT_BYTES = 300 * 1024;
const DECODE_TIMEOUT_MS = 20000;

function sniff(buf) {
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a) return 'png';
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 10 && buf.toString('latin1', 0, 4) === 'GIF8') return 'gif';
  if (buf.length >= 16 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

// Pixel size from the file header, without decoding.
function dimensions(buf, kind) {
  try {
    if (kind === 'png') return buf.toString('latin1', 12, 16) === 'IHDR' ? { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) } : null;
    if (kind === 'gif') return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
    if (kind === 'webp') {
      const chunk = buf.toString('latin1', 12, 16);
      if (chunk === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
      if (chunk === 'VP8L') { const b = buf.readUInt32LE(21); return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 }; }
      if (chunk === 'VP8X') return { w: 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16)), h: 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16)) };
      return null;
    }
    if (kind === 'jpeg') {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i += 1; continue; }
        const marker = buf[i + 1];
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0xff) { i += marker === 0xff ? 1 : 2; continue; }
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
        i += 2 + buf.readUInt16BE(i + 2);
      }
      return null;
    }
  } catch { /* a truncated header */ }
  return null;
}

const pngHasAlpha = (buf) => buf.length > 25 && (buf[25] === 4 || buf[25] === 6 || buf.includes('tRNS', 0, 'latin1'));
const dataUrl = (mime, buf) => `data:image/${mime};base64,${buf.toString('base64')}`;

// PNG: cut a centred square, scale down. A picture with transparency stays PNG (smaller and smaller until it fits); one without goes to JPEG when PNG is big.
function convertPng(buf) {
  const img = nativeImage.createFromBuffer(buf);
  if (img.isEmpty()) throw new Error('Failed прочитать картинку: файл повреждён?');
  const { width, height } = img.getSize();
  const side = Math.min(width, height);
  const square = img.crop({ x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), width: side, height: side });
  const alpha = pngHasAlpha(buf);
  for (const target of [OUT_SIDE, 192, 128, 96]) {
    const size = Math.min(target, side);
    const small = size < side ? square.resize({ width: size, height: size, quality: 'best' }) : square;
    const png = small.toPNG();
    if (png.length <= (alpha ? MAX_OUT_BYTES : 120 * 1024)) return { mime: 'png', buf: png };
    if (!alpha) { const jpg = small.toJPEG(90); if (jpg.length <= MAX_OUT_BYTES) return { mime: 'jpeg', buf: jpg }; }
  }
  throw new Error('Failed уменьшить картинку до нужного размера.');
}

// JPEG / WebP / GIF: Chromium decodes (EXIF rotation applied), a canvas cuts and scales; PNG if the result has transparency, otherwise JPEG.
async function convertWithChromium(buf, kind) {
  const win = new BrowserWindow({
    show: false, width: 64, height: 64,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  const timer = new Promise((_, reject) => { setTimeout(() => reject(new Error('Картинка слишком долго обрабатывается. Попробуйте файл поменьше.')), DECODE_TIMEOUT_MS); });
  try {
    await win.loadURL('data:text/html;charset=utf-8,<!doctype html><meta charset="utf-8"><canvas id="c"></canvas>');
    const script = `(async () => {
      const res = await fetch('data:image/${kind};base64,' + ${JSON.stringify(buf.toString('base64'))});
      const bmp = await createImageBitmap(await res.blob(), { imageOrientation: 'from-image' });
      const side = Math.min(bmp.width, bmp.height);
      const size = Math.min(${OUT_SIDE}, side);
      const c = document.getElementById('c'); c.width = size; c.height = size;
      const x = c.getContext('2d', { willReadFrequently: true });
      x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
      x.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
      const px = x.getImageData(0, 0, size, size).data;
      let alpha = false; for (let i = 3; i < px.length; i += 4) if (px[i] < 250) { alpha = true; break; }
      return alpha ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.9);
    })()`;
    const out = await Promise.race([win.webContents.executeJavaScript(script), timer]);
    const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(typeof out === 'string' ? out : '');
    if (!m) throw new Error('Failed прочитать картинку: файл повреждён?');
    return { mime: m[1], buf: Buffer.from(m[2], 'base64') };
  } catch (err) {
    if (/слишком долго|повреждён/.test(err.message)) throw err;
    throw new Error('Failed прочитать картинку: файл повреждён или формат не поддерживается.');
  } finally {
    try { win.destroy(); } catch { /* already gone */ }
  }
}

// filePath -> a "data:image/...;base64,..." string ready to be stored as an icon. Throws an Error with a message for the person.
async function prepareIcon(filePath) {
  const st = fs.statSync(filePath);
  if (!st.isFile()) throw new Error('Это не файл с картинкой.');
  if (st.size > MAX_FILE_BYTES) throw new Error(`File слишком большой (${(st.size / 1048576).toFixed(1)} МБ). Максимум ${MAX_FILE_BYTES / 1048576} МБ.`);
  const buf = fs.readFileSync(filePath);
  const kind = sniff(buf);
  if (!kind) throw new Error('Поддерживаются PNG, JPG, GIF и WebP.');
  const dim = dimensions(buf, kind);
  if (!dim || !dim.w || !dim.h) throw new Error('Failed прочитать картинку: файл повреждён?');
  if (dim.w * dim.h > MAX_PIXELS) throw new Error(`Слишком большое изображение (${dim.w}×${dim.h} пикселей). Уменьшите его, например, до 4000 пикселей по стороне.`);
  // Small already: untouched (the animation of a GIF survives). A JPEG is converted anyway if it carries a rotation mark we would lose.
  if (buf.length <= KEEP_BYTES && dim.w <= KEEP_SIDE && dim.h <= KEEP_SIDE && !(kind === 'jpeg' && buf.includes('Exif', 0, 'latin1'))) return dataUrl(kind, buf);
  const out = kind === 'png' ? convertPng(buf) : await convertWithChromium(buf, kind);
  if (out.buf.length > MAX_OUT_BYTES) throw new Error('Failed уменьшить картинку до нужного размера.');
  return dataUrl(out.mime, out.buf);
}

module.exports = { prepareIcon, _test: { sniff, dimensions, pngHasAlpha } };
