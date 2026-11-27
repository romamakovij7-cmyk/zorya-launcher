import { useState } from 'react';

export default function CreateFolderModal({ onClose, onCreated }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleCreate() {
    setBusy(true);
    const res = await window.api.folders.create(name.trim());
    setBusy(false);
    if (res.ok) onCreated(res.folder);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>New folder.</h2>
        <div className="field">
          <label>Title</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder="My file."
            autoFocus
          />
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Cancellation</button>
          <button className="btn btn-primary" onClick={handleCreate} disabled={busy}>
            {busy ? 'Creation of...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
