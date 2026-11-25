// What an update announcement (latest.json) looks like and exactly which bytes are
// signed. Shared by the launcher (verifies) and the release tooling (signs),
// so it must not depend on electron.
//
//   { "version": "0.2.0", "file": "Zorya-Launcher-Setup-0.2.0.exe", "size": 85123456,
//     "sha256": "<hex>", "notes": "что нового", "date": "2026-10-20T10:00:00Z",
//     "signature": "<base64 Ed25519>" }
//
// The signature covers version, file name, size and sha256 — so a swapped installer, a
// renamed one, or an old release re-labelled as a new version all fail verification.

function signedMessage(m) {
  return Buffer.from(`zorya-launcher-update\n${m.version}\n${m.file}\n${m.size}\n${m.sha256}`, 'utf8');
}

const VERSION_RE = /^\d+(\.\d+){1,3}$/;
const FILE_RE = /^[A-Za-z0-9._-]{1,120}\.exe$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

// 1 if a > b, -1 if a < b, 0 if equal ("0.10.0" > "0.9.0").
function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

// Shape check only (the signature is checked separately).
function validateManifest(m) {
  if (!m || typeof m !== 'object') throw new Error('Пустой ответ сервера обновлений');
  if (typeof m.version !== 'string' || !VERSION_RE.test(m.version)) throw new Error('В latest.json некорректная версия');
  if (typeof m.file !== 'string' || !FILE_RE.test(m.file)) throw new Error('В latest.json некорректное имя файла');
  if (!Number.isInteger(m.size) || m.size <= 0 || m.size > 1024 * 1024 * 1024) throw new Error('В latest.json некорректный размер');
  if (typeof m.sha256 !== 'string' || !SHA256_RE.test(m.sha256)) throw new Error('В latest.json некорректная контрольная сумма');
  if (typeof m.signature !== 'string' || !m.signature) throw new Error('Обновление не подписано');
  return m;
}

module.exports = {
  signedMessage, compareVersions, validateManifest,
};
