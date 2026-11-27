// Skin и плащ офлайн-аккаунта в Horizon (игра на Rust). В Java-игре это делает authlib-injector, здесь его нет, зато сам клиент
// читает два файла, пути к которым ему передают переменные окружения (crates/horizon-client-render/src/skins.rs):
//   HORIZON_OFFLINE_SKIN        — путь к PNG 64x64 или 64x32;  HORIZON_OFFLINE_SKIN_MODEL — «classic» или «slim»
//   HORIZON_OFFLINE_CAPE        — путь к PNG плаща
// Видит их только сам игрок (клиент подставляет их «своему» нику), другим игрокам на сервере они не передаются.
const fs = require('fs');
const path = require('path');
const { app, nativeImage } = require('electron');
const skins = require('./skins');
const skinServer = require('./skinServer');

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_CAPE_BYTES = 512 * 1024;

const safeId = (id) => String(id).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80);

function assetsDir(instanceId) {
  const dir = path.join(app.getPath('userData'), 'horizon-assets', safeId(instanceId));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function removeAssets(instanceId) {
  try { fs.rmSync(path.join(app.getPath('userData'), 'horizon-assets', safeId(instanceId)), { recursive: true, force: true }); } catch { /* ignore */ }
}

// Horizon принимает ровно 64x64 или 64x32. HD-скин (128x128, 256x256…) сжимается в целое число раз — берётся каждый k-й пиксель
// (а не сглаживание), чтобы пиксельный рисунок остался чётким.
function toLegacySize(png) {
  const img = nativeImage.createFromBuffer(png);
  if (img.isEmpty()) return null;
  const { width: w, height: h } = img.getSize();
  if (w === 64 && (h === 64 || h === 32)) return png;
  if (w % 64 !== 0 || (h !== w && h * 2 !== w)) return null;
  const k = w / 64;
  const outH = h / k;
  const src = img.toBitmap();
  const out = Buffer.alloc(64 * outH * 4);
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < 64; x++) src.copy(out, (y * 64 + x) * 4, ((y * k) * w + x * k) * 4, ((y * k) * w + x * k) * 4 + 4);
  }
  return nativeImage.createFromBitmap(out, { width: 64, height: outH }).toPNG();
}

const withTimeout = (p, ms) => Promise.race([p, new Promise((resolve) => { setTimeout(() => resolve({ ok: false, error: 'сайт долго не отвечает' }), ms); })]);

// Переменные окружения для запуска Horizon (пустой объект — ничего не передаём). log(text) — сообщения в консоль сборки.
async function prepareEnv({ instanceId, account, log = () => {} }) {
  const env = {};
  if (!account || account.type !== 'offline') return env; // у аккаунта Microsoft скин и плащ приходят от Mojang
  const dir = assetsDir(instanceId);

  if (account.offlineSkinId) {
    try {
      const entry = skins.getSkinFile(account.offlineSkinId);
      const png = entry && toLegacySize(entry.buf);
      if (!entry) {
        log('Skin не применён: его нет в библиотеке скинов.');
      } else if (!png) {
        log('Skin не применён: Horizon принимает скины 64×64 или 64×32 (HD-скин кратного размера сжимается сам).');
      } else {
        const file = path.join(dir, 'skin.png');
        fs.writeFileSync(file, png);
        env.HORIZON_OFFLINE_SKIN = file;
        env.HORIZON_OFFLINE_SKIN_MODEL = entry.variant === 'slim' ? 'slim' : 'classic';
      }
    } catch (err) {
      log(`Skin не применён: ${err.message}`);
    }
  }

  // Cape Zorya — по подписке: сначала сайт подтверждает выбор (если подписки нет, он откажет), потом берётся сама картинка
  if (account.customCapeId) {
    try {
      const published = await withTimeout(skinServer.setCape(account, account.customCapeId), 8000);
      if (!published.ok) {
        log(`Cape не применён: ${published.error}`);
      } else {
        const cape = (await skinServer.listCapes()).find((c) => c.id === account.customCapeId);
        if (cape && new URL(cape.url).protocol === 'https:') {
          const res = await fetch(cape.url, { signal: AbortSignal.timeout(10000), cache: 'no-store' });
          const buf = res.ok ? Buffer.from(await res.arrayBuffer()) : null;
          if (buf && buf.length <= MAX_CAPE_BYTES && buf.subarray(0, 8).equals(PNG_SIG)) {
            const file = path.join(dir, 'cape.png');
            fs.writeFileSync(file, buf);
            env.HORIZON_OFFLINE_CAPE = file;
          } else {
            log('Cape не применён: с сайта пришёл не PNG.');
          }
        }
      }
    } catch (err) {
      log(`Cape не применён: ${err.message}`);
    }
  }
  return env;
}

module.exports = { prepareEnv, removeAssets, toLegacySize };
