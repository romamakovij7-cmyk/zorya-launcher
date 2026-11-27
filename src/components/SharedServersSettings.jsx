import { useCallback, useEffect, useState } from 'react';
import Select from './Select.jsx';
import { CloseIcon } from './Icons.jsx';

// Settings -> «Shared servers»: one list of servers for all builds (see electron/mc/sharedServers.js).
export default function SharedServersSettings() {
  const [data, setData] = useState(null); // { servers, max }
  const [builds, setBuilds] = useState([]);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [msg, setMsg] = useState(null); // { ok, text }

  const load = useCallback(() => {
    try { return window.api.sharedServers.get().then((r) => r?.ok && setData(r)).catch(() => {}); } catch { return Promise.resolve(); }
  }, []);
  useEffect(() => {
    load();
    try { window.api.instances.list().then((l) => setBuilds((l || []).filter((i) => i.loader !== 'horizon'))).catch(() => {}); } catch { /* no import list */ }
  }, [load]);

  const show = (r, okText) => setMsg(r?.ok ? { ok: true, text: okText } : { ok: false, text: r?.error || 'It didn\'t work.' });
  async function add() {
    const r = await window.api.sharedServers.add({ name, address });
    if (r?.ok) { setName(''); setAddress(''); setData((d) => ({ ...d, servers: r.servers })); setMsg(null); } else show(r);
  }
  async function remove(i) { const r = await window.api.sharedServers.remove(i); if (r?.ok) setData((d) => ({ ...d, servers: r.servers })); else show(r); }
  async function move(i, dir) { const r = await window.api.sharedServers.move(i, dir); if (r?.ok) setData((d) => ({ ...d, servers: r.servers })); else show(r); }
  async function importFrom(id) {
    const r = await window.api.sharedServers.importFrom(id);
    if (r?.ok) { setData((d) => ({ ...d, servers: r.servers })); show(r, r.added ? `Added servers: ${r.added}.` : 'There are no new servers in this instance: everything is already in the general list.'); } else show(r);
  }

  if (!data) return null;
  const full = data.servers.length >= (data.max || 50);
  return (
    <>
      <h2 className="section-heading">Shared servers</h2>
      <div className="settings-row" style={{ display: 'block' }}>
        <div className="settings-row-label">One list of servers for all instances</div>
        <div className="settings-row-desc">
          Before starting any assembly, the launcher will add those of these servers that are not there yet. New servers go to the end of your in-game list, your own servers don’t change.
          The server that you deleted in the game will not return (you can return it with a button in the build settings, tab). «Game.»).
        </div>

        <div className="shared-list">
          {data.servers.length === 0 && <div className="settings-row-desc">The list is empty. Add the server below or take the servers from the finished instance.</div>}
          {data.servers.map((s, i) => (
            <div className="shared-row" key={`${s.address}:${i}`}>
              <div className="shared-row-text"><strong>{s.name}</strong><span>{s.address}</span></div>
              <button className="btn btn-icon" title="Higher." disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
              <button className="btn btn-icon" title="Below." disabled={i === data.servers.length - 1} onClick={() => move(i, 1)}>↓</button>
              <button className="btn btn-icon" title="Remove from the general list" onClick={() => remove(i)}><CloseIcon width={14} height={14} /></button>
            </div>
          ))}
        </div>

        <div className="shared-add">
          <input className="text-input" placeholder="Title (optional)" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          <input className="text-input" placeholder="Address, for example, play.example.ru" maxLength={260} value={address} onChange={(e) => setAddress(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && address.trim() && add()} />
          <button className="btn" onClick={add} disabled={!address.trim() || full}>Add</button>
        </div>
        {builds.length > 0 && (
          <div className="shared-import">
            <div className="settings-row-desc" style={{ marginBottom: 6 }}>Or take servers from an already configured instance (new servers will be added to the general list):</div>
            <div style={{ width: 300 }}>
              <Select value="" onChange={importFrom} placeholder="Select instance..." options={[{ value: '', label: 'Select instance...', disabled: true }, ...builds.map((b) => ({ value: b.id, label: b.name }))]} />
            </div>
          </div>
        )}
        {msg && <div className={msg.ok ? 'folder-note good' : 'folder-note bad'} style={{ marginTop: 10 }}>{msg.text}</div>}
      </div>
    </>
  );
}
