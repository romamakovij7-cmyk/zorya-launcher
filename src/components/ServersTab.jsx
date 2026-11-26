import { useEffect, useState } from 'react';
import {
  ServerIcon, PlayIcon, TrashIcon, PlusIcon, PinIcon,
} from './Icons.jsx';

export default function ServersTab({ instance, onPlay, busy, account }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [addr, setAddr] = useState('');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  function load() {
    window.api.instanceServers.list(instance.id).then((res) => {
      if (res.ok) setItems(res.items);
      else { setError(res.error); setItems([]); }
    });
  }

  useEffect(() => { setItems(null); load(); }, [instance.id]);

  async function handleAdd() {
    const trimmed = addr.trim();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    const res = await window.api.instanceServers.add(instance.id, trimmed, name.trim());
    setSaving(false);
    if (res.ok) { setAddr(''); setName(''); setAdding(false); load(); }
    else setError(res.error);
  }

  async function togglePin(item) {
    await window.api.instanceServers.setPinned(instance.id, item.address, !item.pinned);
    load();
  }

  async function remove(item) {
    if (!confirm(`Delete сервер «${item.name}» из списка?`)) return;
    await window.api.instanceServers.delete(instance.id, item.index);
    load();
  }

  if (items === null) return <div className="progress-label">Loading…</div>;

  return (
    <div>
      <div className="content-toolbar">
        <button className="btn btn-primary" onClick={() => setAdding((v) => !v)}>
          <PlusIcon width={16} height={16} /> Add сервер
        </button>
      </div>

      {adding && (
        <div className="server-add-form">
          <input
            placeholder="Address (play.example.com:25565)"
            value={addr}
            onChange={(e) => setAddr(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            autoFocus
          />
          <input
            placeholder="Name (необязательно)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          />
          <button className="btn btn-primary" onClick={handleAdd} disabled={saving || !addr.trim()}>
            {saving ? 'Добавление…' : 'Add'}
          </button>
        </div>
      )}

      {error && <div className="error-text" style={{ marginBottom: 12 }}>{error}</div>}

      {items.length === 0 ? (
        <div className="empty-state">
          <ServerIcon width={38} height={38} />
          <p>Серверов пока нет. Добавьте первый выше.</p>
        </div>
      ) : (
        <div className="recent-play-list single-col">
          {items.map((item) => (
            <div className="recent-play-row" key={item.index}>
              <div className="recent-play-icon">
                {item.icon ? <img src={item.icon} alt="" /> : <ServerIcon width={24} height={24} />}
              </div>
              <div className="recent-play-body">
                <div className="recent-play-title-line">
                  <span className="recent-play-title">{item.name}</span>
                  {item.reachable === false && <span className="recent-play-offline">Не в сети</span>}
                </div>
                <div className="recent-play-sub">
                  {item.reachable ? (
                    <>
                      <span>{item.online ?? '?'}/{item.max ?? '?'} онлайн</span>
                      <span className="dot" />
                      <span>{item.ping} мс</span>
                    </>
                  ) : (
                    <span>{item.address}</span>
                  )}
                </div>
              </div>

              {item.reachable === false && <div className="recent-play-error">Невозможно подключиться</div>}

              <button
                className={`icon-btn server-pin-btn ${item.pinned ? 'active' : ''}`}
                title={item.pinned ? 'Unpin' : 'Pin'}
                onClick={() => togglePin(item)}
              >
                <PinIcon width={16} height={16} />
              </button>

              <button
                className="btn btn-primary recent-play-play"
                title={item.canQuickPlay ? 'Играть' : 'Играть (эта Minecraft version не поддерживает прямой переход — откроется главный экран игры)'}
                onClick={() => onPlay(item.canQuickPlay ? { type: 'server', target: item.address } : null)}
                disabled={busy || !account}
              >
                <PlayIcon width={15} height={15} /> Играть
              </button>

              <button className="icon-btn danger" title="Delete" onClick={() => remove(item)}>
                <TrashIcon width={17} height={17} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
