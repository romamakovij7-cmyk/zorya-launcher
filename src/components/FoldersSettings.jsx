import { useCallback, useEffect, useState } from 'react';

// Settings -> «Папки»: the builds and the game files can live on another drive. The launcher moves nothing by itself: the person copies
// the old files by hand, and the line under the path says how much of the old library the chosen folder already holds.

function formatBytes(n) {
  if (n == null) return null;
  const gb = n / 1024 ** 3;
  return gb >= 100 ? `${Math.round(gb)} GB` : `${gb.toFixed(1)} GB`;
}

const SECTIONS = [
  {
    kind: 'instances',
    title: 'instance folder',
    desc: 'Here are the instances themselves: mods, worlds, settings. This is usually the hardest part.',
    status: (i) => (i.total ? `Instances in this folder: ${i.found} of ${i.total}.` : 'No instance yet.'),
    // a good state: nothing to copy, or everything is already there
    ok: (i) => !i.total || i.found === i.total,
  },
  {
    kind: 'game',
    title: 'Game file folder',
    desc: 'Minecraft versions, libraries, assets, auto-downloaded Java and Rust instances (Horizon) files. It\'s a heavy but pumpable part.',
    status: (i) => (i.found ? 'This folder already has game files.' : 'The folder is empty: the necessary files are downloaded on the first run.'),
    ok: () => true,
  },
];

export default function FoldersSettings() {
  const [data, setData] = useState(null);
  const [busyKind, setBusyKind] = useState(null);
  const [message, setMessage] = useState(null); // { kind, tone: 'error' | 'warn' | 'ok', text }

  // Never let a failure here take the whole Settings page down: the section just stays hidden.
  const load = useCallback(() => {
    try { return window.api.dataFolders.info().then((r) => r?.ok && setData(r)).catch(() => {}); } catch { return Promise.resolve(); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function choose(kind) {
    setBusyKind(kind);
    setMessage(null);
    try {
      const res = await window.api.dataFolders.choose(kind);
      if (res?.canceled) return;
      if (!res?.ok) setMessage({ kind, tone: 'error', text: res?.error || 'Couldn\'t change the folder.' });
      else setMessage({ kind, tone: res.warning ? 'warn' : 'ok', text: res.warning || 'Folder changed. If your files are not already there, copy them manually from the old folder (it is better to close the launcher while copying).' });
    } finally {
      setBusyKind(null);
      load();
    }
  }

  async function reset(kind) {
    setBusyKind(kind);
    setMessage(null);
    try {
      const res = await window.api.dataFolders.reset(kind);
      if (!res?.ok) setMessage({ kind, tone: 'error', text: res?.error || 'Couldn\'t drop the file.' });
    } finally {
      setBusyKind(null);
      load();
    }
  }

  if (!data) return null;
  return (
    <>
      <h2 className="section-heading">Folders</h2>
      {SECTIONS.map((s) => {
        const info = data[s.kind];
        if (!info) return null;
        const free = formatBytes(info.free);
        const msg = message && message.kind === s.kind ? message : null;
        return (
          <div className="settings-row folder-row" key={s.kind}>
            <div className="folder-row-info">
              <div className="settings-row-label">{s.title}</div>
              <div className="settings-row-desc">{s.desc}</div>
              <div className="folder-path" title={info.dir}>{info.dir}</div>
              <div className={`folder-note${!info.available ? ' bad' : (s.ok(info) ? '' : ' warn')}`}>
                {!info.available ? 'The folder is unavailable (disk disabled?). Connect it or select another folder.' : s.status(info)}
                {free && info.available ? ` Free on disc: ${free}.` : ''}
              </div>
              {info.custom && info.available && !s.ok(info) && (
                <div className="folder-note warn">Copy the contents of the old folder here manually, otherwise the instances in the list will be empty. Old folder: {info.defaultDir}</div>
              )}
              {msg && <div className={`folder-note ${msg.tone === 'error' ? 'bad' : (msg.tone === 'warn' ? 'warn' : 'good')}`}>{msg.text}</div>}
            </div>
            <div className="folder-actions">
              <button className="btn" disabled={busyKind === s.kind || data.busy} onClick={() => choose(s.kind)} title={data.busy ? 'First, close the running game.' : undefined}>Choose…</button>
              <button className="btn" onClick={() => window.api.dataFolders.open(s.kind)}>Open</button>
              {info.custom && <button className="btn" disabled={busyKind === s.kind || data.busy} onClick={() => reset(s.kind)}>Drop it.</button>}
            </div>
          </div>
        );
      })}
      <div className="settings-row-desc" style={{ margin: '-4px 4px 4px' }}>
        The launcher does not move anything itself: first close it and copy the files manually to a new folder, then select it here. You should not choose a folder inside OneDrive or on a network drive.
      </div>
    </>
  );
}
