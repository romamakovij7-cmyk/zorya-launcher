// Own skins for offline accounts (the server side is on the site). The game is started with authlib-injector
// (github.com/yushijinhun/authlib-injector, a Java agent): it points the game's skin lookups at our skin server, so
// every Zorya player sees the skins of everybody else — on offline-mode servers and in LAN too. Microsoft accounts
// are not touched (they keep Mojang's own skins).
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const paths = require('./paths');
const license = require('./license');
const store = require('../store');
const { downloadChecked } = require('./horizon');
const { app } = require('electron');

// authlib-injector 1.2.8, pinned by SHA-256 (from the project's own artifact site): a swapped file is never run.
const INJECTOR = {
  version: '1.2.8',
  sha256: '9c7f4343e6c82034958ffb48c14a2cb0c85928be7283103ce17da00c6d5a7b10',
  urls: [
    'https://authlib-injector.yushi.moe/artifact/56/authlib-injector-1.2.8.jar',
    'https://github.com/yushijinhun/authlib-injector/releases/download/v1.2.8/authlib-injector-1.2.8.jar',
  ],
};
const OFFLINE_NAME = /^[A-Za-z0-9_]{3,16}$/;

const apiRoot = () => `${license.siteUrl().origin}/api/skins`;

function injectorPath() {
  return path.join(paths.ensureDir(path.join(paths.metaDir(), 'authlib-injector')), `authlib-injector-${INJECTOR.version}.jar`);
}

function sha256Of(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

let pending = null;
// The agent jar on disk, downloaded and checked on first use.
async function ensureInjector() {
  const file = injectorPath();
  try { if (sha256Of(file) === INJECTOR.sha256) return file; } catch { /* not there yet */ }
  if (pending) return pending;
  pending = (async () => {
    const errors = [];
    for (const url of INJECTOR.urls) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await downloadChecked(url, file, INJECTOR.sha256);
        return file;
      } catch (err) { errors.push(err.message); }
    }
    throw new Error(`Failed скачать authlib-injector: ${errors.join('; ')}`);
  })().finally(() => { pending = null; });
  return pending;
}

// The skin server's own description of itself (GET <api root>), handed to the agent up front: the game then starts without
// waiting for the site. It carries the key the skins are signed with — the game shows OTHER players only signed skins —
// so it has to come from the server, not be written here. The last good copy is kept for when the site can't be reached.
function validMetadata(m, host) {
  try {
    if (!m || typeof m !== 'object' || !Array.isArray(m.skinDomains) || typeof m.signaturePublickey !== 'string') return false;
    // The agent may only be told to trust textures from our site and Mojang's.
    if (!m.skinDomains.every((d) => d === host || d === '.minecraft.net' || d === '.mojang.com')) return false;
    crypto.createPublicKey(m.signaturePublickey);
    return !!m.meta && typeof m.meta === 'object';
  } catch { return false; }
}

async function fetchMetadata() {
  const host = license.siteUrl().hostname;
  try {
    const res = await fetch(apiRoot(), { signal: AbortSignal.timeout(6000), cache: 'no-store', headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`сайт ответил ${res.status}`);
    const m = await res.json();
    if (!validMetadata(m, host)) throw new Error('сервер скинов вернул неожиданный ответ');
    store.set('skinMetadata', m);
    return m;
  } catch (err) {
    const cached = store.get('skinMetadata');
    if (validMetadata(cached, host)) return cached;
    throw new Error(`сервер скинов недоступен: ${err.message}`);
  }
}

// JVM arguments to put before the main class.
async function jvmArgs() {
  const [jar, meta] = await Promise.all([ensureInjector(), fetchMetadata()]);
  return [
    `-javaagent:${jar}=${apiRoot()}`,
    `-Dauthlibinjector.yggdrasil.prefetched=${Buffer.from(JSON.stringify(meta)).toString('base64')}`,
    '-Dauthlibinjector.noShowServerName',
    // Our skin server has no chat-signing keys, so by default the injector answers the game's request for one with a made-up key whose
    // signature is junk: the game sends it when joining, and an online-mode server (a LAN world of a licensed player) refuses with
    // "Invalid signature for profile public key". "enabled" tells the injector not to make one up (the option is named from the point
    // of view of the skin server: "it provides keys"), so the request goes on to Mojang, which refuses a game without a real login —
    // the game then has no signing key, as an offline account always had.
    '-Dauthlibinjector.profileKey=enabled',
    // For finding out why a skin isn't shown, add '-Dauthlibinjector.debug=verbose,authlib': every request the game makes to the
    // skin server then goes to <game folder>/authlib-injector.log.
  ];
}

// Puts an offline account's skin on the server (the nick becomes the site account's). entry: { buf, variant }.
async function publish(account, entry) {
  if (!OFFLINE_NAME.test(String(account.name || ''))) {
    return { ok: false, error: 'Skin на сервере доступен для ников из 3–16 латинских букв, цифр и _.' };
  }
  try {
    const r = await license.siteRequest('/api/launcher/skin', {
      method: 'POST',
      body: { name: account.name, model: entry.variant === 'slim' ? 'slim' : 'default', png: `data:image/png;base64,${entry.buf.toString('base64')}` },
    });
    if (r.ok) return { ok: true };
    return { ok: false, error: r.data.error || `Сайт ответил ${r.status}`, code: r.data.code || null };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ---- proof that a Microsoft account is yours (the site refuses to link or take over a UUID without it) ----
// The game's own sign-in protocol: the site hands out a one-time code, the launcher tells MOJANG "I am joining with this code" (the
// token goes to Mojang only, like every time the game joins a server), the site asks Mojang who joined with that code. The token
// never reaches the site. Offline accounts have nothing to prove (their nick is the site login).
const mojangSession = () => (!app.isPackaged && process.env.ETERNAL_MOJANG_SESSION_URL) || 'https://sessionserver.mojang.com/session/minecraft';
const verifiedAt = new Map(); // uuid -> when it was last confirmed in this run (the site is asked again after half an hour)
const VERIFIED_TTL_MS = 30 * 60 * 1000;

async function ensureVerified(account) {
  if (!account || account.type !== 'microsoft') return { ok: true };
  const uuid = String(account.id || '').replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(uuid)) return { ok: false, error: 'неверный идентификатор аккаунта' };
  const seen = verifiedAt.get(uuid);
  if (seen && Date.now() - seen < VERIFIED_TTL_MS) return { ok: true };
  try {
    const st = await license.siteRequest(`/api/launcher/verify/status?uuid=${uuid}`);
    if (!st.ok) return { ok: false, error: st.data.error || `Сайт ответил ${st.status}` };
    if (st.data.verified) { verifiedAt.set(uuid, Date.now()); return { ok: true }; }
    if (!st.data.premium) return { ok: true, skipped: true }; // без подписки привязывать нечего: сервер всё равно откажет
    const token = account.minecraftAccessToken;
    if (!token) return { ok: false, error: 'нет токена Microsoft: войдите в аккаунт заново' };
    const ch = await license.siteRequest('/api/launcher/verify/challenge', { method: 'POST', body: { uuid, name: account.name } });
    if (!ch.ok) return { ok: false, error: ch.data.error || `Сайт ответил ${ch.status}` };
    if (!ch.data.serverId) return { ok: true, skipped: true };
    const join = await fetch(`${mojangSession()}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'ZoryaLauncher' },
      body: JSON.stringify({ accessToken: token, selectedProfile: uuid, serverId: ch.data.serverId }),
      signal: AbortSignal.timeout(8000),
      redirect: 'error',
    });
    if (join.status !== 204 && join.status !== 200) return { ok: false, error: 'Mojang не принял вход: сессия устарела, войдите в аккаунт Microsoft заново' };
    const done = await license.siteRequest('/api/launcher/verify/confirm', { method: 'POST', body: { serverId: ch.data.serverId } });
    if (!done.ok) return { ok: false, error: done.data.error || `Сайт ответил ${done.status}`, code: done.data.code || null };
    if (done.data.verified) verifiedAt.set(uuid, Date.now());
    return { ok: true, takenOver: !!done.data.takenOver };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
// ---- capes ----

let capesCache = null;
// Our capes: [{ id, name, url, width, height }]. Kept in memory for a few minutes.
async function listCapes() {
  if (capesCache && Date.now() - capesCache.at < 5 * 60 * 1000) return capesCache.list;
  const res = await fetch(`${apiRoot()}/capes`, { signal: AbortSignal.timeout(10000), cache: 'no-store', headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`сайт ответил ${res.status}`);
  const data = await res.json();
  const host = license.siteUrl().hostname;
  const list = (Array.isArray(data.capes) ? data.capes : []).filter((c) => c && /^[a-z0-9_-]{1,32}$/.test(String(c.id)) && typeof c.url === 'string' && (() => {
    try { return new URL(c.url).hostname === host; } catch { return false; }
  })()).map((c) => ({
    id: String(c.id), name: String(c.name || c.id).slice(0, 40), url: c.url, width: Number(c.width) || 64, height: Number(c.height) || 32,
  }));
  capesCache = { at: Date.now(), list };
  return list;
}

// Tells the site which of our capes this account wears (capeId null = none). Works for offline and Microsoft accounts.
async function setCape(account, capeId) {
  if (!OFFLINE_NAME.test(String(account.name || ''))) {
    return { ok: false, error: 'Cape на сервере доступен для ников из 3–16 латинских букв, цифр и _.' };
  }
  const proof = await ensureVerified(account);
  if (!proof.ok) return { ok: false, error: `Failed подтвердить аккаунт Microsoft: ${proof.error}` };
  try {
    const r = await license.siteRequest('/api/launcher/cape', {
      method: 'POST',
      body: {
        kind: account.type === 'microsoft' ? 'microsoft' : 'offline', name: account.name, uuid: account.id, capeId: capeId || null,
      },
    });
    return r.ok ? { ok: true } : { ok: false, error: r.data.error || `Сайт ответил ${r.status}`, code: r.data.code || null };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Tells the site whether this account wears the hearts (the game agent of every Zorya player asks the site about each player).
async function setHearts(account, enabled) {
  if (!OFFLINE_NAME.test(String(account.name || ''))) {
    return { ok: false, error: 'Hearts на сервере доступны для ников из 3–16 латинских букв, цифр и _.' };
  }
  const proof = await ensureVerified(account);
  if (!proof.ok) return { ok: false, error: `Failed подтвердить аккаунт Microsoft: ${proof.error}` };
  try {
    const r = await license.siteRequest('/api/launcher/hearts', {
      method: 'POST',
      body: {
        kind: account.type === 'microsoft' ? 'microsoft' : 'offline', name: account.name, uuid: account.id, enabled: !!enabled,
      },
    });
    return r.ok ? { ok: true } : { ok: false, error: r.data.error || `Сайт ответил ${r.status}`, code: r.data.code || null };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Links this account to the site account (premium only, no-op otherwise): the nick colour is then shown in everybody's game.
async function link(account) {
  if (!OFFLINE_NAME.test(String(account.name || ''))) return { ok: false, error: 'ник not suitable для сервера' };
  const proof = await ensureVerified(account);
  if (!proof.ok) return { ok: false, error: proof.error };
  try {
    const r = await license.siteRequest('/api/launcher/link', {
      method: 'POST',
      body: { kind: account.type === 'microsoft' ? 'microsoft' : 'offline', name: account.name, uuid: account.id },
    });
    return r.ok ? { ok: true, linked: r.data.linked !== false } : { ok: false, error: r.data.error || `Сайт ответил ${r.status}` };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function unpublish(account) {
  if (!OFFLINE_NAME.test(String(account.name || ''))) return { ok: true };
  try {
    const r = await license.siteRequest(`/api/launcher/skin/${encodeURIComponent(account.name)}`, { method: 'DELETE' });
    return r.ok || r.status === 404 ? { ok: true } : { ok: false, error: r.data.error || `Сайт ответил ${r.status}` };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = {
  ensureInjector, jvmArgs, publish, unpublish, listCapes, setCape, setHearts, link, ensureVerified, injectorPath, INJECTOR,
};
