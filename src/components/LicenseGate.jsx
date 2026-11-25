// The launcher works for every account of the site (no subscription needed; Premium only adds perks): until the site has
// confirmed the sign-in (a signed, offline-checkable license — see electron/mc/license.js), only this sign-in screen is shown
// and the app itself isn't even mounted. The main process refuses every other call as well.
// Two ways in: login + password, or Telegram (for accounts made through Telegram, which may have no password).
import { useCallback, useEffect, useRef, useState } from 'react';
import logo from '../assets/logo.png';
import LoadingScreen from './LoadingScreen.jsx';
import { resetPremium } from '../utils/usePremium.js';

const REASONS = {
  expired: 'Your license has expired - log in again to renew it.',
  device: 'The license was issued for another computer - log in again.',
  clock: 'The system time is backwards - correct it and log in again.',
  invalid: 'The license is damaged - please log in again.',
};
const SITE = 'https://aestmc.ru';
const TG_POLL_MS = 2500; // the site allows 600 status requests per 10 minutes from one address: this uses ~240

const TgIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21.5 3.3 2.8 10.6c-.9.4-.9 1.1-.2 1.3l4.7 1.5 1.8 5.5c.2.6.4.8.8.8.4 0 .6-.2.9-.4l2.2-2.1 4.6 3.4c.8.5 1.5.2 1.7-.8L22.8 4.8c.3-1.2-.4-1.7-1.3-1.5Zm-3 3.6-8.3 7.5-.3 3.4-1.4-4.5 10-6.4Z" /></svg>
);

// What the Telegram panel says in each phase (phase: starting | wait | asked | finishing | unknown | denied | expired | error)
function TelegramPanel({ tg, onOpen, onCancel, onSite }) {
  const text = {
    wait: 'Open the bot in Telegram and click “Launch”. The launcher will log in by itself as soon as you confirm your login.',
    asked: 'The bot asks if it\'s you. Click "Yes, it\'s me" in Telegram.',
    finishing: 'Confirmed, let\'s go...',
    unknown: 'The site account is not linked to this Telegram. Register on the site via Telegram, then log in here.',
    denied: 'Login canceled in Telegram. If this was you, try again.',
    expired: 'Confirmation time has expired. Try again.',
    error: tg.message || 'Failed to login via Telegram.',
  }[tg.phase];
  const waiting = tg.phase === 'wait' || tg.phase === 'asked';
  return (
    <div className="license-tg-panel" role="status">
      <p>{text}</p>
      <div className="license-tg-actions">
        {waiting && <button type="button" className="btn" onClick={onOpen}>Open Telegram</button>}
        {tg.phase === 'unknown' && <button type="button" className="btn" onClick={onSite}>Open сайт</button>}
        {tg.phase !== 'finishing' && <button type="button" className="btn-text" onClick={onCancel}>{waiting ? 'Cancel' : 'Back'}</button>}
      </div>
    </div>
  );
}

export default function LicenseGate({ children }) {
  const [status, setStatus] = useState(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [tg, setTg] = useState(null); // null | { phase, code?, link?, until?, message? }
  const tgGen = useRef(0); // bumped on cancel / restart: answers of an older attempt are thrown away

  useEffect(() => {
    let alive = true;
    window.api.license.status().then((s) => { if (alive) setStatus(s); }).catch(() => { if (alive) setStatus({ valid: false, reason: 'none' }); });
    const off = window.api.license.onChanged((s) => { if (alive) setStatus(s); });
    return () => { alive = false; off?.(); };
  }, []);

  // a different site account (or none) -> the subscription/nick state is read again for it
  const who = status && status.valid ? status.username || '' : '';
  useEffect(() => { if (who) resetPremium(); }, [who]);

  const submit = useCallback(async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await window.api.license.login(username, password);
      if (res?.ok) { setPassword(''); setStatus(res); } else setError(res?.error || 'Failed войти.');
    } catch {
      setError('Failed to contact the launcher. Restart it.');
    } finally {
      setBusy(false);
    }
  }, [busy, username, password]);

  async function startTelegram() {
    if (busy || tg) return;
    const gen = ++tgGen.current;
    setError('');
    setTg({ phase: 'starting' });
    let r;
    try { r = await window.api.license.tgStart(); } catch { r = null; }
    if (gen !== tgGen.current) return;
    if (!r?.ok) { setTg(null); setError(r?.error || 'Failed to start logging in via Telegram.'); return; }
    setTg({ phase: 'wait', code: r.code, link: r.link, until: Date.now() + r.expiresInSec * 1000 });
    window.api.shell?.openExternal?.(r.link); // the bot opens at once, as a click on a Telegram link would do
  }

  function cancelTelegram() { tgGen.current += 1; setTg(null); }

  // While the bot is waiting for the answer: ask the site what it says, and finish the sign-in when the answer is "yes"
  const phase = tg ? tg.phase : null;
  const code = tg ? tg.code : null;
  useEffect(() => {
    if (phase !== 'wait' && phase !== 'asked') return undefined;
    const gen = tgGen.current;
    let stopped = false;
    const tick = async () => {
      if (stopped || gen !== tgGen.current) return;
      if (tg.until && Date.now() > tg.until) { setTg({ phase: 'expired' }); return; }
      let r;
      try { r = await window.api.license.tgStatus(code); } catch { return; }
      if (stopped || gen !== tgGen.current || !r) return;
      if (!r.ok) { if (r.code === 'telegram_off') setTg({ phase: 'error', message: r.error }); return; } // a network hiccup: next tick
      const st = r.status;
      if (st === 'asked') setTg((p) => (p && p.phase === 'wait' ? { ...p, phase: 'asked' } : p));
      else if (st === 'confirmed') {
        setTg((p) => (p ? { ...p, phase: 'finishing' } : p));
        let f;
        try { f = await window.api.license.tgFinish(code); } catch { f = null; }
        if (gen !== tgGen.current) return;
        if (f?.ok) { setTg(null); setStatus(f); } else setTg({ phase: 'error', message: f?.error || 'Failed to complete login.' });
      } else if (st === 'unknown') setTg({ phase: 'unknown' });
      else if (st === 'denied') setTg({ phase: 'denied' });
      else if (st === 'expired') setTg({ phase: 'expired' });
      else if (st === 'used' || st === 'taken' || st === 'linked') setTg({ phase: 'error', message: 'This request has already been used. Start logging in again.' });
    };
    const id = setInterval(tick, TG_POLL_MS);
    tick();
    return () => { stopped = true; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, code]);

  if (!status) return <LoadingScreen />;
  if (status.valid) return children;

  const openSite = () => window.api.shell?.openExternal?.(SITE);

  return (
    <div className="license-gate">
      <div className="license-bar">
        <button type="button" onClick={() => window.api.window.minimize()} title="Collapse">—</button>
        <button type="button" className="close-btn" onClick={() => window.api.window.close()} title="Close">✕</button>
      </div>
      <form className="license-card" onSubmit={submit}>
        <img className="license-logo" src={logo} alt="" draggable={false} />
        <h1 className="license-title">Zorya Launcher</h1>
        <p className="license-lead">
          Войдите аккаунтом с сайта.
        </p>
        {REASONS[status.reason] && !error && <p className="license-note">{REASONS[status.reason]}</p>}
        <label className="field">
          <span>Логин на сайте</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" maxLength={64} autoFocus spellCheck={false} />
        </label>
        <label className="field">
          <span>Пароль</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" maxLength={128} />
        </label>
        {error && <div className="error-text" role="alert">{error}</div>}
        <button type="submit" className="btn btn-primary license-submit" disabled={busy || !username.trim() || !password}>
          {busy ? 'Let\'s check...' : 'Sign in'}
        </button>
        <div className="license-or"><span>или</span></div>
        {tg && tg.phase !== 'starting' ? (
          <TelegramPanel tg={tg} onOpen={() => window.api.shell?.openExternal?.(tg.link)} onCancel={cancelTelegram} onSite={openSite} />
        ) : (
          <button type="button" className="btn license-tg" onClick={startTelegram} disabled={busy || !!tg}>
            <TgIcon /> {tg ? 'Opening the bot...' : 'Sign in via Telegram'}
          </button>
        )}
        <p className="license-foot">
          No аккаунта? Зарегистрируйтесь на{' '}
          <a href={SITE} onClick={(e) => { e.preventDefault(); openSite(); }}>aestmc.ru</a> (можно через Telegram).
        </p>
      </form>
    </div>
  );
}
