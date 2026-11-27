import { useState } from 'react';
import { formatBytes } from '../utils/formatBytes.js';

// A small card in the corner: "a new version is out" → download → restart. Shown
// when the background check finds an update (or the user checked in Settings).
export default function UpdateBanner({ updater }) {
  const [hidden, setHidden] = useState(null); // version the user pressed "Later." for
  const { status, info, progress, error } = updater;
  const visible = ['available', 'downloading', 'ready', 'installing'].includes(status) || (status === 'error' && info?.hasUpdate);
  if (!visible || hidden === info?.latest) return null;

  const pct = progress?.total ? Math.min(100, Math.round((progress.loaded / progress.total) * 100)) : 0;
  return (
    <div className="update-banner" role="status">
      <div className="update-banner-title">
        {status === 'ready' || status === 'installing' ? 'Update ready.' : `Available version ${info?.latest || ''}`}
      </div>
      {info?.notes && status === 'available' && <div className="update-banner-notes">{info.notes}</div>}
      {status === 'available' && (
        <div className="update-banner-meta">You. {info?.current}{info?.size ? ` • loading ${formatBytes(info.size)}` : ''}</div>
      )}
      {status === 'downloading' && (
        <>
          <div className="update-banner-meta">Download... {pct}%</div>
          <div className="progress-bar-track"><div className="progress-bar-fill" style={{ width: `${pct}%` }} /></div>
        </>
      )}
      {(status === 'ready' || status === 'installing') && (
        <div className="update-banner-meta">The launcher will close, upgrade and reopen.</div>
      )}
      {error && <div className="update-banner-error">{error}</div>}
      <div className="update-banner-actions">
        {(status === 'available' || status === 'error') && <button className="btn btn-primary" onClick={updater.download}>Download</button>}
        {status === 'ready' && <button className="btn btn-primary" onClick={updater.install}>Restart and update</button>}
        {status === 'installing' && <button className="btn" disabled>Installing...</button>}
        {status !== 'downloading' && status !== 'installing' && (
          <button className="btn" onClick={() => setHidden(info?.latest)}>Later.</button>
        )}
      </div>
    </div>
  );
}
