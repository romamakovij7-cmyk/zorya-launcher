// Wearable cosmetics from the public millida catalog (developer allowed).
// Shop prices, purchase buttons and channels are not shown.
import { useMemo, useState } from 'react';
import catalog from '../assets/cosmetics/catalog.json';

const previews = import.meta.glob('../assets/cosmetics/previews/*/*.png', {
  eager: true, query: '?url', import: 'default',
});

const SLOT_LABELS = {
  CAPE: 'Capes', HAT: 'Hats', HEAD: 'Head', FACE: 'Face', EARS: 'Ears',
  BACK: 'Back', WINGS: 'Wings', SHOULDER: 'Shoulder', SHOULDERS: 'Shoulders',
  ARMS: 'Arms', HAND: 'Hands', WAIST: 'Waist', TOP: 'Tops', PANTS: 'Pants',
  SKIRT: 'Skirts', SHOES: 'Shoes', FEET: 'Feet', FULL_BODY: 'Full body',
  ACCESSORY: 'Accessories', ICON: 'Icons', EFFECT: 'Effects', AURA: 'Auras',
  EMOTE: 'Emotes', PET: 'Pets', OTHER: 'Other',
};

const ITEMS = catalog.map((it) => ({
  ...it,
  src: previews[`../assets/cosmetics/previews/${it.slot.toLowerCase()}/${it.id}.png`],
})).filter((it) => it.src);

export default function CosmeticsGallery() {
  const [slot, setSlot] = useState('all');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState(null);
  const [favs, setFavs] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('zorya.cosmeticFavs') || '[]')); }
    catch { return new Set(); }
  });

  const counts = useMemo(() => ITEMS.reduce((m, it) => {
    m[it.slot] = (m[it.slot] || 0) + 1;
    return m;
  }, {}), []);
  const slots = useMemo(() => ['all', ...Object.keys(counts).sort()], [counts]);
  const q = query.trim().toLowerCase();
  const shown = ITEMS.filter((it) => (slot === 'all' || it.slot === slot)
    && (!q || it.name.toLowerCase().includes(q) || it.id.toLowerCase().includes(q)));
  const shownFavs = shown.filter((it) => favs.has(it.id));

  function fav(id) {
    const next = new Set(favs);
    if (next.has(id)) next.delete(id); else next.add(id);
    setFavs(next);
    try { localStorage.setItem('zorya.cosmeticFavs', JSON.stringify([...next])); } catch { /* storage */ }
  }

  return (
    <div className="cosmetics-gallery">
      <div className="cosmetics-hero">
        <div>
          <h3>Cosmetics wardrobe</h3>
          <p>{ITEMS.length} wearable looks from millida’s catalog — capes, hats, wings, effects and more. No shop, no prices.</p>
        </div>
        <span className="cosmetics-count">{ITEMS.length} items</span>
      </div>

      <div className="cosmetics-controls">
        <input
          className="cosmetics-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search cosmetics by name or ID…"
        />
        <div className="cosmetics-chips">
          {slots.map((s) => (
            <button key={s} className={`cosmetics-chip ${slot === s ? 'active' : ''}`} onClick={() => setSlot(s)}>
              {s === 'all' ? 'All' : (SLOT_LABELS[s] || s)} <span>{s === 'all' ? ITEMS.length : counts[s]}</span>
            </button>
          ))}
        </div>
      </div>

      {shownFavs.length > 0 && (
        <>
          <h4 className="cosmetics-section">Favourites · {shownFavs.length}</h4>
          <div className="cosmetics-grid">
            {shownFavs.map((it) => (
              <CosmeticCell key={'f' + it.id} item={it} fav={fav} isFav onPick={setPicked} />
            ))}
          </div>
        </>
      )}

      <h4 className="cosmetics-section">{slot === 'all' ? 'All cosmetics' : SLOT_LABELS[slot] || slot} · {shown.length}</h4>
      <div className="cosmetics-grid">
        {shown.map((it) => (
          <CosmeticCell key={it.id} item={it} fav={fav} isFav={favs.has(it.id)} onPick={setPicked} />
        ))}
      </div>
      {!shown.length && <div className="cosmetics-empty">Nothing found.</div>}

      {picked && (
        <div className="cosmetics-preview">
          <img src={picked.src} alt="" />
          <div className="cosmetics-preview-text">
            <strong>{picked.name}</strong>
            <span>{SLOT_LABELS[picked.slot] || picked.slot} · {String(picked.rarity || '').toLowerCase()}</span>
          </div>
          <button className="btn-text" onClick={() => fav(picked.id)}>
            {favs.has(picked.id) ? '★ Saved' : '☆ Save'}
          </button>
          <button className="btn-text" onClick={() => setPicked(null)}>Close</button>
        </div>
      )}
    </div>
  );
}

function CosmeticCell({ item, fav, isFav, onPick }) {
  return (
    <div className={`cosmetics-cell cosmetic ${item.slot.toLowerCase()}`}>
      <button className="cosmetics-cell-main" onClick={() => onPick(item)} title={item.name}>
        <img src={item.src} alt="" loading="lazy" />
        <span>{item.name}</span>
      </button>
      <button className={`cosmetics-star ${isFav ? 'on' : ''}`} onClick={() => fav(item.id)} title="Favourite">
        {isFav ? '★' : '☆'}
      </button>
    </div>
  );
}
