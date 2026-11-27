const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const Store = require('electron-store');

// A launcher-config.json that can't be parsed (disk full or a crash mid-write,
// hand-editing gone wrong) makes electron-store throw while this module loads —
// and the launcher then never opens at all. Keep the broken file next to the
// new one for recovery and start clean instead.
function openStore(options) {
  try {
    return new Store(options);
  } catch (err) {
    try {
      const file = path.join(app.getPath('userData'), `${options.name}.json`);
      if (fs.existsSync(file)) fs.renameSync(file, `${file}.corrupt-${Date.now()}`);
    } catch { /* nothing more we can do about it */ }
    return new Store(options);
  }
}

const store = openStore({
  name: 'launcher-config',
  defaults: {
    instances: [],
    folders: [],
    // Multiple Microsoft and offline accounts can be signed in at once;
    // activeAccountId picks which one instances launch with. `account`
    // (below) is the pre-multi-account single-account field, kept only so
    // existing installs migrate cleanly — see the migration block below.
    accounts: [],
    activeAccountId: null,
    account: null,
    // Vanilla's servers.dat has no "last connected" field at all, and
    // connecting to an already-saved server doesn't touch the file (only
    // adding/editing/reordering entries does) — so we track real connect
    // events ourselves by watching the game's own log line, keyed by
    // "<instanceId>|<host>:<port>" -> timestamp ms.
    serverConnections: {},
    // "<instanceId>|<address>" -> true, for servers pinned inside an
    // instance's own Servers tab (servers.dat itself has no such field).
    pinnedServers: {},
    // "<instanceId>|<worldFolderName>" -> true, for worlds pinned inside an
    // instance's own Worlds tab.
    pinnedWorlds: {},
    // "world:<instanceId>|<folderName>" / "server:<instanceId>|<address>" ->
    // timestamp ms. Lets a world/server be dismissed from the Home "Recent"
    // list without touching the actual save/server entry — it stays hidden
    // until its real recency signal (LastPlayed / a fresh connect) moves past
    // this timestamp, so playing it again naturally brings it back.
    dismissedRecent: {},
    // { instanceId, start, durationMs } per finished play session — feeds the
    // statistics page (capped in ipc.js).
    playSessions: [],
    // instanceId -> { id, name, icon, mcVersion, loader, totalPlaytimeMs, deletedAt } of builds that were deleted, so their
    // time stays in the statistics and the year recap under their own name.
    deletedInstances: {},
    // instanceId -> { pid, startedAt } of games started by this launcher and (maybe) still running: they outlive the
    // launcher, and the next start picks them up again (see adoptRunningGames in ipc.js).
    runningGames: {},
    settings: {
      javaPath: '',
      minMemoryMb: 1024,
      maxMemoryMb: 4096,
      keybindings: {
        commandPalette: {
          ctrl: true, shift: false, alt: false, meta: false, code: 'KeyF',
        },
      },
      javaArgs: '',
      windowWidth: 854,
      windowHeight: 480,
      curseforgeApiKey: '',
      autoUpdateCheck: true,
      showRecent: true,
      showBuilderTools: false,
      reduceMotion: false,
      showInstanceWeight: false,
      showInstanceStats: true,
      showPlayButton: true,
      showStatsTab: true,
      showSearchPage: true,
      sidebarOrder: [],
      instanceTabOrder: [],
      interfaceStyle: 'classic',
      accentColor: 'rose',
      discordPresence: true,
      discordClientId: '',
    },
  },
});

// --- Microsoft / Minecraft tokens are encrypted at rest ---
// launcher-config.json is a plain file in %APPDATA%; a refresh token in it is a ready-made key to the
// player's Microsoft account for any program running as the same Windows user. So the two secret
// fields of every account are sealed with Windows DPAPI (Electron safeStorage: only this Windows
// user on this PC can open them) when written, and opened again when read. The rest of the code
// keeps using store.get('accounts') / store.set('accounts', …) and never notices.
// If encryption isn't available (non-Windows without a keyring) the value stays as it was before.
const SECRET_FIELDS = ['minecraftAccessToken', 'msRefreshToken'];
const SEALED = 'dpapi:';

function sealValue(v) {
  if (typeof v !== 'string' || !v || v === '0' || v.startsWith(SEALED)) return v;
  try {
    const { safeStorage } = require('electron');
    if (safeStorage.isEncryptionAvailable()) return SEALED + safeStorage.encryptString(v).toString('base64');
  } catch { /* not ready yet / unavailable: keep as is, it is sealed on the next write */ }
  return v;
}

function openValue(v) {
  if (typeof v !== 'string' || !v.startsWith(SEALED)) return v;
  try {
    const { safeStorage } = require('electron');
    return safeStorage.decryptString(Buffer.from(v.slice(SEALED.length), 'base64'));
  } catch {
    return null; // config copied from another Windows user / PC: the account just has to sign in again
  }
}

function mapSecrets(accounts, fn) {
  if (!Array.isArray(accounts)) return accounts;
  return accounts.map((a) => {
    if (!a || typeof a !== 'object') return a;
    const out = { ...a };
    SECRET_FIELDS.forEach((f) => { if (f in out) out[f] = fn(out[f]); });
    return out;
  });
}

const rawGet = store.get.bind(store);
const rawSet = store.set.bind(store);
const rawDelete = store.delete.bind(store);
// Every read of the store parses the whole launcher-config.json (close to 1 MB in a big library). `store.version` goes up on every write, so
// that code which asks for the same data in a loop (paths.js: one lookup per build, per library, per asset) can reuse a read until it changes.
store.version = 0;
store.get = (key, ...rest) => (key === 'accounts' ? mapSecrets(rawGet(key, ...rest), openValue) : rawGet(key, ...rest));
store.set = (key, ...rest) => { store.version += 1; return key === 'accounts' && Array.isArray(rest[0]) ? rawSet(key, mapSecrets(rest[0], sealValue)) : rawSet(key, ...rest); };
store.delete = (...args) => { store.version += 1; return rawDelete(...args); };

// Called once the app is ready (safeStorage needs that): seals tokens that an older version left in plain text.
store.sealAccountSecrets = () => {
  const accounts = rawGet('accounts');
  if (!Array.isArray(accounts)) return;
  const sealed = mapSecrets(accounts, sealValue);
  if (JSON.stringify(sealed) !== JSON.stringify(accounts)) rawSet('accounts', sealed);
};

// One-time migration: fold a pre-multi-account single `account` into the
// new `accounts` list, so existing installs don't just lose their sign-in.
(function migrateLegacyAccount() {
  const legacy = store.get('account');
  const accounts = store.get('accounts') || [];
  if (legacy && accounts.length === 0) {
    store.set('accounts', [legacy]);
    store.set('activeAccountId', legacy.id);
  }
  store.set('account', null);
})();

module.exports = store;
