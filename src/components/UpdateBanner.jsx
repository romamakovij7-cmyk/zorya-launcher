import { useState } from 'react';
import { formatBytes } from '../utils/formatBytes.js';

// A small card in the corner: "a new version is out" → download → restart. Shown
// when the background check finds an update (or the user checked in Settings).
export default function UpdateBanner({ updater }) {
  const [hidden, setHidden] = useState(null); // version the user pressed "Позже" for
  const { status, info, progress, error } = updater;
  const visible = ['available', 'downloading', 'ready', 'installing'].includes(status) || (status === 'error' && info?.hasUpdate);
  if (!visible || hidden === info?.latest) return null;

  const pct = progress?.total ? Math.min(100, Math.round((progress.loaded / progress.total) * 100)) : 0;
  return (
    <div className="update-banner" role="status">
      <div className="update-banner-title">
        {status === 'ready' || status === 'installing' ? 'Обновление готово' : `Доступна версия ${info?.latest || ''}`}
      </div>
      {info?.notes && status === 'available' && <div className="update-banner-notes">{info.notes}</div>}
      {status === 'available' && (
        <div className="update-banner-meta">У вас {info?.current}{info?.size ? ` · загрузка ${formatBytes(info.size)}` : ''}</div>
      )}
      {status === 'downloading' && (
        <>
          <div className="update-banner-meta">Скачиваем… {pct}%</div>
          <div className="progress-bar-track"><div className="progress-bar-fill" style={{ width: `${pct}%` }} /></div>
        </>
      )}
      {(status === 'ready' || status === 'installing') && (
        <div className="update-banner-meta">Лаунчер закроется, обновится и откроется снова.</div>
      )}
      {error && <div className="update-banner-error">{error}</div>}
      <div className="update-banner-actions">
        {(status === 'available' || status === 'error') && <button className="btn btn-primary" onClick={updater.download}>Download</button>}
        {status === 'ready' && <button className="btn btn-primary" onClick={updater.install}>Перезапустить и обновить</button>}
        {status === 'installing' && <button className="btn" disabled>Устанавливаем…</button>}
        {status !== 'downloading' && status !== 'installing' && (
          <button className="btn" onClick={() => setHidden(info?.latest)}>Позже</button>
        )}
      </div>
    </div>
  );
}
