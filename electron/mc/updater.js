// Self-update from your own server. Flow:
//   check()    fetch latest.json, verify its Ed25519 signature, compare versions
//   download() fetch the installer next to it, verify size + SHA-256
//   install()  re-verify the file, run it silently, quit (the installer restarts the app)
// Trust comes from the signature, not from the connection: the public key is inside the
// app (electron/updatePublicKey.js), the private key never leaves the publisher, so a
// hacked server or a man in the middle can't hand out a program the launcher accepts.
const { app, shell } = require('electron');
const { siteFetch } = require('./siteFetch');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const publicKeyPem = require('../updatePublicKey');
const { FEED_URL } = require('../updateConfig');
const { signedMessage, compareVersions, validateManifest } = require('./updateFormat');

const publicKey = crypto.createPublicKey(publicKeyPem);
let ready = null; // { manifest, file } once an installer is downloaded and verified
let downloading = null;
let githubAssetUrl = '';

function feedUrl(override) {
  const url = String(override || FEED_URL || '').trim();
  if (!url) return null;
  let u;
  try { u = new URL(url); } catch { throw new Error('Некорректный адрес обновлений'); }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) throw new Error('Address обновлений должен быть https');
  return u;
}

async function fetchManifest(feed) {
  const res = await siteFetch(feed, () => ({ signal: AbortSignal.timeout(12000), cache: 'no-store', headers: { 'User-Agent': `ZoryaLauncher/${app.getVersion()}` } }));
  if (!res.ok) {
    const err = new Error(`Server обновлений ответил ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const text = await res.text();
  if (text.length > 64 * 1024) throw new Error('Слишком большой latest.json');
  const manifest = validateManifest(JSON.parse(text));
  const ok = crypto.verify(null, signedMessage(manifest), publicKey, Buffer.from(manifest.signature, 'base64'));
  if (!ok) throw new Error('Подпись обновления неверна — оно не от автора лаунчера. Установка отменена.');
  return manifest;
}

// -> { ok, configured, current, latest?, hasUpdate?, notes?, size?, error? }
async function check(override) {
  const current = app.getVersion();
  try {
    const feed = feedUrl(override);
    if (!feed) {
      // Zorya: check the public GitHub release instead of the old signed feed.
      const res = await fetch('https://api.github.com/repos/romamakovij7-cmyk/zorya-launcher/releases/latest', {
        signal: AbortSignal.timeout(12000),
        headers: { 'User-Agent': `ZoryaLauncher/${current}`, Accept: 'application/vnd.github+json' },
      });
      if (!res.ok) return { ok: true, configured: true, current, hasUpdate: false };
      const rel = await res.json();
      const latest = String(rel.tag_name || '').replace(/^v/, '');
      const hasUpdate = compareVersions(latest, current) > 0;
      githubAssetUrl = (rel.assets || []).find((a) => /setup/i.test(a.name))?.browser_download_url || rel.html_url;
      return {
        ok: true, configured: true, current, latest, hasUpdate,
        notes: String(rel.body || '').slice(0, 2000), date: rel.published_at || null,
        size: (rel.assets || []).find((a) => /setup/i.test(a.name))?.size || 0,
      };
    }
    const m = await fetchManifest(feed);
    const hasUpdate = compareVersions(m.version, current) > 0;
    return {
      ok: true, configured: true, current, latest: m.version, hasUpdate, size: m.size, notes: String(m.notes || '').slice(0, 2000), date: m.date || null,
    };
  } catch (err) {
    // Nothing published there yet: nothing newer, not an error.
    if (err.status === 404) return { ok: true, configured: true, current, hasUpdate: false };
    return { ok: false, configured: true, current, error: err.message };
  }
}

function updatesDir() {
  const dir = path.join(app.getPath('userData'), 'updates');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (c) => hash.update(c)).on('end', () => resolve(hash.digest('hex'))).on('error', reject);
  });
}

// Downloads and verifies the installer; onProgress({ loaded, total }).
function download(override, onProgress) {
  if (downloading) return downloading;
  downloading = (async () => {
    try {
      const feed = feedUrl(override);
      if (!feed) {
        if (githubAssetUrl) await shell.openExternal(githubAssetUrl);
        return { ok: true, opened: true };
      }
      const manifest = await fetchManifest(feed);
      if (compareVersions(manifest.version, app.getVersion()) <= 0) throw new Error('Update не новее установленной версии');
      if (ready && ready.manifest.sha256 === manifest.sha256 && fs.existsSync(ready.file)) return { ok: true, version: manifest.version };

      const dir = updatesDir();
      for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { force: true }); // earlier leftovers
      const file = path.join(dir, manifest.file);
      const part = `${file}.part`;
      const url = new URL(manifest.file, feed); // the installer must sit next to latest.json

      const res = await siteFetch(url, () => ({ headers: { 'User-Agent': `ZoryaLauncher/${app.getVersion()}` } }));
      if (!res.ok) throw new Error(`Failed скачать обновление (${res.status})`);
      const hash = crypto.createHash('sha256');
      const out = fs.createWriteStream(part);
      let loaded = 0;
      let lastReport = 0;
      try {
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          loaded += value.length;
          if (loaded > manifest.size) throw new Error('File больше, чем заявлено в latest.json');
          hash.update(value);
          if (!out.write(value)) await new Promise((r) => out.once('drain', r));
          const now = Date.now();
          if (onProgress && now - lastReport > 150) { lastReport = now; onProgress({ loaded, total: manifest.size }); }
        }
        await new Promise((resolve, reject) => { out.end((err) => (err ? reject(err) : resolve())); });
      } catch (err) {
        out.destroy();
        fs.rmSync(part, { force: true });
        throw err;
      }
      if (loaded !== manifest.size || hash.digest('hex') !== manifest.sha256) {
        fs.rmSync(part, { force: true });
        throw new Error('Скачанный файл повреждён или подменён (не совпала контрольная сумма). Установка отменена.');
      }
      fs.renameSync(part, file);
      ready = { manifest, file };
      onProgress?.({ loaded, total: manifest.size });
      return { ok: true, version: manifest.version };
    } catch (err) {
      return { ok: false, error: err.message };
    } finally {
      downloading = null;
    }
  })();
  return downloading;
}

// Runs the downloaded installer and quits so it can replace the files.
async function install() {
  if (!ready) return { ok: false, error: 'Update ещё не скачано' };
  if (!app.isPackaged) return { ok: false, error: 'Установка обновлений работает только в установленной версии лаунчера' };
  try {
    // The file sat in a user-writable folder for a while: check it once more right before running it.
    const st = fs.statSync(ready.file);
    if (st.size !== ready.manifest.size || (await sha256File(ready.file)) !== ready.manifest.sha256) {
      ready = null;
      return { ok: false, error: 'File обновления изменился после скачивания — скачайте его заново' };
    }
    // /S silent, --updated tells the installer this is an update, --force-run starts the app again afterwards.
    const child = spawn(ready.file, ['/S', '--updated', '--force-run'], { detached: true, stdio: 'ignore' });
    child.unref();
    setTimeout(() => app.quit(), 400);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = {
  check, download, install, isReady: () => !!ready,
};
