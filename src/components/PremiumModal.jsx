// Окно Premium. Открывается звездой (PremiumButton) или of любого места через openPremium().
// Показывает разное:
//   подписки нет  → «What the Premium gives» (что открывает подписка, кнопки на Boosty и «I have a key»)
//   подписка есть → «Your premium» (статус, настройка цвета ника, что у тебя открыто) — без рекламы
//   статус не получен → короткое сообщение и «Repeat»
import { useEffect, useMemo, useState } from 'react';
import {
  usePremium, usePremiumModal, closePremium, refreshPremium, chooseNickColor, nickStyle,
} from '../utils/usePremium.js';
import { CloseIcon, CheckIcon } from './Icons.jsx';
import PremiumCape from './PremiumCape.jsx';
import AccountFace from './AccountFace.jsx';
import SkinFace from './SkinFace.jsx';
import { SUPPORTERS } from '../utils/authors.js';
import skinsPng from '../assets/pixel/skins.png';
import libraryPng from '../assets/pixel/library.png';
import capesPng from '../assets/pixel/capes.png';

const SITE = 'https://aestmc.ru';
const BOOSTY = 'https://boosty.to/miha1ych';

const dateRu = (iso) => { try { return new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' }); } catch { return ''; } };
const open = (url) => window.api.shell.openExternal(url);
const goTo = (page, params) => { closePremium(); window.dispatchEvent(new CustomEvent('eternal:navigate', { detail: { page, params } })); };
const gradient = (c) => `linear-gradient(135deg, ${(c.stops.length === 1 ? [c.stops[0], c.stops[0]] : c.stops).join(', ')})`;

// Искры — копия addSparks() с сайта (js/fx.js): те же 10 штук, размеры, время, разброс и подъём 200px
const rnd = (a, b) => a + Math.random() * (b - a);
function Sparks({ n = 10, rise = 200 }) {
  const list = useMemo(() => Array.from({ length: n }, () => ({
    '--x': `${rnd(4, 96).toFixed(1)}%`, '--s': `${rnd(3, 6).toFixed(1)}px`, '--t': `${rnd(2.8, 5.2).toFixed(2)}s`,
    '--d': `${(-rnd(0, 5)).toFixed(2)}s`, '--dx': `${rnd(-26, 26).toFixed(0)}px`,
  })), [n]);
  return <span className="pm-sparks" style={{ '--rise': `${rise}px` }} aria-hidden="true">{list.map((s, i) => <i key={i} style={s} />)}</span>;
}

function Perk({ icon, title, children, tone = 'gold', tall = false, sparks = false }) {
  return (
    <div className={`pm-perk ${tone} ${tall ? 'tall' : ''}`}>
      {sparks && <Sparks />}
      <div className="pm-perk-art">{icon}</div>
      <div className="pm-perk-title">{title}</div>
      {children && <div className="pm-perk-text">{children}</div>}
    </div>
  );
}

// Голова игрока и его ник — так он будет выглядеть в списке «Supporters»
function SupporterPreview({ p, account }) {
  const name = account?.name;
  if (!name) return <span className="pm-heart">♥</span>;
  const color = (p.active && p.nickColor) || 'aurora';
  return (
    <span className="pm-sup">
      <span className="pm-sup-face"><AccountFace account={account} size={44} iconSize={26} /></span>
      <span className="pm-sup-name" style={nickStyle(p.colors, color)}>{name}</span>
    </span>
  );
}

// Шаг «как получить»: кружок с номером, заголовок и пояснение
function Step({ n, title, children }) {
  return (
    <div className="pm-step">
      <span className="pm-step-n">{n}</span>
      <span><b>{title}</b><i>{children}</i></span>
    </div>
  );
}

// ---------- подписки нет: что она даёт и как её получить ----------
// Лаунчер бесплатный для всех аккаунтов сайта; Премиум — это украшения и поддержка проекта, об этом и первая строка.
function PremiumAd({ p, account }) {
  return (
    <>
      <div className="pm-eyebrow">PREMIUM</div>
      <h2 className="pm-title">Eternal Premium</h2>
      <div className="pm-status"><span>The launcher is free. Premium adds jewelry and supports the project</span></div>

      <div className="pm-section-label">What Opens in the Game and Launcher</div>
      <div className="pm-grid">
        <Perk tone="rose" icon={<PremiumCape />} title="Our capes" tall sparks>
          Eternal branded cloak: it is seen by all launcher players, on license and without.
        </Perk>
        <Perk tone="rose" icon={<span className="pm-heart">♥</span>} title="Particles" sparks>
          Hearts around you in play. Eternal launcher (Minecraft 26.1+ and NeoForge 1.20.5+)
        </Perk>
        <Perk tone="gold" icon={<span className="pm-nick" style={nickStyle(p.colors, 'aurora') || nickStyle(p.colors, p.colors[0]?.id)}>{account?.name || 'Nickname'}</span>} title="Nick's color">
          Your gradient for Nick in the launcher, on the site and in the game.
        </Perk>
      </div>

      <div className="pm-actions" style={{ marginTop: 22 }}>
        <button className="pm-cta" onClick={() => open(BOOSTY)}>Receive Premium</button>
        <button className="pm-ghost" onClick={() => open(`${SITE}/account.html`)}>I have a key.</button>
      </div>

      <div className="pm-section-label">How to get</div>
      <div className="pm-steps">
        <Step n="1" title="Subscription to Boosty">Get a Premium from the author.</Step>
        <Step n="2" title="Key key">After payment, they'll send you the key.</Step>
        <Step n="3" title="Enter the key on the site.">In my office. Premium will be here as soon as you get back to the launcher.</Step>
      </div>
      <div className="pm-foot">The launcher does not become paid for this: without a Premium, everything else remains in it.</div>

      {SUPPORTERS.length > 0 && (
        <>
          <div className="pm-section-label">You're on the support list.</div>
          <div className="pm-supporters">
            {SUPPORTERS.map((s, i) => (
              <div className="author" key={`${s.name}:${i}`} data-name={s.name || undefined}>
                <SkinFace src={s.skin} size={46} className="author-head" />
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

// ---------- подписка есть: настройки ----------
function PremiumPanel({ p }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const forever = p.expiresAt && new Date(p.expiresAt).getFullYear() >= 9000;

  async function pick(id) {
    if (busy) return;
    setBusy(id || 'none'); setError(null);
    const r = await chooseNickColor(id);
    setBusy(null);
    if (!r?.ok) setError(r?.error || 'I couldn\'t choose the color.');
  }

  return (
    <>
      <div className="pm-eyebrow">PREMIUM</div>
      <h2 className="pm-title">Your premium.</h2>
      <div className="pm-status on">
        <CheckIcon width={15} height={15} />
        {forever ? 'Subscription is active forever' : `Subscription active${p.expiresAt ? ` to ${dateRu(p.expiresAt)}` : ''}`}
      </div>

      <div className="pm-section-label">Nick's color</div>
      <div className="pm-sample"><span className="pm-sample-name" style={nickStyle(p.colors, p.nickColor)}>{p.username || 'Your nickname.'}</span></div>
      <div className="pm-swatches">
        <button className={`pm-swatch none ${!p.nickColor ? 'active' : ''}`} onClick={() => pick(null)} disabled={!!busy} title="No color.">no</button>
        {p.colors.map((c) => (
          <button
            key={c.id}
            className={`pm-swatch ${p.nickColor === c.id ? 'active' : ''}`}
            style={{ background: gradient(c) }}
            onClick={() => pick(c.id)}
            disabled={!!busy}
            title={c.name}
            aria-label={c.name}
          />
        ))}
      </div>
      <div className="pm-note">The color is visible in the launcher, on the site and in the game (overhead and in the player list on the Tab) for players with the launcher Eternal – on Minecraft 26.1+ and NeoForge 1.20.5+. It will be used at the next start of the game.</div>
      {error && <div className="error-text" style={{ textAlign: 'center', marginTop: 8 }}>{error}</div>}

      <div className="pm-section-label">What's open to you?</div>
      <div className="pm-rows">
        <button className="pm-row" onClick={() => goTo('skins', { view: 'capes' })}>
          <img src={capesPng} alt="" className="pm-row-icon" />
          <span className="pm-row-body"><b>Our capes</b><i>Choose an Eternal cloak</i></span>
          <span className="pm-row-go">→</span>
        </button>
        <button className="pm-row" onClick={() => goTo('skins', { view: 'particles' })}>
          <span className="pm-row-icon heart">♥</span>
          <span className="pm-row-body"><b>Heart particles</b><i>Insert on the skins page</i></span>
          <span className="pm-row-go">→</span>
        </button>
        <div className="pm-row static">
          <span className="pm-row-icon heart">★</span>
          <span className="pm-row-body"><b>Support the launcher.</b><i>You're on the \"Authors\" list in settings</i></span>
        </div>
        <button className="pm-row" onClick={() => open(`${SITE}/skins.html`)}>
          <img src={skinsPng} alt="" className="pm-row-icon" />
          <span className="pm-row-body"><b>Skin suits</b><i>On the website</i></span>
          <span className="pm-row-go">↗</span>
        </button>
        <button className="pm-row" onClick={() => open(`${SITE}/builds.html`)}>
          <img src={libraryPng} alt="" className="pm-row-icon" />
          <span className="pm-row-body"><b>Instance Mihalych</b><i>Access to the site</i></span>
          <span className="pm-row-go">↗</span>
        </button>
      </div>

      <div className="pm-actions">
        <button className="pm-ghost" onClick={() => open(BOOSTY)}>Extend to Boosty</button>
      </div>
    </>
  );
}

export default function PremiumModal({ account = null }) {
  const isOpen = usePremiumModal();
  const p = usePremium();

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') closePremium(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen]);

  if (!isOpen) return null;

  let body;
  if (!p.loaded) body = <div className="pm-wait">Checking the subscription...</div>;
  else if (!p.ok) {
    body = (
      <div className="pm-wait">
        <div className="pm-eyebrow">PREMIUM</div>
        <h2 className="pm-title">Could not verify the subscription</h2>
        <div className="error-text" style={{ margin: '4px 0 18px' }}>{p.error}</div>
        <button className="pm-ghost" onClick={refreshPremium}>Retry</button>
      </div>
    );
  } else body = p.active ? <PremiumPanel p={p} /> : <PremiumAd p={p} account={account} />;

  return (
    <div className="pm-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) closePremium(); }}>
      <div className={`pm-card ${p.loaded && p.ok && p.active ? 'compact' : ''}`} role="dialog" aria-label="Premium">
        <button className="pm-close" onClick={closePremium} title="Close"><CloseIcon width={18} height={18} /></button>
        {body}
      </div>
    </div>
  );
}
