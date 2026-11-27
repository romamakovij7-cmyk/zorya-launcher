// Shown on startup when there is no signed-in account: pick Microsoft or Offline.
import { useEffect, useState } from 'react';
import OfflineAddForm from './OfflineAddForm.jsx';
import { CloseIcon } from './Icons.jsx';

export default function WelcomeModal({ onAccount, onClose }) {
  const [mode, setMode] = useState(null); // null | 'offline'
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState(null);

  useEffect(() => window.api.auth.onStatus(setStatus), []);
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function microsoft() {
    setBusy(true);
    setError(null);
    try {
      const res = await window.api.auth.login();
      if (!res?.ok) { setError(res?.error || 'Could not sign in.'); return; }
      const acc = await window.api.auth.getAccount();
      if (acc) onAccount(acc);
      else onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay welcome-overlay">
      <div className="modal welcome-modal" onClick={(e) => e.stopPropagation()}>
        <button className="icon-btn welcome-close" onClick={onClose} title="Skip for now"><CloseIcon /></button>
        <div className="welcome-mark">✦</div>
        <h2 className="welcome-title">Welcome to Zorya</h2>
        <p className="welcome-sub">Choose how you want to play. You can switch accounts later in Settings.</p>

        {!mode ? (
          <div className="welcome-options">
            <button className="welcome-option microsoft" onClick={microsoft} disabled={busy}>
              <span className="welcome-option-icon">◈</span>
              <span className="welcome-option-name">Microsoft</span>
              <span className="welcome-option-desc">Sign in with your Microsoft account. Skins, capes and realms included.</span>
              <span className="welcome-option-go">{busy ? (status || 'Connecting…') : 'Sign in →'}</span>
            </button>
            <button className="welcome-option offline" onClick={() => setMode('offline')}>
              <span className="welcome-option-icon">☺</span>
              <span className="welcome-option-name">Offline</span>
              <span className="welcome-option-desc">Just type a nickname. No account needed — perfect for singleplayer.</span>
              <span className="welcome-option-go">Continue →</span>
            </button>
          </div>
        ) : (
          <div className="welcome-offline">
            <OfflineAddForm onAdded={onAccount} onCancel={() => setMode(null)} />
          </div>
        )}

        {error && <p className="error-text welcome-error">{error}</p>}
        <button className="btn-text welcome-skip" onClick={onClose}>Continue without an account</button>
      </div>
    </div>
  );
}
