import { useEffect, useMemo, useState } from 'react';
import { CloseIcon, CheckIcon } from './Icons.jsx';
import { explainFailure, explainStatus } from '../utils/netError.js';

// Curated performance mods, per loader. `slugs` are Modrinth project slugs
// tried in order (the first one that has a build for this Minecraft version
// wins) — e.g. Sodium on newer NeoForge, Embeddium on older Forge.
const FABRIC_LIST = [
  { id: 'render', name: 'Sodium', slugs: ['sodium'], desc: 'The main acceleration of the graphics - noticeably raises the FPS.', on: true },
  { id: 'logic', name: 'Lithium', slugs: ['lithium'], desc: 'Optimization of game logic and world generation.', on: true },
  { id: 'memory', name: 'FerriteCore', slugs: ['ferrite-core'], desc: 'It greatly reduces the consumption of RAM.', on: true },
  { id: 'immediate', name: 'ImmediatelyFast', slugs: ['immediatelyfast'], desc: 'It draws interface, text and particles faster.', on: true },
  { id: 'culling', name: 'Entity Culling', slugs: ['entityculling'], desc: 'Does not draw creatures and block entities that are not visible.', on: true },
  { id: 'modernfix', name: 'ModernFix', slugs: ['modernfix'], desc: 'Faster game launch, less memory, leak fixes.', on: true },
  { id: 'extra', name: 'Sodium Extra', slugs: ['sodium-extra'], desc: 'Additional graphics settings for Sodium.', on: false },
  { id: 'dynfps', name: 'Dynamic FPS', slugs: ['dynamic-fps'], desc: 'Reduces FPS when the game window is out of focus.', on: false },
  { id: 'iris', name: 'Iris Shaders', slugs: ['iris'], desc: 'Shader support (shaderpaks themselves are set separately).', on: false },
];

const FORGE_LIST = [
  { id: 'render', name: 'Embeddium', slugs: ['embeddium'], desc: 'Speed up graphics (fork Sodium for Forge).', on: true },
  { id: 'memory', name: 'FerriteCore', slugs: ['ferrite-core'], desc: 'It greatly reduces the consumption of RAM.', on: true },
  { id: 'immediate', name: 'ImmediatelyFast', slugs: ['immediatelyfast'], desc: 'It draws interface, text and particles faster.', on: true },
  { id: 'culling', name: 'Entity Culling', slugs: ['entityculling'], desc: 'He doesn\'t paint creatures he can\'t see.', on: true },
  { id: 'modernfix', name: 'ModernFix', slugs: ['modernfix'], desc: 'Faster game launch, less memory.', on: true },
  { id: 'dynfps', name: 'Dynamic FPS', slugs: ['dynamic-fps'], desc: 'Reduces FPS when the game window is out of focus.', on: false },
];

const NEOFORGE_LIST = FORGE_LIST.map((m) => (m.id === 'render'
  ? { ...m, name: 'Sodium / Embeddium', slugs: ['sodium', 'embeddium'], desc: 'Accelerate graphics - Sodium, and on older versions of Embeddium.' }
  : m));

function listFor(loader) {
  if (loader === 'fabric' || loader === 'quilt') return FABRIC_LIST;
  if (loader === 'neoforge') return NEOFORGE_LIST;
  if (loader === 'forge') return FORGE_LIST;
  return [];
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
  wait: 'In line.',
  search: 'Looking for a version...',
  install: 'Setting up...',
  done: 'Installed',
  have: 'Already installed.',
  none: 'There\'s no version for this game',
  error: 'Mistake',
};

export default function OptimizeModal({ instance, onClose, onInstalled }) {
  const items = useMemo(() => listFor(instance.loader), [instance.loader]);
  const [selected, setSelected] = useState(() => new Set(items.filter((m) => m.on).map((m) => m.id)));
  const [status, setStatus] = useState({}); // id -> { state, text }
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape' && !running) onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [running, onClose]);

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
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

  return (
    <div className="modal-overlay" onClick={() => { if (!running) onClose(); }}>
      <div className="modal optimize-modal" onClick={(e) => e.stopPropagation()}>
        <div className="schem-detail-header">
          <h2 style={{ margin: 0 }}>Optimization</h2>
          <button className="icon-btn" onClick={onClose} disabled={running}><CloseIcon /></button>
        </div>
        <p className="settings-block-hint" style={{ marginTop: 0 }}>
          Proven mods for FPS under {instance.loader} {instance.mcVersion}. The launcher will find suitable versions on Modrinth
          and install required dependencies; already installed ones are skipped.
        </p>

        <div className="opt-list">
          {items.map((m) => {
            const st = status[m.id];
            return (
              <label className={`opt-row ${st ? `opt-${st.state}` : ''}`} key={m.id}>
                <input
                  type="checkbox"
                  className="switch small"
                  checked={selected.has(m.id)}
                  disabled={running}
                  onChange={() => toggle(m.id)}
                />
                <div className="opt-row-text">
                  <div className="opt-row-name">{m.name}</div>
                  <div className="opt-row-desc">{m.desc}</div>
                </div>
                {st && (
                  <span className="opt-row-status">
                    {st.state === 'done' && <CheckIcon width={13} height={13} />}
                    {STATUS_LABEL[st.state]}{st.text && st.state !== 'search' ? ` · ${st.text}` : ''}
                  </span>
                )}
              </label>
            );
          })}
        </div>

        <div className="modal-actions" style={{ marginTop: 18 }}>
          <button className="btn" onClick={onClose} disabled={running}>{finished ? 'Ready.' : 'Cancellation'}</button>
          <button className="btn btn-primary" onClick={install} disabled={running || chosen === 0}>
            {running ? 'Installation...' : `Installation${chosen})`}
          </button>
        </div>
      </div>
    </div>
  );
}
