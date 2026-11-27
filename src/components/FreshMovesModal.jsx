import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SkinViewer, IdleAnimation } from 'skinview3d';
import { CloseIcon } from './Icons.jsx';
import { attachFreshEyes } from '../utils/freshEyes.js';
import { saveFreshLook, useFreshLook } from '../utils/useFreshLook.js';

// Fresh Moves (правый клик по персонажу → «Fresh Moves»): глаза скина и установка пака в сборки.
// Глаза рисует скин: в свободных углах его текстуры лежат пиксели белка, зрачка, бровей, а пак вместе с модами Entity Model Features и
// Entity Texture Features превращает их в объёмные глаза с морганием. Здесь: показать, что скин их несёт (и как они выглядят на персонаже
// в лаунчере), и поставить в сборки всё, что нужно в игре (electron/mc/freshMoves.js).
const BASE_Y = -10; // the camera looks at the middle of the figure: this puts the head into that spot

function Preview({ skinUrl, skinVariant, look, onInfo }) {
  const canvasRef = useRef(null);
  const viewerRef = useRef(null);
  const eyesRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current) return undefined;
    const viewer = new SkinViewer({ canvas: canvasRef.current, width: 240, height: 300, fov: 40, zoom: 2.2 });
    viewer.animation = new IdleAnimation();
    viewer.controls.enableZoom = false;
    viewer.controls.enablePan = false;
    viewer.autoRotate = false;
    viewer.playerObject.position.y = BASE_Y;
    viewer.playerObject.rotation.y = -0.35;
    viewerRef.current = viewer;
    const eyes = attachFreshEyes(viewer, { onInfo });
    eyesRef.current = eyes;
    return () => { eyes.dispose(); eyesRef.current = null; viewer.dispose(); viewerRef.current = null; };
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !skinUrl) return;
    viewer.loadSkin(skinUrl, { model: skinVariant === 'slim' ? 'slim' : 'default' }).catch(() => {});
  }, [skinUrl, skinVariant]);

  useEffect(() => { eyesRef.current?.update(look); }, [look]);

  return <canvas ref={canvasRef} width={240} height={300} className="gender-preview fm-preview" title="Pull to turn." />;
}

const Chip = ({ ok, children }) => <span className={`fm-chip ${ok === true ? 'ok' : ok === 'off' ? 'off' : 'bad'}`}>{children}</span>;

export default function FreshMovesModal({ account, skinUrl, skinVariant, onClose }) {
  const look = useFreshLook();
  const [info, setInfo] = useState(null); // eyes found in the skin (from the preview)
  const [data, setData] = useState(null); // { instances }
  const [picked, setPicked] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null); // { ok, text }

  // Nothing is ticked at first: Fresh Moves goes only into the builds the player picks here and confirms with the button
  const load = () => window.api.freshMoves.status().then((r) => {
    setData({ instances: r?.ok ? r.instances : [] });
  }).catch(() => setData({ instances: [] }));

  useEffect(() => { load(); }, []);

  const toggle = (id) => setPicked((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  async function apply(enable) {
    if (!picked.size) return;
    setBusy(true); setMessage(null);
    try {
      const res = await window.api.freshMoves.apply([...picked], enable);
      const lines = (res?.results || []).map((r) => (r.ok
        ? `${r.name}: ${enable ? (r.steps?.length ? `ready (${r.steps.join(', ')})` : 'It was over.') : 'pack off'}`
        : `${r.name || ''}: ${r.error}`));
      setMessage({ ok: !!res?.ok, text: lines.join('\n') || (res?.error || 'Failed to apply') });
      // Switched on here on purpose: the character in the launcher shows the eyes too (it can be turned off below)
      if (enable && res?.ok) saveFreshLook({ enabled: true });
      await load();
    } catch (e) {
      setMessage({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  }

  const list = data?.instances || [];
  const usable = list.filter((i) => i.supported);

  return createPortal((
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal gender-modal" onClick={(e) => e.stopPropagation()}>
        <div className="customize-modal-header">
          <h2>Fresh Moves</h2>
          <button className="icon-btn" onClick={onClose}><CloseIcon /></button>
        </div>
        <p className="hint-text gender-sub">Animated eyes, eyebrows and character movements {account ? account.name : ''}. The game features Fresh Moves with Entity Model Features and Entity Texture Features.</p>

        {!account && <div className="hint-text">Sign in to your account to set up.</div>}
        {account && (
          <div className="gender-layout">
            <div className="gender-preview-col">
              <Preview skinUrl={skinUrl} skinVariant={skinVariant} look={look} onInfo={setInfo} />
              <div className="gender-preview-label">{info?.present ? 'There are eyes in the skin.' : 'No eye in the skin.'}</div>
            </div>

            <div className="gender-body">
              <div className="gender-section" style={{ marginTop: 0 }}>
                <div className="gender-section-title">Eyes in the skin</div>
                {info === null && <div className="progress-label">Watch the skin...</div>}
                {info && info.present && (
                  <div className="hint-text">
                    Found: {info.variants.length > 1 ? `variant ${info.variants.join(', ')}` : `variant ${info.variants[0]}`}
                    {info.brows ? 'eyebrows' : ''}{info.extras ? 'eyelashes' : ''}. These are only pixels in the skin: to make them eyes in the game, put the pack and mods in the instance (below).
                  </div>
                )}
                {info && !info.present && (
                  <div className="hint-text">
                    This skin does not have Fresh Moves eye pixels: they are drawn in free texture angles (0–8, 24–40 and 56–64 horizontally, top 8 lines).
                    And a pack without them doesn’t add anything. A skin with ready-made eyes can be selected on the “Skins” page.
                  </div>
                )}
                <div className="gender-row">
                  <div className="gender-row-label">Showing eyes on the character in the launcher<small>Just the picture here; it doesn't affect the game.</small></div>
                  <input type="checkbox" className="switch" checked={look.enabled} onChange={(e) => saveFreshLook({ enabled: e.target.checked })} />
                </div>
                <div className={`gender-row ${look.enabled ? '' : 'dim'}`}>
                  <div className="gender-row-label">morgania<small>The eyes on the character sometimes close.</small></div>
                  <input type="checkbox" className="switch" checked={look.blink} disabled={!look.enabled} onChange={(e) => saveFreshLook({ blink: e.target.checked })} />
                </div>
              </div>

              <div className="gender-section">
                <div className="gender-section-title">At play.</div>
                <div className="hint-text">The launcher Fresh Moves does not put in any instances: pack and mods fall only in those instances that you mark below and confirm with a button.</div>

                {data === null && <div className="progress-label">Watching instances...</div>}
                {data && usable.length === 0 && <div className="hint-text" style={{ marginTop: 10 }}>There are no instances with Fabric, Quilt, Forge or NeoForge: Entity Model/Texture Features mods only work for them.</div>}
                {usable.length > 0 && (
                  <>
                    <div className="gender-targets fm-list">
                      {usable.map((i) => (
                        <label className="gender-target fm-item" key={i.id}>
                          <input type="checkbox" checked={picked.has(i.id)} onChange={() => toggle(i.id)} />
                          <span className="fm-name">{i.name} <small>{i.mcVersion} · {i.loader}</small></span>
                          <span className="fm-chips">
                            <Chip ok={!!i.emf}>{i.emf ? 'EMF ✓' : 'EMF ✕'}</Chip>
                            <Chip ok={!!i.etf}>{i.etf ? 'ETF ✓' : 'ETF ✕'}</Chip>
                            <Chip ok={i.pack ? (i.packEnabled ? true : 'off') : false}>{i.pack ? (i.packEnabled ? 'Puck ✓' : 'Puck is off.') : 'No Pak.'}</Chip>
                          </span>
                        </label>
                      ))}
                    </div>
                    <div className="fm-actions">
                      <button className="btn btn-primary" disabled={busy || !picked.size} onClick={() => apply(true)}>{busy ? 'Working.' : `Install and enable${picked.size ? ` (${picked.size})` : ''}`}</button>
                      <button className="btn" disabled={busy || !picked.size} onClick={() => apply(false)}>Turn off the pack.</button>
                    </div>
                  </>
                )}
                {message && <div className={message.ok ? 'hint-text gender-msg ok' : 'error-text gender-msg'} style={{ whiteSpace: 'pre-wrap' }}>{message.text}</div>}
                <div className="hint-text" style={{ marginTop: 12 }}>
                  On the character in the launcher, the eyes are still (pupil in the center, blinking); Look at the cursor and eyebrow movements are only in the game.
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="modal-actions gender-actions"><button className="btn" onClick={onClose}>Close.</button></div>
      </div>
    </div>
  ), document.body);
}
