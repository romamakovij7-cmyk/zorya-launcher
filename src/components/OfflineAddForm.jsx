import { useEffect, useState } from 'react';
import { usePremium, refreshPremium } from '../utils/usePremium.js';

// Offline accountов до 5 (Major is also considered). Main — с ником в игре с сайта: только на нём работают скины, плащи,
// сердечки и цвет ника Eternal. Остальные — обычные оффлайн-аккаунты с любым ником, без систем Eternal.
// Число 5 живёт в electron/mc/limits.js; здесь оно приходит в ответе сервера не отдельно, поэтому дублируется как подсказка.
export const OFFLINE_LIMIT = 5;

export default function OfflineAddForm({ onAdded, onCancel }) {
  const premium = usePremium(); // premium.nick — site-nick
  const [accounts, setAccounts] = useState(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { refreshPremium(); }, []); // The name on the site might have changed.
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
      setError(res?.error || 'I was unable to add an account.');
    }
  }

  const typed = name.trim();
  const typedIsMain = !!premium.nick && typed.toLowerCase() === premium.nick.toLowerCase();

  return (
    <div className="offline-add" style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'stretch' }}>
      <div className="hint-text" style={{ marginTop: 0 }}>
        Offline accounts: <b>{accounts ? offline.length : '…'} from {OFFLINE_LIMIT}</b> (Major is also considered).
      </div>

      <div className="offline-add-block">
        <div className="settings-row-label" style={{ fontSize: 13 }}>Main account</div>
        {!premium.loaded ? (
          <div className="hint-text">Loading...</div>
        ) : premium.nick ? (
          <>
            <div className="hint-text">Nick from the site: <b>{premium.nick}</b>. Only on it work skins, capes, hearts and the color of the nickname Eternal.</div>
            <button className="btn btn-primary" style={{ marginTop: 6, alignSelf: 'flex-start' }} onClick={() => add('')} disabled={busy || mainExists || (full && !mainExists)}>
              {mainExists ? 'Already added.' : 'Add the main'}
            </button>
          </>
        ) : (
          <div className="hint-text">
            {premium.signedIn === false
              ? 'To add a primary account, log in to your Eternal account (Settings → Eternal Account): the nickname is taken from the site.'
              : 'Nick\'s not in the game yet. Ask it on the site (account page, 3-16 Latin letters, numbers, and  ), then return here.'}
          </div>
        )}
      </div>

      <div className="offline-add-block">
        <div className="settings-row-label" style={{ fontSize: 13 }}>Another offline account</div>
        <div className="hint-text">Any nickname up to 16 characters. This is a regular offline account: <b>Eternal skins, cloaks and hearts do not work on it</b> - they're just the main one.</div>
        <div className="account-switcher-add-form" style={{ marginTop: 6 }}>
          <input
            value={name}
            maxLength={16}
            placeholder="Nick."
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && typed && !busy && !full) add(typed); }}
          />
          <button className="btn btn-primary" onClick={() => add(typed)} disabled={busy || !typed || full}>
            Add
          </button>
        </div>
        {typedIsMain && <div className="hint-text">This is your nickname from the site - the account will be the main one.</div>}
        {full && <div className="hint-text">The limit is reached: {OFFLINE_LIMIT} Offline accounts. Remove the unnecessary to add a new one.</div>}
      </div>

      {error && <div className="error-text" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{error}</div>}
      {onCancel && <button className="btn" onClick={onCancel}>Back.</button>}
    </div>
  );
}
