const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');

function skinsDir() {
  const dir = path.join(app.getPath('userData'), 'skins');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function metaFile() {
  return path.join(skinsDir(), 'skins.json');
}

function loadMeta() {
  try {
    return JSON.parse(fs.readFileSync(metaFile(), 'utf8'));
  } catch {
    return [];
  }
}

function saveMeta(list) {
  fs.writeFileSync(metaFile(), JSON.stringify(list, null, 2));
}

// The nine skins Minecraft itself hands out by default (Steve, Alex, Ari, Efe, Kai, Makena, Noor, Sunny, Zuri): a newcomer with no skin of
// their own sees a character at once instead of an empty stage. Put into an EMPTY library once (a marker file remembers it, so skins the
// player deletes do not come back; a library that already has skins is left alone). The arm model is the one the game gives each of them.
const DEFAULT_SKINS = [
  ['steve', 'Steve', 'classic'], ['alex', 'Alex', 'slim'], ['ari', 'Ari', 'classic'], ['efe', 'Efe', 'slim'], ['kai', 'Kai', 'classic'],
  ['makena', 'Makena', 'slim'], ['noor', 'Noor', 'slim'], ['sunny', 'Sunny', 'classic'], ['zuri', 'Zuri', 'classic'],
];
const defaultsDir = () => path.join(__dirname, '..', 'assets', 'default-skins');
let defaultsChecked = false;
function ensureDefaultSkins() {
  if (defaultsChecked) return;
  defaultsChecked = true;
  try {
    const marker = path.join(skinsDir(), '.vanilla-seeded');
    if (fs.existsSync(marker)) return;
    const list = loadMeta();
    if (list.length === 0) {
      const now = Date.now();
      DEFAULT_SKINS.forEach(([key, name, variant], i) => {
        const id = crypto.randomUUID();
        const fileName = `${id}.png`;
        fs.copyFileSync(path.join(defaultsDir(), `${key}.png`), path.join(skinsDir(), fileName));
        list.push({ id, name, variant, file: fileName, addedAt: now - i, vanilla: key });
      });
      saveMeta(list);
    }
    fs.writeFileSync(marker, '1');
  } catch { /* the library simply stays as it is */ }
}

function listSkins() {
  ensureDefaultSkins();
  return loadMeta().map((s) => {
    let dataUrl = null;
    try {
      dataUrl = `data:image/png;base64,${fs.readFileSync(path.join(skinsDir(), s.file)).toString('base64')}`;
    } catch {
      /* file missing — skip preview */
    }
    return { ...s, dataUrl };
  }).filter((s) => s.dataUrl);
}

const MAX_SKIN_BYTES = 1024 * 1024;

// The file the user picked must really be a small PNG: it is copied under the library's own name, shown in the window as a
// data URL and (for an offline account) sent to the skin server — a huge or foreign file would only cause trouble there.
function assertSkinFile(filePath) {
  const st = fs.statSync(filePath);
  if (!st.isFile()) throw new Error('Выберите файл PNG со скином.');
  if (st.size > MAX_SKIN_BYTES) throw new Error('File слишком большой для скина (до 1 МБ).');
  const head = Buffer.alloc(24);
  const fd = fs.openSync(filePath, 'r');
  try { fs.readSync(fd, head, 0, 24, 0); } finally { fs.closeSync(fd); }
  if (!head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) || head.toString('latin1', 12, 16) !== 'IHDR') {
    throw new Error('Это не PNG-файл.');
  }
  const w = head.readUInt32BE(16);
  const h = head.readUInt32BE(20);
  if (w < 64 || h < 32 || w > 1024 || h > 1024) throw new Error(`Размер скина должен быть 64×64 или 64×32 (сейчас ${w}×${h}).`);
}

function addSkin({ filePath, name, variant }) {
  assertSkinFile(filePath);
  const id = crypto.randomUUID();
  const fileName = `${id}.png`;
  fs.copyFileSync(filePath, path.join(skinsDir(), fileName));
  const list = loadMeta();
  const entry = {
    id,
    name: name || path.basename(filePath, path.extname(filePath)),
    variant: variant === 'slim' ? 'slim' : 'classic',
    file: fileName,
    addedAt: Date.now(),
  };
  list.unshift(entry);
  saveMeta(list);
  const dataUrl = `data:image/png;base64,${fs.readFileSync(path.join(skinsDir(), fileName)).toString('base64')}`;
  return { ...entry, dataUrl };
}

// Raw PNG + arm model of one library skin (for injecting into the game).
function getSkinFile(id) {
  const entry = loadMeta().find((s) => s.id === id);
  if (!entry) return null;
  try {
    return { buf: fs.readFileSync(path.join(skinsDir(), entry.file)), variant: entry.variant, name: entry.name };
  } catch {
    return null;
  }
}

function setVariant(id, variant) {
  const list = loadMeta();
  const entry = list.find((s) => s.id === id);
  if (!entry) throw new Error('Skin не найден в библиотеке');
  entry.variant = variant === 'slim' ? 'slim' : 'classic';
  saveMeta(list);
  return entry;
}

function deleteSkin(id) {
  const list = loadMeta();
  const entry = list.find((s) => s.id === id);
  if (!entry) return;
  try {
    fs.unlinkSync(path.join(skinsDir(), entry.file));
  } catch {
    /* already gone */
  }
  saveMeta(list.filter((s) => s.id !== id));
}

// Mojang's skin/cape endpoints are rate-limited (roughly one change per
// ~30-60s) and just return a bare 429 with no useful body. This is Mojang's
// limit, not ours — callers use err.rateLimited to treat it as a quiet
// background retry-later instead of a hard failure the user has to deal with.
async function throwMojangError(res, accusative, genitive) {
  if (res.status === 429) {
    const err = new Error(`Mojang временно ограничил смену ${genitive} — попробуем снова чуть позже.`);
    err.rateLimited = true;
    throw err;
  }
  if (res.status === 401) {
    const err = new Error('Microsoft session expired — войдите в аккаунт заново (иконка аккаунта в боковой панели → добавить аккаунт Microsoft), затем повторите.');
    err.sessionExpired = true;
    throw err;
  }
  const text = await res.text().catch(() => '');
  throw new Error(`Failed изменить ${accusative} (${res.status}). ${text}`.trim());
}

function assertSessionFresh(account) {
  if (account.minecraftAccessTokenExpiresAt && account.minecraftAccessTokenExpiresAt < Date.now()) {
    const err = new Error('Microsoft session expired — войдите в аккаунт заново (иконка аккаунта в боковой панели → добавить аккаунт Microsoft), затем повторите.');
    err.sessionExpired = true;
    throw err;
  }
}

async function uploadSkin(account, buf, variant, fileName) {
  if (!account || account.type !== 'microsoft') {
    throw new Error('Смена скина доступна только для аккаунта Microsoft');
  }
  assertSessionFresh(account);
  const form = new FormData();
  form.append('variant', variant === 'slim' ? 'slim' : 'classic');
  form.append('file', new Blob([buf], { type: 'image/png' }), fileName);

  const res = await fetch('https://api.minecraftservices.com/minecraft/profile/skins', {
    method: 'POST',
    headers: { Authorization: `Bearer ${account.minecraftAccessToken}` },
    body: form,
  });
  if (!res.ok) await throwMojangError(res, 'скин', 'скина');
  return res.json(); // { id, name, skins, capes }
}

async function applySkin(id, account) {
  const entry = loadMeta().find((s) => s.id === id);
  if (!entry) throw new Error('Skin не найден в библиотеке');
  const buf = fs.readFileSync(path.join(skinsDir(), entry.file));
  return uploadSkin(account, buf, entry.variant, entry.file);
}

// Re-uploads the account's currently-equipped skin texture with a different
// arm-width variant — same thing the official skin-customization screen
// does when you flip Classic/Slim without changing the picture.
async function applyVariantToCurrentSkin(account, variant) {
  if (!account?.skinUrl) throw new Error('No активного скина, чтобы изменить тип рук');
  const res = await fetch(account.skinUrl);
  if (!res.ok) throw new Error('Failed скачать текущий скин');
  const buf = Buffer.from(await res.arrayBuffer());
  return uploadSkin(account, buf, variant, 'skin.png');
}

async function setActiveCape(account, capeId) {
  if (!account || account.type !== 'microsoft') {
    throw new Error('Смена плаща доступна только для аккаунта Microsoft');
  }
  assertSessionFresh(account);
  const url = 'https://api.minecraftservices.com/minecraft/profile/capes/active';
  const res = capeId
    ? await fetch(url, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${account.minecraftAccessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ capeId }),
    })
    : await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${account.minecraftAccessToken}` },
    });
  if (!res.ok) await throwMojangError(res, 'плащ', 'плаща');
  // The active-cape endpoints return 204/empty on success — fetch the full
  // profile afterward so the caller gets fresh skins+capes state.
  const profileRes = await fetch('https://api.minecraftservices.com/minecraft/profile', {
    headers: { Authorization: `Bearer ${account.minecraftAccessToken}` },
  });
  if (!profileRes.ok) throw new Error(`Failed обновить профиль (${profileRes.status})`);
  return profileRes.json();
}

module.exports = {
  listSkins, addSkin, getSkinFile, deleteSkin, applySkin, applyVariantToCurrentSkin, setActiveCape, setVariant, skinsDir,
};
