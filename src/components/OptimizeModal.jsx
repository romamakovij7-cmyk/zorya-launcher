import { useEffect, useMemo, useState } from 'react';
import { CloseIcon, CheckIcon, SearchIcon, WrenchIcon } from './Icons.jsx';
import { explainFailure, explainStatus } from '../utils/netError.js';

// Curated performance mods, per loader. `slugs` are Modrinth project slugs
// tried in order (the first one that has a build for this Minecraft version
// wins) — e.g. Sodium on newer NeoForge, Embeddium on older Forge.
const FABRIC_LIST = [
  { id: 'fabricapi', name: 'Fabric API', slugs: ['fabric-api'], desc: 'Required by Sodium, Lithium and most Fabric mods.', cat: 'core', icon: '⛓', on: true },
  { id: 'render', name: 'Sodium', slugs: ['sodium'], desc: 'The main acceleration of the graphics — noticeably raises the FPS.', cat: 'render', icon: '✦', on: true },
  { id: 'logic', name: 'Lithium', slugs: ['lithium'], desc: 'Optimization of game logic and world generation.', cat: 'logic', icon: '⚙', on: true },
  { id: 'memory', name: 'FerriteCore', slugs: ['ferrite-core'], desc: 'Greatly reduces RAM usage.', cat: 'memory', icon: '◈', on: true },
  { id: 'immediate', name: 'ImmediatelyFast', slugs: ['immediatelyfast'], desc: 'Faster interface, text and particles.', cat: 'ui', icon: '⚡', on: true },
  { id: 'culling', name: 'Entity Culling', slugs: ['entityculling'], desc: 'Does not draw creatures and block entities you cannot see.', cat: 'render', icon: '◉', on: true },
  { id: 'modernfix', name: 'ModernFix', slugs: ['modernfix'], desc: 'Faster launch, less memory, leak fixes.', cat: 'logic', icon: '✧', on: true },
  { id: 'extra', name: 'Sodium Extra', slugs: ['sodium-extra'], desc: 'Extra graphics settings for Sodium.', cat: 'extra', icon: '✺', on: false },
  { id: 'dynfps', name: 'Dynamic FPS', slugs: ['dynamic-fps'], desc: 'Lowers FPS when the game window is out of focus.', cat: 'extra', icon: '◐', on: false },
  { id: 'iris', name: 'Iris Shaders', slugs: ['iris'], desc: 'Shader support (shader packs are configured separately).', cat: 'extra', icon: '❈', on: false },
];

const FORGE_LIST = [
  { id: 'render', name: 'Embeddium', slugs: ['embeddium'], desc: 'Speeds up graphics (a Sodium fork for Forge).', cat: 'render', icon: '✦', on: true },
  { id: 'memory', name: 'FerriteCore', slugs: ['ferrite-core'], desc: 'Greatly reduces RAM usage.', cat: 'memory', icon: '◈', on: true },
  { id: 'immediate', name: 'ImmediatelyFast', slugs: ['immediatelyfast'], desc: 'Faster interface, text and particles.', cat: 'ui', icon: '⚡', on: true },
  { id: 'culling', name: 'Entity Culling', slugs: ['entityculling'], desc: 'Does not draw creatures you cannot see.', cat: 'render', icon: '◉', on: true },
  { id: 'modernfix', name: 'ModernFix', slugs: ['modernfix'], desc: 'Faster launch, less memory.', cat: 'logic', icon: '✧', on: true },
  { id: 'dynfps', name: 'Dynamic FPS', slugs: ['dynamic-fps'], desc: 'Lowers FPS when the game window is out of focus.', cat: 'extra', icon: '◐', on: false },
];

const NEOFORGE_LIST = FORGE_LIST.map((m) => (m.id === 'render'
  ? { ...m, name: 'Sodium / Embeddium', slugs: ['sodium', 'embeddium'], desc: 'Accelerates graphics — Sodium, or Embeddium on older versions.' }
  : m));

function listFor(loader) {
  if (loader === 'fabric' || loader === 'quilt') return FABRIC_LIST;
  if (loader === 'neoforge') return NEOFORGE_LIST;
  if (loader === 'forge') return FORGE_LIST;
  return [];
}

const CATEGORIES = [
  { id: 'core', label: 'Required', color: 'violet' },
  { id: 'render', label: 'Rendering', color: 'rose' },
  { id: 'logic', label: 'Logic & launch', color: 'mint' },
  { id: 'memory', label: 'Memory', color: 'blue' },
  { id: 'ui', label: 'Interface', color: 'amber' },
  { id: 'extra', label: 'Extras', color: 'pink' },
];

const PRESETS = [
  { id: 'balanced', label: 'Balanced', icon: '⚖', desc: 'Recommended set' },
  { id: 'fps', label: 'Max FPS', icon: '🚀', desc: 'Everything for speed' },
  { id: 'ram', label: 'Low RAM', icon: '◈', desc: 'Save memory' },
  { id: 'minimal', label: 'Minimal', icon: '◇', desc: 'Only the essentials' },
];

function presetSelection(preset, items) {
  if (preset === 'fps') return new Set(items.map((m) => m.id));
  if (preset === 'ram') return new Set(items.filter((m) => ['memory', 'logic', 'core'].includes(m.cat)).map((m) => m.id));
  if (preset === 'minimal') return new Set(items.filter((m) => ['core', 'render', 'logic'].includes(m.cat)).map((m) => m.id));
  return new Set(items.filter((m) => m.on).map((m) => m.id));
}

const API = 'https://api.modrinth.com/v2';

// Newest compatible file for a project on this instance's loader + version,
// preferring releases over betas/alphas.
async function findVersion(slug, mcVersion, loaders) {
  const params = new URLSearchParams({
    loaders: JSON.stringify(loaders),
    game_versions: JSON.stringify([mcVersion]),
  });
  let res;
  try {
    res = await fetch(`${API}/project/${encodeURIComponent(slug)}/version?${params}`);
  } catch {
    throw new Error(explainFailure('Modrinth unavailable', 'api.modrinth.com'));
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(explainStatus('Modrinth did not give the data.', res.status, 'api.modrinth.com'));
  const versions = await res.json();
  if (!versions.length) return null;
  const rank = { release: 0, beta: 1, alpha: 2 };
  versions.sort((a, b) => (rank[a.version_type] - rank[b.version_type])
    || (new Date(b.date_published) - new Date(a.date_published)));
  return versions[0];
}

function primaryFile(version) {
  const f = version.files.find((x) => x.primary) || version.files[0];
  return { url: f.url, filename: f.filename, sha1: f.hashes?.sha1, size: f.size };
}

const STATUS_LABEL = {
  wait: 'In line',
  search: 'Searching…',
  install: 'Installing…',
  done: 'Installed',
  have: 'Already installed',
  none: 'No version for this game',
  error: 'Error',
};

export default function OptimizeModal({ instance, onClose, onInstalled }) {
  const items = useMemo(() => listFor(instance.loader), [instance.loader]);
  const [selected, setSelected] = useState(() => new Set(items.filter((m) => m.on).map((m) => m.id)));
  const [preset, setPreset] = useState('balanced');
  const [status, setStatus] = useState({}); // id -> { state, text }
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape' && !running) onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [running, onClose]);

  function toggle(id) {
    setPreset(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function choosePreset(id) {
    setPreset(id);
    setSelected(presetSelection(id, items));
  }

  const setState = (id, state, text) => setStatus((prev) => ({ ...prev, [id]: { state, text } }));

  async function install() {
    setRunning(true);
    setFinished(false);
    const loaders = instance.loader === 'quilt' ? ['quilt', 'fabric'] : [instance.loader];

    // What is already in the instance, by Modrinth project id and by file name.
    const listRes = await window.api.content.list(instance.id);
    const installedProjects = new Set();
    const installedFiles = new Set();
    for (const it of listRes.ok ? listRes.items : []) {
      if (it.kind !== 'mod') continue;
      if (it.resolved?.projectId) installedProjects.add(it.resolved.projectId);
      installedFiles.add(it.filename.replace(/\.disabled$/, ''));
    }

    // Installs one version plus the mods it requires (one level deep).
    async function installVersion(version, depth = 0) {
      const file = primaryFile(version);
      if (installedProjects.has(version.project_id) || installedFiles.has(file.filename)) return false;
      const res = await window.api.modrinth.installMod(instance.id, file, 'mod');
      if (!res.ok) throw new Error(res.error || 'failed to download');
      installedProjects.add(version.project_id);
      installedFiles.add(file.filename);
      if (depth < 1) {
        for (const dep of version.dependencies || []) {
          if (dep.dependency_type !== 'required' || !dep.project_id || installedProjects.has(dep.project_id)) continue;
          // eslint-disable-next-line no-await-in-loop
          const depVersion = await findVersion(dep.project_id, instance.mcVersion, loaders);
          // eslint-disable-next-line no-await-in-loop
          if (depVersion) await installVersion(depVersion, depth + 1);
        }
      }
      return true;
    }

    let anyInstalled = false;
    for (const mod of items.filter((m) => selected.has(m.id))) {
      try {
        setState(mod.id, 'search');
        let version = null;
        for (const slug of mod.slugs) {
          // eslint-disable-next-line no-await-in-loop
          version = await findVersion(slug, instance.mcVersion, loaders);
          if (version) break;
        }
        if (!version) { setState(mod.id, 'none'); continue; }
        if (installedProjects.has(version.project_id)) { setState(mod.id, 'have'); continue; }
        setState(mod.id, 'install', version.version_number);
        // eslint-disable-next-line no-await-in-loop
        const added = await installVersion(version);
        setState(mod.id, added ? 'done' : 'have', version.version_number);
        if (added) anyInstalled = true;
      } catch (err) {
        setState(mod.id, 'error', err.message);
      }
    }
    setRunning(false);
    setFinished(true);
    if (anyInstalled) onInstalled?.();
  }

  const chosen = items.filter((m) => selected.has(m.id)).length;
  const visible = items.filter((m) => (m.name + m.desc).toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="modal-overlay" onClick={() => { if (!running) onClose(); }}>
      <div className="modal optimize-modal" onClick={(e) => e.stopPropagation()}>
        <div className="opt-hero">
          <div className="opt-hero-icon"><WrenchIcon width={26} height={26} /></div>
          <div className="opt-hero-text">
            <h2>Optimization</h2>
            <p>Fast, safe tweaks for <strong>{instance.loader}</strong> {instance.mcVersion}</p>
          </div>
          <button className="icon-btn opt-close" onClick={onClose} disabled={running}><CloseIcon /></button>
        </div>

        <div className="opt-body">
          <div className="opt-presets">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`opt-preset ${preset === p.id ? 'active' : ''}`}
                onClick={() => choosePreset(p.id)}
                disabled={running}
              >
                <span className="opt-preset-icon">{p.icon}</span>
                <span className="opt-preset-label">{p.label}</span>
                <span className="opt-preset-desc">{p.desc}</span>
              </button>
            ))}
          </div>

          <div className="opt-toolbar">
            <div className="opt-search">
              <SearchIcon width={15} height={15} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search mods…"
                disabled={running}
              />
            </div>
            <button type="button" className="btn-text" disabled={running} onClick={() => setSelected(new Set(items.map((m) => m.id)))}>Select all</button>
            <button type="button" className="btn-text" disabled={running} onClick={() => setSelected(new Set())}>Clear</button>
          </div>

          <div className="opt-list">
            {CATEGORIES.map((cat) => {
              const rows = visible.filter((m) => m.cat === cat.id);
              if (!rows.length) return null;
              return (
                <div className="opt-cat" key={cat.id}>
                  <div className="opt-cat-title"><span className={`opt-dot ${cat.color}`} />{cat.label}</div>
                  {rows.map((m) => {
                    const st = status[m.id];
                    const on = selected.has(m.id);
                    return (
                      <label className={`opt-card ${on ? 'selected' : ''} ${st ? `opt-${st.state}` : ''}`} key={m.id}>
                        <span className="opt-card-icon" aria-hidden="true">{m.icon}</span>
                        <span className="opt-card-text">
                          <span className="opt-card-name">{m.name}</span>
                          <span className="opt-card-desc">{m.desc}</span>
                        </span>
                        {st && (
                          <span className="opt-card-status">
                            {st.state === 'done' && <CheckIcon width={13} height={13} />}
                            {STATUS_LABEL[st.state]}{st.text && st.state !== 'search' ? ` · ${st.text}` : ''}
                          </span>
                        )}
                        <input
                          type="checkbox"
                          className="switch small"
                          checked={on}
                          disabled={running}
                          onChange={() => toggle(m.id)}
                        />
                      </label>
                    );
                  })}
                </div>
              );
            })}
            {!visible.length && <div className="opt-empty">No mods match that search.</div>}
          </div>
        </div>

        <div className="opt-footer">
          <span className="opt-count"><strong>{chosen}</strong> of {items.length} selected</span>
          <div className="modal-actions">
            <button className="btn" onClick={onClose} disabled={running}>{finished ? 'Close' : 'Cancel'}</button>
            <button className="btn btn-primary opt-install" onClick={install} disabled={running || chosen === 0}>
              {running ? 'Installing…' : `Install ${chosen} ${chosen === 1 ? 'mod' : 'mods'}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
