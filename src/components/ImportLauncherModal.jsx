import { useEffect, useState } from 'react';
import { BoxIcon, CloseIcon, DownloadCloudIcon, ChevronLeft, ChevronRight } from './Icons.jsx';
import { formatBytes } from '../utils/formatBytes.js';

const LOADER_LABELS = { fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge', vanilla: 'Vanilla' };

const pluralBuilds = (n) => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return `${n} instance`;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} instance`;
  return `${n} instance`;
};

// Two steps: pick a launcher (Prism/MultiMC, ATLauncher, Modrinth App,
// CurseForge — the ones that aren't installed are shown greyed out), then pick
// which of its builds to copy, or copy them all. Picked builds go to the app's
// background-import queue (same pause/resume/cancel machinery as a modpack
// download) — see electron/mc/importers.js for how they're found and copied.
export default function ImportLauncherModal({ onClose, onImport }) {
  const [state, setState] = useState('loading'); // loading | error | { launchers, known }
  const [launcherId, setLauncherId] = useState(null);
  const [picked, setPicked] = useState(() => new Set()); // "root|key"
  const [started, setStarted] = useState(new Set());
  const [sizes, setSizes] = useState({}); // "root|key" -> bytes
  const [linkMode, setLinkMode] = useState(false); // use the builds where they are instead of copying them
  const [folderNote, setFolderNote] = useState(null); // { ok, text } after "Indicate the folder"

  useEffect(() => {
    window.api.importers.detect().then((res) => {
      setState(res.ok ? { launchers: res.launchers, known: res.known || [] } : 'error');
    }).catch(() => setState('error'));
  }, []);

  const group = state !== 'loading' && state !== 'error' && launcherId ? state.launchers[launcherId] : null;
  const rowId = (inst) => `${inst.root}|${inst.key}`;

  // Sizes can take a while for big profiles, so they arrive one by one after
  // the list is already on screen.
  useEffect(() => {
    if (!group) return undefined;
    let cancelled = false;
    (async () => {
      for (const inst of group.instances) {
        // eslint-disable-next-line no-await-in-loop
        const res = await window.api.importers.size(launcherId, inst.root, inst.key);
        if (cancelled) return;
        if (res.ok) setSizes((prev) => ({ ...prev, [rowId(inst)]: res.bytes }));
      }
    })();
    return () => { cancelled = true; };
  }, [launcherId, group]);

  function chooseLauncher(id) {
    setLauncherId(id);
    setPicked(new Set());
  }

  function toggle(id) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // A launcher kept on another drive or in a folder of its own: point at its data folder by hand.
  async function pickFolder() {
    setFolderNote(null);
    const res = await window.api.importers.addFolder();
    if (res.canceled) return;
    if (res.ok) {
      setState({ launchers: res.launchers, known: res.known || [] });
      setFolderNote({ ok: true, text: `Found. ${res.added.label}: ${res.added.root}` });
    } else {
      setFolderNote({ ok: false, text: res.error });
    }
  }

  function startImports(instances) {
    instances.forEach((inst) => onImport({
      launcherId, root: inst.root, key: inst.key, title: inst.name, icon: inst.icon || null, mode: linkMode ? 'link' : 'copy',
    }));
    setStarted((prev) => new Set([...prev, ...instances.map(rowId)]));
    setPicked(new Set());
  }

  const available = group ? group.instances.filter((i) => !started.has(rowId(i))) : [];
  const pickedInstances = available.filter((i) => picked.has(rowId(i)));
  const allPicked = available.length > 0 && pickedInstances.length === available.length;
  const loaded = state !== 'loading' && state !== 'error';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ width: 560 }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {group ? (
            <button className="icon-btn" title="Choosing a launcher" onClick={() => setLauncherId(null)}>
              <ChevronLeft width={18} height={18} />
            </button>
          ) : null}
          {group ? group.label : 'Imports from another launcher'}
        </h2>
        <p className="settings-block-hint" style={{ marginTop: -6 }}>
          {group ? 'Choose instances or move everything at once. ' : 'Select the launcher from which you want to take the instances. '}
          {linkMode
            ? 'The instance will work directly from another launcher\'s folder, without copying.'
            : 'Instance are copied, not transferred - nothing changes in the original launcher.'}
        </p>

        {state === 'loading' && <div className="progress-label">Looking for installed launchers...</div>}
        {state === 'error' && <div className="error-text">Failed to perform a search.</div>}

        {loaded && !group && (
          <div className="import-launcher-list">
            <div className="hint-text" style={{ marginBottom: 6 }}>
              Is the launcher installed on another disk or in its folder and not found? Click “Specify folder“ and select its folder with data.
            </div>
            {state.known.map((l) => {
              const found = state.launchers[l.id];
              return (
                <button
                  key={l.id}
                  type="button"
                  className={`import-launcher-row import-launcher-pick ${found ? '' : 'disabled'}`}
                  disabled={!found}
                  onClick={() => chooseLauncher(l.id)}
                >
                  <div className="import-launcher-icon"><DownloadCloudIcon width={20} height={20} /></div>
                  <div className="import-launcher-text">
                    <div className="content-row-title">{l.label}</div>
                    <div className="content-row-sub">{found ? pluralBuilds(found.instances.length) : 'Not found on this computer.'}</div>
                  </div>
                  {found && <ChevronRight width={16} height={16} />}
                </button>
              );
            })}
          </div>
        )}

        {group && (
          <>
            <label className="import-launcher-row" style={{ alignItems: 'flex-start', marginBottom: 8 }}>
              <input type="checkbox" checked={linkMode} onChange={(e) => setLinkMode(e.target.checked)} />
              <div className="import-launcher-text">
                <div className="content-row-title import-wrap">Do not copy, use from the folder of another launcher</div>
                <div className="content-row-sub import-wrap">
                  Save space and time: the assembly stays where it lies. But it’s the same folder for both launchers: mods, settings and worlds common,
                  If the folder is moved or disconnected, the build will stop running. When removing the assembly here is a folder of another loungeIt’s not going away.
                </div>
              </div>
            </label>
            <div className="import-launcher-toolbar">
              <button className="btn-text" onClick={() => setPicked(allPicked ? new Set() : new Set(available.map(rowId)))} disabled={available.length === 0}>
                {allPicked ? 'Remove allocation' : 'Highlight everything'}
              </button>
              <span className="hint-text">{pluralBuilds(group.instances.length)}</span>
            </div>
            <div className="import-launcher-list">
              {group.instances.map((inst) => {
                const id = rowId(inst);
                const busy = started.has(id);
                const size = sizes[id];
                return (
                  <label className={`import-launcher-row ${busy ? 'disabled' : ''}`} key={id}>
                    <input type="checkbox" checked={picked.has(id)} disabled={busy} onChange={() => toggle(id)} />
                    <div className="import-launcher-icon">
                      {inst.icon ? <img src={inst.icon} alt="" /> : <BoxIcon width={20} height={20} />}
                    </div>
                    <div className="import-launcher-text">
                      <div className="content-row-title">{inst.name}</div>
                      <div className="content-row-sub">
                        {LOADER_LABELS[inst.loader] || inst.loader} {inst.mcVersion} · {size == null ? 'Consider the size' : formatBytes(size)}
                      </div>
                    </div>
                    {busy && <span className="hint-text">Import queue</span>}
                  </label>
                );
              })}
            </div>
          </>
        )}

        {folderNote && <div className={folderNote.ok ? 'hint-text' : 'error-text'} style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>{folderNote.text}</div>}

        <div className="modal-actions import-actions">
          <button className="btn" onClick={onClose}><CloseIcon width={15} height={15} /> Close.</button>
          {!group && loaded && <button className="btn" onClick={pickFolder}>Specify the folder...</button>}
          {group && (
            <>
              <button className="btn" onClick={() => startImports(available)} disabled={available.length === 0}>
                Move everything{available.length ? ` (${available.length})` : ''}
              </button>
              <button className="btn btn-primary" onClick={() => startImports(pickedInstances)} disabled={pickedInstances.length === 0}>
                <DownloadCloudIcon width={15} height={15} /> Import{pickedInstances.length ? ` (${pickedInstances.length})` : ''}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
