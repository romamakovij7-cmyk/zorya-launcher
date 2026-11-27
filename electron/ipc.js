const {
  ipcMain: realIpcMain, shell, dialog, BrowserWindow, app,
} = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const { randomUUID } = require('crypto');
const { spawn } = require('child_process');
const AdmZip = require('adm-zip');
const store = require('./store');
const paths = require('./mc/paths');
const worldmap = require('./mc/worldmap');
const versions = require('./mc/versions');
const fabric = require('./mc/fabric');
const forge = require('./mc/forge');
const auth = require('./mc/auth');
const java = require('./mc/java');
const launch = require('./mc/launch');
const modrinth = require('./mc/modrinth');
const curseforge = require('./mc/curseforge');
const technic = require('./mc/technic');
const content = require('./mc/content');
const files = require('./mc/filemanager');
const skins = require('./mc/skins');
const translator = require('./mc/translate');
const dependencies = require('./mc/dependencies');
const importers = require('./mc/importers');
const { InstallControl, isCancel: isCancelError } = require('./mc/installControl');
const offlineSkin = require('./mc/offlineSkin');
const heartsPack = require('./mc/heartsPack');
const screenshots = require('./mc/screenshots');
const recents = require('./mc/recents');
const instanceServers = require('./mc/servers');
const schematics = require('./mc/schematics');
const blockTextures = require('./mc/blockTextures');
const langNames = require('./mc/langNames');
const crashAnalysis = require('./mc/crash');
const modfix = require('./mc/modfix');
const gameProc = require('./mc/gameProc');
const horizonBrand = require('./mc/horizonBrand');
const horizonSkin = require('./mc/horizonSkin');
const cosmetics = require('./mc/cosmetics');
const discord = require('./mc/discord');
const monitor = require('./mc/monitor');
const updater = require('./mc/updater');
const license = require('./mc/license');
const horizon = require('./mc/horizon');
const horizonMods = require('./mc/horizonMods');
const horizonNative = require('./mc/horizonNative');
const overlay = require('./mc/overlay');
// The monitoring overlay (the panel over the game: mc/overlay.js, the agent's metrics) is switched off for now: the code stays as a work in
// progress, but nothing starts it and Settings has no switch for it. Setting this to true brings it back (and the settings block in Settings.jsx).
const OVERLAY_ENABLED = false;
// Direct Horizon launches started by Zorya (id -> child process), so the UI
// can clear its "running" flag as soon as the game window closes.
const zoryaChildren = new Map();
const githubToken = require('./mc/githubToken');
const genderMod = require('./mc/genderMod');
const freshMoves = require('./mc/freshMoves');
const masterOptions = require('./mc/masterOptions');
const sharedServers = require('./mc/sharedServers');
const skinServer = require('./mc/skinServer');
const limits = require('./mc/limits');
const mainAccount = require('./mc/mainAccount');
const { safeJoin, assertVersionString, isSafeExternalUrl } = require('./mc/safe');

// Ready-made pixel-art icons for instances (electron/assets/instance-icons: 128x128 PNG made of 16x16 pixels, index.json lists them).
// The window only ever names a preset by its id — the picture is read from this folder, never taken from the page.
let presetCache = null;
function iconPresets() {
  if (presetCache) return presetCache;
  const dir = path.join(__dirname, 'assets', 'instance-icons');
  const list = [];
  try {
    const index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
    for (const item of Array.isArray(index) ? index : []) {
      if (!item || !/^[a-z0-9_-]{1,24}$/.test(String(item.id))) continue;
      try {
        const buf = fs.readFileSync(path.join(dir, `${item.id}.png`));
        list.push({ id: item.id, name: String(item.name || item.id).slice(0, 30), dataUrl: `data:image/png;base64,${buf.toString('base64')}` });
      } catch { /* a missing file just isn't offered */ }
    }
  } catch { /* no presets */ }
  presetCache = list;
  return list;
}
const presetIcon = (id) => (iconPresets().find((p) => p.id === id) || {}).dataUrl || null;

// Icons are stored inside launcher-config.json (rewritten on every change), so a big picture would make every save slow: whatever the
// person picks is turned into a small square icon first (see mc/iconPrep.js).
const { prepareIcon } = require('./mc/iconPrep');

const runningProcesses = new Map(); // instanceId -> child process
const launchStartTimes = new Map(); // instanceId -> timestamp

// Strips ANSI/CSI color escape sequences (common in Log4j/Java console output)
// so raw escape codes never show up as garbage in the log view.
const ANSI_RE = /\x1B\[[0-9;]*[a-zA-Z]/g;
function stripAnsi(str) {
  return str.replace(ANSI_RE, '');
}

// Opens a popup window at the Microsoft login page and resolves with the
// authorization code ({ code }) once the popup navigates to the redirect URI
// (see auth.js for why this legacy endpoint is used instead of the
// device-code one, and how the code becomes a refresh token).
// A normal desktop Chrome UA — Electron's default UA string includes
// "Electron/x.x.x", which login.live.com detects and responds to with a
// stripped-down, barely-styled fallback page (inputs render with no visible
// text, among other broken bits). Pretending to be plain Chrome gets the
// real, fully-styled sign-in page.
const DESKTOP_CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

function openMicrosoftLoginPopup(parentWin, auth) {
  return new Promise((resolve, reject) => {
    const popup = new BrowserWindow({
      width: 500,
      height: 650,
      parent: parentWin,
      modal: true,
      autoHideMenuBar: true,
      backgroundColor: '#ffffff',
      title: 'Zorya Launcher — вход через Microsoft',
      icon: path.join(__dirname, '..', 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
      // Remote (Microsoft) content with no preload at all — keep it in the OS sandbox too.
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });

    popup.webContents.setUserAgent(DESKTOP_CHROME_UA);
    // The sign-in page is somebody else's content: it may not open further windows inside the launcher. A web link it tries to open
    // (privacy statement, "forgot password") goes to the browser instead, like every other link of the launcher.
    popup.webContents.setWindowOpenHandler(({ url }) => {
      if (isSafeExternalUrl(url)) shell.openExternal(url);
      return { action: 'deny' };
    });

    let settled = false;
    const finish = (fn) => {
      if (settled) return;
      settled = true;
      try { popup.close(); } catch { /* already closing */ }
      fn();
    };

    function checkUrl(url) {
      if (!auth.isRedirectUrl(url)) return;
      const code = auth.extractAuthCodeFromUrl(url);
      if (code) { finish(() => resolve({ code })); return; }
      // Fallback if Microsoft ever answers with a bare token fragment.
      const token = auth.extractAccessTokenFromUrl(url);
      if (token) finish(() => resolve({ accessToken: token }));
      else finish(() => reject(new Error('Failed получить код входа из ответа Microsoft')));
    }

    popup.webContents.on('will-redirect', (e, url) => checkUrl(url));
    popup.webContents.on('will-navigate', (e, url) => checkUrl(url));
    popup.on('closed', () => finish(() => reject(new Error('Вход отменён'))));

    popup.loadURL(auth.buildLiveAuthUrl());
  });
}

// Subscription gate: without a valid license only these channels answer (login screen, window
// buttons, version, updates). Everything else — instances, launching, downloads, files — is
// refused in the main process, not just hidden in the UI.
const OPEN_CHANNELS = /^(license:|window:|updater:|app:getVersion$|shell:openExternal$)/;
const ipcMain = {
  handle(channel, fn) {
    realIpcMain.handle(channel, (event, ...args) => {
      if (!OPEN_CHANNELS.test(channel) && !license.isValid()) throw new Error('LICENSE_REQUIRED');
      return fn(event, ...args);
    });
  },
};

module.exports = function registerIpc(win) {
  const send = (channel, payload) => {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  };

  // --- subscription (site account + active key; see mc/license.js) ---
  let lastLicenseValid = license.isValid();
  const announceLicense = () => {
    const s = license.status();
    if (s.valid !== lastLicenseValid) { lastLicenseValid = s.valid; send('license:changed', s); }
  };
  ipcMain.handle('license:status', () => license.status());
  ipcMain.handle('license:login', async (e, username, password) => {
    const res = await license.login(username, password);
    if (res && res.ok) refreshSiteNick().catch(() => {}); // another site account may have signed in: its nick decides which account is "main"
    announceLicense();
    return res;
  });
  // Sign in through Telegram: start (code + bot link), poll the status, finish (exchange the confirmed code for the session)
  ipcMain.handle('license:tgStart', () => license.tgStart());
  ipcMain.handle('license:tgStatus', (e, code) => license.tgStatus(code));
  ipcMain.handle('license:tgFinish', async (e, code) => {
    const res = await license.tgFinish(code);
    if (res && res.ok) refreshSiteNick().catch(() => {});
    announceLicense();
    return res;
  });
  ipcMain.handle('license:refresh', async () => {
    const res = await license.refresh({ force: true });
    announceLicense();
    return res;
  });
  ipcMain.handle('license:logout', () => {
    const res = license.logout();
    mainAccount.setSiteNick(store, null); // not signed in to the site any more: no account is "main" until the next sign-in
    announceLicense();
    return res;
  });
  // Renew about once a day in the background; revoked keys / bans / expired subscriptions are noticed here.
  const backgroundLicense = async () => { await license.refresh(); announceLicense(); };
  setTimeout(backgroundLicense, 3000);
  setInterval(backgroundLicense, 3 * 60 * 60 * 1000).unref();
  // A license that runs out while the launcher stays open locks it too.
  setInterval(announceLicense, 60 * 1000).unref();

  // process.kill(pid, 0) is vulnerable to Windows PID reuse — once the real
  // process exits, that numeric PID can get handed to an unrelated process
  // within seconds, which would make a plain kill-0 check lie and report
  // "still alive" forever. tasklist confirms an *actual* live process still
  // holds that PID.
  function isPidAlive(pid) {
    return new Promise((resolve) => {
      if (process.platform !== 'win32') {
        try {
          process.kill(pid, 0);
          resolve(true);
        } catch {
          resolve(false);
        }
        return;
      }
      const check = spawn('tasklist', ['/FI', `PID eq ${pid}`, '/NH']);
      let out = '';
      check.stdout.on('data', (b) => { out += b.toString(); });
      check.on('error', () => resolve(false));
      // whole-token match: pid 123 must not "find itself" in 1234 or in a memory figure
      check.on('close', () => resolve(out.split(/\s+/).includes(String(pid))));
    });
  }

  // --- games outlive the launcher ---
  // A running game is written down (pid + start time) so that after the launcher was closed and opened again it shows as
  // running, can be stopped, and its play time is counted — instead of a second copy being started next to it.
  const adoptedTails = new Map(); // instanceId -> tail of a picked-up game's output file
  function dropRunning(id) {
    runningProcesses.delete(id);
    overlay.release(id); // the overlay's socket and window of this game
    const tail = adoptedTails.get(id);
    if (tail) { try { tail.flush(); tail.stop(); } catch { /* ignore */ } adoptedTails.delete(id); }
    // The game's output file is only needed while it runs (a locked file is left and overwritten by the next launch).
    try { fs.rmSync(gameProc.logPathFor(id), { force: true }); } catch { /* still open */ }
    try {
      const map = store.get('runningGames') || {};
      if (id in map) { const next = { ...map }; delete next[id]; store.set('runningGames', next); }
    } catch { /* bookkeeping only */ }
  }
  function rememberRunning(id, pid, startedAt) {
    if (!Number.isInteger(pid) || pid <= 0) return;
    try { store.set('runningGames', { ...(store.get('runningGames') || {}), [id]: { pid, startedAt } }); } catch { /* bookkeeping only */ }
  }
  // The process start time (ms since epoch) of a live pid, or null. The start time is what tells our game from an unrelated process
  // that was later given the same pid, so without it nothing is adopted (Stop must never kill a stranger).
  function processStartMs(pid) {
    return new Promise((resolve) => {
      if (process.platform !== 'win32' || !Number.isInteger(pid) || pid <= 0) { resolve(null); return; }
      const script = `try { [DateTimeOffset]::new((Get-Process -Id ${pid} -ErrorAction Stop).StartTime).ToUnixTimeMilliseconds() } catch { '' }`;
      const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true });
      let out = '';
      const timer = setTimeout(() => { try { ps.kill(); } catch { /* gone */ } resolve(null); }, 15000);
      ps.stdout.on('data', (b) => { out += b.toString(); });
      ps.on('error', () => { clearTimeout(timer); resolve(null); });
      ps.on('close', () => { clearTimeout(timer); const n = Number(out.trim()); resolve(Number.isFinite(n) && n > 0 ? n : null); });
    });
  }

  function killProcessTree(pid) {
    return new Promise((resolve) => {
      if (process.platform !== 'win32') { resolve(); return; }
      const kill = spawn('taskkill', ['/pid', String(pid), '/T', '/F']);
      kill.on('close', () => resolve());
      kill.on('error', () => resolve());
    });
  }

  // Safety net: if the user closes the game window directly (instead of
  // clicking Stop), the java process's own 'exit' event should tell us —
  // but on the off chance it doesn't (subprocess quirks, missed event),
  // this catches it within a few seconds instead of leaving the launcher
  // stuck showing "running" forever.
  // Credits the finished play session to the instance's total playtime and
  // to the stats history. Safe to call more than once per launch — whichever
  // path notices the end first (exit event, Stop button, stale check) wins.
  function finishSession(id) {
    const startedAt = launchStartTimes.get(id);
    launchStartTimes.delete(id);
    setImmediate(refreshPresence); // the session that just ended drops out of Discord
    monitor.stop(id); // history stays available in the Monitor tab
    if (!startedAt) return;
    creditSession(id, startedAt, Date.now() - startedAt);
  }

  // Adds one play session to the instance's total and to the statistics.
  function creditSession(id, startedAt, durationMs) {
    const freshList = store.get('instances');
    const inst = freshList.find((i) => i.id === id);
    if (inst) {
      inst.totalPlaytimeMs = (inst.totalPlaytimeMs || 0) + durationMs;
      store.set('instances', freshList);
    }
    const sessions = store.get('playSessions') || [];
    sessions.push({ instanceId: id, start: startedAt, durationMs });
    store.set('playSessions', sessions.slice(-5000));
  }

  // Discord Rich Presence: shows the most recently started running instance
  // (or nothing). Needs a Discord application id from Settings; otherwise a no-op.
  // What the user is doing in the launcher itself, reported by the UI:
  // 'browsing' | 'searching' | 'idle'. A running game always wins over it.
  const UI_STATUS = {
    browsing: 'Looking at instances',
    searching: 'Searching mods',
    idle: 'Idling',
  };
  let uiKind = 'idle';
  let uiSince = Date.now();
  ipcMain.handle('presence:set', (e, kind) => {
    const next = UI_STATUS[kind] ? kind : 'idle';
    if (next !== uiKind) { uiKind = next; uiSince = Date.now(); }
    refreshPresence();
    return true;
  });

  function refreshPresence() {
    try {
      const settings = { ...SETTINGS_DEFAULTS, ...store.get('settings') };
      discord.configure({ enabled: settings.discordPresence !== false });
      // The launcher's own Discord application has an app icon but no uploaded Rich Presence art, so the
      // icon is passed as an image link (Discord loads it through its own proxy). With a custom Application
      // ID from the settings, the app's own art asset named "logo" is used instead, as before.
      const assets = {
        large_image: settings.discordClientId ? 'logo' : discord.DEFAULT_ICON_URL,
        large_text: 'Zorya Launcher',
      };
      let newest = null;
      for (const id of runningProcesses.keys()) {
        const t = launchStartTimes.get(id) || 0;
        if (!newest || t > newest.t) newest = { id, t };
      }
      const inst = newest && store.get('instances').find((i) => i.id === newest.id);
      if (inst) {
        const loader = inst.loader && inst.loader !== 'vanilla' ? `${inst.loader[0].toUpperCase()}${inst.loader.slice(1)} ` : 'Vanilla ';
        discord.setActivity({
          details: 'Playing',
          state: `${inst.name} · ${loader}${inst.mcVersion}`.slice(0, 120),
          timestamps: { start: Math.floor((newest.t || Date.now()) / 1000) },
          assets,
        });
        return;
      }
      discord.setActivity({
        details: UI_STATUS[uiKind],
        timestamps: { start: Math.floor(uiSince / 1000) },
        assets,
      });
    } catch { /* presence is decoration — never let it break launching */ }
  }

  // Recent console output per instance, kept for crash analysis; and the
  // most recent analysis per instance until it's dismissed or relaunched.
  const logBuffers = new Map(); // instanceId -> string[]
  const lastCrash = new Map(); // instanceId -> analysis
  // Kept for the console page and crash analysis: capped by count AND by total size (a game that spams its log must not
  // fill the launcher's memory).
  const MAX_LOG_CHARS = 6 * 1024 * 1024;
  const logSizes = new Map(); // instanceId -> total chars in logBuffers
  function pushLog(id, chunk) {
    const buf = logBuffers.get(id) || [];
    let size = (logSizes.get(id) || 0) + chunk.length;
    buf.push(chunk);
    while (buf.length > 1 && (buf.length > 1500 || size > MAX_LOG_CHARS)) size -= buf.shift().length;
    logBuffers.set(id, buf);
    logSizes.set(id, size);
  }

  // "Still running" is written down every minute and when the launcher quits: if the launcher is closed while a game is on and the game ends
  // before the launcher is opened again, that is the latest moment we KNOW it was running (the rest of the session is taken from the game's
  // output file, see adoptRunningGames).
  function touchAlive() {
    try {
      const map = store.get('runningGames') || {};
      let changed = false;
      const now = Date.now();
      for (const id of runningProcesses.keys()) if (map[id]) { map[id] = { ...map[id], lastAlive: now }; changed = true; }
      if (changed) store.set('runningGames', map);
    } catch { /* bookkeeping only */ }
  }
  setInterval(touchAlive, 60 * 1000).unref();
  app.on('before-quit', touchAlive);

  setInterval(async () => {
    for (const [id, child] of runningProcesses) {
      // eslint-disable-next-line no-await-in-loop
      const alive = await isPidAlive(child.pid);
      if (!alive) {
        dropRunning(id);
        finishSession(id);
        send('launch:exit', { instanceId: id, code: null, signal: 'stale' });
      }
    }
  }, 4000);

  // --- window controls ---
  ipcMain.handle('window:minimize', () => win.minimize());
  ipcMain.handle('window:maximizeToggle', () => {
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.handle('window:close', () => win.close());
  ipcMain.handle('window:isMaximized', () => win.isMaximized());
  // Works around inputs going dead after a native alert()/confirm() (see main.jsx).
  ipcMain.handle('window:refocus', () => {
    if (win.isDestroyed()) return;
    win.blur();
    win.focus();
    win.webContents.focus();
  });

  // --- settings ---
  // electron-store's `defaults` option doesn't retroactively fill in new
  // fields for users who already had a persisted `settings` object before
  // those fields were added — the whole object is returned as-is. Merge
  // explicitly so a field added later (like showRecent) gets its intended
  // default instead of coming back undefined for existing installs.
  const SETTINGS_DEFAULTS = {
    javaPath: '',
    minMemoryMb: 1024,
    maxMemoryMb: 4096,
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
    language: 'en',
    discordPresence: true,
    discordClientId: '',
    // appearance (see src/utils/theme.js)
    theme: 'zorya',
    accentCustom: '#B85C72',
    glassOpacity: 50,
    glassBlur: 50,
    bgFile: null,
    bgDim: 50,
    bgBlur: 0,
    uiScale: 100,
    homeLayout: 'library', // 'library' | 'play'
    homeScene: true, // фон за персонажем на «Игровом» экране
    zoryaCosmetics: true, // общие скины, плащи и украшения Zorya (authlib-injector для офлайн, агент Zorya Cosmetics для остальных)
    overlayEnabled: true, // оверлей мониторинга поверх игры (Minecraft 26.1+, нужен агент Zorya Cosmetics)
    overlayKey: 'f9', // клавиша показа и скрытия оверлея (см. cosmetics.OVERLAY_KEYS)
    overlayMode: 'full', // 'full' | 'compact'
    overlayScale: 'normal', // 'small' | 'normal' | 'large'
    overlayCorner: 'tl', // 'tl' | 'tr' | 'bl' | 'br'
    overlayOpacity: 82, // процентов, 40-100
    homeLayoutChosen: false, // выбор главного экрана при первом входе уже сделан?
    density: 'normal',
    keybindings: {
      commandPalette: {
        ctrl: true, shift: false, alt: false, meta: false, code: 'KeyF',
      },
    },
  };
  // The two former switches (offline skin server / cosmetics agent) became one: someone who had switched the skin server off keeps it off.
  {
    const saved = store.get('settings') || {};
    if (saved.offlineSkinServer === false && saved.zoryaCosmetics === undefined) store.set('settings', { ...saved, zoryaCosmetics: false });
  }
  ipcMain.handle('settings:get', () => ({ ...SETTINGS_DEFAULTS, ...store.get('settings') }));
  ipcMain.handle('settings:set', (e, partial) => {
    if (!partial || typeof partial !== 'object' || Array.isArray(partial)) return store.get('settings');
    // The data folders change only through dataFolders:* below (checked there), never straight from the page.
    const { instancesDir: _i, gameFilesDir: _g, ...allowed } = partial;
    partial = allowed;
    store.set('settings', { ...store.get('settings'), ...partial });
    if ('discordPresence' in partial || 'discordClientId' in partial) refreshPresence();
    return store.get('settings');
  });

  // --- Settings -> «Game settings» / the build's settings: the "эталон" of game settings (see mc/masterOptions.js) ---
  const buildOf = (id) => (typeof id === 'string' ? (store.get('instances') || []).find((i) => i.id === id) : null);
  ipcMain.handle('masterOptions:get', () => ({ ok: true, ...masterOptions.summary(store), langs: masterOptions.LANGS }));
  ipcMain.handle('masterOptions:set', (e, patch) => ({ ok: true, ...masterOptions.setMaster(store, patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {}) }));
  ipcMain.handle('masterOptions:clear', () => ({ ok: true, ...masterOptions.clearTemplate(store) }));
  // Does the build have its game settings file yet (= has it been started and closed once), and where is its эталон step.
  ipcMain.handle('masterOptions:status', (e, id) => {
    const inst = buildOf(id);
    if (!inst) return { ok: false, error: 'Instance не найдена.' };
    let hasFile = false;
    try { hasFile = fs.existsSync(path.join(paths.instanceGameDir(inst.id), 'options.txt')); } catch { /* unavailable folder */ }
    return { ok: true, hasFile, state: inst.masterOptionsState || null, horizon: inst.loader === 'horizon' };
  });
  ipcMain.handle('masterOptions:capture', (e, id) => {
    const inst = buildOf(id);
    if (!inst) return { ok: false, error: 'Instance не найдена.' };
    if (inst.loader === 'horizon') return { ok: false, error: 'Для сборок Horizon это не поддерживается.' };
    try { return masterOptions.capture(store, inst, paths.instanceGameDir(inst.id)); } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('masterOptions:apply', (e, id) => {
    const inst = buildOf(id);
    if (!inst) return { ok: false, error: 'Instance не найдена.' };
    if (runningProcesses.has(inst.id) || launchingIds.has(inst.id)) return { ok: false, error: 'Сначала закройте игру: пока она запущена, она перезапишет файл настроек.' };
    try { return masterOptions.applyNow(store, inst, paths.instanceGameDir(inst.id)); } catch (err) { return { ok: false, error: err.message }; }
  });

  // --- the shared server list (see mc/sharedServers.js): managed in Settings, given to builds before a launch or by the button ---
  ipcMain.handle('sharedServers:get', () => ({ ok: true, servers: sharedServers.list(store), max: sharedServers.MAX_SERVERS }));
  ipcMain.handle('sharedServers:add', (e, entry) => sharedServers.add(store, entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : {}));
  ipcMain.handle('sharedServers:remove', (e, index) => sharedServers.remove(store, index));
  ipcMain.handle('sharedServers:move', (e, index, dir) => sharedServers.move(store, index, dir));
  ipcMain.handle('sharedServers:importFrom', (e, id) => {
    const inst = buildOf(id);
    if (!inst) return { ok: false, error: 'Instance не найдена.' };
    try { return sharedServers.importFrom(store, inst.id); } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('sharedServers:status', (e, id) => {
    const inst = buildOf(id);
    if (!inst) return { ok: false, error: 'Instance не найдена.' };
    try { return { ...sharedServers.status(store, inst), horizon: inst.loader === 'horizon' }; } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('sharedServers:applyTo', (e, id) => {
    const inst = buildOf(id);
    if (!inst) return { ok: false, error: 'Instance не найдена.' };
    if (runningProcesses.has(inst.id) || launchingIds.has(inst.id)) return { ok: false, error: 'Сначала закройте игру: пока она запущена, она перезапишет список серверов.' };
    try { return sharedServers.applyTo(store, inst, { force: true }); } catch (err) { return { ok: false, error: err.message }; }
  });

  // --- Settings -> «Folders» (dataFolders:*): where the builds and the game files live (the person copies old files by hand) ---
  const dataFolders = require('./mc/dataFolders');
  const folderKind = (k) => (k === 'instances' || k === 'game' ? k : null);
  const gamesBusy = () => runningProcesses.size > 0 || launchingIds.size > 0;
  const BUSY_MSG = 'Сначала закройте запущенную игру и дождитесь конца запуска: папки меняются только когда игры не идут.';
  ipcMain.handle('dataFolders:info', () => ({ ok: true, instances: dataFolders.info('instances'), game: dataFolders.info('game'), busy: gamesBusy() }));
  ipcMain.handle('dataFolders:choose', async (e, kind) => {
    const k = folderKind(kind);
    if (!k) return { ok: false, error: 'Неизвестный раздел.' };
    if (gamesBusy()) return { ok: false, error: BUSY_MSG };
    const res = await dialog.showOpenDialog(win, {
      title: k === 'instances' ? 'Folder для сборок' : 'Folder для файлов игры',
      defaultPath: dataFolders.currentDir(k),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true };
    return dataFolders.apply(k, res.filePaths[0]);
  });
  ipcMain.handle('dataFolders:reset', (e, kind) => {
    const k = folderKind(kind);
    if (!k) return { ok: false, error: 'Неизвестный раздел.' };
    if (gamesBusy()) return { ok: false, error: BUSY_MSG };
    return dataFolders.reset(k);
  });
  ipcMain.handle('dataFolders:open', async (e, kind) => {
    const k = folderKind(kind);
    if (!k) return { ok: false, error: 'Неизвестный раздел.' };
    const dir = dataFolders.currentDir(k);
    try { fs.mkdirSync(dir, { recursive: true }); } catch { return { ok: false, error: `Folder недоступна: ${dir}` }; }
    const err = await shell.openPath(dir);
    return err ? { ok: false, error: err } : { ok: true };
  });

  // --- appearance: the user's own background picture (copied into the launcher's data folder) ---
  const BG_MAX_BYTES = 20 * 1024 * 1024;
  const BG_NAME = /^background\.(png|jpg|webp|gif)$/;
  const BG_MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
  const bgDir = () => paths.ensureDir(path.join(app.getPath('userData'), 'backgrounds'));
  const sniffImage = (b) => {
    if (b.length > 12 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
    if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
    if (b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp';
    if (b.length > 6 && b.toString('latin1', 0, 4) === 'GIF8') return 'gif';
    return null;
  };
  const clearBgFiles = () => { try { for (const f of fs.readdirSync(bgDir())) if (BG_NAME.test(f)) fs.rmSync(path.join(bgDir(), f), { force: true }); } catch { /* nothing to remove */ } };
  ipcMain.handle('appearance:pickBackground', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: 'Choose picture для фона', properties: ['openFile'], filters: [{ name: 'Картинки', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
    });
    if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true };
    try {
      const st = fs.statSync(res.filePaths[0]);
      if (!st.isFile() || st.size > BG_MAX_BYTES) return { ok: false, error: 'Картинка слишком большая (до 20 МБ).' };
      const buf = fs.readFileSync(res.filePaths[0]);
      const ext = sniffImage(buf); // by content, not by the file name
      if (!ext) return { ok: false, error: 'Это не картинка PNG, JPG, WebP или GIF.' };
      clearBgFiles();
      const file = `background.${ext}`;
      fs.writeFileSync(path.join(bgDir(), file), buf);
      return { ok: true, file };
    } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('appearance:getBackground', () => {
    const file = store.get('settings')?.bgFile;
    if (typeof file !== 'string' || !BG_NAME.test(file)) return { ok: false };
    try { return { ok: true, mime: BG_MIME[file.split('.')[1]], data: fs.readFileSync(path.join(bgDir(), file)) }; } catch { return { ok: false }; }
  });
  ipcMain.handle('appearance:clearBackground', () => { clearBgFiles(); return { ok: true }; });

  // The picture behind the character on the "Play view" home screen: its own file (scene.<ext>), separate from the whole-window background.
  const SCENE_NAME = /^scene\.(png|jpg|webp|gif)$/;
  const clearSceneFiles = () => { try { for (const f of fs.readdirSync(bgDir())) if (SCENE_NAME.test(f)) fs.rmSync(path.join(bgDir(), f), { force: true }); } catch { /* nothing to remove */ } };
  ipcMain.handle('appearance:pickSceneBackground', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: 'Background behind character', properties: ['openFile'], filters: [{ name: 'Картинки', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
    });
    if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true };
    try {
      const st = fs.statSync(res.filePaths[0]);
      if (!st.isFile() || st.size > BG_MAX_BYTES) return { ok: false, error: 'Картинка слишком большая (до 20 МБ).' };
      const buf = fs.readFileSync(res.filePaths[0]);
      const ext = sniffImage(buf); // by content, not by the file name
      if (!ext) return { ok: false, error: 'Это не картинка PNG, JPG, WebP или GIF.' };
      clearSceneFiles();
      const file = `scene.${ext}`;
      fs.writeFileSync(path.join(bgDir(), file), buf);
      return { ok: true, file };
    } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('appearance:getSceneBackground', () => {
    const file = store.get('settings')?.homeSceneFile;
    if (typeof file !== 'string' || !SCENE_NAME.test(file)) return { ok: false };
    try { return { ok: true, mime: BG_MIME[file.split('.')[1]], data: fs.readFileSync(path.join(bgDir(), file)) }; } catch { return { ok: false }; }
  });
  ipcMain.handle('appearance:clearSceneBackground', () => { clearSceneFiles(); return { ok: true }; });

  // --- java ---
  ipcMain.handle('java:check', (e, customPath) => java.checkJava(customPath));
  // The Java picker in a build's settings: what is installed here, and which major Java this Minecraft version needs.
  ipcMain.handle('java:list', (e, mcVersion) => {
    try { return { ok: true, installed: java.listInstalled(), required: java.requiredMajor(typeof mcVersion === 'string' ? mcVersion : '') }; } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('java:browse', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: 'Выберите файл java', properties: ['openFile'],
      filters: process.platform === 'win32' ? [{ name: 'Java (java.exe)', extensions: ['exe'] }] : [],
    });
    if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true };
    let file = res.filePaths[0];
    // javaw.exe has no console output to read the version from: its java.exe sits next to it
    if (/javaw(\.exe)?$/i.test(file)) { const alt = file.replace(/javaw(\.exe)?$/i, (m) => m.replace(/javaw/i, 'java')); if (fs.existsSync(alt)) file = alt; }
    if (!/(^|[\\/])java(\.exe)?$/i.test(file)) return { ok: false, error: 'Нужен файл java (java.exe) из папки bin установленной Java.' };
    const check = java.checkJava(file);
    if (!check.ok) return { ok: false, error: `Failed запустить этот файл: ${check.error || 'нет ответа'}` };
    return { ok: true, path: file, version: check.version, major: java.majorOf(check.version) };
  });

  // --- wearable cosmetics (millida catalog, no shop) ---
  ipcMain.handle('cosmetics:getWorn', () => store.get('cosmeticsWorn') || {});
  ipcMain.handle('cosmetics:setWorn', (e, worn) => {
    store.set('cosmeticsWorn', worn && typeof worn === 'object' ? worn : {});
    return { ok: true };
  });
  ipcMain.handle('cosmetics:setCape', (e, { id, dataUrl }) => {
    try {
      const safe = String(id || '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
      if (!safe || !/^data:image\/png;base64,/.test(String(dataUrl || ''))) return { ok: false, error: 'bad image' };
      const buf = Buffer.from(String(dataUrl).split(',')[1], 'base64');
      if (buf.length > 2 * 1024 * 1024 || buf.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
        return { ok: false, error: 'bad png' };
      }
      const dir = path.join(app.getPath('userData'), 'cosmetics');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${safe}.png`), buf);
      return { ok: true, file: path.join(dir, `${safe}.png`) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // --- launcher self-update (from our own server — see mc/updater.js) ---
  ipcMain.handle('app:getVersion', () => app.getVersion());

  ipcMain.handle('updater:check', () => updater.check());
  ipcMain.handle('updater:download', () => updater.download(undefined, (p) => send('updater:progress', p)));
  ipcMain.handle('updater:install', async () => {
    // Replacing the program under a running game or a half-finished download would break them.
    if (runningProcesses.size) return { ok: false, error: 'Сначала закройте запущенную игру.' };
    if (installControls.size) return { ok: false, error: 'Сначала дождитесь окончания загрузки сборок.' };
    return updater.install();
  });

  // Quiet check shortly after start and then every few hours: the UI only hears
  // about it when there is something new (and only once per version).
  let announcedVersion = null;
  // Always on (there is no switch for it any more): it only tells that a version exists; installing stays the user's button and needs the author's signature.
  async function autoCheckUpdate() {
    const res = await updater.check();
    if (res.ok && res.hasUpdate && res.latest !== announcedVersion) {
      announcedVersion = res.latest;
      send('updater:available', res);
    }
  }
  setTimeout(autoCheckUpdate, 8000);
  setInterval(autoCheckUpdate, 6 * 60 * 60 * 1000).unref();

  // --- auth (multiple accounts, one active at a time) ---
  // The UI never needs the session tokens (only this process talks to Microsoft/
  // Mojang and starts the game), so they are left out of everything sent to it.
  function publicAccount(account) {
    if (!account) return account;
    // eslint-disable-next-line no-unused-vars
    const { minecraftAccessToken, msRefreshToken, ...rest } = account;
    // Offline accounts: only the main one (nick = the site nick) has Zorya skins/capes/hearts, see mc/mainAccount.js.
    if (rest.type === 'offline') rest.isMain = mainAccount.isMainOffline(rest, mainAccount.getSiteNick(store));
    return rest;
  }

  function fixSkinUrl(account) {
    if (!account?.skinUrl) return account;
    const fixed = auth.toHttpsUrl(account.skinUrl);
    return fixed === account.skinUrl ? account : { ...account, skinUrl: fixed };
  }

  function getActiveAccount() {
    const accounts = (store.get('accounts') || []).map(fixSkinUrl);
    const activeId = store.get('activeAccountId');
    return accounts.find((a) => a.id === activeId) || null;
  }

  // Returns the active account with a valid Minecraft token, silently
  // renewing it from the stored Microsoft refresh token when it has expired
  // (or is about to). Concurrent callers share one refresh, since refresh
  // tokens rotate and a second parallel use would invalidate the first.
  // Throws (err.needsRelogin) only when there's genuinely no way to renew.
  let refreshInFlight = null;
  async function getFreshActiveAccount() {
    const account = getActiveAccount();
    if (!account) return null;
    if (account.type !== 'microsoft') return account;
    if (account.minecraftAccessTokenExpiresAt && account.minecraftAccessTokenExpiresAt > Date.now() + 5 * 60 * 1000) {
      return account;
    }
    if (!refreshInFlight) {
      refreshInFlight = auth.refreshAccount(account)
        .then((renewed) => upsertAccount(renewed))
        .finally(() => { refreshInFlight = null; });
    }
    return refreshInFlight;
  }

  // Adds a freshly-logged-in account, or refreshes an already-added one
  // (re-login/token-renewal keeps the same id), and makes it the active one.
  function upsertAccount(account) {
    const accounts = store.get('accounts') || [];
    const idx = accounts.findIndex((a) => a.id === account.id);
    if (idx >= 0) accounts[idx] = account;
    else accounts.push(account);
    store.set('accounts', accounts);
    store.set('activeAccountId', account.id);
    return account;
  }

  ipcMain.handle('auth:getAccount', () => {
    // Accounts saved before the http->https skin URL fix may still have a
    // blocked http:// URL cached — persist the normalized version so this
    // doesn't have to happen on every read.
    const accounts = store.get('accounts') || [];
    let changed = false;
    const fixed = accounts.map((a) => {
      const f = fixSkinUrl(a);
      if (f !== a) changed = true;
      return f;
    });
    if (changed) store.set('accounts', fixed);
    const activeId = store.get('activeAccountId');
    return publicAccount(fixed.find((a) => a.id === activeId) || null);
  });

  ipcMain.handle('auth:listAccounts', () => {
    const accounts = (store.get('accounts') || []).map(fixSkinUrl).map(publicAccount);
    return { accounts, activeAccountId: store.get('activeAccountId') };
  });

  ipcMain.handle('auth:switchAccount', (e, id) => {
    const accounts = store.get('accounts') || [];
    const account = accounts.find((a) => a.id === id);
    if (!account) return { ok: false, error: 'Account not found' };
    store.set('activeAccountId', id);
    return { ok: true, account: publicAccount(account) };
  });

  ipcMain.handle('auth:login', async () => {
    try {
      send('auth:status', 'Открываем окно входа Microsoft…');
      const result = await openMicrosoftLoginPopup(win, auth);
      let msTokens = result.accessToken;
      if (result.code) {
        send('auth:status', 'Получение токена Microsoft…');
        msTokens = await auth.exchangeAuthCode(result.code);
      }
      const account = await auth.finishLoginChainFromMsAccessToken(msTokens, (msg) => send('auth:status', msg));
      // One person: one Microsoft account and two offline ones (signing the same account in again is always fine).
      const have = store.get('accounts') || [];
      if (!have.some((a) => a.id === account.id) && have.filter((a) => a.type === 'microsoft').length >= limits.MAX_MICROSOFT_ACCOUNTS) {
        send('auth:status', null);
        return { ok: false, error: `Можно добавить не больше ${limits.MAX_MICROSOFT_ACCOUNTS} аккаунтов Microsoft. Удалите ненужный аккаунт.` };
      }
      upsertAccount(account);
      send('auth:status', null);
      return { ok: true, account: publicAccount(account) };
    } catch (err) {
      send('auth:status', null);
      return { ok: false, error: err.message };
    }
  });

  // Reads the nick the player holds on the site and remembers it (the "main" offline account is the one with this nick).
  // Returns null when not signed in to the site or the nick is not set yet; throws on a network error only if `strict`.
  async function refreshSiteNick({ strict = false } = {}) {
    // Without a site session (it expired or was never made) the last known nick stays: only an explicit sign-out forgets it.
    if (!license.hasSiteAuth()) return mainAccount.getSiteNick(store);
    try {
      const r = await license.siteRequest('/api/launcher/premium');
      const nick = r.ok ? premiumView(r.data).nick : null;
      if (r.ok) mainAccount.setSiteNick(store, nick);
      return r.ok ? nick : mainAccount.getSiteNick(store);
    } catch (err) {
      if (strict) throw err;
      return mainAccount.getSiteNick(store);
    }
  }

  // Up to limits.MAX_OFFLINE_ACCOUNTS offline accounts (the main one counts). `username` empty (or equal to the site nick) = the MAIN
  // account with the nick from the site; any other valid name = an extra offline account WITHOUT Zorya skins/capes/hearts.
  ipcMain.handle('auth:loginOffline', async (e, username) => {
    const typed = String(username ?? '').trim();
    let siteNick;
    try { siteNick = await refreshSiteNick({ strict: true }); } catch (err) {
      // An extra account needs no site at all: the last known nick is enough to tell it apart from the main one.
      const known = mainAccount.getSiteNick(store);
      if (typed && !(known && mainAccount.sameNick(typed, known))) siteNick = known;
      else return { ok: false, error: `Failed узнать ваш ник на сайте: ${err.message}` };
    }
    const have = store.get('accounts') || [];
    const plan = mainAccount.planAddOffline({ accounts: have, name: typed, siteNick, max: limits.MAX_OFFLINE_ACCOUNTS, signedIn: license.hasSiteAuth() });
    if (!plan.ok) return plan;
    if (plan.existing) {
      // Already there (with exactly this spelling): just make it the active one, keeping its chosen skin, cape and hearts.
      const existing = have.find((a) => a.type === 'offline' && a.name === plan.name);
      store.set('activeAccountId', existing.id);
      return { ok: true, account: publicAccount(existing), main: plan.main };
    }
    const account = auth.makeOfflineAccount(plan.name);
    upsertAccount(account);
    return { ok: true, account: publicAccount(account), main: plan.main };
  });

  // Removes one account from the list (id defaults to whichever is active,
  // so the pre-multi-account "log out" call from Settings keeps working
  // unchanged). If the removed account was active, the next one in the
  // list (if any) becomes active.
  ipcMain.handle('auth:logout', (e, id) => {
    const accounts = store.get('accounts') || [];
    const targetId = id || store.get('activeAccountId');
    const next = accounts.filter((a) => a.id !== targetId);
    store.set('accounts', next);
    if (store.get('activeAccountId') === targetId) {
      store.set('activeAccountId', next[0]?.id || null);
    }
    return { ok: true, activeAccountId: store.get('activeAccountId') };
  });

  // --- minecraft version / loader metadata ---
  ipcMain.handle('mc:versionManifest', async () => versions.getVersionManifest());
  ipcMain.handle('mc:fabricLoaders', async (e, mcVersion) => fabric.getFabricLoaderVersions(mcVersion));
  ipcMain.handle('mc:quiltLoaders', async (e, mcVersion) => fabric.getQuiltLoaderVersions(mcVersion));
  ipcMain.handle('mc:forgeLoaders', async (e, mcVersion) => forge.getForgeLoaderVersions(mcVersion));
  ipcMain.handle('mc:neoforgeLoaders', async (e, mcVersion) => forge.getNeoForgeLoaderVersions(mcVersion));

  // --- instances ---
  ipcMain.handle('instances:list', () => store.get('instances'));

  // 'horizon' is a different game, not a mod loader: Minecraft Java rewritten in Rust (see mc/horizon.js).
  const LOADERS = ['vanilla', 'fabric', 'quilt', 'forge', 'neoforge', 'horizon'];
  ipcMain.handle('instances:create', (e, data) => {
    const name = String(data?.name ?? '').trim().slice(0, 100);
    if (!name) throw new Error('Enter an instance name');
    const loader = data.loader || 'vanilla';
    if (!LOADERS.includes(loader)) throw new Error('Unknown loader');
    const isHorizon = loader === 'horizon';
    // A Horizon build brings its own Minecraft version; this is only what the card shows until the first launch.
    const mcVersion = isHorizon ? horizon.DEFAULT_MC_VERSION : data.mcVersion;
    assertVersionString(mcVersion, 'Minecraft version');
    if (!isHorizon && data.loaderVersion) assertVersionString(String(data.loaderVersion), 'loader version');
    const instance = {
      id: randomUUID(),
      name,
      mcVersion,
      loader,
      loaderVersion: isHorizon ? null : (data.loaderVersion || null),
      icon: typeof data.iconPreset === 'string' ? presetIcon(data.iconPreset) : null,
      source: 'manual',
      createdAt: Date.now(),
      lastPlayed: null,
      totalPlaytimeMs: 0,
      minMemoryMb: null,
      maxMemoryMb: null,
      pinned: false,
    };
    const list = store.get('instances');
    list.unshift(instance);
    store.set('instances', list);
    return instance;
  });

  ipcMain.handle('instances:iconPresets', () => iconPresets());
  ipcMain.handle('instances:setIconPreset', (e, { id, presetId } = {}) => {
    const icon = typeof presetId === 'string' ? presetIcon(presetId) : null;
    if (!icon) return { ok: false, error: 'No such icon' };
    const list = store.get('instances');
    const instance = list.find((i) => i.id === id);
    if (!instance) return { ok: false, error: 'Instance not found' };
    instance.icon = icon;
    store.set('instances', list);
    return { ok: true, instance };
  });

  ipcMain.handle('instances:setPinned', (e, { id, pinned }) => {
    const list = store.get('instances');
    const instance = list.find((i) => i.id === id);
    if (!instance) return { ok: false, error: 'Instance not found' };
    instance.pinned = !!pinned;
    store.set('instances', list);
    return { ok: true, instance };
  });

  ipcMain.handle('instances:rename', (e, { id, name: rawName }) => {
    const list = store.get('instances');
    const instance = list.find((i) => i.id === id);
    if (!instance) return { ok: false, error: 'Instance not found' };
    const name = String(rawName ?? '').trim().slice(0, 100);
    if (!name) return { ok: false, error: 'Name не может быть пустым' };

    // Try to rename the on-disk folder to match the new name so it stays
    // readable in Explorer too. Best-effort: skipped while running (the java
    // process holds file handles open) or if the rename otherwise fails.
    if (!runningProcesses.has(id)) {
      const oldDir = paths.instanceDir(id);
      const base = paths.slugifyInstanceName(name);
      const taken = new Set(list.filter((i) => i.id !== id && i.folderName).map((i) => i.folderName));
      let candidate = base;
      let n = 2;
      while (
        taken.has(candidate)
        || (candidate !== instance.folderName && fs.existsSync(path.join(paths.instancesDir(), candidate)))
      ) {
        candidate = `${base} (${n++})`;
      }
      if (candidate !== instance.folderName) {
        try {
          const newDir = path.join(paths.instancesDir(), candidate);
          fs.renameSync(oldDir, newDir);
          instance.folderName = candidate;
        } catch {
          /* keep the old folder name if the rename fails */
        }
      }
    }

    instance.name = name;
    store.set('instances', list);
    return { ok: true, instance };
  });

  ipcMain.handle('instances:delete', async (e, id) => {
    const existing = store.get('instances').find((i) => i.id === id);
    if (!existing) return true;
    if (runningProcesses.has(id)) throw new Error('Instance сейчас запущена — сначала остановите игру');
    const dir = paths.instanceDir(id); // resolve while the record still exists
    // The play time of a deleted build must stay in the statistics: keep its "card" (name, icon, total) next to the session history.
    const hadSessions = (store.get('playSessions') || []).some((s) => s.instanceId === id);
    if ((existing.totalPlaytimeMs || 0) > 0 || hadSessions) {
      const gone = store.get('deletedInstances') || {};
      gone[id] = {
        id,
        name: existing.name || 'Удалённая сборка',
        icon: typeof existing.icon === 'string' && existing.icon.length < 300000 ? existing.icon : null,
        mcVersion: existing.mcVersion || '',
        loader: existing.loader || '',
        totalPlaytimeMs: existing.totalPlaytimeMs || 0,
        deletedAt: Date.now(),
      };
      store.set('deletedInstances', gone);
    }
    const list = store.get('instances').filter((i) => i.id !== id);
    store.set('instances', list);
    try { fs.rmSync(gameProc.logPathFor(id), { force: true }); } catch { /* the game's output file, if any */ }
    horizonSkin.removeAssets(id);
    try {
      // Async: a big instance (worlds, mods) took seconds of a frozen window to remove synchronously.
      await fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      /* the record is gone either way; a locked file just leaves the folder behind */
    }
    return true;
  });

  ipcMain.handle('instances:duplicate', async (e, id) => {
    const source = store.get('instances').find((i) => i.id === id);
    if (!source) return { ok: false, error: 'Instance not found' };
    const newId = randomUUID();
    const copy = {
      ...source, id: newId, folderName: null, name: `${source.name} (копия)`,
      createdAt: Date.now(), lastPlayed: null, totalPlaytimeMs: 0,
    };
    // Copy first, register after: if the copy fails (disk full, a locked file) there is
    // no ghost entry pointing at an empty folder. Async so a big instance doesn't freeze the window.
    try {
      if (source.externalGameDir) {
        // A linked instance has no folder of its own: the copy gets a real copy of the other launcher's folder and is independent of it.
        delete copy.externalGameDir;
        copy.source = String(source.source || '').replace(/-linked$/, '');
        await fs.promises.cp(paths.instanceGameDir(id), path.join(paths.instanceDir(newId), '.minecraft'), { recursive: true });
      } else {
        await fs.promises.cp(paths.instanceDir(id), paths.instanceDir(newId), { recursive: true });
      }
    } catch (err) {
      await fs.promises.rm(paths.instanceDir(newId), { recursive: true, force: true }).catch(() => {});
      return { ok: false, error: `Failed to copy build: ${err.message}` };
    }
    const list = store.get('instances');
    list.unshift(copy);
    store.set('instances', list);
    return { ok: true, instance: copy };
  });

  ipcMain.handle('instances:export', async (e, id) => {
    const list = store.get('instances');
    const instance = list.find((i) => i.id === id);
    if (!instance) return { ok: false, error: 'Instance not found' };
    const result = await dialog.showSaveDialog(win, {
      title: 'Экспортировать сборку',
      defaultPath: `${paths.slugifyInstanceName(instance.name)}.zip`,
      filters: [{ name: 'ZIP-архив', extensions: ['zip'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    try {
      const zip = new AdmZip();
      if (instance.externalGameDir) {
        // linked instance: the game folder lives elsewhere
        zip.addLocalFolder(paths.instanceGameDir(id), '.minecraft');
        zip.writeZip(result.filePath);
        return { ok: true, filePath: result.filePath };
      }
      // the launcher's own heart pictures are not part of a modpack that is handed on
      zip.addLocalFolder(paths.instanceDir(id), '', (name) => !String(name).endsWith(heartsPack.PACK_FILE));
      zip.writeZip(result.filePath);
      return { ok: true, filePath: result.filePath };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('instances:setIcon', async (e, id) => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Выбрать иконку',
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
    let icon;
    try { icon = await prepareIcon(result.filePaths[0]); } catch (err) { return { ok: false, error: err.message }; }
    const list = store.get('instances');
    const instance = list.find((i) => i.id === id);
    if (!instance) return { ok: false, error: 'Instance not found' };
    instance.icon = icon;
    store.set('instances', list);
    return { ok: true, instance };
  });

  ipcMain.handle('instances:setFolder', (e, { id, folderId }) => {
    const list = store.get('instances');
    const instance = list.find((i) => i.id === id);
    if (!instance) return { ok: false, error: 'Instance not found' };
    instance.folderId = folderId || null;
    store.set('instances', list);
    return { ok: true, instance };
  });

  ipcMain.handle('instances:setSection', (e, { id, sectionId }) => {
    const list = store.get('instances');
    const instance = list.find((i) => i.id === id);
    if (!instance) return { ok: false, error: 'Instance not found' };
    instance.sectionId = sectionId || null;
    store.set('instances', list);
    return { ok: true, instance };
  });

  // Merges two instances into a brand-new folder (dragging one onto the
  // other) — atomic-ish: creates the folder, then files both under it.
  ipcMain.handle('instances:mergeIntoFolder', (e, { aId, bId, name }) => {
    const folders = store.get('folders') || [];
    const trimmed = (name || '').trim() || 'New folder';
    const folder = {
      id: randomUUID(), name: trimmed, icon: null, createdAt: Date.now(),
    };
    folders.push(folder);
    store.set('folders', folders);
    const list = store.get('instances');
    for (const inst of list) {
      if (inst.id === aId || inst.id === bId) inst.folderId = folder.id;
    }
    store.set('instances', list);
    return { ok: true, folder, instances: list.filter((i) => i.id === aId || i.id === bId) };
  });

  // --- library folders (purely organizational — no on-disk folder of their own) ---
  ipcMain.handle('folders:list', () => store.get('folders') || []);

  ipcMain.handle('folders:create', (e, { name }) => {
    const folders = store.get('folders') || [];
    const folder = {
      id: randomUUID(), name: (name || '').trim() || 'New folder', icon: null, createdAt: Date.now(),
    };
    folders.push(folder);
    store.set('folders', folders);
    return { ok: true, folder };
  });

  ipcMain.handle('folders:rename', (e, { id, name }) => {
    const folders = store.get('folders') || [];
    const folder = folders.find((f) => f.id === id);
    if (!folder) return { ok: false, error: 'Folder not found' };
    const trimmed = (name || '').trim();
    if (trimmed) folder.name = trimmed;
    store.set('folders', folders);
    return { ok: true, folder };
  });

  ipcMain.handle('folders:setIcon', async (e, id) => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Выбрать иконку',
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
    let icon;
    try { icon = await prepareIcon(result.filePaths[0]); } catch (err) { return { ok: false, error: err.message }; }
    const folders = store.get('folders') || [];
    const folder = folders.find((f) => f.id === id);
    if (!folder) return { ok: false, error: 'Folder not found' };
    folder.icon = icon;
    store.set('folders', folders);
    return { ok: true, folder };
  });

  ipcMain.handle('folders:delete', (e, id) => {
    const folders = (store.get('folders') || []).filter((f) => f.id !== id);
    store.set('folders', folders);
    const list = store.get('instances');
    let changed = false;
    for (const inst of list) {
      if (inst.folderId === id) { inst.folderId = null; changed = true; }
    }
    if (changed) store.set('instances', list);
    return { ok: true };
  });

  ipcMain.handle('folders:setPinned', (e, { id, pinned }) => {
    const folders = store.get('folders') || [];
    const folder = folders.find((f) => f.id === id);
    if (!folder) return { ok: false, error: 'Folder not found' };
    folder.pinned = !!pinned;
    store.set('folders', folders);
    return { ok: true, folder };
  });

  ipcMain.handle('folders:setSection', (e, { id, sectionId }) => {
    const folders = store.get('folders') || [];
    const folder = folders.find((f) => f.id === id);
    if (!folder) return { ok: false, error: 'Folder not found' };
    folder.sectionId = sectionId || null;
    store.set('folders', folders);
    return { ok: true, folder };
  });

  // --- library sections (custom top-level views, drag-and-drop grouping) ---
  // The implicit "everything" view has no record here — it's just id=null.
  ipcMain.handle('sections:list', () => store.get('librarySections') || []);

  ipcMain.handle('sections:create', (e, { name }) => {
    const sections = store.get('librarySections') || [];
    const trimmed = (name || '').trim();
    if (!trimmed) return { ok: false, error: 'Введите название раздела' };
    const section = { id: randomUUID(), name: trimmed, createdAt: Date.now() };
    sections.push(section);
    store.set('librarySections', sections);
    return { ok: true, section };
  });

  ipcMain.handle('sections:rename', (e, { id, name }) => {
    const sections = store.get('librarySections') || [];
    const section = sections.find((s) => s.id === id);
    if (!section) return { ok: false, error: 'Раздел не найден' };
    const trimmed = (name || '').trim();
    if (trimmed) section.name = trimmed;
    store.set('librarySections', sections);
    return { ok: true, section };
  });

  ipcMain.handle('sections:delete', (e, id) => {
    const sections = (store.get('librarySections') || []).filter((s) => s.id !== id);
    store.set('librarySections', sections);
    // Anything filed under the deleted section falls back to "everything".
    const folders = store.get('folders') || [];
    let fChanged = false;
    for (const f of folders) if (f.sectionId === id) { f.sectionId = null; fChanged = true; }
    if (fChanged) store.set('folders', folders);
    const instances = store.get('instances') || [];
    let iChanged = false;
    for (const i of instances) if (i.sectionId === id) { i.sectionId = null; iChanged = true; }
    if (iChanged) store.set('instances', instances);
    return { ok: true };
  });

  // `orderedIds` is the full list of custom section ids in their new order.
  ipcMain.handle('sections:reorder', (e, orderedIds) => {
    const sections = store.get('librarySections') || [];
    const byId = new Map(sections.map((s) => [s.id, s]));
    const next = orderedIds.map((id) => byId.get(id)).filter(Boolean);
    for (const s of sections) if (!orderedIds.includes(s.id)) next.push(s); // keep any stragglers, just in case
    store.set('librarySections', next);
    return { ok: true, sections: next };
  });

  ipcMain.handle('system:totalMemoryMb', () => Math.floor(os.totalmem() / (1024 * 1024)));

  ipcMain.handle('instances:updateMemory', (e, { id, minMemoryMb, maxMemoryMb }) => {
    const list = store.get('instances');
    const instance = list.find((i) => i.id === id);
    if (!instance) return { ok: false, error: 'Instance not found' };
    instance.minMemoryMb = minMemoryMb || null;
    instance.maxMemoryMb = maxMemoryMb || null;
    store.set('instances', list);
    return { ok: true, instance };
  });

  // Per-instance Java overrides: path to a Java executable and extra JVM arguments.
  ipcMain.handle('instances:updateJava', (e, { id, javaPath, javaArgs }) => {
    const list = store.get('instances');
    const instance = list.find((i) => i.id === id);
    if (!instance) return { ok: false, error: 'Instance not found' };
    if ((javaPath != null && typeof javaPath !== 'string') || (javaArgs != null && typeof javaArgs !== 'string')) return { ok: false, error: 'Некорректное значение' };
    if (String(javaPath || '').length > 500 || String(javaArgs || '').length > 2000) return { ok: false, error: 'Слишком длинное значение' };
    instance.javaPath = (javaPath || '').trim() || null;
    instance.javaArgs = (javaArgs || '').trim() || null;
    store.set('instances', list);
    return { ok: true, instance };
  });

  ipcMain.handle('instances:updateInstall', (e, { id, mcVersion, loader, loaderVersion }) => {
    const list = store.get('instances');
    const instance = list.find((i) => i.id === id);
    if (!instance) return { ok: false, error: 'Instance not found' };
    try {
      if (!LOADERS.includes(loader)) throw new Error('Unknown loader');
      // Horizon is a different game: its build is picked by the launcher, and a normal instance can't turn into one.
      if (loader === 'horizon' || instance.loader === 'horizon') throw new Error('Для сборки Horizon версия и тип не меняются');
      assertVersionString(mcVersion, 'Minecraft version');
      if (loader !== 'vanilla') assertVersionString(String(loaderVersion), 'loader version');
    } catch (err) {
      return { ok: false, error: err.message };
    }
    instance.mcVersion = mcVersion;
    instance.loader = loader;
    instance.loaderVersion = loader === 'vanilla' ? null : loaderVersion;
    store.set('instances', list);
    return { ok: true, instance };
  });

  // Horizon: which release a build plays. null = the latest one (the launcher keeps it up to date); a tag from the list = exactly that release.
  ipcMain.handle('horizon:releases', async (e, force) => {
    try { return { ok: true, releases: await horizon.listReleases(!!force) }; } catch (err) { return { ok: false, error: `Failed получить список версий Horizon: ${err.message}` }; }
  });
  ipcMain.handle('instances:setHorizonVersion', (e, { id, version } = {}) => {
    const list = store.get('instances');
    const instance = list.find((i) => i.id === id);
    if (!instance) return { ok: false, error: 'Instance не найдена' };
    if (instance.loader !== 'horizon') return { ok: false, error: 'Версию Horizon можно выбрать только у сборки Rust' };
    if (version != null && (!horizon.isReleaseTag(version) || version === 'nightly')) return { ok: false, error: 'Некорректная версия Horizon' };
    if (runningProcesses.has(id) || launchingIds.has(id)) return { ok: false, error: 'Сначала закройте игру' };
    if (version) instance.horizonVersion = version; else delete instance.horizonVersion;
    store.set('instances', list);
    return { ok: true, instance };
  });

  ipcMain.handle('instances:repair', async (e, id) => {
    const list = store.get('instances');
    const instance = list.find((i) => i.id === id);
    if (!instance) return { ok: false, error: 'Instance not found' };
    if (runningProcesses.has(id)) return { ok: false, error: 'Instance сейчас запущена' };
    try {
      const settings = store.get('settings');
      const onProgress = (p) => send('instances:repairProgress', { instanceId: id, ...p });
      if (instance.loader === 'horizon') await horizon.prepareInstance(store, onProgress, { canPrune: () => !horizonRunning() }, null, instance.horizonVersion || null);
      else await launch.prepareInstance(instance, onProgress, (instance.javaPath || '').trim() || settings.javaPath);
      send('instances:repairProgress', { instanceId: id, stage: 'done' });
      return { ok: true };
    } catch (err) {
      send('instances:repairProgress', { instanceId: id, stage: 'error', error: err.message });
      return { ok: false, error: err.message };
    }
  });

  // --- Horizon ("Rust") instances: mods, native mods, shader packs, resource packs (mc/horizonMods.js) ---
  const horizonGame = (instanceId) => {
    const instance = store.get('instances').find((i) => i.id === instanceId);
    if (!instance || instance.loader !== 'horizon') throw new Error('Это не сборка Horizon');
    return { instance, game: paths.instanceGameDir(instance.id) };
  };
  const horizonReply = (fn) => async (e, args) => {
    try { return { ok: true, ...(await fn(args && typeof args === 'object' ? args : {})) }; } catch (err) { return { ok: false, error: err.message }; }
  };
  const HZ_KINDS = ['mod', 'native', 'shader', 'resourcepack'];
  const hzTarget = ({ instanceId, kind, file }) => {
    if (!HZ_KINDS.includes(kind) || typeof file !== 'string') throw new Error('Некорректный запрос');
    return { ...horizonGame(instanceId), kind, file };
  };
  // Installs several files; one bad file doesn't stop the others.
  const hzInstallMany = (game, filePaths) => {
    const added = [];
    const errors = [];
    for (const f of (Array.isArray(filePaths) ? filePaths : []).slice(0, 100)) {
      try {
        if (typeof f !== 'string' || !path.isAbsolute(f)) throw new Error('Некорректный путь');
        added.push(horizonMods.installFile(game, f));
      } catch (err) { errors.push(err.message); }
    }
    return { added, errors };
  };
  ipcMain.handle('horizonMods:list', horizonReply(({ instanceId }) => ({ items: horizonMods.list(horizonGame(instanceId).game) })));
  ipcMain.handle('horizonMods:setEnabled', horizonReply((a) => {
    const { game, kind, file } = hzTarget(a);
    horizonMods.setEnabled(game, kind, file, !!a.on);
    return {};
  }));
  ipcMain.handle('horizonMods:remove', horizonReply((a) => {
    const { game, kind, file } = hzTarget(a);
    horizonMods.remove(game, kind, file);
    return {};
  }));
  ipcMain.handle('horizonMods:pickFiles', horizonReply(async ({ instanceId }) => {
    const { game } = horizonGame(instanceId);
    const res = await dialog.showOpenDialog(win, {
      title: 'Add мод, шейдер или ресурспак Horizon',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Mods и паки Horizon', extensions: ['hmod', 'hnmod', 'hshader', 'zip'] }, { name: 'All files', extensions: ['*'] }],
    });
    if (res.canceled) return { added: [], errors: [] };
    return hzInstallMany(game, res.filePaths);
  }));
  ipcMain.handle('horizonMods:installPaths', horizonReply(({ instanceId, filePaths }) => hzInstallMany(horizonGame(instanceId).game, filePaths)));
  // --- native mods: building the game together with them, by Horizon Launcher's compiler (mc/horizonNative.js) ---
  ipcMain.handle('horizonNative:status', horizonReply(({ instanceId }) => {
    const { instance, game } = horizonGame(instanceId);
    return {
      status: horizonNative.status(instance, game, store.get('horizonNativeProfile')),
      building: nativeBuilds.has(instanceId),
      githubToken: githubToken.isSet(),
      profiles: horizonNative.PROFILES,
    };
  }));
  // The GitHub token for the compiler: the window can set or remove it and ask whether there is one, never read it.
  ipcMain.handle('horizonNative:setGithubToken', horizonReply(({ token }) => { githubToken.set(token); return { githubToken: true }; }));
  ipcMain.handle('horizonNative:clearGithubToken', horizonReply(() => { githubToken.clear(); return { githubToken: false }; }));
  ipcMain.handle('horizonNative:setProfile', horizonReply(({ profile }) => {
    if (!horizonNative.PROFILES[profile]) throw new Error('Неизвестный профиль');
    store.set('horizonNativeProfile', profile);
    return {};
  }));
  ipcMain.handle('horizonNative:build', horizonReply(async ({ instanceId, profile, allowMismatch }) => {
    const { instance, game } = horizonGame(instanceId);
    if (nativeBuilds.size) throw new Error('Instance нативных модов уже идёт');
    if (runningProcesses.has(instanceId) || launchingIds.has(instanceId)) throw new Error('Сначала закройте игру');
    if (!horizonNative.PROFILES[profile]) throw new Error('Неизвестный профиль');
    // The compiler is told to trust native code (it is compiled into the game and runs with the user's rights), so the consent
    // is asked here, by the main process — a page can't skip or fake it.
    const consent = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['Собрать', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      title: 'Нативные mods',
      message: 'Собрать игру с нативными модами?',
      detail: 'Нативный мод — это код, который компилируется в саму игру и работает с вашими правами на компьютере. Собирайте только mods, которым доверяете.',
    });
    if (consent.response !== 0) throw new Error('Instance отменена');
    if (nativeBuilds.size) throw new Error('Instance нативных модов уже идёт');
    nativeBuilds.set(instanceId, true);
    store.set('horizonNativeProfile', profile);
    // Runs on; the window hears about it through events.
    horizonNative.build({
      game, profile, allowMismatch: !!allowMismatch, onStep: (step) => send('horizonNative:progress', { instanceId, step }),
    }).then((res) => {
      if (res.ok) {
        const list = store.get('instances');
        const cur = list.find((i) => i.id === instance.id);
        if (cur) { cur.horizonNative = { tag: res.tag, profile, builtAt: Date.now() }; store.set('instances', list); }
      }
      send('horizonNative:done', {
        instanceId, ok: !!res.ok, error: res.error || null, mismatch: res.mismatch || null, noLauncher: !!res.noLauncher, log: res.ok ? '' : horizonNative.logTail(40),
      });
    }).catch((err) => send('horizonNative:done', { instanceId, ok: false, error: err.message }))
      .finally(() => nativeBuilds.delete(instanceId));
    return {};
  }));
  ipcMain.handle('horizonMods:catalog', horizonReply(async () => {
    // Zorya Launcher: keep the mod browser offline so a blocked GitHub never
    // produces a 404 popup when a new instance is opened.
    return { projects: [] };
  }));
  ipcMain.handle('horizonMods:installProject', horizonReply(async ({ instanceId, projectId }) => {
    const { instance, game } = horizonGame(instanceId);
    if (typeof projectId !== 'string') throw new Error('Некорректный запрос');
    return { message: await horizonMods.installProject(game, projectId, instance.mcVersion) };
  }));

  // Total on-disk size of an instance's game folder. Async walk (no main
  // thread blocking), directories in parallel, files stat'ed per directory.
  // At most a handful of disk operations of the size walk are in flight at once, for ALL builds together. Without this, the weight of 40 big
  // builds queued tens of thousands of stat() calls on Node's small thread pool, and everything else that reads the disk (the screenshots
  // list, thumbnails, the mod list) waited behind them for tens of seconds.
  const SIZE_SLOTS = 6;
  let sizeActive = 0;
  const sizeWaiters = [];
  async function sizeOp(fn) {
    if (sizeActive >= SIZE_SLOTS) await new Promise((resolve) => { sizeWaiters.push(resolve); });
    sizeActive += 1;
    try { return await fn(); } finally { sizeActive -= 1; const next = sizeWaiters.shift(); if (next) next(); }
  }
  async function dirSize(dir) {
    let entries;
    try {
      entries = await sizeOp(() => fs.promises.readdir(dir, { withFileTypes: true }));
    } catch {
      return 0;
    }
    const sizes = await Promise.all(entries.map(async (entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return dirSize(full);
      if (!entry.isFile()) return 0;
      try {
        return (await sizeOp(() => fs.promises.stat(full))).size;
      } catch {
        return 0;
      }
    }));
    return sizes.reduce((a, b) => a + b, 0);
  }

  ipcMain.handle('instances:getSize', async (e, id) => {
    try {
      const gameDir = paths.instanceGameDir(id);
      let mods = 0;
      let modsDisabled = 0;
      try {
        for (const name of await fs.promises.readdir(path.join(gameDir, 'mods'))) {
          if (/\.jar$/i.test(name)) mods++;
          else if (/\.jar\.disabled$/i.test(name)) modsDisabled++;
        }
      } catch { /* no mods folder */ }
      return { ok: true, bytes: await dirSize(gameDir), mods, modsDisabled };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('instances:openFolder', async (e, { id, subpath } = {}) => {
    let target;
    try {
      target = subpath ? safeJoin(paths.instanceGameDir(id), subpath) : paths.instanceGameDir(id);
    } catch {
      return { ok: false, error: 'Недопустимый путь' };
    }
    fs.mkdirSync(target, { recursive: true });
    if (!fs.existsSync(target)) {
      return { ok: false, error: `Folder не была создана на диске: ${target}` };
    }
    // shell.openPath resolves to an error string instead of throwing (never
    // rejects). Retry a few times with growing delays — this is a mitigation
    // for Explorer-side interference (shell extensions, AV, etc.), not
    // something we can fully control from here.
    let err = '';
    for (const delayMs of [0, 150, 400, 900]) {
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      err = await shell.openPath(target);
      if (!err) return { ok: true };
    }
    return { ok: false, error: `${err} (путь существует на диске: ${target})` };
  });

  ipcMain.handle('instances:listSaves', (e, id) => {
    const savesDir = path.join(paths.instanceGameDir(id), 'saves');
    if (!fs.existsSync(savesDir)) return [];
    const pinnedMap = store.get('pinnedWorlds') || {};
    const instance = store.get('instances').find((i) => i.id === id);
    return fs.readdirSync(savesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => {
        const stat = fs.statSync(path.join(savesDir, d.name));
        let icon = null;
        try {
          const iconBuf = fs.readFileSync(path.join(savesDir, d.name, 'icon.png'));
          icon = `data:image/png;base64,${iconBuf.toString('base64')}`;
        } catch {
          /* world has no custom icon (or hasn't been saved yet) — fall back to a placeholder */
        }
        return {
          name: d.name,
          mtime: stat.mtimeMs,
          icon,
          pinned: !!pinnedMap[`${id}|${d.name}`],
          canQuickPlay: instance ? recents.supportsQuickPlay(instance.mcVersion) : false,
        };
      })
      .sort((a, b) => (b.pinned - a.pinned) || (b.mtime - a.mtime));
  });

  // World sizes are computed separately (and async) so the worlds list itself
  // shows instantly — walking big worlds can take a moment.
  ipcMain.handle('instances:getSaveSizes', async (e, id) => {
    try {
      const savesDir = path.join(paths.instanceGameDir(id), 'saves');
      const entries = await fs.promises.readdir(savesDir, { withFileTypes: true }).catch(() => []);
      const sizes = {};
      await Promise.all(entries.filter((d) => d.isDirectory()).map(async (d) => {
        sizes[d.name] = await dirSize(path.join(savesDir, d.name));
      }));
      return { ok: true, sizes };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('worldmap:info', (e, { id, world }) => {
    try {
      return worldmap.getInfo(id, world);
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('worldmap:tile', (e, { id, world, dimension, rx, rz }) => worldmap.getTile(id, world, dimension, rx, rz));

  ipcMain.handle('instances:deleteSave', async (e, { id, name }) => {
    // `name` is one folder inside saves/ — never a path ("..\..\" would delete the launcher's own data).
    if (!name || /[\\/]/.test(name) || name === '.' || name === '..') throw new Error('Некорректное имя мира');
    await fs.promises.rm(safeJoin(path.join(paths.instanceGameDir(id), 'saves'), name), { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    const pinnedMap = store.get('pinnedWorlds') || {};
    delete pinnedMap[`${id}|${name}`];
    store.set('pinnedWorlds', pinnedMap);
    return true;
  });

  ipcMain.handle('instances:setWorldPinned', (e, { id, name, pinned }) => {
    const pinnedMap = store.get('pinnedWorlds') || {};
    const key = `${id}|${name}`;
    if (pinned) pinnedMap[key] = true;
    else delete pinnedMap[key];
    store.set('pinnedWorlds', pinnedMap);
    return { ok: true };
  });

  ipcMain.handle('instances:listLogFiles', (e, id) => {
    try {
      const gameDir = paths.instanceGameDir(id);
      const results = [];
      const collect = (dir, prefix) => {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.isFile() && /\.log(\.gz)?$/i.test(entry.name)) {
            const stat = fs.statSync(path.join(dir, entry.name));
            results.push({ name: prefix ? `${prefix}/${entry.name}` : entry.name, mtime: stat.mtimeMs });
          }
        }
      };
      collect(path.join(gameDir, 'logs'), 'logs');
      collect(gameDir, ''); // root-level mod logs, e.g. rei.log
      return results.sort((a, b) => b.mtime - a.mtime);
    } catch {
      return [];
    }
  });

  ipcMain.handle('instances:readLogFile', (e, { id, name }) => {
    try {
      const target = safeJoin(paths.instanceGameDir(id), name);
      if (!/\.log(\.gz)?$/i.test(target)) throw new Error('Invalid path');
      let buf = fs.readFileSync(target);
      if (/\.gz$/i.test(name)) buf = zlib.gunzipSync(buf, { maxOutputLength: 256 * 1024 * 1024 });
      const MAX_CHARS = 4 * 1024 * 1024;
      let text = buf.toString('utf8');
      if (text.length > MAX_CHARS) text = text.slice(-MAX_CHARS);
      return { ok: true, content: text };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('instances:isRunning', (e, id) => runningProcesses.has(id));
  // The last lines of a game's output, for a page opened after the game started (the live feed only reaches an open page).
  ipcMain.handle('instances:getLiveLog', (e, id) => (typeof id === 'string' ? (logBuffers.get(id) || []).map(stripAnsi) : []));

  const CONNECTING_TO_RE = /Connecting to ([^,]+), (\d+)/;
  function recordServerConnection(instanceId, line) {
    const m = CONNECTING_TO_RE.exec(line);
    if (!m) return;
    const key = `${instanceId}|${m[1]}:${m[2]}`;
    const map = store.get('serverConnections');
    map[key] = Date.now();
    store.set('serverConnections', map);
  }

  const nativeBuilds = new Map(); // instanceId -> true while a native build runs

  // Old Horizon builds are deleted when a newer one is installed — never while a Horizon game is running from one.
  const horizonRunning = () => {
    const list = store.get('instances');
    return [...runningProcesses.keys()].some((rid) => list.find((i) => i.id === rid)?.loader === 'horizon');
  };

  const launchInstance = async (e, id, quickPlay, forceRestart) => {
    const list = store.get('instances');
    const instance = list.find((i) => i.id === id);
    if (!instance) return { ok: false, error: 'Instance not found' };
    if (runningProcesses.has(id)) {
      // Guard against a stale tracking entry — if the tracked process is
      // actually already gone (e.g. the game window was closed directly and
      // its 'exit' event never reached us for some reason), self-heal
      // instead of permanently blocking the user from launching again.
      const stalePid = runningProcesses.get(id).pid;
      // eslint-disable-next-line no-await-in-loop
      const alive = await isPidAlive(stalePid);
      if (alive && !forceRestart) return { ok: false, error: 'Already running' };
      if (alive && forceRestart) await killProcessTree(stalePid);
      dropRunning(id);
      finishSession(id);
      send('launch:exit', { instanceId: id, code: null, signal: 'stale' });
    }

    if (!getActiveAccount()) return { ok: false, error: 'No account signed in' };
    // The button must answer at once: renewing the Microsoft session below can take a while on a slow connection.
    send('launch:progress', { instanceId: id, stage: 'preparing' });
    const failEarly = (error) => {
      send('launch:progress', { instanceId: id, stage: 'error', error });
      return { ok: false, error };
    };
    let account;
    try {
      account = await getFreshActiveAccount();
    } catch (err) {
      // The renewal failed (no connection, Microsoft down) but the saved token has not expired yet: the game does not need a new one
      const saved = getActiveAccount();
      if (!err.needsRelogin && saved && saved.type === 'microsoft' && saved.minecraftAccessTokenExpiresAt && saved.minecraftAccessTokenExpiresAt > Date.now() + 60 * 1000) {
        account = saved;
        send('launch:log', { instanceId: id, line: `[Zorya Launcher] Сессию Microsoft обновить failed (${err.message}); запускаю с прежней, она ещё действует\n` });
      } else {
        return failEarly(err.needsRelogin
          ? 'Microsoft session expired. Sign in again.'
          : `Failed обновить сессию Microsoft: ${err.message}`);
      }
    }

    const settings = store.get('settings');
    // Offline accounts: skins/capes/hearts/nick colour of Zorya work only on the MAIN one (nick = the site nick). The cached nick is trusted
    // when it already makes this account the main one; otherwise it is asked again (the nick may have been changed on the site).
    let zoryaOk = account.type !== 'offline';
    if (!zoryaOk) {
      let siteNick = mainAccount.getSiteNick(store);
      if (!mainAccount.isMainOffline(account, siteNick) && license.hasSiteAuth()) {
        siteNick = await Promise.race([refreshSiteNick(), new Promise((resolve) => { setTimeout(() => resolve(mainAccount.getSiteNick(store)), 4000); })]);
      }
      zoryaOk = mainAccount.zoryaAllowed(account, siteNick);
      if (!zoryaOk) send('launch:log', { instanceId: id, line: `[Zorya Launcher] ${account.name}: is not the main offline account (основной — с ником с сайта${siteNick ? `: ${siteNick}` : ''}). Skins, плащи и сердечки Zorya здесь выключены — the game starts as a regular offline player\n` });
    }
    // A custom Java path from Settings is checked up front; otherwise the
    // matching Mojang runtime is fetched during prepareInstance.
    // A per-instance Java path (instance settings) beats the global one.
    // A linked instance (imported "in place") lives in another launcher's folder: if that drive is not connected, say so instead of failing later.
    if (instance.externalGameDir && !fs.existsSync(instance.externalGameDir)) {
      return failEarly(`Folder сборки недоступна: ${instance.externalGameDir}\nThe drive may be disconnected или сборку перенесли в другой лаунчере.`);
    }
    const isHorizon = instance.loader === 'horizon'; // plays through Horizon's own programs, no Java for the game
    const customJava = isHorizon ? '' : ((instance.javaPath || '').trim() || (settings.javaPath || '').trim());
    if (customJava) {
      const javaStatus = java.checkJava(customJava);
      if (!javaStatus.ok) {
        return failEarly(`Failed запустить Java (${customJava}).\n${javaStatus.error || ''}`);
      }
    }

    logBuffers.set(id, []);
    logSizes.set(id, 0);
    lastCrash.delete(id);

    try {
      const onProgress = (p) => send('launch:progress', { instanceId: id, ...p });
      // A Horizon instance with native mods turned on plays the game built with them (when that build is current).
      let nativeBuild = null;
      if (isHorizon) {
        if (nativeBuilds.has(id)) throw new Error('Идёт сборка нативных модов — дождитесь её окончания');
        const ns = horizonNative.status(instance, paths.instanceGameDir(instance.id), store.get('horizonNativeProfile'));
        if (ns.state === 'upToDate') nativeBuild = { tag: ns.tag, dir: ns.dir };
        else if (ns.state !== 'none') {
          send('launch:log', { instanceId: id, line: `[Zorya Launcher] Нативные mods включены, но игра собрана без них${ns.state === 'outdated' ? ' (набор модов изменился)' : ''} — запускаю обычную сборку. Соберите mods на вкладке «Mods».\n` });
        }
      }
      const prepared = isHorizon
        ? await horizon.prepareInstance(store, onProgress, { canPrune: () => !horizonRunning() }, nativeBuild, instance.horizonVersion || null)
        : await launch.prepareInstance(instance, onProgress, customJava);
      if (!store.get('instances').some((i) => i.id === id)) {
        send('launch:progress', { instanceId: id, stage: 'error', error: 'Instance была removed во время подготовки' });
        return { ok: false, error: 'Instance была removed во время подготовки' };
      }
      const effectiveQuickPlay = quickPlay && (isHorizon ? quickPlay.type === 'server' : recents.supportsQuickPlay(instance.mcVersion)) ? quickPlay : null;
      let fullArgs = null;
      let gameDir;
      if (isHorizon) {
        gameDir = paths.instanceGameDir(instance.id);
        // The first launch tells which Minecraft version this Horizon build really is.
        if (prepared.minecraft && prepared.minecraft !== instance.mcVersion) {
          const fresh = store.get('instances');
          const cur = fresh.find((i) => i.id === id);
          if (cur) { cur.mcVersion = prepared.minecraft; store.set('instances', fresh); }
        }
      } else {
        ({ fullArgs, gameDir } = launch.buildArgs(prepared, instance, account, settings, effectiveQuickPlay));

        // The "эталон" of game settings (language, sound, keys, ...): a new build gets it at its first launch. Never blocks the launch.
        try {
          const applied = masterOptions.applyOnLaunch(store, instance, gameDir);
          if (applied.applied) send('launch:log', { instanceId: id, line: `[Zorya Launcher] Эталон настроек: ${applied.stage === 'first' ? 'записана основная часть (язык, звук, дальность)' : 'добавлены клавиши, поле зрения и графика'}\n` });
        } catch (err) {
          send('launch:log', { instanceId: id, line: `[Zorya Launcher] Эталон настроек не применён: ${err.message}\n` });
        }
        // The shared server list: servers the build lacks are added to its servers.dat (only added, never changed or removed).
        try {
          // Not into a build that lives in another launcher's folder ("used in place"): only the button in the build's settings does that.
          const shared = instance.externalGameDir ? { ok: true, added: 0 } : sharedServers.applyTo(store, instance);
          if (shared.ok && shared.added) send('launch:log', { instanceId: id, line: `[Zorya Launcher] General серверы добавлены в список: ${shared.names.join(', ')}\n` });
          else if (!shared.ok && shared.reason) send('launch:log', { instanceId: id, line: `[Zorya Launcher] General серверы не добавлены: ${shared.error}\n` });
        } catch (err) {
          send('launch:log', { instanceId: id, line: `[Zorya Launcher] General серверы не добавлены: ${err.message}\n` });
        }

        // Offline accounts: skins of all Zorya players come from our skin server (authlib-injector). If the agent can't be
        // fetched, the game still starts, just with the usual skins.
        let skinAgent = false;
        // New versions (see cosmetics.skinsViaAgent): our own agent does this, authlib-injector is not used there at all — two agents
        // working on the same authlib classes made skins show up for one player of a LAN game and not for the other.
        const viaAgent = cosmetics.skinsViaAgent(instance);
        if (account.type === 'offline' && zoryaOk && settings.zoryaCosmetics !== false) {
          try {
            // Old versions: the injector (once it is in the arguments the shared skins are on). New versions: our agent, below.
            if (!viaAgent) { fullArgs = [...await skinServer.jvmArgs(), ...fullArgs]; skinAgent = true; }
            // The skin picked for this account must be on the server for other players to see it. Choosing it before the skin
            // server existed (or while the site was down) never put it there, so it is put there at every start (idempotent).
            const worn = account.offlineSkinId ? skins.getSkinFile(account.offlineSkinId) : null;
            if (worn) {
              const r = await Promise.race([
                skinServer.publish(account, worn),
                new Promise((resolve) => { setTimeout(() => resolve({ ok: false, error: 'сайт долго не отвечает' }), 8000); }),
              ]);
              send('launch:log', { instanceId: id, line: `[Zorya Launcher] ${r.ok ? `Skin ${account.name} опубликован на сервере скинов` : `Skin не опубликован: ${r.error}`}\n` });
            } else {
              send('launch:log', { instanceId: id, line: `[Zorya Launcher] У ${account.name} не выбран скин (страница «Skins»): другие игроки увидят стандартного персонажа\n` });
            }
          } catch (err) {
            send('launch:log', { instanceId: id, line: `[Zorya Launcher] General скины недоступны: ${err.message}\n` });
          }
        }

        // Licensed (Microsoft) accounts: the Zorya Cosmetics agent shows Zorya capes on every player who wears one. It only adds a
        // cape picture to what authlib already unpacked — sign-in and the session server are not touched (see zorya-agent/).
        // Offline accounts get it too: it also draws the hearts (Skins page, "Частицы"), which authlib-injector does not do.
        let cosmeticsAgent = false;
        if ((account.type === 'microsoft' || (account.type === 'offline' && zoryaOk && viaAgent)) && settings.zoryaCosmetics !== false) {
          try {
            // The overlay (Right Ctrl in the game): a port to receive the game's numbers on; without one the agent measures nothing
            const metricsPort = OVERLAY_ENABLED && settings.overlayEnabled !== false ? await overlay.prepare(id, cosmetics.overlayKey(settings.overlayKey).label) : null;
            const agentArgs = cosmetics.jvmArgs({ offline: account.type === 'offline', metricsPort, overlayKeyId: settings.overlayKey, account });
            if (agentArgs.length) {
              fullArgs = [...agentArgs, ...fullArgs];
              cosmeticsAgent = true;
              send('launch:log', { instanceId: id, line: '[Zorya Launcher] Zorya Cosmetics: плащи и сердечки Zorya включены\n' });
            }
          } catch (err) {
            send('launch:log', { instanceId: id, line: `[Zorya Launcher] Zorya Cosmetics не подключён: ${err.message}\n` });
          }
        }

        // New versions: shared skins are on only if the agent really is in the arguments (otherwise the generated own-skin pack below stays as the fallback).
        if (viaAgent && cosmeticsAgent && account.type === 'offline') skinAgent = true;

        // The nick colour (Premium) is shown in the game to every Zorya player: the account has to be linked to the site account.
        if (cosmeticsAgent) {
          // Silent on failure: without a site sign-in or a subscription there is simply nothing to link.
          await Promise.race([
            skinServer.link(account),
            new Promise((resolve) => { setTimeout(resolve, 6000); }),
          ]);
        }

        // Hearts around the player: a vanilla heart particle drawn by the agent, with the Chubrik pictures supplied by the agent itself
        // from memory (no resource pack, nothing on disk). Only where the agent can find the player (see heartsPack.supported); never
        // blocks the launch. The pictures are the same for everybody who runs the agent, so other players' hearts look the same.
        try {
          const wearHearts = !!account.heartsEnabled && cosmeticsAgent;
          if (wearHearts) {
            const r = await Promise.race([
              skinServer.setHearts(account, true),
              new Promise((resolve) => { setTimeout(() => resolve({ ok: false, error: 'сайт долго не отвечает' }), 8000); }),
            ]);
            if (!r.ok) send('launch:log', { instanceId: id, line: `[Zorya Launcher] Hearts не опубликованы: ${r.error}\n` });
          }
          // The heart pictures live inside the agent now; what older launcher versions left in the game folder is taken away.
          heartsPack.removeLegacy(gameDir, instance.mcVersion);
          if (wearHearts && !heartsPack.supported(instance)) send('launch:log', { instanceId: id, line: `[Zorya Launcher] Hearts видны на Minecraft 26.1+ и NeoForge 1.20.5+; на ${instance.mcVersion} (${instance.loader}) их не будет\n` });
        } catch (err) {
          send('launch:log', { instanceId: id, line: `[Zorya Launcher] Hearts не применены: ${err.message}\n` });
        }

        // The cape picked on the Skins page (any account type) is kept on the site; put it there again at every start so it
        // survives a site that was down when it was picked (never blocks the launch).
        if (account.customCapeId && zoryaOk) {
          const r = await Promise.race([
            skinServer.setCape(account, account.customCapeId),
            new Promise((resolve) => { setTimeout(() => resolve({ ok: false, error: 'сайт долго не отвечает' }), 8000); }),
          ]);
          if (!r.ok) send('launch:log', { instanceId: id, line: `[Zorya Launcher] Cape не опубликован: ${r.error}\n` });
        }

        // Own skin for offline accounts WITHOUT the skin server: a generated resource pack that replaces the default skin
        // (only this player sees it). With the skin server on, the pack would only paint other players' default skins in the
        // same colour, so it is taken out instead (never blocks the launch).
        try {
          let entry = !skinAgent && account.type === 'offline' && zoryaOk && account.offlineSkinId ? skins.getSkinFile(account.offlineSkinId) : null;
          // Licensed account on an old version (the agent shows the real skin on offline-mode servers only on 1.21+): its Mojang skin goes
          // into the same pack, for the UUID the nick has on an offline server; on online servers the account's own skin is used as usual.
          let packUuid = account.id;
          if (!entry && account.type === 'microsoft' && !viaAgent && account.skinUrl && account.name) {
            const buf = await freshMoves.fetchSkinBuffer(account.skinUrl);
            if (buf) { entry = { buf, variant: account.skinVariant === 'slim' ? 'slim' : 'classic' }; packUuid = auth.makeOfflineAccount(account.name).id; }
          }
          const v = instance.mcVersion;
          const res = offlineSkin.sync({
            gameDir,
            mcVersion: v,
            jarPath: path.join(paths.versionsDir(), v, `${v}.jar`),
            uuid: packUuid,
            skin: entry && { buf: entry.buf, slim: entry.variant === 'slim' },
          });
          if (!res.ok) send('launch:log', { instanceId: id, line: `[Zorya Launcher] Skin не применён: ${res.error}\n` });
        } catch (err) {
          send('launch:log', { instanceId: id, line: `[Zorya Launcher] Skin не применён: ${err.message}\n` });
        }
        // Fresh Moves is NOT put in at launch: it is installed and switched on only from its own window (right click on the character).
      }

      send('launch:progress', { instanceId: id, stage: 'starting' });
      const onLine = (line) => {
        recordServerConnection(id, line);
        pushLog(id, line);
        send('launch:log', { instanceId: id, line: stripAnsi(line) });
      };
      const onExit = ({ code, signal }) => {
        // Still tracked = the game ended by itself (not via the Stop button).
        const endedOnItsOwn = runningProcesses.get(id) === child;
        const startedAt = launchStartTimes.get(id);
        dropRunning(id);
        finishSession(id);
        heartsPack.removeFile(gameDir);
        send('launch:exit', { instanceId: id, code, signal });
        if (endedOnItsOwn && code !== 0 && code !== null) {
          try {
            const analysis = crashAnalysis.analyzeCrash({
              gameDir, lines: logBuffers.get(id) || [], startedAt, exitCode: code,
            });
            lastCrash.set(id, analysis);
            send('launch:crash', { instanceId: id, analysis });
          } catch { /* analysis is best-effort */ }
        }
      };
      // Horizon runs as "Minecraft Rust (H)" with the launcher's icon (a patched copy of the game's exe; the original if that fails).
      if (isHorizon) prepared.clientExe = await horizonBrand.ensureBrandedExe(prepared.clientExe, (line) => send('launch:log', { instanceId: id, line }));
      // An offline account's skin and cape reach Horizon as files named by environment variables (see horizonSkin.js).
      const horizonEnv = isHorizon
        ? await horizonSkin.prepareEnv({ instanceId: id, account: zoryaOk ? account : null, log: (m) => send('launch:log', { instanceId: id, line: `[Zorya Launcher] ${m}\n` }) })
        : null;
      // The game is a separate process: closing the launcher leaves it running (see gameProc.js / adoptRunningGames).
      // The overlay for Horizon: the game is asked for its numbers through its own control socket (the file it writes there is named here)
      const horizonControlFile = OVERLAY_ENABLED && isHorizon && settings.overlayEnabled !== false
        ? overlay.prepareHorizon(id, cosmetics.overlayKey(settings.overlayKey).label, cosmetics.overlayKey(settings.overlayKey).vk)
        : null;
      const child = isHorizon
        ? horizon.launchProcess(prepared, gameDir, account, settings, effectiveQuickPlay, onLine, onExit, id, horizonEnv, horizonControlFile)
        : launch.launchProcess(prepared.javaExe, fullArgs, gameDir, onLine, onExit, id);
      runningProcesses.set(id, child);
      const startedMs = Date.now();
      launchStartTimes.set(id, startedMs);
      rememberRunning(id, child.pid, startedMs);
      if (isHorizon) horizonBrand.setWindowTitle(child.pid);
      refreshPresence();
      overlay.attachProcess(id, child.pid);
      monitor.start(id, child.pid, (sample) => { send('monitor:sample', { instanceId: id, sample }); overlay.onProcessSample(id, sample); });

      // `list` was read before the (possibly minutes-long) preparation: writing it back
      // would undo anything changed meanwhile — a rename, a pin — or bring back an
      // instance the user deleted while it was downloading. Update a fresh copy instead.
      const fresh = store.get('instances');
      const current = fresh.find((i) => i.id === id);
      if (current) {
        current.lastPlayed = Date.now();
        store.set('instances', fresh);
      }

      send('launch:progress', { instanceId: id, stage: 'running' });
      return { ok: true };
    } catch (err) {
      overlay.release(id);
      send('launch:progress', { instanceId: id, stage: 'error', error: err.message });
      return { ok: false, error: err.message };
    }
  };

  // A double-click on Play (or a jump-list click racing a card click) must not
  // start the same instance twice while the first launch is still preparing.
  const launchingIds = new Set();
  // Zorya Launcher: direct local Horizon start — no GitHub, no account, no
  // license gate. Uses the already installed client and prepared resources.
  ipcMain.handle('zorya:launch', async (e, id) => {
    try {
      const instance = (store.get('instances') || []).find((i) => i.id === id);
      if (!instance) return { ok: false, error: 'Instance not found' };
      // Java instances (Vanilla/Fabric/Forge/Quilt) keep the original Java
      // launch path; only Horizon builds use the direct local start below.
      if (instance.loader !== 'horizon') return await launchInstance(e, id, null, false);
      const existing = zoryaChildren.get(id);
      if (existing && existing.exitCode === null && existing.signalCode === null) {
        return { ok: false, error: 'Already running' };
      }
      zoryaChildren.delete(id);
      const game = paths.instanceGameDir(id);
      const dataDir = app.getPath('appData');
      const roots = [
        path.join(dataDir, 'ZoryaLauncher', 'meta', 'versions'),
        path.join(dataDir, 'ZoryaLauncher', 'meta', 'versions'),
        path.join(dataDir, 'horizon-launcher', 'versions'),
      ];
      let best = null;
      for (const root of roots) {
        if (!fs.existsSync(root)) continue;
        for (const name of fs.readdirSync(root)) {
          const exe = path.join(root, name, 'horizon-client.exe');
          if (!fs.existsSync(exe)) continue;
          const prepared = path.join(root, name, '.local', 'horizon-client', '26.3');
          const ok = fs.existsSync(prepared);
          const m = fs.statSync(exe).mtimeMs;
          // A build WITH prepared resources always wins over a newer empty one.
          if (!best || (ok && !best.ok) || (ok === best.ok && m > best.m)) {
            best = { exe, prepared: ok ? prepared : '', m };
          }
        }
      }
      let client = best && best.exe;
      let resources = best && best.prepared;
      if (!client || !resources || !fs.existsSync(resources)) {
        // Nothing prepared locally: download the ready-to-play Horizon bundle
        // from this launcher's own GitHub release (works even when the
        // horizon-rust organisation is hidden by a 404).
        try {
          const url = 'https://github.com/romamakovij7-cmyk/zorya-launcher/releases/download/v0.1.1/horizon-ready-26.3.zip';
          const zip = path.join(app.getPath('userData'), 'downloads', 'horizon-ready-26.3.zip');
          fs.mkdirSync(path.dirname(zip), { recursive: true });
          const expectedSize = 642797396;
          let have = fs.existsSync(zip) ? fs.statSync(zip).size : 0;
          if (have > expectedSize) { fs.rmSync(zip, { force: true }); have = 0; }
          // A stalled connection used to leave the launcher stuck at ~98%.
          // Every attempt resumes from the bytes already on disk; a watchdog
          // aborts a silent stream and the loop simply continues.
          for (let attempt = 0; have < expectedSize && attempt < 25; attempt += 1) {
            const offset = have;
            const controller = new AbortController();
            let lastChunk = Date.now();
            const watchdog = setInterval(() => {
              if (Date.now() - lastChunk > 15000) controller.abort();
            }, 3000);
            let out = null;
            try {
              const res = await fetch(url, {
                headers: offset > 0 ? { Range: `bytes=${offset}-` } : {},
                signal: controller.signal,
              });
              if (!res.ok && res.status !== 206) throw new Error(`download ${res.status}`);
              const append = offset > 0 && res.status === 206;
              if (!append) { fs.rmSync(zip, { force: true }); have = 0; }
              out = fs.createWriteStream(zip, { flags: append ? 'a' : 'w' });
              let loaded = append ? offset : 0;
              let last = 0;
              for await (const chunk of res.body) {
                lastChunk = Date.now();
                loaded += chunk.length;
                if (!out.write(chunk)) await new Promise((resolve) => out.once('drain', resolve));
                const now = Date.now();
                if (now - last > 300) {
                  last = now;
                  send('launch:progress', { instanceId: id, stage: 'downloading', completed: loaded, total: expectedSize, bytes: true });
                }
              }
              await new Promise((resolve, reject) => out.end((e) => (e ? reject(e) : resolve())));
              out = null;
            } catch {
              if (out && !out.destroyed) out.destroy();
              // Keep the partial file: the next attempt resumes from its size.
            } finally {
              clearInterval(watchdog);
            }
            have = fs.existsSync(zip) ? fs.statSync(zip).size : 0;
          }
          if (have !== expectedSize) throw new Error(`incomplete download (${have}/${expectedSize})`);
          send('launch:progress', { instanceId: id, stage: 'extracting' });
          const versionDir = path.join(dataDir, 'ZoryaLauncher', 'meta', 'versions', 'nightly-2026-11-22-f1bb66f');
          const tmp = `${versionDir}.unpacking`;
          fs.mkdirSync(path.dirname(versionDir), { recursive: true });
          fs.rmSync(tmp, { recursive: true, force: true });
          // Extraction runs in a separate PowerShell process so the launcher
          // window stays responsive during the ~32k files of the bundle.
          await new Promise((resolve, reject) => {
            const q = (s) => s.replace(/'/g, "''");
            const cmd = `Expand-Archive -LiteralPath '${q(zip)}' -DestinationPath '${q(tmp)}' -Force`;
            const child = spawn('powershell', ['-NoProfile', '-Command', cmd], { windowsHide: true, stdio: 'ignore' });
            child.on('error', reject);
            child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`extract ${code}`))));
          });
          fs.rmSync(versionDir, { recursive: true, force: true });
          fs.renameSync(tmp, versionDir);
          client = path.join(versionDir, 'horizon-client.exe');
          resources = path.join(versionDir, '.local', 'horizon-client', '26.3');
        } catch (err) {
          return { ok: false, error: `Horizon download failed: ${err.message}` };
        }
      }
      if (!client || !fs.existsSync(client)) return { ok: false, error: 'horizon-client.exe not found' };
      if (!resources || !fs.existsSync(resources)) {
        const local = path.join(game, '.local', 'horizon-client', '26.3');
        if (fs.existsSync(local)) resources = local;
      }
      if (!resources || !fs.existsSync(resources)) return { ok: false, error: 'Prepared Horizon resources not found' };
      const versionRoot = path.dirname(client);
      const account = getActiveAccount();
      const name = (account && account.name) || 'Player';
      const logFile = path.join(game, 'logs', 'zorya-launch.log');
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      const out = fs.openSync(logFile, 'a');
      // Equip the offline skin the same way the original launcher does:
      // Horizon reads it from HORIZON_OFFLINE_SKIN / HORIZON_OFFLINE_SKIN_MODEL.
      const skinEnv = await horizonSkin.prepareEnv({
        instanceId: id,
        account: account && account.type === 'offline' ? account : null,
        worn: store.get('cosmeticsWorn') || {},
        log: (m) => send('launch:log', { instanceId: id, line: `[Zorya] ${m}\n` }),
      });
      const child = spawn(client, [
        '--resources', resources, '--game-dir', game, '--home', game,
        '--width', '854', '--height', '480', '--name', name,
      ], {
        cwd: versionRoot, detached: true, stdio: ['ignore', out, out],
        env: { ...process.env, ...skinEnv },
      });
      child.unref();
      const startedMs = Date.now();
      zoryaChildren.set(id, child);
      // Track the session exactly like the Java/Horizon launch path, otherwise
      // Stats (and the Monitor) never see time spent in a directly started
      // Horizon build.
      runningProcesses.set(id, child);
      launchStartTimes.set(id, startedMs);
      rememberRunning(id, child.pid, startedMs);
      refreshPresence();
      monitor.start(id, child.pid, (sample) => { send('monitor:sample', { instanceId: id, sample }); });
      child.on('exit', (code, signal) => {
        zoryaChildren.delete(id);
        if (runningProcesses.get(id) === child) dropRunning(id);
        monitor.stop(id);
        finishSession(id);
        send('launch:exit', { instanceId: id, code, signal: signal || null });
      });
      send('launch:progress', { instanceId: id, stage: 'running' });
      return { ok: true, pid: child.pid };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('instances:launch', async (e, id, quickPlay, forceRestart) => {
    if (launchingIds.has(id)) return { ok: false, error: 'Instance уже запускается.', alreadyStarting: true };
    launchingIds.add(id);
    try {
      return await launchInstance(e, id, quickPlay, forceRestart);
    } finally {
      launchingIds.delete(id);
    }
  });

  ipcMain.handle('monitor:history', (e, id) => {
    const instance = store.get('instances').find((i) => i.id === id);
    const settings = { ...SETTINGS_DEFAULTS, ...store.get('settings') };
    return {
      ...monitor.history(id),
      running: runningProcesses.has(id),
      maxMemoryMb: instance?.maxMemoryMb || settings.maxMemoryMb,
    };
  });
  app.on('before-quit', () => { monitor.stopAll(); overlay.releaseAll(); });

  ipcMain.handle('instances:getLastCrash', (e, id) => lastCrash.get(id) || null);
  ipcMain.handle('instances:clearCrash', (e, id) => { lastCrash.delete(id); return true; });
  ipcMain.handle('instances:openCrashReport', (e, id) => {
    const report = lastCrash.get(id)?.reportPath;
    if (!report || !fs.existsSync(report)) return { ok: false, error: 'File краш-репорта не найден' };
    shell.showItemInFolder(report);
    return { ok: true };
  });

  // Play history for the statistics page (start time + length per session).
  ipcMain.handle('stats:get', () => {
    // Builds deleted earlier keep their numbers; one that came back (same id, e.g. restored) is not listed twice.
    const alive = new Set((store.get('instances') || []).map((i) => i.id));
    const deleted = Object.values(store.get('deletedInstances') || {}).filter((d) => d && !alive.has(d.id));
    return { ok: true, sessions: store.get('playSessions') || [], deleted };
  });

  // ---- Female Gender Mod: settings of the player (see mc/genderMod.js) ----
  // The account must be one of the launcher's own (its id becomes a file name), the instance one of the launcher's instances.
  // A licensed account's id is 32 hex digits, an offline account's is a UUID with dashes: both give the same 32 digits (the mod names the file by the dashed form).
  const genderAccountId = (accountId) => {
    const acc = (store.get('accounts') || []).find((a) => a.id === accountId);
    const hex = acc ? String(acc.id).replace(/-/g, '') : '';
    return /^[0-9a-fA-F]{32}$/.test(hex) ? hex.toLowerCase() : null;
  };
  ipcMain.handle('gender:detect', () => ({ ok: true, instances: genderMod.detect(store.get('instances') || []) }));
  ipcMain.handle('gender:get', (e, { instanceId, accountId } = {}) => {
    const id = genderAccountId(accountId);
    if (!id) return { ok: false, error: 'Account не найден' };
    const inst = (store.get('instances') || []).find((i) => i.id === instanceId);
    if (!inst) return { ok: false, error: 'Instance не найдена' };
    try { return genderMod.read(paths.instanceGameDir(inst.id), id); } catch (err) { return { ok: false, error: err.message }; }
  });
  // The look of the character in the launcher: the settings from the instance with the mod that was played last
  ipcMain.handle('gender:look', (e, accountId) => {
    const id = genderAccountId(accountId);
    if (!id) return { ok: false, error: 'Account не найден' };
    const all = store.get('instances') || [];
    const withMod = genderMod.detect(all).map((m) => all.find((i) => i.id === m.id)).filter(Boolean);
    if (!withMod.length) return { ok: true, present: false };
    withMod.sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
    for (const inst of withMod) {
      try {
        const r = genderMod.read(paths.instanceGameDir(inst.id), id);
        if (r.present && r.exists) return { ok: true, present: true, instanceId: inst.id, settings: r.settings, uv: r.uv || null };
      } catch { /* try the next one */ }
    }
    return { ok: true, present: false }; // the mod is there, but this player has no settings yet: nothing to show
  });
  ipcMain.handle('gender:set', (e, { instanceIds, accountId, settings } = {}) => {
    const id = genderAccountId(accountId);
    if (!id) return { ok: false, error: 'Account не найден' };
    if (!Array.isArray(instanceIds) || !instanceIds.length || instanceIds.length > 200 || !settings || typeof settings !== 'object') return { ok: false, error: 'Некорректный запрос' };
    const all = store.get('instances') || [];
    const results = [];
    for (const instanceId of instanceIds) {
      const inst = all.find((i) => i.id === instanceId);
      if (!inst) { results.push({ instanceId, ok: false, error: 'Instance не найдена' }); continue; }
      if (runningProcesses.has(inst.id)) { results.push({ instanceId, name: inst.name, ok: false, error: 'Game запущена: мод перезапишет настройки при выходе. Закройте игру и повторите.' }); continue; }
      try { results.push({ instanceId, name: inst.name, ...genderMod.write(paths.instanceGameDir(inst.id), id, settings) }); } catch (err) { results.push({ instanceId, name: inst.name, ok: false, error: err.message }); }
    }
    return { ok: results.every((r) => r.ok), results };
  });

  // ---- Fresh Moves: pack + EMF/ETF per instance (see mc/freshMoves.js) ----
  ipcMain.handle('fresh:status', () => ({ ok: true, instances: freshMoves.status(store.get('instances') || []) }));
  ipcMain.handle('fresh:apply', async (e, { instanceIds, enable } = {}) => {
    if (!Array.isArray(instanceIds) || !instanceIds.length || instanceIds.length > 200 || typeof enable !== 'boolean') return { ok: false, error: 'Некорректный запрос' };
    const all = store.get('instances') || [];
    const results = [];
    for (const instanceId of instanceIds) {
      const inst = all.find((i) => i.id === instanceId);
      if (!inst) { results.push({ instanceId, ok: false, error: 'Instance не найдена' }); continue; }
      if (runningProcesses.has(inst.id)) { results.push({ instanceId, name: inst.name, ok: false, error: 'Game запущена: закройте её и повторите' }); continue; }
      try {
        const r = enable ? await freshMoves.install(inst) : freshMoves.disable(inst);
        results.push({ instanceId, name: inst.name, ...r });
      } catch (err) { results.push({ instanceId, name: inst.name, ok: false, error: err.message }); }
    }
    return { ok: results.every((r) => r.ok), results };
  });

  // Delete the statistics of one build: its dated sessions go, its total time is set to 0; for a build that has been deleted its saved "card"
  // (name, icon) goes too, so it leaves the lists completely. The build itself, its files and its other settings are not touched.
  ipcMain.handle('stats:clearInstance', (e, id) => {
    if (typeof id !== 'string' || id.length > 80) return { ok: false, error: 'Некорректная сборка' };
    const sessions = store.get('playSessions') || [];
    const kept = sessions.filter((s) => s.instanceId !== id);
    store.set('playSessions', kept);
    const list = store.get('instances') || [];
    const inst = list.find((i) => i.id === id);
    if (inst) { inst.totalPlaytimeMs = 0; store.set('instances', list); }
    const gone = store.get('deletedInstances') || {};
    if (gone[id]) { delete gone[id]; store.set('deletedInstances', gone); }
    return { ok: true, removedSessions: sessions.length - kept.length, instance: inst || null };
  });

  // «Итоги года»: the picture card is saved where the player says. Only a PNG of a sane size is written, under a name the program makes safe.
  ipcMain.handle('recap:saveCard', async (e, { dataUrl, name } = {}) => {
    const m = typeof dataUrl === 'string' && dataUrl.length <= 8 * 1024 * 1024 + 32 ? /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl) : null;
    if (!m || m[1].length > 8 * 1024 * 1024) return { ok: false, error: 'Failed подготовить картинку.' };
    const buf = Buffer.from(m[1], 'base64');
    if (buf.length < 100 || buf.toString('latin1', 1, 4) !== 'PNG') return { ok: false, error: 'Failed подготовить картинку.' };
    const safeName = String(name || 'zorya-itogi.png').replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 60);
    const res = await dialog.showSaveDialog(win, { title: 'Save карточку', defaultPath: safeName, filters: [{ name: 'PNG', extensions: ['png'] }] });
    if (res.canceled || !res.filePath) return { ok: false, canceled: true };
    try { fs.writeFileSync(res.filePath, buf); return { ok: true, filePath: res.filePath }; } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('instances:stop', (e, id) => {
    const child = runningProcesses.get(id);
    if (child) {
      // Plain child.kill() only signals the immediate java.exe — on Windows
      // that can leave the actual game process (spawned as a sub-process)
      // running, so the window never closes and the launcher never sees an
      // 'exit' event. taskkill /T kills the whole process tree.
      if (process.platform === 'win32' && child.pid) {
        killProcessTree(child.pid);
      } else {
        child.kill();
      }
      dropRunning(id);
      finishSession(id);
      // Don't wait on the (possibly unreliable) 'exit' event to update the
      // UI — the user asked to stop, so reflect that immediately.
      send('launch:exit', { instanceId: id, code: null, signal: 'stopped' });
      return true;
    }
    return false;
  });

  // After the launcher was closed and opened again: games that are still running (see dropRunning/rememberRunning) are picked up —
  // shown as running, Stop works, the console continues from the game's output file, and play time is counted when they end.
  // A pid is trusted only when the process start time matches the recorded launch (otherwise it may be a stranger with a reused pid).
  async function adoptRunningGames() {
    const saved = store.get('runningGames') || {};
    for (const [id, rec] of Object.entries(saved)) {
      try {
        if (runningProcesses.has(id)) continue;
        const known = store.get('instances').some((i) => i.id === id);
        if (!known || !Number.isInteger(rec?.pid) || !Number.isFinite(rec?.startedAt)) { dropRunning(id); continue; }
        // eslint-disable-next-line no-await-in-loop
        const startMs = await processStartMs(rec.pid);
        if (startMs == null || Math.abs(startMs - rec.startedAt) > 30000) {
          // The game ended while the launcher was closed: without this the whole session (hours, maybe) was simply forgotten. The end is taken
          // from the game's output file (it gets the shutdown lines when the game exits), at the latest from the last time we saw it running.
          // Not credited when the process may still be there and only its start time could not be read.
          // eslint-disable-next-line no-await-in-loop
          const stillThere = startMs == null && await isPidAlive(rec.pid);
          if (!stillThere) {
            let endMs = Number(rec.lastAlive) || 0;
            try { endMs = Math.max(endMs, fs.statSync(gameProc.logPathFor(id)).mtimeMs); } catch { /* no output file */ }
            const durationMs = Math.min(endMs - rec.startedAt, 3 * 24 * 60 * 60 * 1000);
            if (Number.isFinite(durationMs) && durationMs > 60 * 1000) creditSession(id, rec.startedAt, durationMs);
          }
          dropRunning(id);
          continue;
        }
        runningProcesses.set(id, { pid: rec.pid, adopted: true, kill() {} });
        launchStartTimes.set(id, rec.startedAt);
        const logFile = gameProc.logPathFor(id);
        const { text, size } = gameProc.readTail(logFile);
        logBuffers.set(id, text ? [text] : []);
        logSizes.set(id, text ? text.length : 0);
        adoptedTails.set(id, gameProc.tailFile(logFile, (t) => {
          recordServerConnection(id, t);
          pushLog(id, t);
          send('launch:log', { instanceId: id, line: stripAnsi(t) });
        }, size));
        monitor.start(id, rec.pid, (sample) => send('monitor:sample', { instanceId: id, sample }));
        send('launch:progress', { instanceId: id, stage: 'running' });
      } catch { dropRunning(id); }
    }
    // The hearts pack is only needed while a game runs: nothing is left behind for instances that are not running now.
    for (const inst of store.get('instances')) {
      if (runningProcesses.has(inst.id) || inst.loader === 'horizon') continue;
      try { heartsPack.removeFile(paths.instanceGameDir(inst.id)); } catch { /* ignore */ }
    }
    refreshPresence();
  }
  ipcMain.handle('instances:runningIds', () => [...runningProcesses.keys()]);
  // { instanceId: start time in ms } of the games that are running now (the home screen shows how long each one has been on)
  ipcMain.handle('instances:runningStartTimes', () => Object.fromEntries([...runningProcesses.keys()].map((id) => [id, launchStartTimes.get(id) || null])));
  setTimeout(() => { adoptRunningGames().catch(() => {}); }, 1200);

  // --- background modpack installs: pause / resume / cancel ---
  const installControls = new Map(); // installId -> InstallControl
  ipcMain.handle('installs:control', (e, { installId, action }) => {
    const c = installControls.get(installId);
    if (!c) return { ok: false };
    if (action === 'pause') c.pause();
    else if (action === 'resume') c.resume();
    else if (action === 'cancel') c.cancel();
    return { ok: true };
  });

  // Runs one modpack install under a control switch and stores the result.
  async function runModpackInstall(installId, install) {
    const control = new InstallControl();
    if (installId) installControls.set(installId, control);
    try {
      const instance = await install(control);
      const list = store.get('instances');
      list.unshift(instance);
      store.set('instances', list);
      return { ok: true, instance };
    } catch (err) {
      if (isCancelError(err)) return { ok: false, cancelled: true, error: 'Loading отменена' };
      return { ok: false, error: err.message };
    } finally {
      installControls.delete(installId);
    }
  }

  // Same queue/control machinery as a fresh install, but merges a `patch`
  // into the existing instance record instead of adding a new one.
  async function runPackUpdate(installId, instanceId, run) {
    const control = new InstallControl();
    if (installId) installControls.set(installId, control);
    try {
      const { patch } = await run(control);
      const list = store.get('instances');
      const instance = list.find((i) => i.id === instanceId);
      if (instance) Object.assign(instance, patch);
      store.set('instances', list);
      return { ok: true, instance };
    } catch (err) {
      if (isCancelError(err)) return { ok: false, cancelled: true, error: 'Update отменено' };
      return { ok: false, error: err.message };
    } finally {
      installControls.delete(installId);
    }
  }

  // Reads the pack's current project/version metadata off the stored
  // instance record (works the same regardless of platform).
  ipcMain.handle('instances:checkPackUpdate', async (e, instanceId) => {
    const instance = store.get('instances').find((i) => i.id === instanceId);
    if (!instance) return { ok: false, error: 'Instance не найдена' };
    if (!['modrinth', 'curseforge'].includes(instance.source)) {
      return { ok: false, error: 'Эта сборка не была установлена с Modrinth или CurseForge' };
    }
    try {
      if (instance.source === 'modrinth') {
        const latest = await modrinth.checkPackUpdate(instance.projectId, instance.versionId);
        return { ok: true, hasUpdate: !!latest, latest: latest && { versionId: latest.id, name: latest.name || latest.version_number } };
      }
      const apiKey = store.get('settings').curseforgeApiKey;
      const latest = await curseforge.checkPackUpdate(apiKey, instance.projectId, instance.versionId);
      return { ok: true, hasUpdate: !!latest, latest: latest && { versionId: String(latest.id), name: latest.displayName || latest.fileName } };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('instances:updatePack', (e, { instanceId, installId }) => {
    const instance = store.get('instances').find((i) => i.id === instanceId);
    if (!instance) return { ok: false, error: 'Instance не найдена' };
    if (!['modrinth', 'curseforge'].includes(instance.source)) {
      return { ok: false, error: 'Эта сборка не была установлена с Modrinth или CurseForge' };
    }
    return runPackUpdate(installId, instanceId, async (control) => {
      if (instance.source === 'modrinth') {
        const [project, latest] = await Promise.all([
          modrinth.getProject(instance.projectId),
          modrinth.checkPackUpdate(instance.projectId, instance.versionId),
        ]);
        if (!latest) throw new Error('Уже установлена последняя версия');
        return modrinth.updatePack({
          instanceId, project, version: latest, control, onProgress: (p) => send('modrinth:installProgress', { projectId: instance.projectId, installId, ...p }),
        });
      }
      const apiKey = store.get('settings').curseforgeApiKey;
      const [mod, latest] = await Promise.all([
        curseforge.getMod(apiKey, instance.projectId),
        curseforge.checkPackUpdate(apiKey, instance.projectId, instance.versionId),
      ]);
      if (!latest) throw new Error('Уже установлена последняя версия');
      return curseforge.updatePack({
        apiKey, instanceId, project: mod, file: latest, control, onProgress: (p) => send('curseforge:installProgress', { projectId: instance.projectId, installId, ...p }),
      });
    });
  });

  // --- import from another launcher (Prism/MultiMC, ATLauncher) ---
  ipcMain.handle('importers:detect', () => {
    try {
      return { ok: true, launchers: importers.detect(), known: importers.KNOWN };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('importers:size', async (e, args) => {
    try { return { ok: true, bytes: await importers.sizeOf(args) }; } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('importers:import', (e, {
    launcherId, root, key, installId, mode,
  }) => runModpackInstall(installId, (control) => importers.importInstance({
    launcherId, root, key, mode: mode === 'link' ? 'link' : 'copy', onProgress: (p) => send('importers:importProgress', { installId, ...p }),
  }, control)));
  // A launcher kept on another drive / in a folder of its own: the user points at the folder, we check it looks like one and remember it.
  ipcMain.handle('importers:addFolder', async () => {
    const result = await dialog.showOpenDialog(win, { title: 'Folder с данными другого лаунчера', properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
    try {
      const added = importers.addFolder(result.filePaths[0]);
      return { ok: true, added, launchers: importers.detect(), known: importers.KNOWN };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // --- modrinth ---
  ipcMain.handle('modrinth:installModpack', (e, { project, version, installId }) => runModpackInstall(installId, (control) => modrinth.installModpack({
    project,
    version,
    control,
    onProgress: (p) => send('modrinth:installProgress', { projectId: project.id, installId, ...p }),
  })));

  ipcMain.handle('modrinth:installMod', async (e, { instanceId, file, kind, versionId }) => {
    try {
      await modrinth.installModFile({ instanceId, file, kind });
      // Mods bring the mods they require (when the caller says which version this was).
      let deps = null;
      const instance = store.get('instances').find((i) => i.id === instanceId);
      if (versionId && kind === 'mod' && instance) {
        try {
          const res = await fetch(`https://api.modrinth.com/v2/version/${encodeURIComponent(versionId)}`, { headers: { 'User-Agent': 'ZoryaLauncher/0.1' } });
          if (res.ok) deps = await dependencies.installForModrinth({ instanceId, instance, version: await res.json() });
        } catch (err) {
          deps = { installed: [], failed: [{ title: 'зависимости', error: err.message }] };
        }
      }
      return { ok: true, deps };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // --- curseforge ---
  // "Check key" (Settings): the key from the field (not yet saved, or saved) is tested with one harmless request.
  ipcMain.handle('curseforge:checkKey', async (e, key) => {
    try { return { ok: true, ...(await curseforge.checkKey(typeof key === 'string' ? key : store.get('settings').curseforgeApiKey)) }; } catch (err) { return { ok: false, kind: 'other', message: err.message }; }
  });

  ipcMain.handle('curseforge:search', async (e, params) => {
    const apiKey = store.get('settings').curseforgeApiKey;
    if (!apiKey) return { ok: true, hits: [], totalCount: 0, note: 'CurseForge needs a free API key from console.curseforge.com' };
    try {
      const { hits, totalCount } = await curseforge.search({ ...params, apiKey });
      return { ok: true, hits, totalCount };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('curseforge:getCategories', async (e, projectType) => {
    const apiKey = store.get('settings').curseforgeApiKey;
    if (!apiKey) return { ok: true, categories: [] };
    try {
      return { ok: true, categories: await curseforge.getCategories(apiKey, projectType) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('curseforge:getMod', async (e, modId) => {
    const apiKey = store.get('settings').curseforgeApiKey;
    try {
      return { ok: true, mod: await curseforge.getMod(apiKey, modId) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('curseforge:getModDetails', async (e, modId) => {
    const apiKey = store.get('settings').curseforgeApiKey;
    try {
      return { ok: true, mod: await curseforge.getModDetails(apiKey, modId) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('curseforge:getDescription', async (e, modId) => {
    const apiKey = store.get('settings').curseforgeApiKey;
    try {
      return { ok: true, html: await curseforge.getModDescription(apiKey, modId) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('curseforge:getChangelog', async (e, { modId, fileId }) => {
    const apiKey = store.get('settings').curseforgeApiKey;
    try {
      return { ok: true, html: await curseforge.getFileChangelog(apiKey, modId, fileId) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Machine translation of project descriptions / changelogs (see mc/translate.js).
  ipcMain.handle('translate:texts', async (e, payload) => {
    try {
      const texts = Array.isArray(payload?.texts) ? payload.texts.map(String) : [];
      const protect = Array.isArray(payload?.protect) ? payload.protect.map(String).slice(0, 20) : [];
      return { ok: true, texts: await translator.translateTexts(texts, 'ru', protect) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('curseforge:getModFiles', async (e, { modId, gameVersion, modLoaderType }) => {
    const apiKey = store.get('settings').curseforgeApiKey;
    try {
      return { ok: true, files: await curseforge.getModFiles(apiKey, modId, { gameVersion, modLoaderType }) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('curseforge:installMod', async (e, { instanceId, modId, fileId, kind }) => {
    const apiKey = store.get('settings').curseforgeApiKey;
    try {
      const { dest, file, mod } = await curseforge.installModFile({
        apiKey, instanceId, modId, fileId, kind,
      });
      content.recordResolved(instanceId, path.basename(dest), {
        platform: 'curseforge',
        projectId: String(modId),
        versionId: String(file.id),
        versionNumber: file.displayName || file.fileName,
        title: mod ? mod.title : (file.displayName || file.fileName),
        icon: mod ? mod.icon_url : null,
        author: mod ? mod.author : null,
      });
      let deps = null;
      const instance = store.get('instances').find((i) => i.id === instanceId);
      if (kind === 'mod' && instance) {
        try {
          deps = await dependencies.installForCurseforge({ apiKey, instanceId, instance, modId, file });
        } catch (err) {
          deps = { installed: [], failed: [{ title: 'зависимости', error: err.message }] };
        }
      }
      return { ok: true, deps };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('curseforge:installModpack', (e, { project, file, installId }) => {
    const apiKey = store.get('settings').curseforgeApiKey;
    return runModpackInstall(installId, (control) => curseforge.installModpack({
      apiKey,
      project,
      file,
      control,
      onProgress: (p) => send('curseforge:installProgress', { projectId: project.project_id || project.id, installId, ...p }),
    }));
  });

  // Import a modpack file already on disk — auto-detects .mrpack
  // (Modrinth) vs a CurseForge-style manifest.json zip, so one "Import"
  // button covers both without asking the user which kind it is.
  // --- technic (technicpack.net modpacks) ---
  const technicReply = (fn) => async (e, args) => {
    try { return { ok: true, ...(await fn(args)) }; } catch (err) { return { ok: false, error: err.message }; }
  };
  ipcMain.handle('technic:search', technicReply(async ({ query }) => ({ hits: await technic.search(query) })));
  ipcMain.handle('technic:getModpack', technicReply(async ({ slug }) => ({ pack: await technic.getModpack(slug, { images: true }) })));
  ipcMain.handle('technic:getBuilds', technicReply(async ({ slug }) => technic.getBuilds(slug)));
  ipcMain.handle('technic:getBuild', technicReply(async ({ slug, build }) => ({ build: await technic.getBuild(slug, build) })));
  ipcMain.handle('technic:installModpack', (e, { project, version, installId }) => runModpackInstall(installId, (control) => technic.installModpack({
    project,
    version,
    control,
    onProgress: (p) => send('technic:installProgress', { projectId: project.project_id, installId, ...p }),
  })));

  // Step 1: just the file picker. The import itself (step 2) is a background
  // install with a progress card, pause and cancel — like a Modrinth download.
  ipcMain.handle('instances:pickPack', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Import сборку',
      filters: [{ name: 'Instances Minecraft', extensions: ['mrpack', 'zip'] }],
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
    const filePath = result.filePaths[0];
    return { ok: true, filePath, title: path.basename(filePath, path.extname(filePath)) };
  });

  ipcMain.handle('instances:importPackFile', (e, { filePath, installId }) => runModpackInstall(installId, async (control) => {
    let zip;
    try {
      // Async read: `new AdmZip(path)` reads the whole archive synchronously.
      zip = new AdmZip(await fs.promises.readFile(filePath));
    } catch (err) {
      throw new Error(`Failed открыть файл: ${err.message}`);
    }
    const isMrpack = !!zip.getEntry('modrinth.index.json');
    const isCurseZip = !isMrpack && !!zip.getEntry('manifest.json');
    if (!isMrpack && !isCurseZip) {
      throw new Error('Формат файла не распознан. Поддерживаются .mrpack (Modrinth) и .zip-сборки CurseForge (с manifest.json).');
    }
    const onProgress = (p) => send('instances:importProgress', { installId, ...p });
    if (isMrpack) return modrinth.importLocalMrpack(filePath, onProgress, control, zip);
    const apiKey = store.get('settings').curseforgeApiKey;
    return curseforge.installModpackFromLocalZip({
      apiKey, filePath, onProgress, control, zip,
    });
  }));

  // --- instance content (mods / shaderpacks) ---
  ipcMain.handle('content:list', async (e, instanceId) => {
    try {
      return { ok: true, items: await content.listContent(instanceId) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('content:toggle', async (e, { instanceId, filename, kind }) => {
    try {
      const newFilename = await content.toggleContent(instanceId, filename, kind);
      return { ok: true, filename: newFilename };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('content:delete', (e, { instanceId, filename, kind }) => {
    try {
      content.deleteContent(instanceId, filename, kind);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('content:addFiles', async (e, { instanceId, kind }) => {
    try {
      const added = await content.addContentFiles(instanceId, kind, win);
      return { ok: true, added };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Files dropped directly onto the Content tab (see preload's File.path —
  // Electron exposes the real filesystem path for OS-dragged files).
  ipcMain.handle('content:addFilePaths', (e, { instanceId, kind, filePaths }) => {
    try {
      return { ok: true, ...content.addContentFilePaths(instanceId, filePaths, kind) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('content:checkUpdate', async (e, { instanceId, item, mcVersion, loader }) => {
    try {
      return { ok: true, update: await content.checkContentUpdate(instanceId, item, mcVersion, loader) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Panel of a crashed game: the mods named by the analysis → what is installed / what Modrinth offers, and applying one fix.
  ipcMain.handle('crash:resolveMods', async (e, { instanceId, needs } = {}) => {
    try {
      const instance = store.get('instances').find((i) => i.id === instanceId);
      if (!instance || instance.loader === 'horizon') return { ok: false, error: 'Instance не найдена' };
      return { ok: true, rows: await modfix.resolveNeeds(instance, needs) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('crash:applyModFix', async (e, { instanceId, action, versionId, filename } = {}) => {
    try {
      const instance = store.get('instances').find((i) => i.id === instanceId);
      if (!instance || instance.loader === 'horizon') return { ok: false, error: 'Instance не найдена' };
      if (action !== 'install' && action !== 'update') return { ok: false, error: 'Неизвестное действие' };
      return { ok: true, ...(await modfix.applyFix(instance, { action, versionId, filename })) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('content:applyUpdate', async (e, { instanceId, item, update }) => {
    try {
      const filename = await content.applyContentUpdate(instanceId, item, update);
      return { ok: true, filename };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // --- in-app file manager (scoped to an instance's .minecraft folder) ---
  // --- file manager (per-instance folder) ---
  // Every handler answers { ok, ... } and never throws; all disk work is async.
  const fileHandler = (channel, fn) => ipcMain.handle(channel, async (e, args) => {
    try {
      return { ok: true, ...(await fn(args || {})) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  fileHandler('files:list', async ({ instanceId, relPath }) => ({ entries: await files.listDir(instanceId, relPath) }));
  fileHandler('files:search', ({ instanceId, relPath, query }) => files.searchEntries(instanceId, relPath, query));
  fileHandler('files:delete', async ({ instanceId, relPath }) => { await files.deleteEntry(instanceId, relPath); return {}; });
  fileHandler('files:rename', async ({ instanceId, relPath, newName }) => { await files.renameEntry(instanceId, relPath, newName); return {}; });
  fileHandler('files:mkdir', async ({ instanceId, relPath, name }) => { await files.createFolder(instanceId, relPath, name); return {}; });
  fileHandler('files:createFile', async ({ instanceId, relPath, name }) => { await files.createFile(instanceId, relPath, name); return {}; });
  fileHandler('files:readText', ({ instanceId, relPath }) => files.readText(instanceId, relPath));
  fileHandler('files:writeText', ({ instanceId, relPath, content, bom, eol, backup }) => files.writeText(instanceId, relPath, {
    content, bom, eol, backup,
  }));
  fileHandler('files:open', async ({ instanceId, relPath }) => { await files.openEntry(instanceId, relPath); return {}; });
  fileHandler('files:reveal', async ({ instanceId, relPath }) => { files.revealEntry(instanceId, relPath); return {}; });
  fileHandler('files:addFiles', async ({ instanceId, relPath }) => ({ added: await files.addFiles(instanceId, relPath, win) }));
  fileHandler('files:copyIn', async ({ instanceId, relPath, filePaths }) => ({ added: await files.copyIn(instanceId, relPath, filePaths) }));

  // --- skin library ---
  ipcMain.handle('skins:list', () => skins.listSkins());

  ipcMain.handle('skins:add', async (e, { variant } = {}) => {
    if (skins.listSkins().length >= limits.MAX_SKINS) {
      return { ok: false, error: `В библиотеке уже ${limits.MAX_SKINS} скинов — это предел. Удалите ненужные, чтобы добавить новые.` };
    }
    const result = await dialog.showOpenDialog(win, {
      title: 'Выбрать скин',
      filters: [{ name: 'PNG', extensions: ['png'] }],
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
    try {
      const entry = skins.addSkin({ filePath: result.filePaths[0], variant });
      return { ok: true, skin: entry };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('skins:delete', (e, id) => {
    skins.deleteSkin(id);
    // Offline accounts that were wearing it fall back to the default skin.
    const accounts = store.get('accounts') || [];
    if (accounts.some((a) => a.offlineSkinId === id)) {
      store.set('accounts', accounts.map((a) => (a.offlineSkinId === id ? { ...a, offlineSkinId: null } : a)));
    }
    return true;
  });

  // Picks (or clears, with null) the skin the active offline account wears
  // in-game — takes effect at the next launch.
  // The skin also goes to our skin server (best effort) so that other Zorya players see it too; `publish` says how that went.
  // Zorya systems (skin server, capes, hearts): Microsoft accounts and the MAIN offline account (nick = the site nick) only.
  // Zorya Launcher: every account is a "main" account — no site nick required.
  const isZoryaAccount = () => true;
  async function publishOfflineSkin() {
    // Cosmetics are kept locally; no site/skin-server request (works offline).
    return { ok: true };
  }
  ipcMain.handle('skins:applyOffline', async (e, id) => {
    const account = getActiveAccount();
    if (!account || account.type !== 'offline') return { ok: false, error: 'Доступно только для оффлайн-аккаунта' };
    if (id && !skins.getSkinFile(id)) return { ok: false, error: 'Skin не найден в библиотеке' };
    if (!isZoryaAccount(account)) {
      // Not the main offline account: Zorya skins are off for it (a skin it still carries from before can be cleared, locally only).
      if (id) return { ok: false, error: mainAccount.NOT_MAIN_MESSAGE };
      return { ok: true, account: publicAccount(upsertAccount({ ...account, offlineSkinId: null })), publish: { ok: true } };
    }
    const updated = upsertAccount({ ...account, offlineSkinId: id || null });
    const publish = await publishOfflineSkin(updated, id || null);
    return { ok: true, account: publicAccount(updated), publish };
  });
  // Premium (the site subscription): its state, the nick colour palette and the chosen colour live on the site.
  // Only plain, checked fields reach the window.
  const HEX = /^#[0-9a-fA-F]{6}$/;
  const premiumView = (d) => ({
    username: typeof d.username === 'string' ? d.username.slice(0, 64) : null,
    nick: typeof d.nick === 'string' && /^[A-Za-z0-9_]{3,16}$/.test(d.nick) ? d.nick : null, // ник в игре (оффлайн-аккаунт) = логин на сайте
    active: !!(d.premium && d.premium.active),
    expiresAt: d.premium && d.premium.active && typeof d.premium.expiresAt === 'string' ? d.premium.expiresAt : null,
    nickColor: typeof d.nickColor === 'string' && /^[a-z0-9_-]{1,24}$/.test(d.nickColor) ? d.nickColor : null,
    colors: (Array.isArray(d.colors) ? d.colors : []).slice(0, 40).filter((c) => c && typeof c.id === 'string' && /^[a-z0-9_-]{1,24}$/.test(c.id)
      && Array.isArray(c.stops) && c.stops.length >= 1 && c.stops.length <= 4 && c.stops.every((h) => typeof h === 'string' && HEX.test(h)))
      .map((c) => ({ id: c.id, name: String(c.name || c.id).slice(0, 24), stops: c.stops })),
  });
  // Zorya Launcher: Premium is unlocked for everyone, kept locally.
  const PREMIUM_COLORS = [
    { id: 'aurora', name: 'Aurora', stops: ['#5EFCE8', '#B06CFF', '#FF7AC8'] },
    { id: 'mint', name: 'Mint', stops: ['#5CB76B', '#9DE7AB'] },
    { id: 'violet', name: 'Violet', stops: ['#8B7CF6', '#C4B5FD'] },
  ];
  ipcMain.handle('premium:status', async () => {
    const account = getActiveAccount();
    const nick = account && typeof account.name === 'string' && /^[A-Za-z0-9_]{3,16}$/.test(account.name) ? account.name : null;
    const saved = store.get('settings') || {};
    return {
      ok: true, signedIn: true, username: nick, nick, active: true, expiresAt: null,
      nickColor: saved.nickColor || null, colors: PREMIUM_COLORS,
    };
  });
  ipcMain.handle('premium:setNickColor', async (e, colorId) => {
    if (colorId !== null && !(typeof colorId === 'string' && /^[a-z0-9_-]{1,24}$/.test(colorId))) return { ok: false, error: 'Invalid colour' };
    store.set('settings', { ...(store.get('settings') || {}), nickColor: colorId });
    return { ok: true, nickColor: colorId };
  });

  // Our own capes (the site's list) and the one the active account wears. Works for offline AND Microsoft accounts: the
  // choice is kept on the site, so every Zorya player's game shows it.
  ipcMain.handle('skins:listCapes', async () => ({ ok: true, capes: [] }));
  // The account with a fresh Microsoft token (proving ownership of a licensed account to the site goes through Mojang, see skinServer.ensureVerified)
  async function accountForSite() {
    const account = getActiveAccount();
    if (!account || account.type !== 'microsoft') return account;
    try { return await getFreshActiveAccount(); } catch { return account; }
  }
  ipcMain.handle('skins:setCustomCape', async (e, capeId) => {
    const account = getActiveAccount();
    if (!account) return { ok: false, error: 'No active account' };
    if (capeId !== null && !/^[a-z0-9_-]{1,32}$/.test(String(capeId))) return { ok: false, error: 'Invalid cape' };
    const updated = upsertAccount({ ...account, customCapeId: capeId || null });
    return { ok: true, account: publicAccount(updated), publish: { ok: true } };
  });

  // Hearts around the player: kept on the site like the cape (premium), the pack is switched on at the next launch.
  ipcMain.handle('skins:setHearts', async (e, enabled) => {
    const account = getActiveAccount();
    if (!account) return { ok: false, error: 'No active account' };
    const updated = upsertAccount({ ...account, heartsEnabled: enabled === true });
    return { ok: true, account: publicAccount(updated), publish: { ok: true } };
  });

  // Tries again to put the worn skin on the server (after signing in to the site again, or the site was down).
  ipcMain.handle('skins:publishOffline', async () => {
    const account = getActiveAccount();
    if (!account || account.type !== 'offline') return { ok: false, error: 'Доступно только для оффлайн-аккаунта' };
    return { ok: true, publish: await publishOfflineSkin(account, account.offlineSkinId || null) };
  });

  ipcMain.handle('skins:setVariant', async (e, { id, variant }) => {
    try {
      const skin = skins.setVariant(id, variant);
      // An offline account wearing this skin gets the new arm model on the server too.
      for (const acc of (store.get('accounts') || []).filter((a) => a.type === 'offline' && a.offlineSkinId === id)) {
        // eslint-disable-next-line no-await-in-loop
        await publishOfflineSkin(acc, id);
      }
      return { ok: true, skin };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('skins:apply', async (e, id) => {
    try {
      const account = await getFreshActiveAccount();
      // Zorya Launcher: offline accounts equip skins locally (no Mojang call).
      if (account && account.type === 'offline') {
        if (id && !skins.getSkinFile(id)) return { ok: false, error: 'Skin not found in library' };
        const updated = upsertAccount({ ...account, offlineSkinId: id || null });
        return { ok: true, account: publicAccount(updated), publish: { ok: true } };
      }
      const profile = await skins.applySkin(id, account);
      const updatedAccount = upsertAccount({ ...account, ...auth.cosmeticsFromProfile(profile) });
      return { ok: true, account: publicAccount(updatedAccount) };
    } catch (err) {
      return { ok: false, error: err.message, rateLimited: !!err.rateLimited };
    }
  });

  ipcMain.handle('skins:setEquippedVariant', async (e, variant) => {
    try {
      const account = await getFreshActiveAccount();
      if (account && account.type === 'offline') {
        const updated = upsertAccount({ ...account, skinVariant: variant });
        return { ok: true, account: publicAccount(updated) };
      }
      const profile = await skins.applyVariantToCurrentSkin(account, variant);
      const updatedAccount = upsertAccount({ ...account, ...auth.cosmeticsFromProfile(profile) });
      return { ok: true, account: publicAccount(updatedAccount) };
    } catch (err) {
      return { ok: false, error: err.message, rateLimited: !!err.rateLimited };
    }
  });

  ipcMain.handle('skins:setCape', async (e, capeId) => {
    try {
      const account = await getFreshActiveAccount();
      const profile = await skins.setActiveCape(account, capeId);
      const updatedAccount = upsertAccount({ ...account, ...auth.cosmeticsFromProfile(profile) });
      return { ok: true, account: publicAccount(updatedAccount) };
    } catch (err) {
      return { ok: false, error: err.message, rateLimited: !!err.rateLimited };
    }
  });

  // --- screenshots gallery (aggregated across all instances) ---
  // The hidden window that makes thumbnails must not keep the app alive after the main window is closed.
  win.on('closed', () => screenshots.disposeWorker());
  ipcMain.handle('screenshots:list', async () => {
    try {
      const items = await screenshots.listAll();
      screenshots.pruneThumbs(items).catch(() => {}); // old thumbnails of deleted screenshots, in the background
      return { ok: true, items };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // The thumbnail as JPEG bytes (made once, then read from the disk cache); the page shows it through a blob URL.
  ipcMain.handle('screenshots:thumbnail', async (e, { instanceId, filename } = {}) => {
    try {
      return { ok: true, bytes: await screenshots.getThumbnailBytes(instanceId, filename) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('screenshots:full', async (e, { instanceId, filename }) => {
    try {
      return { ok: true, dataUrl: await screenshots.getFull(instanceId, filename) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('screenshots:save', async (e, { instanceId, filename }) => {
    try {
      return await screenshots.saveAs(instanceId, filename, win);
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('screenshots:saveMany', async (e, { items }) => {
    try {
      return await screenshots.saveMany(items, win);
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('screenshots:copy', async (e, { instanceId, filename }) => {
    try {
      await screenshots.copyToClipboard(instanceId, filename);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('screenshots:original', async (e, { instanceId, filename }) => {
    try {
      return { ok: true, dataUrl: await screenshots.getOriginal(instanceId, filename) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('screenshots:saveEdited', async (e, { instanceId, filename, bytes, mode }) => {
    try {
      return { ok: true, filename: await screenshots.saveEdited(instanceId, filename, bytes, mode) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('screenshots:copyBytes', async (e, { bytes }) => {
    try {
      await screenshots.copyBytesToClipboard(bytes);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('screenshots:delete', async (e, { instanceId, filename }) => {
    try {
      await screenshots.deleteShot(instanceId, filename);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // --- recently played worlds/servers, aggregated across all instances ---
  ipcMain.handle('recents:worlds', () => {
    try {
      return { ok: true, items: recents.listRecentWorlds() };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('recents:servers', async () => {
    try {
      return { ok: true, items: await recents.listRecentServers() };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('recents:dismiss', (e, { kind, instanceId, itemKey }) => {
    try {
      recents.dismissRecent(kind, instanceId, itemKey);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // --- this instance's own full server list (servers.dat) ---
  ipcMain.handle('instanceServers:list', async (e, instanceId) => {
    try {
      return { ok: true, items: await instanceServers.listInstanceServers(instanceId) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('instanceServers:add', (e, { instanceId, address, name }) => {
    const trimmed = (address || '').trim();
    if (!trimmed) return { ok: false, error: 'Введите адрес сервера' };
    try {
      instanceServers.addServer(instanceId, trimmed, (name || '').trim());
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('instanceServers:delete', (e, { instanceId, index }) => {
    try {
      instanceServers.deleteServer(instanceId, index);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('instanceServers:setPinned', (e, { instanceId, address, pinned }) => {
    try {
      instanceServers.setServerPinned(instanceId, address, !!pinned);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // --- schematics (Litematica / WorldEdit files), aggregated across instances ---
  ipcMain.handle('schematics:list', async () => {
    try {
      return { ok: true, items: await schematics.listAll() };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('schematics:preview', async (e, { instanceId, filename }) => {
    try {
      return { ok: true, preview: await schematics.getPreviewImage(instanceId, filename) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('schematics:voxels', async (e, { instanceId, filename }) => {
    try {
      return { ok: true, ...(await schematics.getVoxels(instanceId, filename)) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('schematics:materials', async (e, { instanceId, filename }) => {
    try {
      const data = await schematics.getMaterials(instanceId, filename);
      let names = {};
      const instance = store.get('instances').find((i) => i.id === instanceId);
      if (instance) {
        names = await langNames.getRussianNames(instance.mcVersion, data.items.map((i) => i.id));
      }
      return { ok: true, ...data, names };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('schematics:textures', async (e, { instanceId, blocks }) => {
    try {
      const instance = store.get('instances').find((i) => i.id === instanceId);
      if (!instance) return { ok: false, error: 'Instance not found' };
      const data = await blockTextures.getTexturesForBlocks(instance.mcVersion, blocks);
      return { ok: true, ...data };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('schematics:delete', async (e, { instanceId, filename }) => {
    try {
      await schematics.deleteSchematic(instanceId, filename);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('schematics:copyTo', (e, { instanceId, filename, targetInstanceId }) => {
    try {
      const destName = schematics.copyTo(instanceId, filename, targetInstanceId);
      return { ok: true, destName };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('schematics:saveAs', async (e, { instanceId, filename }) => {
    const result = await dialog.showSaveDialog(win, {
      title: 'Save схематику как',
      defaultPath: filename,
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    try {
      fs.copyFileSync(schematics.schematicPath(instanceId, filename), result.filePath);
      return { ok: true, filePath: result.filePath };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('schematics:import', async (e, { instanceId }) => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Add схематику',
      filters: [{ name: 'Schematics', extensions: ['litematic', 'schem', 'schematic'] }],
      properties: ['openFile', 'multiSelections'],
    });
    if (result.canceled) return { ok: true, added: [] };
    const destDir = schematics.schematicsDir(instanceId);
    fs.mkdirSync(destDir, { recursive: true });
    const added = [];
    for (const src of result.filePaths) {
      const dest = path.join(destDir, path.basename(src));
      fs.copyFileSync(src, dest);
      added.push(path.basename(dest));
    }
    return { ok: true, added };
  });

  // Links come from project pages and update feeds written by strangers: only
  // web/mail links go to the OS (never file:, smb:, ms-… or other protocol handlers).
  ipcMain.handle('shell:openExternal', (e, url) => {
    if (!isSafeExternalUrl(url)) return false;
    return shell.openExternal(String(url));
  });
};
