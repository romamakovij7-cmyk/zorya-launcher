import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  HomeIcon, SearchIcon, LibraryIcon, SettingsIcon, ShirtIcon, CameraIcon, BarChartIcon, LayersIcon, BoxIcon,
} from './Icons.jsx';
import searchMascot from '../assets/search-mascot.gif';

const PAGE_ITEMS = [
  { page: 'home', label: 'Home', Icon: HomeIcon },
  { page: 'search', label: 'Search', Icon: SearchIcon, flag: 'showSearchPage' },
  { page: 'library', label: 'Library', Icon: LibraryIcon },
  { page: 'skins', label: 'Skins', Icon: ShirtIcon },
  { page: 'screenshots', label: 'Screenshots', Icon: CameraIcon },
  { page: 'stats', label: 'Stats', Icon: BarChartIcon, flag: 'showStatsTab' },
  { page: 'schematics', label: 'Schematics', Icon: LayersIcon, flag: 'showBuilderTools' },
  { page: 'settings', label: 'Settings', Icon: SettingsIcon },
];

function fuzzyScore(query, text) {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 0;
  const idx = t.indexOf(q);
  if (idx === -1) return -1;
  return idx === 0 ? 2 : 1; // prefix match ranks above a mid-string match
}

// A quick switcher (default Ctrl+F, rebindable in Settings): jump to any page
// or instance without reaching for the sidebar.
export default function CommandPalette({
  instances, settings, onNavigate, onClose,
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const items = useMemo(() => {
    const pages = PAGE_ITEMS
      .filter((p) => !p.flag || settings?.[p.flag] !== false)
      .map((p) => ({ kind: 'page', key: `page:${p.page}`, label: p.label, Icon: p.Icon, sub: 'Раздел', go: () => onNavigate(p.page) }));
    const insts = (instances || []).map((i) => ({
      kind: 'instance', key: `inst:${i.id}`, label: i.name, Icon: BoxIcon, icon: i.icon, sub: i.loader !== 'vanilla' ? `${i.loader} ${i.mcVersion}` : i.mcVersion, go: () => onNavigate('instance', { id: i.id }),
    }));
    const all = [...pages, ...insts];
    if (!query.trim()) return all.slice(0, 8);
    return all
      .map((item) => ({ item, score: fuzzyScore(query, item.label) }))
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 30)
      .map((x) => x.item);
  }, [instances, settings, query, onNavigate]);

  useEffect(() => { setActive(0); }, [query]);

  function activate(item) {
    if (!item) return;
    item.go();
    onClose();
  }

  function onKeyDown(e) {
    if (e.code === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.code === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)); return; }
    if (e.code === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); return; }
    if (e.code === 'Enter') { e.preventDefault(); activate(items[active]); }
  }

  return createPortal(
    <div className="cmdk-overlay" onMouseDown={onClose}>
      <div className="cmdk-box" onMouseDown={(e) => e.stopPropagation()}>
        <div className="cmdk-input-row">
          <SearchIcon width={17} height={17} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Куда перейти? Раздел или название сборки…"
          />
        </div>
        <div className="cmdk-list">
          {items.length === 0 ? (
            <div className="cmdk-empty">Ничего не найдено.</div>
          ) : items.map((item, i) => (
            <button
              key={item.key}
              className={`cmdk-row ${i === active ? 'active' : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => activate(item)}
            >
              <span className="cmdk-row-icon">
                {item.icon ? <img src={item.icon} alt="" /> : <item.Icon width={16} height={16} />}
              </span>
              <span className="cmdk-row-label">{item.label}</span>
              <span className="cmdk-row-sub">{item.sub}</span>
            </button>
          ))}
          {/* Sits in the free space under the list (or at the very end of it when the list is long). */}
          <div className="cmdk-mascot-slot" aria-hidden="true">
            <div className="cmdk-mascot"><img src={searchMascot} alt="" draggable={false} /></div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
