import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { UserIcon, CheckIcon, CloseIcon, PlusIcon } from './Icons.jsx';
import AccountFace from './AccountFace.jsx';
import OfflineAddForm from './OfflineAddForm.jsx';

// Rendered via a portal straight into <body> — the sidebar has
// overflow-x: hidden (so its own icon column never grows a scrollbar), and
// that clips ANY absolutely/fixed-positioned descendant that extends past
// its edge, including this popover, no matter its z-index. Escaping to
// <body> and positioning against the avatar's real on-screen rect sidesteps
// that entirely.
export default function AccountSwitcher({ anchorRef, onClose, onActiveAccountChange }) {
  const [pos, setPos] = useState(null);
  const [accounts, setAccounts] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [addMode, setAddMode] = useState(null); // null | 'offline'
  const [loggingIn, setLoggingIn] = useState(false);
  const [loginStatus, setLoginStatus] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const el = anchorRef?.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({ top: rect.top, left: rect.right + 12 });
  }, [anchorRef]);

  function load() {
    window.api.auth.listAccounts().then((res) => {
      setAccounts(res.accounts);
      setActiveId(res.activeAccountId);
    });
  }

  useEffect(load, []);
  useEffect(() => window.api.auth.onStatus(setLoginStatus), []);

  async function handleSwitch(account) {
    if (account.id === activeId) return;
    setBusyId(account.id);
    const res = await window.api.auth.switchAccount(account.id);
    setBusyId(null);
    if (res.ok) {
      setActiveId(account.id);
      onActiveAccountChange(res.account);
    }
  }

  async function handleRemove(e, account) {
    e.stopPropagation();
    if (!confirm(`Убрать аккаунт «${account.name}» из лаунчера?`)) return;
    setBusyId(account.id);
    const res = await window.api.auth.logout(account.id);
    setBusyId(null);
    if (res.ok) {
      const remaining = accounts.filter((a) => a.id !== account.id);
      setAccounts(remaining);
      setActiveId(res.activeAccountId);
      onActiveAccountChange(remaining.find((a) => a.id === res.activeAccountId) || null);
    }
  }

  async function handleMicrosoftLogin() {
    setLoggingIn(true);
    setError(null);
    const res = await window.api.auth.login();
    setLoggingIn(false);
    setLoginStatus(null);
    if (res.ok) {
      onActiveAccountChange(res.account);
      load();
      setAddMode(null);
    } else {
      setError(res.error);
    }
  }

  if (!pos) return null;

  return createPortal(
    <>
      <div className="dropdown-backdrop" onClick={onClose} />
      <div className="account-switcher" style={{ top: pos.top, left: pos.left }}>
        <div className="account-switcher-title">Аккаунты</div>

        {accounts === null ? (
          <div className="progress-label" style={{ padding: '10px 4px' }}>Loading…</div>
        ) : accounts.length === 0 ? (
          <div className="account-switcher-empty">Ни одного аккаунта ещё не добавлено.</div>
        ) : (
          <div className="account-switcher-list">
            {accounts.map((account) => (
              <button
                key={account.id}
                className={`account-switcher-row ${account.id === activeId ? 'active' : ''}`}
                onClick={() => handleSwitch(account)}
                disabled={busyId === account.id}
              >
                <div className="account-switcher-avatar">
                  <AccountFace account={account} size={34} iconSize={16} />
                </div>
                <div className="account-switcher-info">
                  <div className="account-switcher-name">{account.name}</div>
                  <div className="account-switcher-type">
                    {account.type === 'microsoft' ? 'Microsoft' : account.isMain ? 'Оффлайн · основной' : 'Оффлайн · без скинов Zorya'}
                  </div>
                </div>
                {account.id === activeId && <CheckIcon width={16} height={16} className="account-switcher-check" />}
                <span className="account-switcher-remove" onClick={(e) => handleRemove(e, account)} title="Убрать">
                  <CloseIcon width={14} height={14} />
                </span>
              </button>
            ))}
          </div>
        )}

        {error && <div className="error-text" style={{ margin: '8px 0', whiteSpace: 'pre-wrap' }}>{error}</div>}

        {addMode === 'offline' ? (
          <OfflineAddForm
            onAdded={(account) => { onActiveAccountChange(account); load(); setAddMode(null); }}
            onCancel={() => setAddMode(null)}
          />
        ) : (
          <div className="account-switcher-actions">
            <button className="btn" onClick={handleMicrosoftLogin} disabled={loggingIn}>
              <PlusIcon width={14} height={14} /> {loggingIn ? (loginStatus || 'Вход…') : 'Microsoft'}
            </button>
            <button className="btn" onClick={() => setAddMode('offline')}>
              <PlusIcon width={14} height={14} /> Оффлайн
            </button>
          </div>
        )}
      </div>
    </>,
    document.body
  );
}
