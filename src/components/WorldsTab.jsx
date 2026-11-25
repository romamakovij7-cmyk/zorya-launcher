import { useEffect, useState } from 'react';
import {
  GlobeIcon, TrashIcon, FolderIcon, PlayIcon, PinIcon, MapIcon,
} from './Icons.jsx';
import WorldMapModal from './WorldMapModal.jsx';
import { formatBytes } from '../utils/formatBytes.js';

export default function WorldsTab({ instance, onPlay, busy, account }) {
  const [saves, setSaves] = useState(null);
  const [sizes, setSizes] = useState({});
  const [mapWorld, setMapWorld] = useState(null);

  function load() {
    window.api.instances.listSaves(instance.id).then(setSaves);
    // Sizes arrive after the list is already on screen.
    window.api.instances.getSaveSizes(instance.id).then((res) => {
      if (res?.ok) setSizes(res.sizes);
    });
  }

  useEffect(() => { setSaves(null); setSizes({}); load(); }, [instance.id]);

  async function remove(name) {
    if (!confirm(`Delete мир «${name}»? Это необратимо.`)) return;
    await window.api.instances.deleteSave(instance.id, name);
    load();
  }

  async function togglePin(s) {
    await window.api.instances.setWorldPinned(instance.id, s.name, !s.pinned);
    load();
  }

  if (saves === null) return <div className="progress-label">Loading…</div>;

  if (saves.length === 0) {
    return (
      <div className="empty-state">
        <GlobeIcon width={38} height={38} />
        <p>Пока нет сохранённых миров. Они появятся здесь после первого запуска.</p>
      </div>
    );
  }

  return (
    <div className="content-table">
      <div className="content-table-head" style={{ gridTemplateColumns: '1fr auto' }}>
        <span>World</span>
        <span style={{ textAlign: 'right' }}>Действия</span>
      </div>
      {saves.map((s) => (
        <div className="content-row" key={s.name} style={{ gridTemplateColumns: '1fr auto' }}>
          <div className="content-row-project">
            {s.icon ? (
              <img className="content-row-icon" src={s.icon} alt="" />
            ) : (
              <div className="content-row-icon placeholder"><GlobeIcon width={20} height={20} /></div>
            )}
            <div className="content-row-title-wrap">
              <div className="content-row-title">{s.name}</div>
              <div className="content-row-sub">
                {new Date(s.mtime).toLocaleString('ru-RU')}
                {sizes[s.name] != null && ` · ${formatBytes(sizes[s.name])}`}
              </div>
            </div>
          </div>
          <div className="content-row-actions">
            <button
              className={`icon-btn server-pin-btn ${s.pinned ? 'active' : ''}`}
              title={s.pinned ? 'Unpin' : 'Pin'}
              onClick={() => togglePin(s)}
            >
              <PinIcon width={16} height={16} />
            </button>
            <button className="btn" style={{ padding: '8px 14px' }} title="World map from above" onClick={() => setMapWorld(s.name)}>
              <MapIcon width={15} height={15} /> Карта
            </button>
            <button className="icon-btn" title="Open folder" onClick={async () => {
              const res = await window.api.instances.openFolder(instance.id, `saves/${s.name}`);
              if (res && !res.ok) alert(`Failed открыть папку: ${res.error}`);
            }}>
              <FolderIcon width={17} height={17} />
            </button>
            <button
              className="btn btn-primary"
              style={{ padding: '8px 16px' }}
              title={s.canQuickPlay ? 'Play' : 'Play (this Minecraft version does not support direct navigation - the game\'s main screen will open)'}
              onClick={() => onPlay(s.canQuickPlay ? { type: 'world', target: s.name } : null)}
              disabled={busy || !account}
            >
              <PlayIcon width={15} height={15} /> Играть
            </button>
            <button className="icon-btn danger" title="Delete" onClick={() => remove(s.name)}>
              <TrashIcon width={17} height={17} />
            </button>
          </div>
        </div>
      ))}
      {mapWorld && <WorldMapModal instanceId={instance.id} world={mapWorld} onClose={() => setMapWorld(null)} />}
    </div>
  );
}
