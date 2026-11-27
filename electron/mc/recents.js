const fs = require('fs');
const path = require('path');
const paths = require('./paths');
const store = require('../store');
const { parseNbtFile } = require('./nbt');
const { pingServer } = require('./serverPing');

const MOTD_COLOR_RE = /§[0-9a-fk-or]/gi;

function stripColors(s) {
  return (s || '').replace(MOTD_COLOR_RE, '');
}

// Minecraft's own launcher-args scheme for jumping directly into a world or
// server (--quickPlaySingleplayer / --quickPlayMultiplayer) only exists from
// 1.20 onward. This install's fictional post-1.21 versions dropped the
// leading "1." (e.g. "26.3"), so a plain major.minor compare would wrongly
// reject them — treat any non-"1.x" major as newer than 1.20.
function supportsQuickPlay(mcVersion) {
  if (!mcVersion) return false;
  const parts = mcVersion.split('.').map((p) => parseInt(p, 10));
  const major = parts[0];
  const minor = parts[1] || 0;
  if (Number.isNaN(major)) return false;
  if (major === 1) return minor >= 20;
  return major > 1;
}

function dismissKey(kind, instanceId, itemKey) {
  return `${kind}:${instanceId}|${itemKey}`;
}

// Hides a world/server from the Home "Recent" list without touching the
// actual save or server entry — it reappears on its own once played/
// connected to again, since that bumps its real recency signal back past
// this dismissal timestamp.
function dismissRecent(kind, instanceId, itemKey) {
  const dismissed = store.get('dismissedRecent') || {};
  dismissed[dismissKey(kind, instanceId, itemKey)] = Date.now();
  store.set('dismissedRecent', dismissed);
}

function listRecentWorlds(limit = 2) {
  const instances = store.get('instances') || [];
  const dismissed = store.get('dismissedRecent') || {};
  const results = [];
  for (const inst of instances) {
    const savesDir = path.join(paths.instanceGameDir(inst.id), 'saves');
    if (!fs.existsSync(savesDir)) continue;
    for (const entry of fs.readdirSync(savesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const worldDir = path.join(savesDir, entry.name);
      try {
        const nbt = parseNbtFile(fs.readFileSync(path.join(worldDir, 'level.dat')));
        const data = nbt.Data;
        const lastPlayed = Number(data.LastPlayed || 0n);
        const dismissedAt = dismissed[dismissKey('world', inst.id, entry.name)];
        if (dismissedAt && dismissedAt >= lastPlayed) continue;
        let icon = null;
        try {
          icon = `data:image/png;base64,${fs.readFileSync(path.join(worldDir, 'icon.png')).toString('base64')}`;
        } catch { /* no icon yet */ }
        results.push({
          kind: 'world',
          instanceId: inst.id,
          instanceName: inst.name,
          instanceIcon: inst.icon || null,
          instanceLoader: inst.loader,
          instanceMcVersion: inst.mcVersion,
          folderName: entry.name,
          levelName: data.LevelName || entry.name,
          lastPlayed,
          icon,
          canQuickPlay: supportsQuickPlay(inst.mcVersion),
        });
      } catch {
        /* unreadable/corrupt level.dat — skip this world */
      }
    }
  }
  return results.sort((a, b) => b.lastPlayed - a.lastPlayed).slice(0, limit);
}

function normalizeAddress(address) {
  // servers.dat entries are sometimes saved without an explicit port when
  // it's the default — normalize to "host:port" so it matches the
  // "Connecting to <host>, <port>" log line, which always includes one.
  return address.includes(':') ? address : `${address}:25565`;
}

async function listRecentServers(limit = 2) {
  const instances = store.get('instances') || [];
  const connections = store.get('serverConnections') || {};
  const dismissed = store.get('dismissedRecent') || {};
  const entries = [];
  for (const inst of instances) {
    const serversDat = path.join(paths.instanceGameDir(inst.id), 'servers.dat');
    if (!fs.existsSync(serversDat)) continue;
    try {
      const stat = fs.statSync(serversDat);
      const nbt = parseNbtFile(fs.readFileSync(serversDat));
      const list = nbt.servers || [];
      list.forEach((s, index) => {
        if (!s.ip) return;
        const connectedAt = connections[`${inst.id}|${normalizeAddress(s.ip)}`];
        // Prefer an actual observed connect time (tracked from the game's
        // own log — see ipc.js). Vanilla servers.dat has no such field and
        // isn't touched just by connecting, only by editing the saved list,
        // so fall back to the old file-recency/position heuristic for
        // servers we've never seen a real connection to yet.
        const sortKey = connectedAt || stat.mtimeMs - index;
        const dismissedAt = dismissed[dismissKey('server', inst.id, s.ip)];
        if (dismissedAt && dismissedAt >= sortKey) return;
        entries.push({
          instanceId: inst.id,
          instanceName: inst.name,
          instanceIcon: inst.icon || null,
          name: s.name || s.ip,
          address: s.ip,
          icon: s.icon ? `data:image/png;base64,${s.icon}` : null,
          canQuickPlay: supportsQuickPlay(inst.mcVersion),
          sortKey,
        });
      });
    } catch {
      /* unreadable/corrupt servers.dat — skip this instance's server list */
    }
  }
  entries.sort((a, b) => b.sortKey - a.sortKey);
  const top = entries.slice(0, limit);

  await Promise.all(top.map(async (entry) => {
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
    delete entry.sortKey;
  }));

  return top;
}

module.exports = {
  listRecentWorlds, listRecentServers, supportsQuickPlay, dismissRecent,
};
