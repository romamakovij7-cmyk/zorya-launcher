// Zorya Launcher: no site account / subscription gate.
// Keeps the same interface as the fork's original license module so the rest
// of the launcher keeps working, but every check passes locally.
function status() {
  return { valid: true, premium: true, site: false, offline: true };
}
function isValid() { return true; }
function hasSiteAuth() { return false; }
function siteBearer() { return null; }
function siteUrl() { return 'https://localhost'; }

async function login() { return { ok: false, error: 'Zorya Launcher does not use site accounts' }; }
async function tgStart() { return { ok: false, error: 'Not available' }; }
async function tgStatus() { return { ok: false, error: 'Not available' }; }
async function tgFinish() { return { ok: false, error: 'Not available' }; }
async function refresh() { return { ok: true, ...status() }; }
async function logout() { return { ok: true, ...status() }; }
async function siteRequest() { return { ok: false, error: 'No site connection in Zorya Launcher' }; }

module.exports = {
  isValid, status, login, tgStart, tgStatus, tgFinish, refresh, logout,
  siteRequest, siteUrl, hasSiteAuth, siteBearer,
};
