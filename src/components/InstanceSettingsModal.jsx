import Select, { LOADER_OPTIONS } from './Select.jsx';
import { useEffect, useMemo, useState } from 'react';
import {
  InfoIcon, WrenchIcon, CloseIcon, BoxIcon, CopyIcon, TrashIcon, EditIcon, PlayIcon,
} from './Icons.jsx';
import { MEM_STEP, MEM_FLOOR, memoryCap, formatMb } from '../utils/memory.js';
import GcPicker from './GcPicker.jsx';

const TABS = [
  { id: 'general', label: 'Basic', icon: InfoIcon },
  { id: 'install', label: 'Installation', icon: WrenchIcon },
  { id: 'game', label: 'Game.', icon: PlayIcon }, // game settings of this build: the The shared servers (not for Horizon builds)
];

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function InstanceSettingsModal({ instance, onClose, onRenamed, onDeleted, onDuplicated, onInstallChanged }) {
  const [tab, setTab] = useState('general');

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-modal-header">
          <div className="settings-modal-crumb">
            <div className="settings-modal-icon">
              {instance.icon ? <img src={instance.icon} alt="" /> : <BoxIcon width={18} height={18} />}
            </div>
            <span>{instance.name}</span>
            <span className="settings-modal-sep">›</span>
            <strong>Settings</strong>
          </div>
          <button className="icon-btn" onClick={onClose}><CloseIcon /></button>
        </div>

        <div className="settings-modal-body">
          <div className="settings-modal-nav">
            {TABS.filter((t) => t.id !== 'game' || instance.loader !== 'horizon').map((t) => (
              <button key={t.id} className={`settings-modal-nav-item ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
                <t.icon width={16} height={16} /> {t.label}
              </button>
            ))}
          </div>
          <div className="settings-modal-content">
            {tab === 'general' && (
              <GeneralTab
                instance={instance}
                onClose={onClose}
                onRenamed={onRenamed}
                onDeleted={onDeleted}
                onDuplicated={onDuplicated}
              />
            )}
            {tab === 'install' && (
              <InstallTab instance={instance} onInstallChanged={onInstallChanged} />
            )}
            {tab === 'game' && instance.loader !== 'horizon' && <GameTab instance={instance} />}
          </div>
        </div>
      </div>
    </div>
  );
}

// A Rust (Horizon) build: which Horizon release it plays. "Last" = the launcher keeps the newest one (checks once a day when the game starts);
// a dated release stays exactly as it is, so a build that works can be kept while a newer one is broken (or the other way round).
function HorizonVersionPicker({ instance, onInstallChanged }) {
  const [releases, setReleases] = useState(null); // [{ tag, label, date }] | null while loading
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState(null);
  const current = instance.horizonVersion || '';

  const load = (force) => {
    setError(null);
    window.api.instances.horizonReleases(force).then((r) => {
      if (r.ok) setReleases(r.releases); else { setReleases([]); setError(r.error); }
    }).catch((e) => { setReleases([]); setError(e.message); });
  };
  useEffect(() => { load(false); }, []);

  async function pick(value) {
    setSaving(true); setNote(null);
    const res = await window.api.instances.setHorizonVersion(instance.id, value || null);
    setSaving(false);
    if (res.ok) {
      onInstallChanged(res.instance);
      setNote(value ? 'Version saved. The desired Horizon instance will download at the next launch.' : 'The instance will play the latest version of Horizon.');
    } else setError(res.error);
  }

  // A version that is no longer listed stays in the list, so the current choice is always visible
  const options = [{ value: '', label: 'The latest (updated itself)' }];
  const tags = new Set();
  for (const r of releases || []) { tags.add(r.tag); options.push({ value: r.tag, label: r.label }); }
  if (current && !tags.has(current)) options.push({ value: current, label: current.replace(/^nightly-/, '') });

  return (
    <div style={{ marginTop: 14 }}>
      <label className="settings-block-label">Horizon version</label>
      <Select value={current} onChange={pick} options={options} disabled={saving || releases === null} />
      <p className="settings-block-hint">
        «Last» — The launcher itself takes the new Horizon assembly (checks once a day at launch). Dated version can be fixed: it will not be updated.
        until you change your mind. This helps if a new build breaks the game or mod. Java and Mojang files launcher selects itself.
        If the build includes native modes and it is assembled, the assembled version is played, not the selected one.
      </p>
      {releases === null && <div className="progress-label">Download the version list...</div>}
      {note && <div className="hint-text">{note}</div>}
      {error && <div className="error-text">{error} <button className="btn" style={{ marginLeft: 8 }} onClick={() => load(true)}>Retry</button></div>}
    </div>
  );
}

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const roundStep = (v) => Math.round(v / MEM_STEP) * MEM_STEP;

// Aikar's well-known G1 garbage-collector flags for Minecraft (the "balanced"
// set for heaps up to ~12 GB, and the variant for bigger ones).
const G1_TUNED = '-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions '
  + '-XX:+DisableExplicitGC -XX:G1NewSizePercent=30 -XX:G1MaxNewSizePercent=40 -XX:G1HeapRegionSize=8M '
  + '-XX:G1ReservePercent=20 -XX:G1HeapWastePercent=5 -XX:G1MixedGCCountTarget=4 -XX:InitiatingHeapOccupancyPercent=15 '
  + '-XX:G1MixedGCLiveThresholdPercent=90 -XX:G1RSetUpdatingPauseTimePercent=5 -XX:SurvivorRatio=32 '
  + '-XX:+PerfDisableSharedMem -XX:MaxTenuringThreshold=1';
const G1_TUNED_BIG = G1_TUNED
  .replace('G1NewSizePercent=30', 'G1NewSizePercent=40')
  .replace('G1MaxNewSizePercent=40', 'G1MaxNewSizePercent=50')
  .replace('G1HeapRegionSize=8M', 'G1HeapRegionSize=16M')
  .replace('G1ReservePercent=20', 'G1ReservePercent=15')
  .replace('InitiatingHeapOccupancyPercent=15', 'InitiatingHeapOccupancyPercent=20');

// Launch presets: memory is picked from the machine's RAM (never more than
// 75% of it), plus a matching set of JVM flags.
const PRESETS = [
  {
    id: 'low',
    label: 'Weak PC',
    hint: 'A little memory and soft garbage collection – less stress on weak iron.',
    compute: (total) => ({
      max: clamp(roundStep(total * 0.2), 2048, 4096),
      min: 1024,
      args: '-XX:+UseG1GC -XX:MaxGCPauseMillis=100 -XX:+DisableExplicitGC',
    }),
  },
  {
    id: 'balance',
    label: 'General',
    hint: 'About a quarter of RAM (4–8 GB) and proven G1GC flags are a good option for most instances.',
    compute: (total) => {
      const max = clamp(roundStep(total * 0.25), 4096, 8192);
      return { max, min: roundStep(max / 2), args: G1_TUNED };
    },
  },
  {
    id: 'max',
    label: 'Maximum',
    hint: 'Up to half of RAM (6-16 GB): for large instances with shaders and many mods.',
    compute: (total) => {
      const max = clamp(roundStep(total * 0.5), 6144, 16384);
      return { max, min: roundStep(max / 2), args: G1_TUNED_BIG };
    },
  },
];

function presetValues(preset, totalMb) {
  const v = preset.compute(totalMb);
  const cap = Math.max(1024, roundStep(totalMb * 0.75));
  const max = Math.min(v.max, cap);
  return { max, min: Math.min(v.min, max), args: v.args };
}

// "Standard of game settings": remember this build's game settings, or give the remembered ones to this build (see electron/mc/masterOptions.js).
function GameOptionsBlock({ instance }) {
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null); // { ok, text }
  const [st, setSt] = useState(null); // { hasFile, state } | null while loading
  const loadStatus = () => { try { window.api.masterOptions.status(instance.id).then((r) => r?.ok && setSt(r)).catch(() => {}); } catch { /* shown without status */ } };
  useEffect(() => { loadStatus(); }, [instance.id]);
  async function run(kind) {
    setBusy(kind); setMsg(null);
    try {
      const r = kind === 'capture' ? await window.api.masterOptions.capture(instance.id) : await window.api.masterOptions.apply(instance.id);
      if (!r?.ok) setMsg({ ok: false, text: r?.error || 'It didn\'t work.' });
      else if (kind === 'capture') setMsg({ ok: true, text: `Remembered. ${r.count} This is now your standard of measurement. New instances will get it when they first start (if enabled in Settings → “Game settings”).` });
      else setMsg({ ok: true, text: r.note || (r.changed ? `Ready, modified parameters: ${r.changed}. The previous settings file is saved as options.txt.eternal-bak. Start the game to see the result.` : 'The settings of this instance already coincide with the standard.') });
    } catch (e) { setMsg({ ok: false, text: e.message }); } finally { setBusy(null); loadStatus(); }
  }
  const noFile = st && !st.hasFile;
  return (
    <div className="settings-row-block">
      <label className="settings-block-label">Game settings (standard)</label>
      {noFile && (
        <p className="error-text" style={{ marginTop: 0 }}>
          This instance has never been launched yet, so it doesn’t have a game settings file. First, start the instance, wait for the main menu of the game and exit the game. After that, buttons will be available.
        </p>
      )}
      {st && st.hasFile && st.state === 'pending' && (
        <p className="settings-block-hint" style={{ marginTop: 0 }}>
          The main part of the standard (language, sound, range) has already been applied. Keys, field of view and graphics will be added the next time you run, or click “Apply the benchmark“ now.
        </p>
      )}
      <div className="java-override-row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <button className="btn" onClick={() => run('capture')} disabled={!!busy || noFile} title={noFile ? 'Start the instance first and exit the game.' : undefined}>{busy === 'capture' ? 'I remember...' : 'Remember the game settings'}</button>
        <button className="btn" onClick={() => run('apply')} disabled={!!busy || noFile} title={noFile ? 'Start the instance first and exit the game.' : undefined}>{busy === 'apply' ? 'Applying...' : 'Apply the standard'}</button>
      </div>
      {msg && <p className={msg.ok ? 'settings-block-hint' : 'error-text'} style={{ marginTop: 8 }}>{msg.text}</p>}
      <div className="settings-block-hint" style={{ lineHeight: 1.6 }}>
        <strong>How to use:</strong>
        <ol style={{ margin: '6px 0 6px 18px', padding: 0 }}>
          <li>Start the instance, customize the game as you like (language, sound, keys, graphics) and exit the game.</li>
          <li>Click \"Remember the game settings\": they will become your benchmark.</li>
          <li>Run another ready-made instance once, exit the game and click on “Apply the standard” in it. The new instances will get the benchmark themselves.</li>
        </ol>
        We need to apply the standard. <strong>only after the first start of the instance</strong> and when the game is closed.
      </div>
    </div>
  );
}

// The shared server list: how many of the shared servers this build has, and the button that adds the missing ones (see electron/mc/sharedServers.js).
function SharedServersBlock({ instance }) {
  const [st, setSt] = useState(null); // { total, present, missing, unreadable }
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const load = () => { try { window.api.sharedServers.status(instance.id).then((r) => r?.ok && setSt(r)).catch(() => {}); } catch { /* shown without status */ } };
  useEffect(() => { load(); }, [instance.id]);
  async function apply() {
    setBusy(true); setMsg(null);
    try {
      const r = await window.api.sharedServers.applyTo(instance.id);
      if (!r?.ok) setMsg({ ok: false, text: r?.error || 'It didn\'t work.' });
      else setMsg({ ok: true, text: r.added ? `Added servers: ${r.added} (${(r.names || []).join(', ')}). They'll be on the game list.` : 'All shared servers are already in this instance.' });
    } catch (e) { setMsg({ ok: false, text: e.message }); } finally { setBusy(false); load(); }
  }
  const nothing = st && st.total === 0;
  return (
    <div className="settings-row-block">
      <label className="settings-block-label">Shared servers</label>
      {nothing && <p className="settings-block-hint" style={{ marginTop: 0 }}>The general list is empty. Add servers in Launcher Settings, Shared Servers section.</p>}
      {st && !nothing && (
        <p className="settings-block-hint" style={{ marginTop: 0 }}>
          In this instance {st.present} of {st.total} shared servers.{st.missing.length ? ` Missing: ${st.missing.join(', ')}.` : ''}
          {st.unreadable ? ' The instance server file is not readable, so we do not change it.' : ''}
        </p>
      )}
      <button className="btn" onClick={apply} disabled={busy || nothing || !st}>{busy ? 'Adding...' : 'Add shared servers'}</button>
      {msg && <p className={msg.ok ? 'settings-block-hint' : 'error-text'} style={{ marginTop: 8 }}>{msg.text}</p>}
      <p className="settings-block-hint">
        Before each build run, the missing shared servers are added themselves. They go to the end of your list in the game, your service.You don’t change.
        The server that you deleted in the game will not come back: it is returned by this button. The game should be closed. List Shared servers run in Launcher Settings → «Shared servers».
      </p>
    </div>
  );
}

// "Game.": everything that is about the game's own settings and servers for this build.
function GameTab({ instance }) {
  return (
    <div>
      <GameOptionsBlock instance={instance} />
      <SharedServersBlock instance={instance} />
    </div>
  );
}

function GeneralTab({ instance, onClose, onRenamed, onDeleted, onDuplicated }) {
  const [name, setName] = useState(instance.name);
  const [icon, setIcon] = useState(instance.icon);
  const [iconBusy, setIconBusy] = useState(false);
  const [iconError, setIconError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [minMem, setMinMem] = useState(instance.minMemoryMb || '');
  const [maxMem, setMaxMem] = useState(instance.maxMemoryMb || '');
  const [totalMem, setTotalMem] = useState(16384);

  const [globalMax, setGlobalMax] = useState(null);

  useEffect(() => {
    window.api.system.totalMemoryMb().then(setTotalMem).catch(() => {});
    window.api.settings.get().then((s) => setGlobalMax(s.maxMemoryMb)).catch(() => {});
  }, []);

  useEffect(() => {
    setName(instance.name);
    setIcon(instance.icon);
    setMinMem(instance.minMemoryMb || '');
    setMaxMem(instance.maxMemoryMb || '');
  }, [instance.id]);

  async function saveName() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === instance.name) return;
    const res = await window.api.instances.rename(instance.id, trimmed);
    if (res.ok) onRenamed(res.instance);
  }

  async function persistMemory(nextMin, nextMax) {
    const res = await window.api.instances.updateMemory(instance.id, {
      minMemoryMb: nextMin || null,
      maxMemoryMb: nextMax || null,
    });
    if (res.ok) onRenamed(res.instance);
  }

  const [javaPath, setJavaPath] = useState(instance.javaPath || '');
  const [javaArgs, setJavaArgs] = useState(instance.javaArgs || '');

  useEffect(() => {
    setJavaPath(instance.javaPath || '');
    setJavaArgs(instance.javaArgs || '');
  }, [instance.id]);

  async function persistJava() {
    if ((javaPath.trim() || '') === (instance.javaPath || '') && (javaArgs.trim() || '') === (instance.javaArgs || '')) return;
    const res = await window.api.instances.updateJava(instance.id, { javaPath, javaArgs });
    if (res.ok) onRenamed(res.instance);
  }

  // Выбор G1/ZGC сразу сохраняется (поле ниже показывает получившиеся аргументы)
  async function persistGc(nextArgs) {
    setJavaArgs(nextArgs);
    const res = await window.api.instances.updateJava(instance.id, { javaPath, javaArgs: nextArgs });
    if (res.ok) onRenamed(res.instance);
  }

  const [presetNote, setPresetNote] = useState(null);

  // Applies a launch preset: memory + JVM flags, both still editable afterwards.
  async function applyPreset(preset) {
    const v = presetValues(preset, totalMem);
    setMinMem(v.min);
    setMaxMem(v.max);
    setJavaArgs(v.args);
    const [memRes, javaRes] = await Promise.all([
      window.api.instances.updateMemory(instance.id, { minMemoryMb: v.min, maxMemoryMb: v.max }),
      window.api.instances.updateJava(instance.id, { javaPath, javaArgs: v.args }),
    ]);
    const fresh = javaRes.ok ? javaRes.instance : memRes.instance;
    if (fresh) onRenamed({ ...fresh, minMemoryMb: v.min, maxMemoryMb: v.max });
    setPresetNote(`«${preset.label}: ${formatMb(v.min)}–${formatMb(v.max)}The JVM arguments are listed below. You can fix it manually.`);
  }

  const activePreset = PRESETS.find((p) => {
    const v = presetValues(p, totalMem);
    return Number(minMem) === v.min && Number(maxMem) === v.max && javaArgs.trim() === v.args;
  });

  const overrideOn = minMem !== '' || maxMem !== '';
  const sliderMax = memoryCap(totalMem);
  const effectiveMax = Math.min(overrideOn ? Number(maxMem) || Math.min(4096, sliderMax) : Math.min(4096, sliderMax), sliderMax);

  // One slider, like Modrinth's launcher — it sets the ceiling (-Xmx); the
  // floor (-Xms) just tags along at MEM_FLOOR so it's never above the
  // ceiling, since Java refuses to start otherwise.
  function toggleOverride(on) {
    if (on) {
      const defMax = Math.min(4096, sliderMax);
      setMinMem(MEM_FLOOR);
      setMaxMem(defMax);
      persistMemory(MEM_FLOOR, defMax);
    } else {
      setMinMem('');
      setMaxMem('');
      persistMemory(null, null);
    }
  }

  function onMaxChange(e) {
    const v = Number(e.target.value);
    setMaxMem(v);
    setMinMem(MEM_FLOOR);
  }

  function onSliderRelease() {
    persistMemory(MEM_FLOOR, maxMem || Math.min(4096, sliderMax));
  }

  async function pickIcon() {
    setIconBusy(true); setIconError(null);
    let res;
    try { res = await window.api.instances.setIcon(instance.id); } finally { setIconBusy(false); }
    if (!res.ok && !res.canceled) setIconError(res.error || 'Couldn\'t put up the icon.');
    if (res.ok) { setIcon(res.instance.icon); onRenamed(res.instance); }
    else if (!res.canceled && res.error) alert(res.error);
  }

  async function handleDuplicate() {
    setBusy(true);
    const res = await window.api.instances.duplicate(instance.id);
    setBusy(false);
    if (res.ok) { onDuplicated(res.instance); onClose(); } else alert(res.error || 'Failed to copy the instance');
  }

  async function handleDelete() {
    if (!confirm(`Delete "${instance.name}? The files will be permanently deleted.`)) return;
    try {
      await window.api.instances.delete(instance.id);
    } catch (err) {
      alert(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
      return;
    }
    onDeleted(instance.id);
    onClose();
  }

  return (
    <div>
      <div className="settings-row-block">
        <label className="settings-block-label">Title</label>
        <div className="settings-name-row">
          <input value={name} onChange={(e) => setName(e.target.value)} onBlur={saveName} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
          <div>
            <label className="settings-block-label">Icon</label>
            <button className="settings-icon-picker" onClick={pickIcon} disabled={iconBusy} title="Change the icon: any PNG, JPG, GIF or WebP image will fit up to 25 MB, the launcher will reduce it.">
              {icon ? <img src={icon} alt="" /> : <BoxIcon width={28} height={28} />}
              <span className="settings-icon-picker-edit"><EditIcon width={13} height={13} /></span>
            </button>
          </div>
        </div>
        {iconBusy && <p className="settings-block-hint">Processing the image...</p>}
        {iconError && <p className="error-text" style={{ marginTop: 8 }}>{iconError}</p>}
        <p className="settings-block-hint">Instance icon: Any PNG, JPG, GIF or WebP image up to 25MB. The launcher will reduce it to a small square icon.</p>
      </div>

      {/* Horizon is a Rust game: no JVM, so memory and Java settings mean nothing for it. */}
      {instance.loader !== 'horizon' && (
      <div className="settings-row-block">
        <div className="field-label-row">
          <label className="settings-block-label" style={{ marginBottom: 0 }}>RAM</label>
          <label className="snapshot-toggle">
            instance
            <input type="checkbox" className="switch small" checked={overrideOn} onChange={(e) => toggleOverride(e.target.checked)} />
          </label>
        </div>

        <div className="preset-row">
          <span className="preset-row-label">Presets:</span>
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`shot-editor-tool ${activePreset?.id === p.id ? 'active' : ''}`}
              title={p.hint}
              onClick={() => applyPreset(p)}
            >
              {p.label}
            </button>
          ))}
        </div>
        {presetNote && <p className="settings-block-hint" style={{ marginTop: 0 }}>{presetNote}</p>}

        {overrideOn ? (
          <div className="memory-sliders">
            <div className="memory-slider-row">
              <div className="memory-slider-head"><span>RAM</span><strong>{formatMb(effectiveMax)}</strong></div>
              <input
                type="range" className="mem-range"
                min={MEM_FLOOR} max={sliderMax} step={MEM_STEP}
                value={effectiveMax}
                onChange={onMaxChange}
                onMouseUp={onSliderRelease} onTouchEnd={onSliderRelease} onKeyUp={onSliderRelease}
              />
            </div>
          </div>
        ) : (
          <p className="settings-block-hint">The default value is now used. {formatMb(globalMax)} (Changes in Launcher Settings).</p>
        )}
        <p className="settings-block-hint">All on the device: {formatMb(totalMem)}.</p>
      </div>
      )}

      {instance.loader !== 'horizon' && (
      <div className="settings-row-block">
        <label className="settings-block-label">Garbage collector</label>
        <GcPicker args={javaArgs} onChange={persistGc} />
        <input
          className="text-input"
          style={{ marginTop: 10 }}
          value={javaArgs}
          onChange={(e) => setJavaArgs(e.target.value)}
          onBlur={persistJava}
          placeholder="Additional JVM arguments for this instance only, such as -XX:+UseZGC"
        />
        <p className="settings-block-hint">Arguments are added to the common ones from the launcher settings. Select Java itself (its version) for instance on the Installation tab.</p>
      </div>
      )}

      <div className="settings-row-block">
        <label className="settings-block-label">Creating a copy of the instance</label>
        <button className="btn" onClick={handleDuplicate} disabled={busy}>
          <CopyIcon width={15} height={15} /> {busy ? 'Copying...' : 'Create a copy'}
        </button>
        <p className="settings-block-hint">Creates a copy of the instance, including worlds, settings, mods, etc.</p>
      </div>

      <div className="settings-row-block">
        <label className="settings-block-label" style={{ color: 'var(--danger)' }}>Instance removal</label>
        <button className="btn btn-danger" onClick={handleDelete}>
          <TrashIcon width={15} height={15} /> Remove instance
        </button>
        <p className="settings-block-hint">
          Permanently removes the build from the device, including worlds, settings and all installed content.
          Please note that after removal, the assembly cannot be restored.
        </p>
      </div>
    </div>
  );
}

// Which Java runs this build: "Automatically." (the launcher picks and downloads the one Mojang names for this version), one of the Javas
// installed on this computer, or a file of the person's own. The choice is stored as the build's own javaPath (empty = automatic).
const BROWSE = '__browse__';
const homeName = (p) => String(p || '').replace(/\\/g, '/').split('/').slice(-3, -2)[0] || '';
// "1.8.0_51" -> 8, "17.0.15" -> 17, "25" -> 25
const majorOfJava = (v) => {
  const m = /^(\d+)(?:\.(\d+))?/.exec(String(v || ''));
  if (!m) return null;
  const first = Number(m[1]);
  return first === 1 ? (Number(m[2]) || null) : first;
};

function JavaPicker({ instance, onChanged }) {
  const [data, setData] = useState(null); // { installed, required }
  const [globalPath, setGlobalPath] = useState('');
  const [customInfo, setCustomInfo] = useState(null); // { major, version } of a path that is not in the list
  const [note, setNote] = useState(null); // { ok, text }
  const [busy, setBusy] = useState(false);
  const current = instance.javaPath || '';

  useEffect(() => {
    let alive = true;
    window.api.java.list(instance.mcVersion).then((r) => { if (alive && r?.ok) setData(r); }).catch(() => {});
    window.api.settings.get().then((s) => { if (alive) setGlobalPath((s?.javaPath || '').trim()); }).catch(() => {});
    return () => { alive = false; };
  }, [instance.id, instance.mcVersion]);

  const listed = data ? data.installed.find((j) => j.path.toLowerCase() === current.toLowerCase()) : null;
  useEffect(() => {
    setCustomInfo(null);
    if (!current || !data || listed) return undefined;
    let alive = true;
    window.api.java.check(current).then((r) => { if (alive && r?.ok) setCustomInfo({ version: r.version }); }).catch(() => {});
    return () => { alive = false; };
  }, [current, data, listed]);

  const options = useMemo(() => {
    const out = [{ value: '', label: 'Automatic (recommended)', hint: data?.required ? `Java ${data.required}` : '' }];
    for (const j of (data?.installed || [])) out.push({ value: j.path, label: `Java ${j.version || '?'}${j.vendor ? ` · ${j.vendor}` : ''}`, hint: homeName(j.path) });
    if (current && !listed) out.push({ value: current, label: 'My file.', hint: homeName(current) });
    out.push({ value: BROWSE, label: 'Select the java file...' });
    return out;
  }, [data, current, listed]);

  async function save(value) {
    const res = await window.api.instances.updateJava(instance.id, { javaPath: value, javaArgs: instance.javaArgs || '' });
    if (res.ok) { onChanged(res.instance); setNote({ ok: true, text: value ? 'Save. This Java will be used in the next run.' : 'Save. The launcher will select the Java version of the game.' }); }
    else setNote({ ok: false, text: res.error || 'Failed to save.' });
  }
  async function pick(value) {
    setBusy(true); setNote(null);
    try {
      if (value === BROWSE) {
        const r = await window.api.java.browse();
        if (r?.ok) await save(r.path);
        else if (!r?.canceled) setNote({ ok: false, text: r?.error || 'I couldn\'t pick the file.' });
      } else await save(value);
    } finally { setBusy(false); }
  }

  const major = listed ? listed.major : majorOfJava(customInfo && customInfo.version);
  const req = data?.required || null;
  let warn = null;
  if (current && major && req && major < req) warn = { bad: true, text: `This Java.${major}) older than required for Minecraft ${instance.mcVersion} (Java ${req}). The game probably won't start.` };
  else if (current && major && req && req <= 8 && major > 8) warn = { bad: false, text: 'Older versions of Minecraft and their mods often don’t work on new Java. If the game does not start, return "Automatically".' };

  return (
    <div className="settings-row-block" style={{ marginTop: 28 }}>
      <label className="settings-block-label">Java for this instance</label>
      <Select value={current} onChange={pick} options={options} disabled={busy || !data} />
      {note && <p className={note.ok ? 'settings-block-hint' : 'error-text'} style={{ marginTop: 8 }}>{note.text}</p>}
      {warn && <p className={warn.bad ? 'error-text' : 'settings-block-hint'} style={{ marginTop: 8 }}>{warn.text}</p>}
      {!current && (
        <p className="settings-block-hint">
          {globalPath
            ? `Launcher Settings provides a common path to Java.${globalPath}): while here "Automatically", it will be used.`
            : `The launcher itself downloads and uses Java${req ? ` ${req}` :''} suitable for Minecraft ${instance.mcVersion}. This is the safest option.`}
        </p>
      )}
      {current && (
        <p className="settings-block-hint" style={{ wordBreak: 'break-all' }}>Used: {current}</p>
      )}
      <p className="settings-block-hint">You only need to change Java if the mod or instance so requires. The selected version is used at the next start of the game.</p>
    </div>
  );
}

function InstallTab({ instance, onInstallChanged }) {
  const [editing, setEditing] = useState(false);
  const [manifest, setManifest] = useState(null);
  const [mcVersion, setMcVersion] = useState(instance.mcVersion);
  const [loader, setLoader] = useState(instance.loader);
  const [loaderVersions, setLoaderVersions] = useState([]);
  const [loaderVersion, setLoaderVersion] = useState(instance.loaderVersion || '');
  const [savingInstall, setSavingInstall] = useState(false);

  const [repairing, setRepairing] = useState(false);
  const [repairProgress, setRepairProgress] = useState(null);
  const [repairError, setRepairError] = useState(null);
  const [repairDone, setRepairDone] = useState(false);

  useEffect(() => {
    if (!editing || manifest) return;
    window.api.mc.versionManifest().then(setManifest).catch(() => {});
  }, [editing]);

  const LOADER_FETCHERS = {
    fabric: window.api.mc.fabricLoaders,
    quilt: window.api.mc.quiltLoaders,
    forge: window.api.mc.forgeLoaders,
    neoforge: window.api.mc.neoforgeLoaders,
  };

  useEffect(() => {
    if (!editing || !mcVersion) return;
    const fetcher = LOADER_FETCHERS[loader];
    if (fetcher) {
      fetcher(mcVersion).then(setLoaderVersions).catch(() => setLoaderVersions([]));
    } else {
      setLoaderVersions([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, loader, mcVersion]);

  useEffect(() => {
    return window.api.instances.onRepairProgress((p) => {
      if (p.instanceId !== instance.id) return;
      if (p.stage === 'error') { setRepairError(p.error); setRepairing(false); }
      else if (p.stage === 'done') { setRepairing(false); setRepairDone(true); }
      else setRepairProgress(p);
    });
  }, [instance.id]);

  async function saveInstall() {
    setSavingInstall(true);
    const res = await window.api.instances.updateInstall(instance.id, {
      mcVersion, loader, loaderVersion: loader === 'vanilla' ? null : loaderVersion,
    });
    setSavingInstall(false);
    if (res.ok) { onInstallChanged(res.instance); setEditing(false); }
  }

  async function handleRepair() {
    setRepairing(true);
    setRepairError(null);
    setRepairDone(false);
    setRepairProgress(null);
    const res = await window.api.instances.repair(instance.id);
    if (!res.ok) { setRepairError(res.error); setRepairing(false); }
  }

  const versionList = useMemo(() => (manifest ? manifest.versions.filter((v) => v.type === 'release') : []), [manifest]);

  return (
    <div>
      <label className="settings-block-label">Installation information</label>
      <div className="install-info-table">
        <div className="install-info-row"><span>Platform</span><strong>{cap(instance.loader)}</strong></div>
        <div className="install-info-row"><span>Game version</span><strong>{instance.mcVersion}</strong></div>
        {instance.loader !== 'vanilla' && instance.loader !== 'horizon' && (
          <div className="install-info-row"><span>Version. {cap(instance.loader)}</span><strong>{instance.loaderVersion}</strong></div>
        )}
      </div>

      {instance.loader === 'horizon' ? (
        <HorizonVersionPicker instance={instance} onInstallChanged={onInstallChanged} />
      ) : !editing ? (
        <button className="btn" style={{ marginTop: 14 }} onClick={() => setEditing(true)}>
          <EditIcon width={15} height={15} /> Change
        </button>
      ) : (
        <div className="install-edit-form">
          <div className="field">
            <label>Loader</label>
            <Select value={loader} onChange={setLoader} options={LOADER_OPTIONS} />
          </div>
          <div className="field">
            <label>Minecraft version</label>
            <Select
              value={mcVersion}
              onChange={setMcVersion}
              disabled={!manifest}
              options={manifest ? versionList.map((v) => ({ value: v.id, label: v.id })) : [{ value: mcVersion, label: mcVersion }]}
            />
          </div>
          {loader !== 'vanilla' && (
            <div className="field">
              <label>Loader version</label>
              <Select
                value={loaderVersion}
                onChange={setLoaderVersion}
                disabled={loaderVersions.length === 0}
                placeholder="There are no available versions"
                options={loaderVersions.map((l) => ({ value: l.loaderVersion, label: l.loaderVersion }))}
              />
            </div>
          )}
          <div className="modal-actions" style={{ marginTop: 4 }}>
            <button className="btn" onClick={() => setEditing(false)}>Cancellation</button>
            <button className="btn btn-primary" onClick={saveInstall} disabled={savingInstall}>
              {savingInstall ? 'Conservation...' : 'Save.'}
            </button>
          </div>
        </div>
      )}
      {instance.loader !== 'horizon' && (
        <p className="settings-block-hint">
          It is not recommended to change the installation after adding content. This can lead to compatibility errors.
        </p>
      )}

      {instance.loader !== 'horizon' && <JavaPicker instance={instance} onChanged={onInstallChanged} />}

      <div className="settings-row-block" style={{ marginTop: 28 }}>
        <label className="settings-block-label">Instance correction</label>
        <button className="btn" onClick={handleRepair} disabled={repairing}>
          <WrenchIcon width={15} height={15} /> {repairing ? 'Checking…' : 'Fix'}
        </button>
        <p className="settings-block-hint">
          Resets Minecraft dependencies and restores corrupted files. Could fix the launch issues.
        </p>
        {repairing && repairProgress && (
          <div className="progress-label">{repairProgress.stage}{repairProgress.total ? ` (${repairProgress.completed}/${repairProgress.total})` : ''}</div>
        )}
        {repairError && <div className="error-text">{repairError}</div>}
        {repairDone && <div style={{ color: 'var(--success)', fontSize: 13 }}>Ready - instance files checked.</div>}
      </div>
    </div>
  );
}
