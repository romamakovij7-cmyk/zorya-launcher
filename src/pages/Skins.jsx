import {
  Suspense, lazy, useEffect, useMemo, useRef, useState,
} from 'react';
import { SkinViewer, IdleAnimation } from 'skinview3d';
import { useSkinReactions } from '../utils/useSkinReactions.js';
import { attachBreasts } from '../utils/breasts.js';
import { useGenderLook } from '../utils/useGenderLook.js';
import { attachFreshEyes } from '../utils/freshEyes.js';
import { useFreshLook } from '../utils/useFreshLook.js';
import { defaultSkinFor } from '../utils/defaultSkin.js';
import { usePremium, openPremium } from '../utils/usePremium.js';
import { PlusIcon, TrashIcon, WrenchIcon } from '../components/Icons.jsx';
import CustomizeModal from '../components/CustomizeModal.jsx';

const GenderModal = lazy(() => import('../components/GenderModal.jsx'));
const FreshMovesModal = lazy(() => import('../components/FreshMovesModal.jsx'));
const CharacterMenu = lazy(() => import('../components/CharacterMenu.jsx'));
import { detectVariant } from '../utils/skinVariant.js';
import HeartParticles from '../components/HeartParticles.jsx';
import heartFrame from '../assets/hearts/heart_2.png';

// Static (non-interactive, non-rotating) 3D render of a skin for library
// cards — a rendered model instead of the flat unwrapped texture sheet. The
// player is turned ~35° so the render actually reads as 3D (a dead-on front
// view looks almost flat since you can't see any side faces).
// One shared (never shown) renderer draws every thumbnail into a picture: a card used to own a WebGL context of its own, and a library of
// hundreds of skins ran into the browser's limit of live contexts (the oldest ones were dropped and their cards went blank). The pictures
// are cached, rendered one after another and only for cards that are on screen.
const thumbCache = new Map(); // "variant|size|skin" -> data URL of the rendered picture
let thumbViewer = null;
let thumbQueue = Promise.resolve();
const thumbKey = (src, variant, size) => `${variant === 'slim' ? 'slim' : 'default'}|${size}|${src}`;

function renderThumb(src, variant, size) {
  const key = thumbKey(src, variant, size);
  const job = thumbQueue.then(async () => {
    if (thumbCache.has(key)) return thumbCache.get(key);
    if (!thumbViewer || thumbViewer.width !== size) {
      if (thumbViewer) thumbViewer.dispose();
      const canvas = document.createElement('canvas');
      thumbViewer = new SkinViewer({ canvas, width: size, height: size, fov: 35, zoom: 1.45, preserveDrawingBuffer: true });
      thumbViewer.controls.enableRotate = false;
      thumbViewer.controls.enableZoom = false;
      thumbViewer.controls.enablePan = false;
      thumbViewer.playerObject.rotation.y = -22 * Math.PI / 180;
      thumbViewer.playerObject.position.y = -6;
      thumbViewer.renderPaused = true;
    }
    await thumbViewer.loadSkin(src, { model: variant === 'slim' ? 'slim' : 'default' });
    thumbViewer.render();
    const url = thumbViewer.canvas.toDataURL('image/png');
    thumbCache.set(key, url);
    return url;
  });
  thumbQueue = job.catch(() => {}); // a failed skin must not stop the ones behind it
  return job;
}

function SkinThumbnail({ src, variant, size = 240 }) {
  const holderRef = useRef(null);
  const [url, setUrl] = useState(() => (src ? thumbCache.get(thumbKey(src, variant, size)) || null : null));
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = holderRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setVisible(true); return undefined; }
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { setVisible(true); io.disconnect(); } }, { rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!src) { setUrl(null); return undefined; }
    const cached = thumbCache.get(thumbKey(src, variant, size));
    if (cached) { setUrl(cached); return undefined; }
    if (!visible) return undefined;
    let alive = true;
    renderThumb(src, variant, size).then((u) => { if (alive) setUrl(u); }).catch(() => {});
    return () => { alive = false; };
  }, [src, variant, size, visible]);

  return (
    <div ref={holderRef} className="skins-thumb" style={{ width: size, height: size }}>
      {url && <img src={url} width={size} height={size} alt="" draggable={false} />}
    </div>
  );
}


// The outer face of a cape (what is seen from behind): the 10x16 area at (1,1) of the 64x32 layout, cut out of the picture.
// Done with a CSS crop, so it works for HD capes too (the picture is scaled to the 64x32 grid first).
function CapeThumb({ cape, unit = 9 }) {
  return (
    <div
      className="cape-thumb"
      style={{
        width: 10 * unit,
        height: 16 * unit,
        backgroundImage: `url(${cape.url})`,
        backgroundSize: `${64 * unit}px ${32 * unit}px`,
        backgroundPosition: `-${unit}px -${unit}px`,
      }}
    />
  );
}

export default function Skins({ account, onAccountChange, initialView }) {
  const canvasRef = useRef(null);
  const viewerRef = useRef(null);
  const [skins, setSkins] = useState([]);
  const [menuOpen, setMenuOpen] = useState(false); // right click on the character: what to set up
  const [genderOpen, setGenderOpen] = useState(false); // ... Female Gender Mod
  const [freshOpen, setFreshOpen] = useState(false); // ... Fresh Moves
  const [query, setQuery] = useState(''); // search in a big library (no limit on the number of skins)
  const visibleSkins = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? skins.filter((s) => String(s.name || '').toLowerCase().includes(q)) : skins;
  }, [skins, query]);
  const [selected, setSelected] = useState(null); // null = currently active account skin
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState(null);
  const [customizing, setCustomizing] = useState(false);
  // Optimistic local overrides — Mojang's skin/cape API is rate-limited to
  // roughly one change a minute, but the launcher itself shouldn't feel
  // gated by that: clicking updates the preview instantly, and the real
  // sync to the account happens in the background whenever Mojang allows it.
  const [variantOverride, setVariantOverride] = useState(null);
  const [capeOverride, setCapeOverride] = useState(undefined); // undefined = follow account.capes
  // Our own capes (kept on the site, shown in every Eternal player's game): a second tab next to the skin library.
  const [view, setView] = useState(initialView === 'capes' || initialView === 'particles' ? initialView : 'skins'); // 'skins' | 'capes' | 'particles'
  const [capes, setCapes] = useState(null); // null = loading
  const [capesError, setCapesError] = useState(null);
  const [capeBusy, setCapeBusy] = useState(false);

  function load() {
    window.api.skins.list().then(setSkins);
  }

  useEffect(load, []);

  function loadCapes() {
    setCapesError(null);
    window.api.skins.listCapes().then((res) => { if (res.ok) setCapes(res.capes); else setCapesError(res.error); }).catch(() => setCapesError('Couldn\'t get a cloak list.'));
  }
  useEffect(loadCapes, []);

  // Our cape is a Premium thing; "known off" = the site answered and there is no active subscription (the server refuses it as well).
  const premium = usePremium();
  const premiumKnownOff = premium.loaded && premium.ok && !premium.active;
  const customCapeId = account?.customCapeId || null;
  const customCape = capes?.find((c) => c.id === customCapeId) || null;

  async function applyCape(id) {
    setCapeBusy(true);
    setError(null);
    const res = await window.api.skins.setCustomCape(id);
    if (!res?.ok) { setCapeBusy(false); setError(res?.error || 'Failed to choose a cloak'); return; }
    onAccountChange(res.account);
    // The Eternal Cosmetics agent puts our cape over Mojang's in every game, the player's own included, so the licence cape
    // stays on the profile untouched (it is what players without the Eternal launcher keep seeing).
    setCapeBusy(false);
  }

  // Hearts around the player (a Premium thing like the cape); they appear in the game at the next launch.
  const [heartsBusy, setHeartsBusy] = useState(false);
  const heartsOn = !!account?.heartsEnabled;
  async function toggleHearts() {
    if (!account || heartsBusy) return;
    if (!heartsOn && premiumKnownOff) { openPremium(); return; }
    setHeartsBusy(true);
    setError(null);
    const res = await window.api.skins.setHearts(!heartsOn);
    setHeartsBusy(false);
    if (res?.ok) onAccountChange(res.account);
    else if (res?.code === 'premium_required') openPremium();
    else setError(res?.error || 'Failed to save the setting');
  }

  // A cape of the Microsoft account itself (Mojang's): applied to the real profile. Putting one on takes our cape off,
  // otherwise other Eternal players would keep seeing ours. cape = null: no Mojang cape either.
  async function applyMojangCape(cape) {
    setCapeBusy(true);
    setError(null);
    if (customCapeId) {
      const r0 = await window.api.skins.setCustomCape(null);
      if (r0?.ok) onAccountChange(r0.account);
    }
    setCapeOverride(cape || null); // the preview follows at once; Mojang takes its time
    const res = await window.api.skins.setCape(cape ? cape.id : null);
    setCapeBusy(false);
    if (res?.ok) onAccountChange(res.account); else if (!res?.rateLimited) setError(res?.error || 'Failed to choose a cloak');
  }

  useEffect(() => {
    if (!canvasRef.current) return undefined;
    const viewer = new SkinViewer({
      canvas: canvasRef.current,
      width: 600,
      height: 760,
      fov: 55,
      zoom: 0.85,
    });
    // Idle pose — standing still, not spinning or walking in place.
    viewer.animation = new IdleAnimation();
    viewer.controls.enableZoom = false;
    viewer.autoRotate = false;
    viewerRef.current = viewer;
    return () => viewer.dispose();
  }, []);

  const { handleViewerClick } = useSkinReactions(viewerRef, canvasRef);

  // Грудь и пол по настройкам мода Female Gender (of сборки с модом, в которую играли последней)
  const look = useGenderLook(account);
  const breastsRef = useRef(null);
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return undefined;
    const ctrl = attachBreasts(viewer);
    breastsRef.current = ctrl;
    return () => { ctrl.dispose(); breastsRef.current = null; };
  }, []);
  useEffect(() => { breastsRef.current?.update(look); }, [look]);

  // Глаза Fresh Moves, если они нарисованы в скине (см. utils/freshEyes.js)
  const eyesLook = useFreshLook();
  const eyesRef = useRef(null);
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return undefined;
    const ctrl = attachFreshEyes(viewer);
    eyesRef.current = ctrl;
    return () => { ctrl.dispose(); eyesRef.current = null; };
  }, []);
  useEffect(() => { eyesRef.current?.update(eyesLook); }, [eyesLook]);

  const isOffline = account?.type === 'offline';
  // Eternal skins, capes, hearts and nick colour work only on the MAIN offline account (nick = the site nick).
  const notMain = false;
  const wornId = isOffline ? account.offlineSkinId || null : null; // skin the offline account wears in-game
  const selectedSkin = selected
    ? skins.find((s) => s.id === selected)
    : (wornId ? skins.find((s) => s.id === wornId) || null : null);

  const currentVariant = variantOverride || account?.skinVariant;

  // No skin of its own (a new offline account): one of Minecraft's default characters is shown instead of an empty stage.
  const fallbackSkin = !selectedSkin && !account?.skinUrl ? defaultSkinFor(account, skins) : null;
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const url = selectedSkin ? selectedSkin.dataUrl : account?.skinUrl || fallbackSkin?.dataUrl;
    if (!url) return;
    const variant = selectedSkin ? selectedSkin.variant : account?.skinUrl ? currentVariant : fallbackSkin?.variant;
    viewer.loadSkin(url, { model: variant === 'slim' ? 'slim' : 'default' }).catch(() => {
      setError('Could not download the skin texture for preview.');
    });
  }, [selectedSkin, account?.skinUrl, currentVariant, fallbackSkin?.id]);

  const activeCape = capeOverride !== undefined ? capeOverride : ((account?.capes || []).find((c) => c.state === 'ACTIVE') || null);
  const isMicrosoft = account?.type === 'microsoft';
  // "No cloak." is worn when neither our cape nor (for a Microsoft account) a Mojang one is on.
  const noCapeWorn = !customCapeId && !(isMicrosoft && activeCape);

  // Our cape (if the account wears one) is what the others see, so it is what the preview shows; otherwise the Mojang cape.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const url = customCape?.url || activeCape?.url || null;
    if (url) viewer.loadCape(url).catch(() => {});
    else viewer.loadCape(null);
  }, [activeCape, customCape?.url]);

  async function handleAdd() {
    setAdding(true);
    setError(null);
    const res = await window.api.skins.add('classic');
    if (res?.ok) {
      const variant = await detectVariant(res.skin.dataUrl);
      if (variant !== res.skin.variant) {
        await window.api.skins.setVariant(res.skin.id, variant);
      }
      load();
    } else if (res?.error) {
      setError(res.error);
    }
    setAdding(false);
  }

  async function handleToggleVariant(skin, e) {
    e.stopPropagation();
    const next = skin.variant === 'slim' ? 'classic' : 'slim';
    const res = await window.api.skins.setVariant(skin.id, next);
    if (res.ok) load();
  }

  async function handleDelete(id, e) {
    e.stopPropagation();
    if (!confirm('Remove the skin from the library?')) return;
    await window.api.skins.delete(id);
    if (wornId === id) window.api.auth.getAccount().then(onAccountChange);
    if (selected === id) setSelected(null);
    load();
  }

  async function applySkin(id) {
    setError(null);
    const res = await window.api.skins.apply(id);
    if (res.ok) {
      onAccountChange(res.account);
      setVariantOverride(null); // the freshly-applied skin's own variant now applies
    } else if (!res.rateLimited) {
      setError(res.error);
    }
    return res;
  }

  // Offline accounts: the picked skin is injected into the game at launch.
  const [publishNote, setPublishNote] = useState(null); // how putting the skin on the skin server went

  async function wearOffline(id) {
    setError(null);
    setPublishNote(null);
    const res = await window.api.skins.applyOffline(id);
    if (res?.ok) {
      onAccountChange(res.account);
      if (res.publish) setPublishNote(res.publish);
    } else setError(res?.error || 'I couldn\'t pick a skin.');
  }

  async function retryPublish() {
    setPublishNote(null);
    const res = await window.api.skins.publishOffline();
    setPublishNote(res?.publish || { ok: false, error: res?.error || 'It failed.' });
  }

  function handleCardClick(s) {
    setSelected(s.id);
    // Microsoft: uploaded to Mojang. Offline: remembered on the account and
    // injected into the game as a resource pack at the next launch.
    if (account?.type === 'microsoft') applySkin(s.id);
    else if (isOffline) wearOffline(s.id);
  }

  const previewName = selectedSkin ? selectedSkin.name : (account ? account.name : 'No account.');

  return (
    <div className="skins-page">
      <div className="page-header">
        <h1>Skins</h1>
      </div>

      {!account && <div className="hint-text" style={{ marginBottom: 16 }}>Sign in to your Settings account to apply skins to your Microsoft profile.</div>}
      {error && <div className="error-text" style={{ marginBottom: 16 }}>{error}</div>}

      <div className="skins-layout">
        <div className="skins-viewer-card">
          <div className="skins-viewer-stage">
            <canvas
              ref={canvasRef} width={600} height={760} onClick={handleViewerClick}
              onContextMenu={(e) => { e.preventDefault(); if (account) setMenuOpen(true); }}
            />
            {menuOpen && (
              <Suspense fallback={null}>
                <CharacterMenu account={account} onClose={() => setMenuOpen(false)} onPick={(id) => { setMenuOpen(false); if (id === 'gender') setGenderOpen(true); else setFreshOpen(true); }} />
              </Suspense>
            )}
            {genderOpen && (
              <Suspense fallback={null}>
                <GenderModal
                  account={account}
                  skinUrl={selectedSkin ? selectedSkin.dataUrl : account?.skinUrl}
                  skinVariant={selectedSkin ? selectedSkin.variant : currentVariant}
                  onClose={() => setGenderOpen(false)}
                />
              </Suspense>
            )}
            {freshOpen && (
              <Suspense fallback={null}>
                <FreshMovesModal
                  account={account}
                  skinUrl={selectedSkin ? selectedSkin.dataUrl : account?.skinUrl}
                  skinVariant={selectedSkin ? selectedSkin.variant : currentVariant}
                  onClose={() => setFreshOpen(false)}
                />
              </Suspense>
            )}
            {view === 'particles' && heartsOn && <HeartParticles className="skins-hearts" />}
          </div>
          <div className="skins-viewer-label">
            {previewName}
            {selectedSkin && <span className="platform-chip modrinth" style={{ marginLeft: 8 }}>{selectedSkin.variant === 'slim' ? 'Slim' : 'Classic'}</span>}
          </div>
          {selected && selectedSkin && (
            <button className="btn-text" onClick={() => setSelected(null)}>{isOffline ? 'Show equipped skin' : 'Show the current skin'}</button>
          )}
          <button className="btn" onClick={() => { setSelected(null); setCustomizing(true); }}>
            <WrenchIcon width={15} height={15} /> Set up
          </button>
        </div>

        <div className="skins-library">
          <div className="content-toolbar">
            <div className="pill-tabs" style={{ marginBottom: 0 }}>
              <button className={`pill-tab ${view === 'skins' ? 'active' : ''}`} onClick={() => setView('skins')}>Skins</button>
              <button className={`pill-tab ${view === 'capes' ? 'active' : ''}`} onClick={() => setView('capes')}>Capes</button>
              <button className={`pill-tab ${view === 'particles' ? 'active' : ''}`} onClick={() => setView('particles')}>Particles</button>
            </div>
            {view === 'skins' && (
              <>
                <button className="btn" onClick={handleAdd} disabled={adding}>
                  <PlusIcon width={16} height={16} /> {adding ? 'Addition...' : 'Add skin'}
                </button>
                {skins.length > 8 && (
                  <input className="skins-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${skins.length} skins`} />
                )}
                {isOffline && wornId && (
                  <button className="btn" onClick={() => { wearOffline(null); setSelected(null); }}>Remove skin</button>
                )}
              </>
            )}
          </div>

          {view === 'skins' && isOffline && publishNote && (
            publishNote.ok
              ? <p style={{ color: 'var(--success)', fontSize: 13, margin: '0 0 12px' }}>The skin is uploaded to the server.</p>
              : (
                <p className="error-text" style={{ margin: '0 0 12px' }}>
                  The skin is not uploaded to the server: {publishNote.error}{' '}
                  <button className="btn-text" onClick={retryPublish}>Retry</button>
                </p>
              )
          )}

          {view === 'particles' ? (
            <>
              {!account && <div className="hint-text" style={{ marginBottom: 12 }}>Log in to your account to put on particles.</div>}
              <div className="skins-grid">
                <div
                  className={`skins-card ${!heartsOn ? 'active' : ''} ${!account || heartsBusy ? 'disabled' : ''}`}
                  onClick={() => heartsOn && toggleHearts()}
                  title="No particles."
                >
                  {!heartsOn && <span className="skins-worn-badge">Nadeto.</span>}
                  <div className="cape-thumb cape-thumb-none">no</div>
                  <div className="skins-card-name">No particles.</div>
                </div>
                <div
                  className={`skins-card ${heartsOn ? 'active' : ''} ${!account || heartsBusy ? 'disabled' : ''}`}
                  onClick={() => !heartsOn && toggleHearts()}
                  title={premiumKnownOff ? 'Particles available with Premium' : 'Put on hearts.'}
                >
                  {heartsOn && <span className="skins-worn-badge">Nadeto.</span>}
                  {premiumKnownOff && <span className="skins-worn-badge premium-badge">Premium</span>}
                  <div className="particle-preview">
                    <img src={heartFrame} alt="" />
                    <HeartParticles />
                  </div>
                  <div className="skins-card-name">Hearts.</div>
                </div>
              </div>
              <p className="settings-block-hint">
                Hearts appear around you in game on next launch and are visible to players using Eternal launcher. Works on Minecraft 26.1 and newer on NeoForge 1.20.5+ (other versions will not have particles). Hearts Eternal can be seen with Chubrik pictures on everyone who is turned on «Skins, cloaks and jewelry Eternal» (in Settings; of-For this, the hearts from the reproduction of living beings also look like this.
              </p>
            </>
          ) : view === 'capes' ? (
            <>
              {!account && <div className="hint-text" style={{ marginBottom: 12 }}>Sign in to your account to select a cloak.</div>}
              {capesError && <p className="error-text">{capesError}{' '}<button className="btn-text" onClick={loadCapes}>Retry</button></p>}
              {capes === null && !capesError && <div className="progress-label">Loading cloaks...</div>}
              {capes && (
                <div className="skins-grid">
                  <div
                    className={`skins-card ${noCapeWorn ? 'active' : ''} ${!account || capeBusy ? 'disabled' : ''}`}
                    onClick={() => account && !capeBusy && (isMicrosoft && activeCape ? applyMojangCape(null) : applyCape(null))}
                    title="Take off the cloak"
                  >
                    {noCapeWorn && <span className="skins-worn-badge">Nana.</span>}
                    <div className="cape-thumb cape-thumb-none">no</div>
                    <div className="skins-card-name">No cloak.</div>
                  </div>
                  {capes.map((c) => (
                    <div
                      key={c.id}
                      className={`skins-card ${customCapeId === c.id ? 'active' : ''} ${!account || capeBusy ? 'disabled' : ''}`}
                      onClick={() => { if (!account || capeBusy) return; if (premiumKnownOff) openPremium(); else applyCape(c.id); }}
                      title={premiumKnownOff ? 'Cloak available with Premium' : 'Wear this cloak'}
                    >
                      {customCapeId === c.id && <span className="skins-worn-badge">Nana.</span>}
                      {premiumKnownOff && <span className="skins-worn-badge premium-badge">Premium</span>}
                      <CapeThumb cape={c} />
                      <div className="skins-card-name">{c.name}</div>
                    </div>
                  ))}
                </div>
              )}
              {isMicrosoft && (account.capes || []).length > 0 && (
                <>
                  <h3 className="settings-block-label" style={{ margin: '22px 0 8px' }}>License fees</h3>
                  <div className="skins-grid">
                    {account.capes.map((c) => (
                      <div
                        key={c.id}
                        className={`skins-card ${!customCapeId && activeCape?.id === c.id ? 'active' : ''} ${capeBusy ? 'disabled' : ''}`}
                        onClick={() => !capeBusy && applyMojangCape(c)}
                        title="Wear this cloak (it will apply to Microsoft profile)"
                      >
                        {!customCapeId && activeCape?.id === c.id && <span className="skins-worn-badge">Nana.</span>}
                        <CapeThumb cape={c} />
                        <div className="skins-card-name">{c.alias || 'Cape'}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {isMicrosoft && (
                <p className="settings-block-hint">Our capes is seen by players with the Eternal launcher (and you are in your game); the license cloak remains on the profile - it is seen by other players. Turns off in Settings: “Eternal Cloaks on License.”</p>
              )}
            </>
          ) : skins.length === 0 ? (
            <div className="empty-state"><p>The skin library is empty. Add the skin PNG file (64×64) – the Classic/Slim mode will be determined automatically.</p></div>
          ) : (
            <div className="skins-grid">
              {visibleSkins.map((s) => (
                <div
                  key={s.id}
                  className={`skins-card ${selected === s.id ? 'active' : ''} ${!account ? 'disabled' : ''}`}
                  onClick={() => account && handleCardClick(s)}
                  title={
                    !account ? 'Sign in to your account to work with skins'
                      : account.type === 'microsoft' ? 'Click to apply this skin'
                        : 'Click to wear this skin (applicable the next instance start)'
                  }
                >
                  {wornId === s.id && <span className="skins-worn-badge">Nana.</span>}
                  <SkinThumbnail src={s.dataUrl} variant={s.variant} size={240} />
                  <div className="skins-card-name">{s.name}</div>
                  <button className="skins-variant-toggle" onClick={(e) => handleToggleVariant(s, e)} title="Switch to Classic/Slim">
                    {s.variant === 'slim' ? 'Slim' : 'Classic'}
                  </button>
                  <button className="icon-btn danger skins-card-delete" onClick={(e) => handleDelete(s.id, e)}>
                    <TrashIcon width={14} height={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {customizing && (
        <CustomizeModal
          account={account}
          previewVariant={currentVariant}
          onPreviewVariant={setVariantOverride}
          activeCapeId={activeCape?.id || null}
          onCapeOverride={setCapeOverride}
          onClose={() => setCustomizing(false)}
          onAccountChange={onAccountChange}
          onApplySkin={applySkin}
          onSkinAdded={load}
        />
      )}
    </div>
  );
}
