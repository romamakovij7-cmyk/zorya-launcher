import Select from '../components/Select.jsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CameraIcon, ChevronLeft, ChevronRight, ChevronDownIcon, CloseIcon, DownloadCloudIcon, CopyIcon,
  CheckIcon, TrashIcon, SearchIcon, EditIcon,
} from '../components/Icons.jsx';
import ScreenshotEditor from '../components/ScreenshotEditor.jsx';
import { queueThumb, bytesToBlobUrl } from '../utils/thumbs.js';

function keyOf(item) {
  return `${item.instanceId}:${item.filename}`;
}

// Loads its thumbnail only once it actually scrolls near the viewport, through a small queue (utils/thumbs.js): a few at a time, and a card that
// scrolls away before its turn is dropped. The main process serves a small JPEG made once and kept on disk (see mc/screenshots.js); here it
// becomes a blob URL (freed when the card goes away). Before, every card asked for a full decode at once and the whole app froze.
function ShotCard({
  item, onOpen, onCopy, onDownload, onDelete, selected, selectionMode, onToggleSelect,
}) {
  const [thumb, setThumb] = useState(null);
  const elRef = useRef(null);

  useEffect(() => {
    const el = elRef.current;
    if (!el) return undefined;
    let alive = true;
    let job = null;
    let url = null;
    // Near the screen (1200 px around it) the thumbnail is loaded; far away it is released again, so scrolling through thousands of
    // screenshots does not pile up thousands of pictures in memory (coming back reads the small cached file again, which is quick).
    const observer = new IntersectionObserver((entries) => {
      const visible = entries[entries.length - 1].isIntersecting;
      if (visible && !job && !url) {
        job = queueThumb(item);
        job.promise.then((bytes) => {
          if (!alive || !bytes) { job = null; return; }
          url = bytesToBlobUrl(bytes);
          setThumb(url);
        });
      } else if (!visible && job && !url) { job.cancel(); job = null; } // left the screen before its turn
      else if (!visible && url) { URL.revokeObjectURL(url); url = null; job = null; setThumb(null); }
    }, { rootMargin: '1200px 0px' });
    observer.observe(el);
    return () => { alive = false; observer.disconnect(); if (job) job.cancel(); if (url) URL.revokeObjectURL(url); setThumb(null); };
  }, [item.instanceId, item.filename, item.mtime]);

  return (
    <div
      className={`shots-card ${selected ? 'selected' : ''} ${selectionMode ? 'selection-mode' : ''}`}
      ref={elRef}
      onClick={selectionMode ? () => onToggleSelect(item) : onOpen}
    >
      <div className="shots-card-thumb">
        {thumb ? <img src={thumb} alt="" decoding="async" draggable={false} /> : <div className="shots-card-loading" />}
        <span
          className={`shots-card-select ${selected ? 'active' : ''}`}
          role="checkbox"
          aria-checked={!!selected}
          title={selected ? 'Deselect' : 'Select'}
          onClick={(e) => { e.stopPropagation(); onToggleSelect(item); }}
        >
          {selected && <CheckIcon width={14} height={14} />}
        </span>
        <div className="shots-card-actions">
          <button className="icon-btn" title="Copy" onClick={(e) => { e.stopPropagation(); onCopy(item); }}>
            <CopyIcon width={15} height={15} />
          </button>
          <button className="icon-btn" title="Download" onClick={(e) => { e.stopPropagation(); onDownload(item); }}>
            <DownloadCloudIcon width={16} height={16} />
          </button>
          <button className="icon-btn danger" title="Delete" onClick={(e) => { e.stopPropagation(); onDelete(item); }}>
            <TrashIcon width={15} height={15} />
          </button>
        </div>
        <div className="shots-card-hover-info">
          <span className="shots-card-instance">{item.instanceName}</span>
          <span className="shots-card-date">{item.filename} · {new Date(item.mtime).toLocaleString('ru-RU')}</span>
        </div>
      </div>
    </div>
  );
}

const MONTHS_NOM = ['January', 'February', 'March', 'April', 'май', 'June', 'July', 'August', 'September', 'October', 'november', 'December'];

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// Buckets a timestamp into the same kind of labels the reference UI uses:
// Today / Yesterday / This week / This month, then "<month> <year>" for
// anything older.
function dateGroupInfo(ts) {
  const d = new Date(ts);
  const now = new Date();
  const today = startOfDay(now);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  if (d >= today) return { key: 'today', label: 'Today' };
  if (d >= yesterday) return { key: 'yesterday', label: 'Yesterday' };
  if (d >= weekAgo) return { key: 'week', label: 'this week' };
  if (d >= monthStart) return { key: 'month', label: 'This month' };
  return { key: `${d.getFullYear()}-${d.getMonth()}`, label: `${MONTHS_NOM[d.getMonth()]} ${d.getFullYear()} г.` };
}

export default function Screenshots() {
  const [items, setItems] = useState(null);
  const [fullCache, setFullCache] = useState({});
  const [search, setSearch] = useState('');
  const [order, setOrder] = useState('newest');
  const [groupBy, setGroupBy] = useState('date');
  const [collapsed, setCollapsed] = useState(new Set());
  const [lightboxKey, setLightboxKey] = useState(null);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(null); // item being edited
  const [error, setError] = useState(null);
  const [selectedKeys, setSelectedKeys] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkNote, setBulkNote] = useState(null);

  function load() {
    window.api.screenshots.list().then((res) => {
      if (res.ok) setItems(res.items);
      else { setError(res.error); setItems([]); }
    });
  }

  useEffect(load, []);

  const filteredItems = useMemo(() => {
    if (!items) return [];
    let list = items;
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((i) => i.instanceName.toLowerCase().includes(q) || i.filename.toLowerCase().includes(q));
    return [...list].sort((a, b) => (order === 'newest' ? b.mtime - a.mtime : a.mtime - b.mtime));
  }, [items, search, order]);

  const groups = useMemo(() => {
    const map = new Map();
    for (const item of filteredItems) {
      const key = groupBy === 'date' ? dateGroupInfo(item.mtime).key : `inst:${item.instanceId}`;
      const label = groupBy === 'date' ? dateGroupInfo(item.mtime).label : item.instanceName;
      if (!map.has(key)) map.set(key, { key, label, items: [], maxMtime: item.mtime });
      const g = map.get(key);
      g.items.push(item);
      if (item.mtime > g.maxMtime) g.maxMtime = item.mtime;
    }
    const list = [...map.values()];
    list.sort((a, b) => (order === 'newest' ? b.maxMtime - a.maxMtime : a.maxMtime - b.maxMtime));
    return list;
  }, [filteredItems, groupBy, order]);

  function toggleCollapse(key) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const lightboxIndex = lightboxKey === null ? -1 : filteredItems.findIndex((i) => keyOf(i) === lightboxKey);
  const lightboxItem = lightboxIndex >= 0 ? filteredItems[lightboxIndex] : null;

  // Full-resolution images are large (up to ~1920px). Browsing through many
  // in one lightbox session used to cache every single one for the rest of
  // the page's life, which built up tens of MB of base64 strings and caused
  // a visible stutter (GC pause) the moment the page finally unmounted —
  // capping it to the last few keeps that bounded.
  const FULL_CACHE_LIMIT = 4;
  useEffect(() => {
    if (!lightboxItem) return undefined;
    let cancelled = false;
    const key = keyOf(lightboxItem);
    if (!fullCache[key]) {
      window.api.screenshots.full(lightboxItem.instanceId, lightboxItem.filename).then((res) => {
        if (cancelled || !res.ok) return;
        setFullCache((prev) => {
          const next = { ...prev, [key]: res.dataUrl };
          const keys = Object.keys(next);
          if (keys.length > FULL_CACHE_LIMIT) delete next[keys[0]];
          return next;
        });
      });
    }
    return () => { cancelled = true; };
  }, [lightboxItem]);

  useEffect(() => {
    if (!lightboxItem) return undefined;
    function onKeyDown(e) {
      if (e.key === 'Escape') setLightboxKey(null);
      else if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lightboxItem, filteredItems]);

  function step(delta) {
    if (filteredItems.length === 0) return;
    const next = (lightboxIndex + delta + filteredItems.length) % filteredItems.length;
    setLightboxKey(keyOf(filteredItems[next]));
  }

  async function handleDownload(item) {
    const res = await window.api.screenshots.save(item.instanceId, item.filename);
    if (!res.ok && !res.canceled) setError(res.error);
  }

  async function handleCopy(item) {
    const res = await window.api.screenshots.copy(item.instanceId, item.filename);
    if (res.ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } else {
      setError(res.error);
    }
  }

  async function handleDelete(item) {
    if (!confirm('Delete this screenshot?')) return;
    const res = await window.api.screenshots.delete(item.instanceId, item.filename);
    if (!res.ok) { setError(res.error); return; }
    setItems((prev) => prev.filter((i) => keyOf(i) !== keyOf(item)));
    if (lightboxKey === keyOf(item)) setLightboxKey(null);
  }

  // ---- multi-select (same idea as the library's tile checkboxes) ----
  const selectedItems = useMemo(() => (items || []).filter((i) => selectedKeys.has(keyOf(i))), [items, selectedKeys]);
  const selectionActive = selectedItems.length > 0;

  useEffect(() => {
    if (!selectionActive || lightboxKey !== null) return undefined;
    function onKey(e) { if (e.key === 'Escape') setSelectedKeys(new Set()); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectionActive, lightboxKey]);

  function toggleSelect(item) {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      const k = keyOf(item);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }

  const clearSelection = () => setSelectedKeys(new Set());

  function flashNote(text) {
    setBulkNote(text);
    setTimeout(() => setBulkNote(null), 3500);
  }

  async function bulkDownload() {
    setBulkBusy(true);
    const res = await window.api.screenshots.saveMany(selectedItems.map(({ instanceId, filename }) => ({ instanceId, filename })));
    setBulkBusy(false);
    if (res.ok) { flashNote(`Сохранено скриншотов: ${res.count}`); clearSelection(); }
    else if (!res.canceled) setError(res.error);
  }

  async function bulkDelete() {
    if (!confirm(`Delete скриншоты (${selectedItems.length})? Files будут удалены безвозвратно.`)) return;
    setBulkBusy(true);
    const gone = new Set();
    for (const item of selectedItems) {
      // eslint-disable-next-line no-await-in-loop
      const res = await window.api.screenshots.delete(item.instanceId, item.filename);
      if (res.ok) gone.add(keyOf(item));
    }
    setBulkBusy(false);
    setItems((prev) => prev.filter((i) => !gone.has(keyOf(i))));
    if (gone.size < selectedItems.length) setError(`Удалено ${gone.size} из ${selectedItems.length}.`);
    clearSelection();
  }

  return (
    <div className="screenshots-page">
      <div className="page-header">
        <h1>Screenshots</h1>
      </div>

      {error && <div className="error-text" style={{ marginBottom: 16 }}>{error}</div>}

      {items && items.length > 0 && (
        <div className="shots-toolbar">
          <div className="search-bar" style={{ marginBottom: 0 }}>
            <SearchIcon width={18} height={18} />
            <input placeholder="Search by assembly or file..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="select-chip">
            Сортировка:
            <Select value={order} onChange={setOrder} options={[{ value: 'newest', label: 'New ones first' }, { value: 'oldest', label: 'Old ones first' }]} />
          </div>
          <div className="select-chip">
            Группировка:
            <Select value={groupBy} onChange={setGroupBy} options={[{ value: 'date', label: 'Date' }, { value: 'instance', label: 'Instance' }]} />
          </div>
        </div>
      )}

      {bulkNote && <div className="hint-text" style={{ marginBottom: 12 }}>{bulkNote}</div>}

      {selectionActive && (
        <div className="library-selection-bar">
          <span className="library-selection-count">Выбрано: {selectedItems.length}</span>
          <button className="btn" onClick={() => setSelectedKeys(new Set(filteredItems.map(keyOf)))} disabled={bulkBusy}>
            Выделить все
          </button>
          <div className="library-selection-actions">
            {selectedItems.length === 1 && (
              <button className="btn" onClick={() => handleCopy(selectedItems[0])} disabled={bulkBusy}>
                <CopyIcon width={15} height={15} /> {copied ? 'Copied' : 'Copy'}
              </button>
            )}
            <button className="btn" onClick={bulkDownload} disabled={bulkBusy}>
              <DownloadCloudIcon width={16} height={16} /> {bulkBusy ? 'Wait…' : 'Download'}
            </button>
            <button className="btn btn-danger" onClick={bulkDelete} disabled={bulkBusy}>
              <TrashIcon width={15} height={15} /> Delete
            </button>
            <button className="icon-btn" title="Deselect (Esc)" onClick={clearSelection}>
              <CloseIcon />
            </button>
          </div>
        </div>
      )}

      {items === null ? (
        <div className="progress-label">Loading…</div>
      ) : filteredItems.length === 0 ? (
        <div className="empty-state">
          <CameraIcon width={38} height={38} />
          <p>{items.length === 0 ? 'No screenshots yet. They will appear here after you make them in the game (F2 key).' : 'Nothing found.'}</p>
        </div>
      ) : (
        groups.map((g) => (
          <div className="shots-group" key={g.key}>
            <button className="shots-group-header" onClick={() => toggleCollapse(g.key)}>
              <ChevronDownIcon
                width={16} height={16}
                style={{ transform: collapsed.has(g.key) ? 'rotate(-90deg)' : 'none', transition: 'transform .15s ease' }}
              />
              <span className="shots-group-title">{g.label}</span>
              <span className="shots-group-count">{g.items.length}</span>
            </button>
            {!collapsed.has(g.key) && (
              <div className="shots-grid">
                {g.items.map((item) => (
                  <ShotCard
                    key={keyOf(item)}
                    item={item}
                    onOpen={() => setLightboxKey(keyOf(item))}
                    onCopy={handleCopy}
                    onDownload={handleDownload}
                    onDelete={handleDelete}
                    selected={selectedKeys.has(keyOf(item))}
                    selectionMode={selectionActive}
                    onToggleSelect={toggleSelect}
                  />
                ))}
              </div>
            )}
          </div>
        ))
      )}

      {selectionActive && <div className="library-selection-bar-spacer" />}

      {editing && (
        <ScreenshotEditor
          item={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { load(); setFullCache({}); }}
        />
      )}

      {lightboxItem && (
        <div className="lightbox-overlay" onClick={() => setLightboxKey(null)}>
          {/* Arrows sit right beside the window (not at the screen edge, where
              the sidebar/title bar's drag regions swallow clicks). */}
          <div className="lightbox-stage" onClick={(e) => e.stopPropagation()}>
          {filteredItems.length > 1 ? (
            <button className="lightbox-nav" onClick={() => step(-1)} title="Previous">
              <ChevronLeft width={26} height={26} />
            </button>
          ) : <span className="lightbox-nav-spacer" />}

          <div className="lightbox-body">
            <button className="icon-btn lightbox-close" onClick={() => setLightboxKey(null)} title="Close (Esc)"><CloseIcon /></button>
            <div className="lightbox-image-wrap">
              {fullCache[keyOf(lightboxItem)] ? (
                <img src={fullCache[keyOf(lightboxItem)]} alt="" />
              ) : (
                <div className="progress-label">Loading…</div>
              )}
            </div>
            <div className="lightbox-toolbar">
              <div>
                <div className="lightbox-title">{lightboxItem.instanceName}</div>
                <div className="lightbox-sub">{lightboxItem.filename} · {new Date(lightboxItem.mtime).toLocaleString('ru-RU')}</div>
              </div>
              <div className="lightbox-actions">
                <button className="btn" onClick={() => handleCopy(lightboxItem)}>
                  {copied ? <><CheckIcon width={15} height={15} /> Скопировано</> : <><CopyIcon width={15} height={15} /> Copy</>}
                </button>
                <button className="btn" onClick={() => setEditing(lightboxItem)}>
                  <EditIcon width={15} height={15} /> Редактировать
                </button>
                <button className="btn" onClick={() => handleDownload(lightboxItem)}>
                  <DownloadCloudIcon width={16} height={16} /> Download
                </button>
                <button className="icon-btn danger" onClick={() => handleDelete(lightboxItem)} title="Delete">
                  <TrashIcon width={16} height={16} />
                </button>
              </div>
            </div>
          </div>

          {filteredItems.length > 1 ? (
            <button className="lightbox-nav" onClick={() => step(1)} title="Next">
              <ChevronRight width={26} height={26} />
            </button>
          ) : <span className="lightbox-nav-spacer" />}
          </div>
        </div>
      )}
    </div>
  );
}
