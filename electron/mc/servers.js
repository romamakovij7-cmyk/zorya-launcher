const fs = require('fs');
const path = require('path');
const paths = require('./paths');
const store = require('../store');
const { parseNbtFile, writeServersDat } = require('./nbt');
const { pingServer } = require('./serverPing');
const { supportsQuickPlay } = require('./recents');

const MOTD_COLOR_RE = /§[0-9a-fk-or]/gi;
function stripColors(s) {
  return (s || '').replace(MOTD_COLOR_RE, '');
}

function serversDatPath(instanceId) {
  return path.join(paths.instanceGameDir(instanceId), 'servers.dat');
}

function readServersRaw(instanceId) {
  const p = serversDatPath(instanceId);
  if (!fs.existsSync(p)) return [];
  try {
    const nbt = parseNbtFile(fs.readFileSync(p));
    return nbt.servers || [];
  } catch {
    return [];
  }
}

// Like readServersRaw, but tells "there is no file" from "there is a file we cannot read" (a caller that is about to WRITE must never
// take a damaged file for an empty list and overwrite it).
function readServersStrict(instanceId) {
  const p = serversDatPath(instanceId);
  if (!fs.existsSync(p)) return { exists: false, ok: true, list: [] };
  try {
    const nbt = parseNbtFile(fs.readFileSync(p));
    return { exists: true, ok: Array.isArray(nbt.servers) || nbt.servers === undefined, list: Array.isArray(nbt.servers) ? nbt.servers : [] };
  } catch {
    return { exists: true, ok: false, list: [] };
  }
}

function writeServersRaw(instanceId, list) {
  const file = serversDatPath(instanceId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Written next to the file and renamed over it: a crash or a power cut in the middle never leaves a half-written servers.dat.
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, writeServersDat(list));
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* nothing */ }
    throw err;
  }
}

function pinKey(instanceId, address) {
  return `${instanceId}|${address}`;
}

// Every server saved in this instance's servers.dat (not just the top few
// shown in the cross-instance "Recent" list on Home), pinged live and
// merged with our own pinned-state (kept outside servers.dat since Mojang's
// format has no such field).
async function listInstanceServers(instanceId) {
  const instances = store.get('instances') || [];
  const instance = instances.find((i) => i.id === instanceId);
  const raw = readServersRaw(instanceId);
  const pinned = store.get('pinnedServers') || {};

  const results = raw.map((s, index) => ({
    index,
    name: s.name || s.ip,
    address: s.ip,
    icon: s.icon ? `data:image/png;base64,${s.icon}` : null,
    pinned: !!pinned[pinKey(instanceId, s.ip)],
    canQuickPlay: instance ? supportsQuickPlay(instance.mcVersion) : false,
  })).filter((r) => typeof r.address === 'string' && r.address); // an entry without an address (foreign/corrupt servers.dat) can't be pinged

  await Promise.all(results.map(async (entry) => {
    const [host, portStr] = entry.address.split(':');
    const port = portStr ? parseInt(portStr, 10) : 25565;
    try {
      const status = await pingServer(host, port, 3000);
      entry.online = status.online;
      entry.max = status.max;
      entry.motd = stripColors(status.motd);
      entry.ping = status.ping;
      if (!entry.icon && status.favicon) entry.icon = status.favicon;
      entry.reachable = true;
    } catch {
      entry.reachable = false;
    }
  }));

  results.sort((a, b) => (b.pinned - a.pinned) || (a.index - b.index));
  return results;
}

function addServer(instanceId, address, name) {
  const raw = readServersRaw(instanceId);
  raw.push({ ip: address, name: name || address, acceptTextures: 1 });
  writeServersRaw(instanceId, raw);
}

function deleteServer(instanceId, index) {
  const raw = readServersRaw(instanceId);
  if (index < 0 || index >= raw.length) return;
  const [removed] = raw.splice(index, 1);
  writeServersRaw(instanceId, raw);
  if (removed) {
    const pinned = store.get('pinnedServers') || {};
    delete pinned[pinKey(instanceId, removed.ip)];
    store.set('pinnedServers', pinned);
  }
}

function setServerPinned(instanceId, address, isPinned) {
  const pinned = store.get('pinnedServers') || {};
  const key = pinKey(instanceId, address);
  if (isPinned) pinned[key] = true;
  else delete pinned[key];
  store.set('pinnedServers', pinned);
}

module.exports = { listInstanceServers, addServer, deleteServer, setServerPinned, readServersStrict, readServersRaw, writeServersRaw, serversDatPath };
