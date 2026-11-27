// All visual cosmetics from millida/launcher (developer allowed).
// Gallery only — no shop, purchases or currency.
import { useMemo, useState } from 'react';
import manifest from '../assets/cosmetics/emoji/eltaller/manifest.json';

const files = import.meta.glob('../assets/cosmetics/**/*.{png,webp,svg,jpg,jpeg}', {
  eager: true, query: '?url', import: 'default',
});

const LABELS = {
  emoji: 'Emoji', capes: 'Capes', 'catalog-art': 'Catalog art', 'mode-art': 'Mode art',
  'build-icons': 'Build icons', 'block-icons': 'Block icons', lobby: 'Lobby',
  'app-icons': 'App icons', packs: 'Packs', plus: 'Plus', currency: 'Currency',
  chests: 'Chests', bg: 'Backgrounds', presets: 'Presets', season: 'Season',
  loaders: 'Loaders', 'mr-icons': 'Category icons', art: 'Art',
};

const EMOJI_BY_FILE = Object.fromEntries(manifest.items.map((i) => [i.id + '.webp', i.emoji]));

const ITEMS = Object.entries(files).map(([path, url]) => {
  const parts = path.split('/');
  const file = parts.pop();
  const name = file.replace(/\.[^.]+$/, '');
  const i = parts.indexOf('cosmetics');
  const folder = i >= 0 && parts[i + 1] ? parts[i + 1] : 'art';
  return {
    path, url, name, folder,
    label: folder === 'emoji' ? (EMOJI_BY_FILE[file] || name) : name,
  };
});

export default function CosmeticsGallery() {
  const [cat, setCat] = useState('all');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState(null);

  const counts = useMemo(() => ITEMS.reduce((m, it) => {
    m[it.folder] = (m[it.folder] || 0) + 1;
    return m;
  }, {}), []);

  const cats = useMemo(() => ['all', ...Object.keys(counts).sort()], [counts]);
  const q = query.trim().toLowerCase();
  const shown = ITEMS.filter((it) => (cat === 'all' || it.folder === cat)
    && (!q || it.name.toLowerCase().includes(q) || it.label.toLowerCase().includes(q)));

  return (
    <div className="cosmetics-gallery">
      <div className="cosmetics-hero">
        <div>
          <h3>Cosmetics collection</h3>
          <p>Every cosmetic and art asset from millida’s launcher — free to use. No shop, no purchases.</p>
        </div>
        <span className="cosmetics-count">{ITEMS.length} items</span>
      </div>

      <div className="cosmetics-controls">
        <input
          className="cosmetics-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search cosmetics…"
        />
        <div className="cosmetics-chips">
          {cats.map((c) => (
            <button key={c} className={`cosmetics-chip ${cat === c ? 'active' : ''}`} onClick={() => setCat(c)}>
              {c === 'all' ? 'All' : (LABELS[c] || c)} <span>{c === 'all' ? ITEMS.length : counts[c]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="cosmetics-grid">
        {shown.map((it) => (
          <button
            key={it.path}
            className={`cosmetics-cell ${picked === it ? 'active' : ''} ${it.folder}`}
            onClick={() => setPicked(it)}
            title={`${it.label} · ${LABELS[it.folder] || it.folder}`}
          >
            <img src={it.url} alt="" loading="lazy" />
            <span>{it.label}</span>
          </button>
        ))}
      </div>
      {!shown.length && <div className="cosmetics-empty">Nothing found.</div>}

      {picked && (
        <div className="cosmetics-preview">
          <img src={picked.url} alt="" />
          <div className="cosmetics-preview-text">
            <strong>{picked.label}</strong>
            <span>{LABELS[picked.folder] || picked.folder}</span>
          </div>
          <button className="btn-text" onClick={() => setPicked(null)}>Close</button>
        </div>
      )}
    </div>
  );
}
