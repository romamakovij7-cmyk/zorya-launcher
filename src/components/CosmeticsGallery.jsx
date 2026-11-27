// Wearable cosmetics from the public millida catalog (developer allowed).
// Shop prices / purchase actions are never shown.
import { useEffect, useMemo, useState } from 'react';
import catalog from '../assets/cosmetics/catalog.json';

const previews = import.meta.glob('../assets/cosmetics/previews/*/*.png', {
  eager: true, query: '?url', import: 'default',
});

const SLOT_LABELS = {
  CAPE: 'Cape', HAT: 'Hat', HEAD: 'Head', FACE: 'Face', EARS: 'Ears',
  BACK: 'Back', WINGS: 'Wings', SHOULDER: 'Shoulder', SHOULDERS: 'Shoulders',
  ARMS: 'Arms', HAND: 'Hand', WAIST: 'Waist', TOP: 'Top', PANTS: 'Pants',
  SKIRT: 'Skirt', SHOES: 'Shoes', FEET: 'Feet', FULL_BODY: 'Full body',
  ACCESSORY: 'Accessory', ICON: 'Icon', EFFECT: 'Effect', AURA: 'Aura',
  EMOTE: 'Emote', PET: 'Pet', OTHER: 'Other',
};

// Grouped tabs — e.g. every cape lives under the Capes tab.
const TABS = [
  { id: 'all', label: 'All', slots: null },
  { id: 'cape', label: 'Capes', slots: ['CAPE', 'BACK'] },
  { id: 'hat', label: 'Hats & heads', slots: ['HAT', 'HEAD', 'EARS', 'FACE'] },
  { id: 'body', label: 'Outfits', slots: ['FULL_BODY', 'TOP', 'PANTS', 'SKIRT', 'SHOES', 'FEET', 'ARMS', 'HAND', 'WAIST', 'SHOULDERS', 'SHOULDER', 'ACCESSORY'] },
  { id: 'wings', label: 'Wings', slots: ['WINGS'] },
  { id: 'effect', label: 'Effects', slots: ['EFFECT', 'AURA', 'ICON'] },
  { id: 'pet', label: 'Pets', slots: ['PET'] },
  { id: 'emote', label: 'Emotes', slots: ['EMOTE'] },
];

const ITEMS = catalog.map((it) => ({
  ...it,
  src: previews[`../assets/cosmetics/previews/${it.slot.toLowerCase()}/${it.id}.png`],
})).filter((it) => it.src);

const WORN_KEY = 'zorya.cosmetics.worn';

export default function CosmeticsGallery() {
  const [tab, setTab] = useState('all');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState(null);
  const [worn, setWorn] = useState(() => {
    try { return JSON.parse(localStorage.getItem(WORN_KEY) || '{}'); } catch { return {}; }
  });
  const [favs, setFavs] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('zorya.cosmeticFavs') || '[]')); }
    catch { return new Set(); }
  });

  useEffect(() => { window.api.cosmetics?.setWorn?.(worn).catch?.(() => {}); }, [worn]);

  const tabDef = TABS.find((t) => t.id === tab) || TABS[0];
  const q = query.trim().toLowerCase();
  const shown = ITEMS.filter((it) => (!tabDef.slots || tabDef.slots.includes(it.slot))
    && (!q || it.name.toLowerCase().includes(q) || it.id.toLowerCase().includes(q)));

  const wornItems = Object.values(worn).map((id) => ITEMS.find((it) => it.id === id)).filter(Boolean);

  function equip(item) {
    const next = { ...worn };
    // One item per slot; equipping the same one again takes it off.
    if (next[item.slot] === item.id) delete next[item.slot];
    else next[item.slot] = item.id;
    setWorn(next);
    try { localStorage.setItem(WORN_KEY, JSON.stringify(next)); } catch { /* storage */ }
    if (next.CAPE && item.slot === 'CAPE') sendCape(next.CAPE);
    if (item.slot === 'CAPE' && !next.CAPE) window.api.cosmetics?.setCape?.('', '');
  }

  async function sendCape(id) {
    const item = ITEMS.find((it) => it.id === id);
    if (!item) return;
    try {
      const blob = await fetch(item.src).then((r) => r.blob());
      const dataUrl = await new Promise((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.readAsDataURL(blob);
      });
      await window.api.cosmetics?.setCape?.(id, dataUrl);
    } catch { /* preview upload is best effort */ }
  }

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
          <p>{ITEMS.length} wearable looks from millida’s catalog. Equip one per slot — no shop, no prices.</p>
        </div>
        <span className="cosmetics-count">{ITEMS.length} items</span>
      </div>

      <div className="cosmetics-tabs">
        {TABS.map((t) => (
          <button key={t.id} className={`cosmetics-tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="cosmetics-controls">
        <input
          className="cosmetics-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search cosmetics…"
        />
        {wornItems.length > 0 && (
          <div className="cosmetics-worn">
            <span className="cosmetics-worn-label">Worn:</span>
            {wornItems.map((it) => (
              <button key={it.slot} className="cosmetics-worn-item" onClick={() => equip(it)} title="Click to remove">
                <img src={it.src} alt="" />
                <span>{SLOT_LABELS[it.slot] || it.slot}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {[...new Set(shown.map((it) => it.slot))].sort().map((slot) => (
        <div key={slot}>
          <h4 className="cosmetics-section">{SLOT_LABELS[slot] || slot} · {shown.filter((it) => it.slot === slot).length}</h4>
          <div className="cosmetics-grid">
            {shown.filter((it) => it.slot === slot).map((it) => (
              <div className={`cosmetics-cell cosmetic ${it.slot.toLowerCase()} ${worn[it.slot] === it.id ? 'worn' : ''}`} key={it.id}>
                <button className="cosmetics-cell-main" onClick={() => setPicked(it)} title={it.name}>
                  <img src={it.src} alt="" loading="lazy" />
                  <span>{it.name}</span>
                </button>
                <button className={`cosmetics-equip ${worn[it.slot] === it.id ? 'on' : ''}`} onClick={() => equip(it)}>
                  {worn[it.slot] === it.id ? '✓' : '+'}
                </button>
                <button className={`cosmetics-star ${favs.has(it.id) ? 'on' : ''}`} onClick={() => fav(it.id)} title="Favourite">
                  {favs.has(it.id) ? '★' : '☆'}
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
      {!shown.length && <div className="cosmetics-empty">Nothing found.</div>}

      {picked && (
        <div className="cosmetics-preview">
          <img src={picked.src} alt="" />
          <div className="cosmetics-preview-text">
            <strong>{picked.name}</strong>
            <span>{SLOT_LABELS[picked.slot] || picked.slot}</span>
          </div>
          <button className="btn btn-primary" onClick={() => { equip(picked); setPicked(null); }}>
            {worn[picked.slot] === picked.id ? 'Unequip' : 'Equip'}
          </button>
          <button className="btn-text" onClick={() => setPicked(null)}>Close</button>
        </div>
      )}
    </div>
  );
}
