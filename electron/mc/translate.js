// Free machine translation (Google's public "gtx" endpoint — no key needed) for
// project descriptions and changelogs. Best-effort: quality is "readable".
//
// The endpoint rate-limits per client rather than being generous — inside
// Electron, both net.fetch and the global fetch share the same throttled
// state (confirmed: hammering one 429s the other too), so there is no "other
// path" to fall back to. Every request in the whole app funnels through one
// queue (never more than one in flight, with a minimum gap between them) so
// several translations don't hammer the endpoint in parallel — but a 429
// still fails back to the caller quickly (a couple of short retries, a few
// seconds total) rather than sitting there waiting it out: a translation
// that just hangs for the better part of a minute is worse than one that
// fails fast with a clear "try again in a bit".
let doFetch = (...args) => fetch(...args);
try {
  const { net } = require('electron');
  if (net && typeof net.fetch === 'function') doFetch = (...args) => net.fetch(...args);
} catch { /* plain Node (tests) */ }

const TARGET = 'ru';
const ENDPOINT = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&dt=t';
const MAX_CHARS = 3800; // per request (the endpoint refuses very long bodies)
const MIN_GAP_MS = 300; // spacing between requests even when everything's healthy
const COOLDOWNS_MS = [1000, 2500, 4000]; // short escalation on repeated 429/5xx — seconds, not a minute
const MAX_ATTEMPTS = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- shared gate: one request at a time, app-wide, with a shared cooldown ----
let queueTail = Promise.resolve();
let lastRequestAt = 0;
let cooldownUntil = 0;
let cooldownStep = -1;

async function waitTurn() {
  const myTurn = queueTail.then(() => {});
  let release;
  queueTail = new Promise((r) => { release = r; });
  await myTurn;
  const wait = Math.max(0, cooldownUntil - Date.now(), lastRequestAt + MIN_GAP_MS - Date.now());
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
  return release;
}

function noteThrottled() {
  cooldownStep = Math.min(cooldownStep + 1, COOLDOWNS_MS.length - 1);
  cooldownUntil = Date.now() + COOLDOWNS_MS[cooldownStep];
}

function noteHealthy() {
  cooldownStep = -1;
}

// Names that must survive translation untouched ("Fabric" must not become "ткань").
const PROTECTED = [
  'Minecraft', 'Modrinth', 'CurseForge', 'Fabric API', 'Fabric', 'NeoForge', 'Forge', 'Quilt', 'OptiFine', 'Iris', 'Sodium',
  'Discord', 'GitHub', 'YouTube', 'Patreon', 'Ko-fi', 'Twitch', 'Java', 'Bukkit', 'Spigot', 'Paper', 'Mojang', 'Microsoft',
];

// Swap protected names for letter tokens Google leaves alone, and back again.
function tokenLetters(i) {
  let s = '';
  let n = i;
  do { s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
}
function makeProtector(extra) {
  const terms = [...new Set([...(extra || []), ...PROTECTED].filter((t) => t && t.length > 1))].sort((a, b) => b.length - a.length);
  return {
    enc(text) {
      let out = text;
      terms.forEach((t, i) => { out = out.split(t).join(`QQ${tokenLetters(i)}QQ`); });
      return out;
    },
    dec(text) {
      let out = text;
      terms.forEach((t, i) => { out = out.replace(new RegExp(`QQ${tokenLetters(i)}QQ`, 'gi'), () => t); });
      return out;
    },
  };
}

const cache = new Map(); // "ru|text" -> translation
const CACHE_LIMIT = 6000;

async function callGoogle(text, tl) {
  let lastErr = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    // eslint-disable-next-line no-await-in-loop
    const release = await waitTurn();
    try {
      // eslint-disable-next-line no-await-in-loop
      const res = await doFetch(`${ENDPOINT}&tl=${tl}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'User-Agent': 'Mozilla/5.0 ZoryaLauncher' },
        body: `q=${encodeURIComponent(text)}`,
      });
      if (res.status === 429 || res.status >= 500) { noteThrottled(); throw new Error(`переводчик занят (${res.status})`); }
      if (!res.ok) throw new Error(`переводчик недоступен (${res.status})`);
      noteHealthy();
      // eslint-disable-next-line no-await-in-loop
      const json = await res.json();
      return (json[0] || []).map((seg) => seg[0] || '').join('');
    } catch (err) {
      lastErr = err;
    } finally {
      release();
    }
  }
  throw lastErr || new Error('failed перевести');
}

// One line per item: joined by "\n", translated together, split back. If the
// service returns a different number of lines, fall back to smaller pieces.
async function translateGroup(items, tl) {
  const joined = items.join('\n');
  const out = (await callGoogle(joined, tl)).split('\n');
  if (out.length === items.length) return out;
  if (items.length === 1) return [out.join(' ')];
  const mid = Math.ceil(items.length / 2);
  return [...await translateGroup(items.slice(0, mid), tl), ...await translateGroup(items.slice(mid), tl)];
}

// texts: string[] (each a single line). Returns translations in the same order.
// Requests for all of them (and for any other concurrent call — see the queue
// above) are serialized, so this is safe to call from several places at once.
async function translateTexts(texts, tl = TARGET, protect = []) {
  const prot = makeProtector(protect);
  const result = new Array(texts.length);
  const todo = [];
  texts.forEach((raw, i) => {
    const text = String(raw).replace(/\s*\n\s*/g, ' ').trim();
    if (!text || !/\p{L}/u.test(text)) { result[i] = raw; return; }
    const hit = cache.get(`${tl}|${text}`);
    if (hit !== undefined) { result[i] = hit; return; }
    todo.push({ i, text });
  });

  // pack into requests under the size limit
  const groups = [];
  let cur = [];
  let size = 0;
  for (const item of todo) {
    if (cur.length && size + item.text.length + 1 > MAX_CHARS) { groups.push(cur); cur = []; size = 0; }
    cur.push(item);
    size += item.text.length + 1;
  }
  if (cur.length) groups.push(cur);

  // The shared queue already caps real concurrency at 1 in-flight request, so
  // groups are simply submitted together and let the queue order them.
  await Promise.all(groups.map(async (group) => {
    const translated = await translateGroup(group.map((g) => prot.enc(g.text)), tl);
    group.forEach((g, k) => {
      const t = prot.dec(translated[k] ?? prot.enc(g.text));
      result[g.i] = t;
      if (cache.size > CACHE_LIMIT) cache.clear();
      cache.set(`${tl}|${g.text}`, t);
    });
  }));
  return result;
}

module.exports = { translateTexts };
