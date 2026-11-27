// Cosmetic assets imported from millida/launcher (developer allowed).
// Gallery only — no shop, purchases or currency.
import { useMemo, useState } from 'react';
import manifest from '../assets/cosmetics/emoji/eltaller/manifest.json';

const emojiModules = import.meta.glob('../assets/cosmetics/emoji/eltaller/*.webp', { eager: true, import: 'default' });
const capeModules = import.meta.glob('../assets/cosmetics/capes/*.png', { eager: true, import: 'default' });
const artModules = import.meta.glob('../assets/cosmetics/art/*.png', { eager: true, import: 'default' });

export default function CosmeticsGallery() {
  const [picked, setPicked] = useState(null);
  const [filter, setFilter] = useState('');
  const emoji = useMemo(() => manifest.items.map((it) => ({
    ...it,
    src: emojiModules[`../assets/cosmetics/emoji/eltaller/${it.file}`],
  })).filter((it) => it.src), []);
  const capes = useMemo(() => Object.entries(capeModules).map(([path, src]) => ({
    name: path.split('/').pop().replace(/\.png$/, ''), src,
  })), []);
  const art = useMemo(() => Object.entries(artModules).map(([path, src]) => ({
    name: path.split('/').pop().replace(/\.png$/, ''), src,
  })), []);
  const q = filter.trim().toLowerCase();
  const shown = emoji.filter((it) => !q || it.emoji.includes(q) || it.id.includes(q));

  return (
    <div className="cosmetics-gallery">
      <div className="cosmetics-hero">
        <div>
          <h3>Cosmetics collection</h3>
          <p>All free cosmetic art from the millida launcher — emoji, capes and catalog art. No shop, no purchases.</p>
        </div>
        <span className="cosmetics-count">{emoji.length + capes.length + art.length} items</span>
      </div>

      <input
        className="cosmetics-search"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Search emoji (name or number)…"
      />

      <h4 className="cosmetics-section">Emoji · {shown.length}</h4>
      <div className="cosmetics-grid">
        {shown.map((it) => (
          <button
            key={it.id}
            className={`cosmetics-cell ${picked === it ? 'active' : ''}`}
            onClick={() => setPicked(it)}
            title={`${it.emoji} · ${it.id}`}
          >
            <img src={it.src} alt="" loading="lazy" />
            <span>{it.emoji}</span>
          </button>
        ))}
      </div>

      <h4 className="cosmetics-section">Capes · {capes.length}</h4>
      <div className="cosmetics-grid">
        {capes.map((c) => (
          <button key={c.name} className="cosmetics-cell cape" onClick={() => setPicked(c)}>
            <img src={c.src} alt="" />
            <span>{c.name}</span>
          </button>
        ))}
      </div>

      <h4 className="cosmetics-section">Catalog art · {art.length}</h4>
      <div className="cosmetics-grid">
        {art.map((a) => (
          <button key={a.name} className="cosmetics-cell art" onClick={() => setPicked(a)}>
            <img src={a.src} alt="" />
            <span>{a.name}</span>
          </button>
        ))}
      </div>

      {picked && (
        <div className="cosmetics-preview">
          <img src={picked.src} alt="" />
          <span>{picked.emoji || picked.name}</span>
          <button className="btn-text" onClick={() => setPicked(null)}>Close</button>
        </div>
      )}
    </div>
  );
}
