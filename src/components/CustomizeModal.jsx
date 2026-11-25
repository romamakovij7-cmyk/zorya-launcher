import { useEffect, useRef, useState } from 'react';
import { CloseIcon, CheckIcon, UploadIcon } from './Icons.jsx';
import { detectVariant } from '../utils/skinVariant.js';

// A cape texture is a 64x32 sheet with the front/back/sides/top/bottom of a
// thin box all crammed into it — showing that whole sheet looks like noise.
// The region at x:1,y:1 (10x16) is the outward-facing panel players actually
// see when the cape is worn, right side up — crop just that, flat, no 3D.
// (Verified against a real cape by rendering both side by side — the other
// candidate region, x:12,y:1, is the inner lining that faces the player's
// back, not what's shown here.)
function CapeThumbnail({ src, alt }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    if (!src) return;
    const img = new Image();
    img.onload = () => {
      const scale = img.naturalWidth / 64; // texture is nominally 64px wide
      canvas.width = 10 * scale;
      canvas.height = 16 * scale;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 1 * scale, 1 * scale, 10 * scale, 16 * scale, 0, 0, canvas.width, canvas.height);
    };
    img.src = src;
  }, [src]);

  return <canvas ref={canvasRef} className="customize-cape-img" aria-label={alt} />;
}

export default function CustomizeModal({
  account, previewVariant, activeCapeId, onClose, onAccountChange, onPreviewVariant, onCapeOverride, onApplySkin, onSkinAdded,
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);

  // Every action here updates the local preview immediately and fires the
  // real Mojang sync in the background without waiting on it — Mojang
  // rate-limits these endpoints to roughly one change a minute, but that's
  // their limit to deal with, not a reason to freeze the launcher's UI.
  function handleVariant(variant) {
    if (variant === previewVariant) return;
    onPreviewVariant(variant);
    setError(null);
    window.api.skins.setEquippedVariant(variant).then((res) => {
      if (res.ok) onAccountChange(res.account);
      else if (!res.rateLimited) setError(res.error);
    });
  }

  function handleCape(capeId, cape) {
    onCapeOverride(cape || null);
    setError(null);
    window.api.skins.setCape(capeId).then((res) => {
      if (res.ok) onAccountChange(res.account);
      else if (!res.rateLimited) setError(res.error);
    });
  }

  async function handleUploadSkin() {
    setUploading(true);
    setError(null);
    const res = await window.api.skins.add('classic');
    if (res?.ok) {
      const variant = await detectVariant(res.skin.dataUrl);
      if (variant !== res.skin.variant) await window.api.skins.setVariant(res.skin.id, variant);
      onApplySkin(res.skin.id); // fire-and-forget — preview updates instantly on the caller's side
      onSkinAdded?.();
    } else if (res?.error) {
      setError(res.error);
    }
    setUploading(false);
  }

  const capes = account?.capes || [];
  const noCapeActive = !activeCapeId;
  const isMicrosoft = account?.type === 'microsoft';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal customize-modal" onClick={(e) => e.stopPropagation()}>
        <div className="customize-modal-header">
          <h2>Configure skin</h2>
          <button className="icon-btn" onClick={onClose}><CloseIcon /></button>
        </div>

        {!account && <div className="hint-text" style={{ marginBottom: 14 }}>Войдите в аккаунт Microsoft, чтобы менять эти параметры.</div>}
        {account && !isMicrosoft && (
          <div className="hint-text" style={{ marginBottom: 14 }}>
            Offline accounts can upload and equip skins here too — the skin is saved locally and used at the next launch.
          </div>
        )}
        {error && <div className="error-text" style={{ marginBottom: 14 }}>{error}</div>}

        <div className="settings-row-block">
          <label className="settings-block-label">Arm type</label>
          <div className="pill-tabs" style={{ marginBottom: 0 }}>
            <button
              className={`pill-tab ${previewVariant !== 'slim' ? 'active' : ''}`}
              onClick={() => handleVariant('classic')}
            >
              Classic
            </button>
            <button
              className={`pill-tab ${previewVariant === 'slim' ? 'active' : ''}`}
              onClick={() => handleVariant('slim')}
            >
              Slim
            </button>
          </div>
          <p className="settings-block-hint">Reapplies the current skin with a different arm width — the texture stays the same.</p>
        </div>

        <div className="settings-row-block">
          <label className="settings-block-label">Skin texture</label>
          <button className="btn" onClick={handleUploadSkin} disabled={uploading}>
            <UploadIcon width={15} height={15} /> {uploading ? 'Loading…' : 'Upload skin'}
          </button>
        </div>

        <div className="settings-row-block">
          <label className="settings-block-label">Cape</label>
          {capes.length === 0 ? (
            <p className="settings-block-hint">No capes available for this account.</p>
          ) : (
            <div className="customize-cape-grid">
              <button
                className={`customize-cape-item ${noCapeActive ? 'active' : ''}`}
                onClick={() => handleCape(null, null)}
              >
                <div className="customize-cape-none">✕</div>
                <span>No cape</span>
              </button>
              {capes.map((c) => (
                <button
                  key={c.id}
                  className={`customize-cape-item ${activeCapeId === c.id ? 'active' : ''}`}
                  onClick={() => handleCape(c.id, c)}
                >
                  <CapeThumbnail src={c.url} alt={c.alias || 'Cape'} />
                  <span>{c.alias || 'Cape'}</span>
                  {activeCapeId === c.id && <div className="customize-cape-check"><CheckIcon width={11} height={11} /></div>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
