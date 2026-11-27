import { useState } from 'react';

// Dropping one instance tile onto another (neither already in a folder)
// offers to bundle them into a brand-new one — a name is suggested, but
// editable, and Cancel leaves both exactly where they were.
export default function MergeIntoFolderModal({
  instanceA, instanceB, onClose, onMerged,
}) {
  const [name, setName] = useState('New folder.');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handleConfirm() {
    setBusy(true);
    setError(null);
    const res = await window.api.instances.mergeIntoFolder(instanceA.id, instanceB.id, name.trim());
    setBusy(false);
    if (res.ok) onMerged(res.folder, res.instances);
    else setError(res.error || 'Failed to create a folder.');
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Put it in a folder.</h2>
        <p className="settings-block-hint" style={{ marginTop: -6 }}>
          «{instanceA.name}“ and “{instanceB.name}They will be in one new folder.
        </p>
        <div className="field">
          <label>Folder name.</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleConfirm()}
            autoFocus
            onFocus={(e) => e.target.select()}
          />
        </div>
        {error && <div className="error-text">{error}</div>}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Cancellation</button>
          <button className="btn btn-primary" onClick={handleConfirm} disabled={busy || !name.trim()}>
            {busy ? 'Creation of...' : 'Create a folder.'}
          </button>
        </div>
      </div>
    </div>
  );
}
