import { useEffect, useState } from 'react';
import { usePremium, refreshPremium } from '../utils/usePremium.js';

// Оффлайн-аккаунтов до 5 (основной тоже считается). Main — с ником в игре с сайта: только на нём работают скины, плащи,
// сердечки и цвет ника Zorya. Остальные — обычные оффлайн-аккаунты с любым ником, без систем Zorya.
// Число 5 живёт в electron/mc/limits.js; здесь оно приходит в ответе сервера не отдельно, поэтому дублируется как подсказка.
export const OFFLINE_LIMIT = 5;

export default function OfflineAddForm({ onAdded, onCancel }) {
  const premium = usePremium(); // premium.nick — ник с сайта
  const [accounts, setAccounts] = useState(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { refreshPremium(); }, []); // ник на сайте мог поменяться
  const load = () => window.api.auth.listAccounts().then((r) => setAccounts(r.accounts || []));
  useEffect(() => { load(); }, []);

  const offline = (accounts || []).filter((a) => a.type === 'offline');
  const full = offline.length >= OFFLINE_LIMIT;
  const mainExists = !!premium.nick && offline.some((a) => a.name === premium.nick);

  async function add(typed) {
    setBusy(true);
    setError(null);
    const res = await window.api.auth.loginOffline(typed);
    setBusy(false);
    if (res?.ok) {
      setName('');
      await load();
      onAdded?.(res.account);
    } else {
      setError(res?.error || 'Failed добавить аккаунт');
    }
  }

  const typed = name.trim();
  const typedIsMain = !!premium.nick && typed.toLowerCase() === premium.nick.toLowerCase();

  return (
    <div className="offline-add" style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'stretch' }}>
      <div className="hint-text" style={{ marginTop: 0 }}>
        Оффлайн-аккаунтов: <b>{accounts ? offline.length : '…'} из {OFFLINE_LIMIT}</b> (основной тоже считается).
      </div>

      <div className="offline-add-block">
        <div className="settings-row-label" style={{ fontSize: 13 }}>Main аккаунт</div>
        {!premium.loaded ? (
          <div className="hint-text">Loading…</div>
        ) : premium.nick ? (
          <>
            <div className="hint-text">Nickname с сайта: <b>{premium.nick}</b>. Только на нём работают скины, плащи, сердечки и цвет ника Zorya.</div>
            <button className="btn btn-primary" style={{ marginTop: 6, alignSelf: 'flex-start' }} onClick={() => add('')} disabled={busy || mainExists || (full && !mainExists)}>
              {mainExists ? 'Уже добавлен' : 'Add основной'}
            </button>
          </>
        ) : (
          <div className="hint-text">
            {premium.signedIn === false
              ? 'Чтобы добавить основной аккаунт, войдите в аккаунт Zorya (Settings → Account Zorya): ник берётся с сайта.'
              : 'Nickname в игре ещё не задан. Задайте его на сайте (страница аккаунта, 3–16 латинских букв, цифр и _), потом вернитесь сюда.'}
          </div>
        )}
      </div>

      <div className="offline-add-block">
        <div className="settings-row-label" style={{ fontSize: 13 }}>Ещё один оффлайн-аккаунт</div>
        <div className="hint-text">Любой ник до 16 символов. Это обычный оффлайн-аккаунт: <b>скины, плащи и сердечки Zorya на нём не работают</b> — они только у основного.</div>
        <div className="account-switcher-add-form" style={{ marginTop: 6 }}>
          <input
            value={name}
            maxLength={16}
            placeholder="Nickname"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && typed && !busy && !full) add(typed); }}
          />
          <button className="btn btn-primary" onClick={() => add(typed)} disabled={busy || !typed || full}>
            Add
          </button>
        </div>
        {typedIsMain && <div className="hint-text">Это ваш ник с сайта — аккаунт будет основным.</div>}
        {full && <div className="hint-text">Достигнут предел: {OFFLINE_LIMIT} оффлайн-аккаунтов. Уберите ненужный, чтобы добавить новый.</div>}
      </div>

      {error && <div className="error-text" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{error}</div>}
      {onCancel && <button className="btn" onClick={onCancel}>Назад</button>}
    </div>
  );
}
