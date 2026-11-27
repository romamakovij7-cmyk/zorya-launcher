const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

// Thousands of small files: Node's network stack first (it is several times faster for that), Chromium's (system proxy, secure DNS) when Node cannot
// reach the host. See mc/netFetch.js. Loaded on first use, so this file still works where Electron is not there.
let bulkImpl = null;
function bulkFetch(url, init) {
  if (!bulkImpl) {
    try { bulkImpl = require('./netFetch').bulkFetch; } catch { bulkImpl = (u, i) => fetch(u, i); }
  }
  return bulkImpl(url, init);
}

function sha1File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha1');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

// Every call here goes through the async fs.promises API rather than the
// *Sync variants. This runs per-asset across thousands of files (a fresh
// instance's asset index alone can be 20k+ entries) with many concurrent
// workers — using the Sync fs calls was hammering Electron's single main-
// process JS thread with blocking disk I/O and freezing the whole app
// (including renderer IPC) for the duration of asset/library downloads.
async function fileNeedsDownload(destPath, expectedSize, expectedSha1) {
  let stat;
  try {
    stat = await fsp.stat(destPath);
  } catch {
    return true;
  }
  if (expectedSize && stat.size !== expectedSize) return true;
  if (expectedSha1) {
    try {
      const actual = await sha1File(destPath);
      if (actual !== expectedSha1) return true;
    } catch {
      return true;
    }
  }
  return false;
}

const DOWNLOAD_RETRY_DELAYS_MS = [500, 1500, 3000];
const MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024; // nothing this launcher fetches is bigger

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// url: where to download from. With a Forge/NeoForge maven address the Zorya site's mirror is the way out when that address is blocked
// (mavenMirror.js): it is tried when the official one fails at the network level (or is cut with 403/451/5xx), or first with mirrorFirst.
// The checksum (expectedSha1) is checked on every path, so a file from the mirror must be the same as the repository's.
// onBytes(received, total): for ONE big file, called about every 0.2 s while it arrives (so the window can show a real progress bar).
async function downloadFile(url, destPath, { expectedSize, expectedSha1, signal, mirrorFirst, onBytes } = {}) {
  const needs = await fileNeedsDownload(destPath, expectedSize, expectedSha1);
  if (!needs) return { skipped: true };

  await fsp.mkdir(path.dirname(destPath), { recursive: true });

  const mirror = require('./mavenMirror').mirrorFor(url);
  const opts = { expectedSha1, signal, onBytes, expectedSize };
  if (mirror && mirrorFirst) return { ...(await downloadFrom(mirror.url, destPath, { ...opts, headers: mirror.headers })), viaMirror: true };
  try {
    return await downloadFrom(url, destPath, { ...opts, quick: !!mirror });
  } catch (err) {
    if (!mirror || signal?.aborted || !require('./mavenMirror').worthMirror(err)) throw err;
    try {
      return { ...(await downloadFrom(mirror.url, destPath, { ...opts, headers: mirror.headers })), viaMirror: true };
    } catch {
      throw err; // the first failure is the informative one (the official host and why)
    }
  }
}

// quick: for an address that has a fallback — no retries on a network failure and a 20 s wait for the server's first answer
async function downloadFrom(url, destPath, { expectedSha1, signal, headers, quick, onBytes, expectedSize } = {}) {
  // A single dropped connection to a CDN under load (e.g. many parallel
  // downloads from CurseForge/Forge mirrors) surfaces as a generic "fetch
  // failed" network error, not an HTTP status — retrying the individual
  // file a few times clears the vast majority of these without aborting
  // the whole batch install over a transient blip.
  let lastErr;
  for (let attempt = 0; ; attempt++) {
    try {
      let res;
      if (quick || headers) {
        const wait = new AbortController();
        const timer = setTimeout(() => wait.abort(), 20000);
        try {
          res = await bulkFetch(url, { signal: signal ? AbortSignal.any([signal, wait.signal]) : wait.signal, ...(headers ? { headers } : {}) });
        } finally { clearTimeout(timer); }
      } else {
        res = await bulkFetch(url, signal ? { signal } : undefined);
      }
      if (!res.ok) {
        let host = url;
        try { host = new URL(url).host; } catch { /* keep the address as is */ }
        const e = new Error(require('./netFetch').explainStatus('Failed скачать файл', res.status, host));
        e.httpStatus = res.status;
        throw e;
      }
      if (Number(res.headers.get('content-length')) > MAX_DOWNLOAD_BYTES) throw new Error(`File слишком большой (${url})`);
      // Streamed to disk (not held in memory) with a hard size cap even when the server sends no
      // Content-Length, so a hostile host can't make the launcher swallow gigabytes of RAM.
      const tmp = destPath + '.part';
      const sha1 = crypto.createHash('sha1');
      const out = fs.createWriteStream(tmp);
      let bytes = 0;
      const total = Number(res.headers.get('content-length')) || expectedSize || 0;
      let lastEmit = 0;
      try {
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.length;
          if (bytes > MAX_DOWNLOAD_BYTES) { reader.cancel().catch(() => {}); throw new Error(`File слишком большой (${url})`); }
          if (onBytes) {
            const now = Date.now();
            if (now - lastEmit >= 200) { lastEmit = now; try { onBytes(bytes, total); } catch { /* progress display only */ } }
          }
          sha1.update(value);
          if (!out.write(value)) await new Promise((r) => out.once('drain', r));
        }
        await new Promise((resolve, reject) => { out.end((err) => (err ? reject(err) : resolve())); });
      } catch (err) {
        out.destroy();
        await fsp.rm(tmp, { force: true });
        throw err;
      }
      // The hash was only ever checked on files already on disk: a download that
      // arrived corrupted or swapped on the way was kept (and trusted next time).
      if (expectedSha1 && sha1.digest('hex') !== String(expectedSha1).toLowerCase()) {
        await fsp.rm(tmp, { force: true });
        throw new Error(`Контрольная сумма не совпала: ${url}`);
      }
      await fsp.rename(tmp, destPath);
      return { skipped: false, bytes };
    } catch (err) {
      lastErr = err;
      if (signal?.aborted || attempt >= DOWNLOAD_RETRY_DELAYS_MS.length) {
        // a connection that broke in the middle of the file says only "terminated" / "fetch failed": say what it means
        if (/^(terminated|fetch failed|other side closed|socket hang up)$/i.test(String(lastErr && lastErr.message)) || /UND_ERR|ECONNRESET/.test(String(lastErr && lastErr.cause && lastErr.cause.code))) {
          const e = new Error('Соединение оборвалось во время загрузки. Проверьте интернет; если сайт блокируется провайдером, включите VPN на весь компьютер, и повторите. Недокачанные files докачаются при следующем запуске.');
          e.cause = lastErr;
          throw e;
        }
        throw lastErr;
      }
      if (quick && !lastErr.httpStatus) throw lastErr; // an address with a fallback: go there at once instead of waiting through the retries
      await sleep(DOWNLOAD_RETRY_DELAYS_MS[attempt]);
    }
  }
}

async function downloadAll(tasks, { concurrency = 8, onProgress, control } = {}) {
  let completed = 0;
  const total = tasks.length;
  let idx = 0;
  let failed = [];

  async function worker() {
    while (idx < tasks.length) {
      if (control) {
        try { await control.gate(); } catch { return; } // cancelled: stop taking new files
      }
      const myIdx = idx++;
      const task = tasks[myIdx];
      try {
        await downloadFile(task.url, task.dest, {
          expectedSize: task.size,
          expectedSha1: task.sha1,
          signal: control?.signal,
        });
      } catch (err) {
        if (control?.cancelled) return;
        failed.push({ task, error: err.message });
      }
      completed++;
      if (onProgress) onProgress({ completed, total, label: task.label });
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, Math.max(1, tasks.length)) }, worker);
  await Promise.all(workers);
  if (control?.cancelled) { const e = new Error('Loading отменена'); e.code = 'CANCELLED'; throw e; }

  if (failed.length) {
    const msg = failed.slice(0, 5).map((f) => `${f.task.label || f.task.url}: ${f.error}`).join('; ');
    throw new Error(`${failed.length} file(s) failed to download: ${msg}`);
  }
}

// Downloads a whole file into memory, chunk by chunk, so a pause/cancel can
// take effect mid-download. onProgress(loaded, total|0).
async function fetchBuffer(url, { control, onProgress } = {}) {
  const res = await fetch(url, control ? { signal: control.signal } : undefined);
  if (!res.ok) throw new Error(`Failed скачать (${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    if (control) await control.gate();
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
    loaded += value.length;
    if (loaded > MAX_DOWNLOAD_BYTES) { reader.cancel().catch(() => {}); throw new Error('File слишком большой'); }
    if (onProgress) onProgress(loaded, total);
  }
  return Buffer.concat(chunks);
}

module.exports = { downloadFile, downloadAll, sha1File, fileNeedsDownload, fetchBuffer };
