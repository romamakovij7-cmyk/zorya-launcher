import { useEffect, useState } from 'react';
import { LogOutIcon, UserIcon } from '../components/Icons.jsx';
import SkinFace from '../components/SkinFace.jsx';
import GcPicker from '../components/GcPicker.jsx';
import AccountFace from '../components/AccountFace.jsx';
import PremiumButton, { NickText } from '../components/PremiumButton.jsx';
import FoldersSettings from '../components/FoldersSettings.jsx';
import MasterOptionsSettings from '../components/MasterOptionsSettings.jsx';
import SharedServersSettings from '../components/SharedServersSettings.jsx';
import OfflineAddForm from '../components/OfflineAddForm.jsx';
import { MEM_STEP, MEM_FLOOR, memoryCap, formatMb } from '../utils/memory.js';

// Interface settings, grouped. `get` reads the on/off state from the settings
// object (some are stored inverted or default to on), `set` maps the switch
// back to the stored value.
// The monitoring overlay is switched off for now (the main process does not start it, see OVERLAY_ENABLED in ipc.js): its settings stay in the code, hidden.
const SHOW_OVERLAY_SETTINGS = false;

const flag = (key, defaultOn) => ({
  key,
  get: (s) => (defaultOn ? s[key] !== false : !!s[key]),
  set: (checked) => checked,
});

import AppearanceSettings from '../components/AppearanceSettings.jsx';
import { AUTHORS, SUPPORTERS } from '../utils/authors.js';
import { ORDER_RESET_EVENT } from '../utils/useOrder.js';
import { captureBinding, formatBinding, DEFAULT_KEYBINDINGS } from '../utils/keybind.js';

const STYLE_OPTIONS = [
  { id: 'classic', name: 'Classical.', desc: 'Dark wine style, like before.' },
  { id: 'liquid', name: 'Liquid glass', desc: 'Clear glass with glare, like in iOS.' },
];
const INTERFACE_GROUPS = [
  {
    title: 'Sections',
    items: [
      { ...flag('showRecent', true), label: 'Recent on the main', desc: 'Recent worlds and servers over the library.' },
      { ...flag('showBuilderTools', false), label: 'Builder tools', desc: 'Section "Schematics" in the side panel.' },
      { ...flag('showSearchPage', true), label: 'Search page', desc: 'Search instances and mods on Modrinth and CurseForge in the sidebar. The search for mods inside the instance remains.' },
      { ...flag('showStatsTab', true), label: 'Statistical tab', desc: 'Game time and schedule by day. Time is also written with a hidden tab.' },
    ],
  },
  {
    title: 'Instance cards',
    items: [
      { ...flag('showPlayButton', true), label: 'Play button', desc: 'It appears when pointing at the card.' },
      { ...flag('showInstanceStats', true), label: 'Game time.', desc: 'How many games and when was the last launch?' },
      { ...flag('showInstanceWeight', false), label: 'Weight of instance', desc: 'The size of the instance folder on the disk.' },
    ],
  },
  {
    title: 'Processing',
    items: [
      {
        key: 'reduceMotion',
        get: (s) => !s.reduceMotion,
        set: (checked) => !checked,
        label: 'Animations.',
        desc: 'Smooth appearances of windows, menus and buttons. Turn it off on a weak PC.',
      },
      {
        ...flag('wormProgress', false),
        label: 'Eternich instead of loading strips',
        desc: 'Eternych\'s worm crawls all the loading strips instead of the usual line. It only works with the animations included.',
      },
    ],
  },
];
export default function Settings({
  account, onAccountChange, onSettingsChange, updater,
}) {
  const [settings, setSettings] = useState(null);
  const [javaStatus, setJavaStatus] = useState(null);
  const [loginStatus, setLoginStatus] = useState(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState(null);
  const [showOffline, setShowOffline] = useState(false);
  const [cfKeyDraft, setCfKeyDraft] = useState('');
  const [cfCheck, setCfCheck] = useState(null); // { busy } | { ok, message }
  // A pasted key often brings invisible characters (newline, zero-width space, quotes): they make CurseForge answer 403 as for a wrong key.
  const cleanKey = (s) => String(s || '').replace(/[\s\u00A0\u200B-\u200D\uFEFF"'`]/g, '');
  async function checkCfKey() {
    const key = cleanKey(cfKeyDraft);
    setCfKeyDraft(key);
    updateSetting('curseforgeApiKey', key);
    setCfCheck({ busy: true });
    const res = await window.api.curseforge.checkKey(key);
    setCfCheck({ ok: !!res.ok && res.kind === 'ok', message: res.message || 'I couldn\'t check the key.' });
  }
  const [appVersion, setAppVersion] = useState('');
  const [license, setLicense] = useState(null);

  useEffect(() => {
    window.api.settings.get().then((s) => {
      setSettings(s);
      setCfKeyDraft(s.curseforgeApiKey || '');
      onSettingsChange?.(s);
    });
    window.api.app.getVersion().then(setAppVersion);
    window.api.license.status().then(setLicense).catch(() => {});
    return window.api.auth.onStatus(setLoginStatus);
  }, []);

  useEffect(() => {
    if (settings) window.api.java.check(settings.javaPath).then(setJavaStatus);
  }, [settings?.javaPath]);

  function resetOrder() {
    window.api.settings.set({ sidebarOrder: [], instanceTabOrder: [] });
    window.dispatchEvent(new Event(ORDER_RESET_EVENT));
  }

  function updateSetting(key, value) {
    const next = { ...settings, [key]: value };
    setSettings(next);
    onSettingsChange?.(next);
    window.api.settings.set({ [key]: value });
  }

  // Several settings at once (a theme with its accent, the appearance reset).
  function updateSettings(partial) {
    const next = { ...settings, ...partial };
    setSettings(next);
    onSettingsChange?.(next);
    window.api.settings.set(partial);
  }

  const [totalMem, setTotalMem] = useState(16384);
  const [memDraft, setMemDraft] = useState(null);
  useEffect(() => { window.api.system.totalMemoryMb().then(setTotalMem).catch(() => {}); }, []);
  const memCap = memoryCap(totalMem);

  function commitMemory() {
    if (memDraft == null) return;
    const max = memDraft;
    setMemDraft(null);
    const next = { ...settings, maxMemoryMb: max, minMemoryMb: Math.min(1024, max) };
    setSettings(next);
    onSettingsChange?.(next);
    window.api.settings.set({ maxMemoryMb: max, minMemoryMb: Math.min(1024, max) });
  }

  async function handleMicrosoftLogin() {
    setLoggingIn(true);
    setLoginError(null);
    const res = await window.api.auth.login();
    setLoggingIn(false);
    setLoginStatus(null);
    if (res.ok) onAccountChange(res.account);
    else setLoginError(res.error);
  }

  async function handleLogout() {
    // Removes the currently-active account. If other accounts are still
    // signed in, the backend switches to one of those instead of going
    // fully signed-out — re-fetch rather than assuming null.
    await window.api.auth.logout();
    const next = await window.api.auth.getAccount();
    onAccountChange(next);
  }

  if (!settings) return <div className="progress-label">Loading...</div>;

  return (
    <div>
      <div className="page-header">
        <h1>Settings</h1>
      </div>

      <div className="settings-layout">
      <div className="settings-section settings-main">
      <h2 className="section-heading" style={{ marginTop: 0 }}>Account.</h2>
      <p className="hint-text" style={{ marginTop: -8, marginBottom: 16 }}>
        You can add multiple accounts (both Microsoft and offline) and quickly switch between them – click on the avatar in the self.I’m at the top of the sidebar.
        Offline account5, the main one is also considered. Skins, cloaks, hearts and the color of the nickname Eternal work only on the main offline account - the volume from which the nickname from the site.
      </p>

      {account ? (
        <div className="account-card">
          <div className="account-card-avatar">
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <AccountFace account={account} size={58} iconSize={24} />
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <div className="account-card-name"><NickText name={account.name} /></div>
            <div className="account-card-type">
              {account.type === 'microsoft' ? 'Microsoft account' : account.isMain ? 'Offline account · main (nick from the site)' : 'Offline account · Eternal skins and cloaks do not work'}
            </div>
          </div>
          <PremiumButton />
          <button className="btn" onClick={handleLogout}><LogOutIcon width={16} height={16} /> Get out.</button>
        </div>
      ) : (
        <div>
          <button className="btn btn-primary" onClick={handleMicrosoftLogin} disabled={loggingIn}>
            {loggingIn ? (loginStatus || 'Entrance') : 'Log in via Microsoft'}
          </button>
          <button className="btn" style={{ marginLeft: 10 }} onClick={() => setShowOffline((v) => !v)}>
            Offline account
          </button>
          {showOffline && (
            <div style={{ marginTop: 14, maxWidth: 360 }}>
              <OfflineAddForm onAdded={(acc) => { onAccountChange(acc); setShowOffline(false); }} />
            </div>
          )}
          {loginError && <div className="error-text" style={{ marginTop: 10, whiteSpace: 'pre-wrap' }}>{loginError}</div>}
        </div>
      )}

      <h2 className="section-heading">Sites</h2>
      <div className="settings-row">
        <div>
          <div className="settings-row-label">CurseForge API Key</div>
          <div className="settings-row-desc">
            You need to find and install mods/instances with CurseForge. The free key.{' '}
            <a href="#" onClick={(e) => { e.preventDefault(); window.api.shell.openExternal('https://console.curseforge.com/'); }}>
              console.curseforge.com
            </a>.
          </div>
          <button className="btn" style={{ marginTop: 10 }} onClick={checkCfKey} disabled={cfCheck?.busy || !cleanKey(cfKeyDraft)}>
            {cfCheck?.busy ? 'Checking...' : 'Check the key'}
          </button>
        </div>
        <input
          value={cfKeyDraft}
          onChange={(e) => setCfKeyDraft(e.target.value)}
          onBlur={() => { const k = cleanKey(cfKeyDraft); setCfKeyDraft(k); updateSetting('curseforgeApiKey', k); }}
          placeholder="$2a$10…"
          type="password"
        />

      </div>

      {cfCheck && !cfCheck.busy && (
        <div className={cfCheck.ok ? 'hint-text' : 'error-text'} style={{ marginTop: -4, marginBottom: 12, whiteSpace: 'pre-wrap' }}>{cfCheck.message}</div>
      )}

      <h2 className="section-heading">Discord</h2>
      <div className="settings-row">
        <div>
          <div className="settings-row-label">Show activity in Discord</div>
          <div className="settings-row-desc">The Discord profile will show you what you are doing: “Looking at instances”, “Looking for fashion”, “Plays” (with the name of the instance) or “Discourse”.</div>
        </div>
        <input
          type="checkbox"
          className="switch"
          checked={settings.discordPresence !== false}
          onChange={(e) => updateSetting('discordPresence', e.target.checked)}
        />
      </div>

      <h2 className="section-heading">Productivity</h2>
      <div className="settings-row">
        <div>
          <div className="settings-row-label">Save resources in the background</div>
          <div className="settings-row-desc">When the launcher window is not in focus or folded (for example, there is a game), animations, 3D character and glass blur are turned off and do not load the graphics card. When you come back, everything turns on again.</div>
        </div>
        <input
          type="checkbox"
          className="switch"
          checked={settings.pauseInBackground !== false}
          onChange={(e) => updateSetting('pauseInBackground', e.target.checked)}
        />
      </div>

      <div className="settings-row">
        <div>
          <div className="settings-row-label">Frequency of animation</div>
          <div className="settings-row-desc">For a 3D character. 30 fps is twice as light for the processor and graphics card, but slightly less smoothly. \"Auto\" is like a monitor. Use only on weak PCs.</div>
        </div>
        <div className="gc-picker-row">
          {[[0, 'Automobile'], [60, '60'], [30, '30']].map(([fps, label]) => (
            <button key={fps} type="button" className={`shot-editor-tool ${(settings.animationFps || 0) === fps ? 'active' : ''}`} onClick={() => updateSetting('animationFps', fps)}>{label}</button>
          ))}
        </div>
      </div>

      {SHOW_OVERLAY_SETTINGS && (
      <>
      <div className="settings-row">
        <div>
          <div className="settings-row-label">monitoring overlay</div>
          <div className="settings-row-desc">In the game, on the selected key, a panel appears over the window: FPS, frame schedule, processor, graphics card, memory, entities, TPS. Works in Minecraft 26.1+ (requires Eternal Cosmetics agent) and Horizon (Rust). In window mode and “window without frames”. Change the key before the game starts.</div>
        </div>
        <input
          type="checkbox"
          className="switch"
          checked={settings.overlayEnabled !== false}
          onChange={(e) => updateSetting('overlayEnabled', e.target.checked)}
        />
      </div>
      {settings.overlayEnabled !== false && (
        <div className="settings-row">
          <div>
            <div className="settings-row-label">Overlay key</div>
            <div className="settings-row-desc">The tap shows and hides the panel.</div>
          </div>
          <div className="gc-picker-row" style={{ flexWrap: 'wrap', maxWidth: 360 }}>
            {[['f9', 'F9'], ['f8', 'F8'], ['insert', 'Insert'], ['home', 'Home'], ['end', 'End'], ['right_ctrl', 'Right Ctrl'], ['right_shift', 'Right Shift'], ['right_alt', 'Right Alt']].map(([id, label]) => (
              <button key={id} type="button" className={`shot-editor-tool ${(settings.overlayKey || 'f9') === id ? 'active' : ''}`} onClick={() => updateSetting('overlayKey', id)}>{label}</button>
            ))}
          </div>
        </div>
      )}
      {settings.overlayEnabled !== false && (
        <>
          <div className="settings-row">
            <div>
              <div className="settings-row-label">Overlay view</div>
              <div className="settings-row-desc">Full: FPS, graphics, processor, graphics card, memory, world. Compact: FPS only and schedule.</div>
            </div>
            <div className="gc-picker-row">
              {[['full', 'Complete.'], ['compact', 'Compact']].map(([id, label]) => (
                <button key={id} type="button" className={`shot-editor-tool ${(settings.overlayMode || 'full') === id ? 'active' : ''}`} onClick={() => updateSetting('overlayMode', id)}>{label}</button>
              ))}
            </div>
          </div>
          <div className="settings-row">
            <div>
              <div className="settings-row-label">Size and position</div>
              <div className="settings-row-desc">It is used when the panel is shown again.</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
              <div className="gc-picker-row">
                {[['small', 'shallow'], ['normal', 'Normal.'], ['large', 'Big one.']].map(([id, label]) => (
                  <button key={id} type="button" className={`shot-editor-tool ${(settings.overlayScale || 'normal') === id ? 'active' : ''}`} onClick={() => updateSetting('overlayScale', id)}>{label}</button>
                ))}
              </div>
              <div className="gc-picker-row" style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {[['tl', 'Top left.'], ['tr', 'Top right.'], ['bl', 'Lower left.'], ['br', 'Down below right']].map(([id, label]) => (
                  <button key={id} type="button" className={`shot-editor-tool ${(settings.overlayCorner || 'tl') === id ? 'active' : ''}`} onClick={() => updateSetting('overlayCorner', id)}>{label}</button>
                ))}
              </div>
            </div>
          </div>
          <div className="settings-row">
            <div>
              <div className="settings-row-label">Transparency of panel</div>
              <div className="settings-row-desc">{settings.overlayOpacity ?? 82}%: The less, the better you can see the game under the panel.</div>
            </div>
            <input
              type="range" className="mem-range" style={{ width: 200 }}
              min={40} max={100} step={5}
              value={settings.overlayOpacity ?? 82}
              onChange={(e) => updateSetting('overlayOpacity', Number(e.target.value))}
            />
          </div>
        </>
      )}
      </>
      )}

      <h2 className="section-heading">Cosmetics</h2>
      <div className="settings-row">
        <div>
          <div className="settings-row-label">Our makeup.</div>
          <div className="settings-row-desc">Eternal players’ cloaks, skins, nicks and hearts: you see them and they see yours.</div>
        </div>
        <input
          type="checkbox"
          className="switch"
          checked={settings.eternalCosmetics !== false}
          onChange={(e) => updateSetting('eternalCosmetics', e.target.checked)}
        />
      </div>
      <MasterOptionsSettings />
      <SharedServersSettings />
      <FoldersSettings />

      <h2 className="section-heading">Java</h2>
      <div className="settings-row">
        <div>
          <div className="settings-row-label">The Way to Java</div>
          <div className="settings-row-desc">
            {javaStatus?.ok ? `Found Java ${javaStatus.version}` : 'Java not found - leave empty to use PATH, or point the path to javaw.exe'}
          </div>
        </div>
        <input
          value={settings.javaPath}
          onChange={(e) => updateSetting('javaPath', e.target.value)}
          placeholder="java"
        />
      </div>

      <div className="settings-row">
        <div>
          <div className="settings-row-label">Default RAM</div>
          <div className="settings-row-desc">
            Each assembly receives so much memory, from there there is no meaning. For a piece assembly, you can set your own in its settings.
            All on the device: {formatMb(totalMem)}.
          </div>
        </div>
        <div style={{ width: 260 }}>
          <div className="memory-slider-head"><span /> <strong>{formatMb(memDraft ?? settings.maxMemoryMb)}</strong></div>
          <input
            type="range" className="mem-range"
            min={MEM_FLOOR} max={memCap} step={MEM_STEP}
            value={Math.min(memDraft ?? settings.maxMemoryMb, memCap)}
            onChange={(e) => setMemDraft(Number(e.target.value))}
            onMouseUp={commitMemory} onTouchEnd={commitMemory} onKeyUp={commitMemory}
          />
        </div>
      </div>

      <div className="settings-row">
        <div>
          <div className="settings-row-label">Garbage collector</div>
          <div className="settings-row-desc">For all instances. G1GC - standard, ZGC - almost without pauses on large instances (you need Java 15+, on old Java it will turn off itself). In the instance settings, you can choose your own.</div>
        </div>
        <GcPicker args={settings.javaArgs} onChange={(v) => updateSetting('javaArgs', v)} compact />
      </div>

      <div className="settings-row">
        <div>
          <div className="settings-row-label">JVM's additional arguments</div>
          <div className="settings-row-desc">Applies to all instances.</div>
        </div>
        <input
          value={settings.javaArgs}
          onChange={(e) => updateSetting('javaArgs', e.target.value)}
          placeholder="-XX:+UseG1GC"
        />
      </div>

      <h2 className="section-heading">The launcher.</h2>
      <div className="settings-row">
        <div>
          <div className="settings-row-label">Version.</div>
          <div className="settings-row-desc">Current version: {appVersion || '…'}</div>
        </div>
      </div>
      {license?.valid && !license.dev && (
        <div className="settings-row">
          <div>
            <div className="settings-row-label">Account.</div>
            <div className="settings-row-desc">Your Eternal account.</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <strong>{license.username}</strong>
            <button
              className="btn"
              onClick={() => { if (window.confirm('Get off the site? The launcher will close before the new entrance.')) window.api.license.logout(); }}
            >
              Sign out
            </button>
          </div>
        </div>
      )}
      <div className="settings-row-block">
        {['available', 'downloading', 'ready', 'installing'].includes(updater.status) ? (
          <p style={{ color: 'var(--success)', fontSize: 13 }}>
            Available version {updater.info?.latest} (you have {updater.info?.current})). The buttons are in the card on the bottom right.
          </p>
        ) : (
          <button className="btn" onClick={updater.check} disabled={updater.status === 'checking'}>
            {updater.status === 'checking' ? 'Checking…' : 'Check for updates'}
          </button>
        )}
        {updater.status === 'uptodate' && (
          <p style={{ color: 'var(--text-dim)', fontSize: 13, marginTop: 10 }}>You have the latest version.{updater.info?.current}).</p>
        )}
        {updater.status === 'off' && (
          <p style={{ color: 'var(--text-dim)', fontSize: 13, marginTop: 10 }}>The address of the update server in this instance is not specified.</p>
        )}
        {updater.status === 'error' && !updater.info?.hasUpdate && (
          <p className="error-text" style={{ marginTop: 10 }}>Could not verify the updates: {updater.error}</p>
        )}
      </div>
      </div>

      <div className="settings-side">
        <h2 className="section-heading" style={{ marginTop: 0 }}>Interface.</h2>
        <div className="ui-columns">
        <div className="ui-group">
          <div className="ui-group-title">Interface language</div>
          <div className="style-picker">
            {[{ id: 'en', name: 'English' }, { id: 'uk', name: 'Українська' }].map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={`style-card ${(settings.language || 'en') === opt.id ? 'active' : ''}`}
                onClick={() => updateSetting('language', opt.id)}
              >
                <div className="style-card-name">{opt.name}</div>
              </button>
            ))}
          </div>
        </div>
        <div className="ui-group">
          <div className="ui-group-title">Design style</div>
          <div className="style-picker">
            {STYLE_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={`style-card ${(settings.interfaceStyle || 'classic') === opt.id ? 'active' : ''}`}
                onClick={() => updateSetting('interfaceStyle', opt.id)}
              >
                <div className={`style-card-preview ${opt.id}`}>
                  <span className="style-card-preview-bar" />
                  <span className="style-card-preview-chip" />
                </div>
                <div className="style-card-name">{opt.name}</div>
                <div className="style-card-desc">{opt.desc}</div>
              </button>
            ))}
          </div>
        </div>
        <AppearanceSettings settings={settings} updateSetting={updateSetting} updateSettings={updateSettings} />
        {INTERFACE_GROUPS.map((group) => (
          <div className="ui-group" key={group.title}>
            <div className="ui-group-title">{group.title}</div>
            <div className="ui-toggle-grid">
              {group.items.map((item) => {
                const on = item.get(settings);
                return (
                  <label className="ui-toggle" key={item.key}>
                    <div className="ui-toggle-text">
                      <div className="ui-toggle-label">{item.label}</div>
                      <div className="ui-toggle-desc">{item.desc}</div>
                    </div>
                    <input
                      type="checkbox"
                      className="switch small"
                      checked={on}
                      onChange={(e) => updateSetting(item.key, item.set(e.target.checked))}
                    />
                  </label>
                );
              })}
            </div>
          </div>
        ))}
        <div className="ui-group">
          <div className="ui-group-title">Order of tabs</div>
          <div className="ui-toggle-desc" style={{ marginBottom: 10 }}>
            Drag icons in the sidebar and tabs inside the instance (Content, Files, Worlds...) to swap them.
          </div>
          <button className="btn" onClick={resetOrder}>Reset the order</button>
        </div>
        <div className="ui-group">
          <div className="ui-group-title">Hot keys.</div>
          <div className="ui-toggle" style={{ cursor: 'default' }}>
            <div className="ui-toggle-text">
              <div className="ui-toggle-label">Command palette</div>
              <div className="ui-toggle-desc">Quick transition to partition or instance.</div>
            </div>
            <KeybindRecorder
              value={settings.keybindings?.commandPalette || DEFAULT_KEYBINDINGS.commandPalette}
              onChange={(b) => updateSetting('keybindings', { ...settings.keybindings, commandPalette: b })}
              onReset={() => updateSetting('keybindings', { ...settings.keybindings, commandPalette: DEFAULT_KEYBINDINGS.commandPalette })}
            />
          </div>
        </div>
        </div>
      </div>
      </div>

      <div className="authors">
        <div className="authors-title">Authors:</div>
        <div className="authors-row">
          {AUTHORS.map((a) => (
            <div className="author" key={a.name} data-name={a.name}>
              <SkinFace src={a.skin} size={56} className="author-head" />
            </div>
          ))}
        </div>
        {SUPPORTERS.length > 0 && (
          <>
            <div className="authors-sub">Support the launcher.</div>
            <div className="authors-row">
              {SUPPORTERS.map((p, i) => (
                <div className="author" key={`${p.name}:${i}`} data-name={p.name || undefined}>
                  <SkinFace src={p.skin} size={56} className="author-head" />
                </div>
              ))}
            </div>
          </>
        )}
        <details className="credits">
          <summary>Licenses and sources</summary>
          <div className="credits-body">
            <p>
              <strong>Horizon</strong> Minecraft on Rust, project{' '}
              <button type="button" className="credits-link" onClick={() => window.api.shell.openExternal('https://github.com/horizon-rust/horizon')}>horizon-rust/horizon</button>,
              licensed LGPL-3.0. The launcher does not include Horizon: it downloads official builds from GitHub and runs them separately program.
            </p>
            <p><strong>Mode catalogues</strong> Modrinth and CurseForge, through their public APIs</p>
            <p><strong>Minecraft</strong> Game files are downloaded from Mojang servers. The launcher is not an official Minecraft product, is not endorsed by Mojang or Microsoft, and is not associated with them.</p>
          </div>
        </details>
      </div>
    </div>
  );
}

// Click "Write down", press the combo you want, done — Esc alone cancels
// without changing anything.
function KeybindRecorder({ value, onChange, onReset }) {
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    if (!recording) return undefined;
    function onKeyDown(e) {
      e.preventDefault();
      // Consume the whole keystroke here — otherwise, once this recorder's
      // own state update takes effect, the very same keydown can go on to
      // bubble into whatever listener the *new* binding now matches (e.g.
      // it would immediately toggle the command palette while recording a
      // binding for it), because React can re-render before the bubble
      // phase reaches window.
      e.stopPropagation();
      if (e.code === 'Escape') { setRecording(false); return; }
      const next = captureBinding(e);
      if (next) { onChange(next); setRecording(false); }
    }
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [recording, onChange]);

  return (
    <div className="keybind-recorder">
      <button type="button" className={`keybind-value ${recording ? 'recording' : ''}`} onClick={() => setRecording(true)}>
        {recording ? 'Press the keys...' : formatBinding(value)}
      </button>
      <button className="btn-text" onClick={() => { setRecording(false); onReset(); }}>Drop it.</button>
    </div>
  );
}
