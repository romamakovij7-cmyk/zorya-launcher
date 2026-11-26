import { useCallback, useEffect, useState } from 'react';
import Select from './Select.jsx';
import { CloseIcon } from './Icons.jsx';

// Settings -> «General серверы»: one list of servers for all builds (see electron/mc/sharedServers.js).
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

  const show = (r, okText) => setMsg(r?.ok ? { ok: true, text: okText } : { ok: false, text: r?.error || 'Не получилось.' });
  async function add() {
    const r = await window.api.sharedServers.add({ name, address });
    if (r?.ok) { setName(''); setAddress(''); setData((d) => ({ ...d, servers: r.servers })); setMsg(null); } else show(r);
  }
  async function remove(i) { const r = await window.api.sharedServers.remove(i); if (r?.ok) setData((d) => ({ ...d, servers: r.servers })); else show(r); }
  async function move(i, dir) { const r = await window.api.sharedServers.move(i, dir); if (r?.ok) setData((d) => ({ ...d, servers: r.servers })); else show(r); }
  async function importFrom(id) {
    const r = await window.api.sharedServers.importFrom(id);
    if (r?.ok) { setData((d) => ({ ...d, servers: r.servers })); show(r, r.added ? `Добавлено серверов: ${r.added}.` : 'Новых серверов в этой сборке нет: все уже в общем списке.'); } else show(r);
  }

  if (!data) return null;
  const full = data.servers.length >= (data.max || 50);
  return (
    <>
      <h2 className="section-heading">General серверы</h2>
      <div className="settings-row" style={{ display: 'block' }}>
        <div className="settings-row-label">Один список серверов для всех сборок</div>
        <div className="settings-row-desc">
          Перед запуском любой сборки лаунчер добавит в неё те из этих серверов, которых там ещё нет. Новые серверы идут в конец вашего списка в игре, ваши собственные серверы не меняются.
          Server, который вы удалили в игре, сам не вернётся (вернуть его можно кнопкой в настройках сборки, вкладка «Game»).
        </div>

        <div className="shared-list">
          {data.servers.length === 0 && <div className="settings-row-desc">Список пока пуст. Добавьте сервер ниже или возьмите серверы из готовой сборки.</div>}
          {data.servers.map((s, i) => (
            <div className="shared-row" key={`${s.address}:${i}`}>
              <div className="shared-row-text"><strong>{s.name}</strong><span>{s.address}</span></div>
              <button className="btn btn-icon" title="Выше" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
              <button className="btn btn-icon" title="Ниже" disabled={i === data.servers.length - 1} onClick={() => move(i, 1)}>↓</button>
              <button className="btn btn-icon" title="Убрать из общего списка" onClick={() => remove(i)}><CloseIcon width={14} height={14} /></button>
            </div>
          ))}
        </div>

        <div className="shared-add">
          <input className="text-input" placeholder="Name (необязательно)" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          <input className="text-input" placeholder="Address, например play.example.ru" maxLength={260} value={address} onChange={(e) => setAddress(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && address.trim() && add()} />
          <button className="btn" onClick={add} disabled={!address.trim() || full}>Add</button>
        </div>
        {builds.length > 0 && (
          <div className="shared-import">
            <div className="settings-row-desc" style={{ marginBottom: 6 }}>Или возьмите серверы из уже настроенной сборки (новые серверы добавятся в общий список):</div>
            <div style={{ width: 300 }}>
              <Select value="" onChange={importFrom} placeholder="Выбрать сборку…" options={[{ value: '', label: 'Выбрать сборку…', disabled: true }, ...builds.map((b) => ({ value: b.id, label: b.name }))]} />
            </div>
          </div>
        )}
        {msg && <div className={msg.ok ? 'folder-note good' : 'folder-note bad'} style={{ marginTop: 10 }}>{msg.text}</div>}
      </div>
    </>
  );
}
