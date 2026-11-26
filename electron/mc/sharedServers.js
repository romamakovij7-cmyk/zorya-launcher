// "General серверы": one list of servers kept by the launcher and given to every build (into its servers.dat), so nobody adds the same
// servers by hand to each new build.
// Rules (see also the plain-language description in the UI):
//   • only ADDS: servers the player has in a build are never removed, reordered or changed; new ones go to the END of the list;
//   • no duplicates: addresses are compared without case and without the default port (play.x.ru == play.x.ru:25565);
//   • a shared server the player deleted in the game does not come back by itself (the build remembers what it was given);
//     the button "Add общие серверы" brings them back on purpose;
//   • a servers.dat that cannot be read is never overwritten, and the old file is kept once as servers.dat.zorya-bak;
//   • done before a launch or with the game closed (a running game would overwrite the file when it exits).
const fs = require('fs');
const servers = require('./servers');

const KEY = 'sharedServers';
const MAX_SERVERS = 50;
const KNOWN_FIELDS = new Set(['ip', 'name', 'icon', 'acceptTextures', 'hidden']);
const HOST_RE = /^(?:(?:\d{1,3}\.){3}\d{1,3}|[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)*)$/i;

// "Play.Example.ru." / "play.example.ru:25565" -> "play.example.ru"; a custom port stays: "play.example.ru:25566". null if not an address.
function normalize(address) {
  let s = String(address || '').trim().toLowerCase().replace(/\.+(?=:|$)/, '');
  if (!s || s.length > 260 || /[\s/\\@]/.test(s)) return null;
  const m = /^([^:]+)(?::(\d{1,5}))?$/.exec(s);
  if (!m || !HOST_RE.test(m[1])) return null;
  if (m[2] !== undefined) {
    const port = Number(m[2]);
    if (!(port >= 1 && port <= 65535)) return null;
    s = port === 25565 ? m[1] : `${m[1]}:${port}`;
  }
  return s;
}

const cleanName = (name, fallback) => {
  const n = String(name || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 60);
  return n || fallback;
};

function validate(entry) {
  const norm = normalize(entry && entry.address);
  if (!norm) return { ok: false, error: 'Address сервера: только имя или IP, при необходимости с портом (например, play.example.ru или play.example.ru:25566).' };
  return { ok: true, name: cleanName(entry.name, norm), address: String(entry.address).trim(), norm };
}

function list(store) {
  const raw = store.get(KEY);
  const out = [];
  const seen = new Set();
  for (const e of Array.isArray(raw) ? raw : []) {
    const v = validate(e);
    if (v.ok && !seen.has(v.norm)) { seen.add(v.norm); out.push({ name: v.name, address: v.address }); }
    if (out.length >= MAX_SERVERS) break;
  }
  return out;
}

function add(store, entry) {
  const v = validate(entry);
  if (!v.ok) return v;
  const cur = list(store);
  if (cur.some((s) => normalize(s.address) === v.norm)) return { ok: false, error: 'Такой сервер уже есть в общем списке.' };
  if (cur.length >= MAX_SERVERS) return { ok: false, error: `В общем списке может быть не больше ${MAX_SERVERS} серверов.` };
  cur.push({ name: v.name, address: v.address });
  store.set(KEY, cur);
  return { ok: true, servers: cur };
}

function remove(store, index) {
  const cur = list(store);
  if (!Number.isInteger(index) || index < 0 || index >= cur.length) return { ok: false, error: 'Server не найден.' };
  cur.splice(index, 1);
  store.set(KEY, cur);
  return { ok: true, servers: cur };
}

function move(store, index, dir) {
  const cur = list(store);
  const to = index + (dir < 0 ? -1 : 1);
  if (!Number.isInteger(index) || index < 0 || index >= cur.length || to < 0 || to >= cur.length) return { ok: false, error: 'Нельзя сдвинуть.' };
  [cur[index], cur[to]] = [cur[to], cur[index]];
  store.set(KEY, cur);
  return { ok: true, servers: cur };
}

// Takes every server of a build into the shared list (new ones only).
function importFrom(store, instanceId) {
  const strict = servers.readServersStrict(instanceId);
  if (!strict.exists) return { ok: false, error: 'У этой сборки ещё нет списка серверов: добавьте сервер в игре или запустите её один раз.' };
  if (!strict.ok) return { ok: false, error: 'File серверов этой сборки не читается.' };
  let added = 0;
  const cur = list(store);
  const seen = new Set(cur.map((s) => normalize(s.address)));
  for (const s of strict.list) {
    const v = validate({ name: s.name, address: s.ip });
    if (!v.ok || seen.has(v.norm) || cur.length >= MAX_SERVERS) continue;
    seen.add(v.norm); cur.push({ name: v.name, address: v.address }); added += 1;
  }
  if (added) store.set(KEY, cur);
  return { ok: true, added, servers: cur };
}

// Which shared servers are in this build's servers.dat and which are not.
function status(store, instance) {
  const shared = list(store);
  const strict = servers.readServersStrict(instance.id);
  if (!strict.ok) return { ok: true, total: shared.length, present: 0, missing: shared.map((s) => s.name), unreadable: true };
  const have = new Set(strict.list.map((s) => normalize(s.ip)).filter(Boolean));
  const missing = shared.filter((s) => !have.has(normalize(s.address))).map((s) => s.name);
  return { ok: true, total: shared.length, present: shared.length - missing.length, missing, unreadable: false };
}

// Gives the build the shared servers it lacks. force = also those the player deleted before (the button).
function applyTo(store, instance, { force = false } = {}) {
  if (!instance || instance.loader === 'horizon') return { ok: false, error: 'Для сборок Horizon это не поддерживается.' };
  const shared = list(store);
  if (!shared.length) return { ok: true, added: 0, reason: 'empty' };
  const strict = servers.readServersStrict(instance.id);
  if (!strict.ok) return { ok: false, error: 'File серверов этой сборки не читается, поэтому он не тронут.', reason: 'unreadable' };
  if (strict.list.some((s) => Object.keys(s).some((k) => !KNOWN_FIELDS.has(k)))) return { ok: false, error: 'В файле серверов есть незнакомые поля, поэтому он не тронут.', reason: 'unknown-fields' };

  const given = new Set(Array.isArray(instance.sharedServersGiven) ? instance.sharedServersGiven : []);
  const present = new Set(strict.list.map((s) => normalize(s.ip)).filter(Boolean));
  const toAdd = shared.filter((s) => { const n = normalize(s.address); return !present.has(n) && (force || !given.has(n)); });

  if (toAdd.length) {
    const p = servers.serversDatPath(instance.id);
    if (strict.exists) { try { if (!fs.existsSync(`${p}.zorya-bak`)) fs.copyFileSync(p, `${p}.zorya-bak`); } catch { /* the backup is a courtesy */ } }
    servers.writeServersRaw(instance.id, [...strict.list, ...toAdd.map((s) => ({ ip: s.address, name: s.name }))]); // no acceptTextures: the game asks about a server's resource pack as usual
  }
  // remember: everything that is in the file now counts as given (a server the player already had and deletes later is not forced back)
  const nowPresent = new Set([...present, ...toAdd.map((s) => normalize(s.address))]);
  const nextGiven = new Set([...given, ...shared.map((s) => normalize(s.address)).filter((n) => nowPresent.has(n))]);
  const instances = store.get('instances') || [];
  const cur = instances.find((i) => i.id === instance.id);
  if (cur && nextGiven.size !== given.size) { cur.sharedServersGiven = [...nextGiven]; store.set('instances', instances); }
  return { ok: true, added: toAdd.length, names: toAdd.map((s) => s.name) };
}

module.exports = { MAX_SERVERS, normalize, list, add, remove, move, importFrom, status, applyTo };
