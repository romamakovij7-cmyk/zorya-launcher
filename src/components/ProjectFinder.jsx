import { depsNote } from '../utils/depsSummary.js';
import Select from './Select.jsx';
import { useResetScroll } from '../utils/useResetScroll.js';
import { categoryLabel, CATEGORY_HEADERS } from '../utils/categoryNames.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { searchProjects, getProjectVersions, getCategoryTags, formatCount } from '../api/modrinth.js';
import {
  ChevronLeft, ChevronRight, SearchIcon, DownloadIcon, HeartIcon, BoxIcon, LockIcon, CheckIcon, PlusIcon,
} from './Icons.jsx';
import ProjectPage from './ProjectPage.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';

const TYPE_TABS = [
  { id: 'mod', label: 'Fashions' },
  { id: 'resourcepack', label: 'Resource sets' },
  { id: 'shader', label: 'Shaders.' },
];

const SORT_OPTIONS = [
  { id: 'relevance', label: 'Relevance' },
  { id: 'downloads', label: 'Downloads.' },
  { id: 'follows', label: 'Subscriptions' },
  { id: 'newest', label: 'New' },
  { id: 'updated', label: 'Updated' },
];

const PAGE_SIZES = [10, 20, 50, 100];

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function ProjectFinder({ instance, onClose, onInstalled }) {
  const rootRef = useRef(null);
  const [type, setType] = useState('mod');
  const [platform, setPlatform] = useState('modrinth');
  const [query, setQuery] = useState('');
  const [sortIndex, setSortIndex] = useState('relevance');
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  const [results, setResults] = useState(null);
  const [totalHits, setTotalHits] = useState(0);
  const [error, setError] = useState(null);
  const [installedKeys, setInstalledKeys] = useState(new Set());
  const [installing, setInstalling] = useState(new Set());
  const [rowErrors, setRowErrors] = useState({});
  const [rowNotes, setRowNotes] = useState({}); // key -> text about installed dependencies
  const [detail, setDetail] = useState(null);
  const [allCategories, setAllCategories] = useState([]);
  const [selectedCategories, setSelectedCategories] = useState(new Set());
  const [cfCategories, setCfCategories] = useState([]);
  const [selectedCfCategoryId, setSelectedCfCategoryId] = useState(null);

  useEffect(() => { getCategoryTags().then(setAllCategories).catch(() => {}); }, []);
  useEffect(() => { setSelectedCategories(new Set()); setSelectedCfCategoryId(null); }, [type]);

  useEffect(() => {
    if (platform !== 'curseforge') return;
    setCfCategories([]);
    window.api.curseforge.getCategories(type).then((res) => {
      if (res.ok) setCfCategories(res.categories);
    });
  }, [platform, type]);

  const categoryGroups = useMemo(() => {
    const groups = new Map();
    for (const c of allCategories) {
      if (c.project_type !== type) continue;
      if (!groups.has(c.header)) groups.set(c.header, []);
      groups.get(c.header).push(c);
    }
    return [...groups.entries()];
  }, [allCategories, type]);

  function toggleCategory(name) {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function refreshInstalled() {
    window.api.content.list(instance.id).then((res) => {
      if (!res.ok) return;
      setInstalledKeys(new Set(
        res.items.filter((i) => i.resolved).map((i) => `${i.resolved.platform}:${i.resolved.projectId}`)
      ));
    });
  }

  useEffect(() => { refreshInstalled(); }, [instance.id]);

  useEffect(() => { setPage(1); }, [type, platform, query, sortIndex, pageSize, selectedCategories, selectedCfCategoryId]);

  useEffect(() => {
    let cancelled = false;
    setResults(null);
    setError(null);
    const timer = setTimeout(async () => {
      try {
        if (platform === 'modrinth') {
          const r = await searchProjects({
            query, projectType: type, limit: pageSize, index: sortIndex,
            offset: (page - 1) * pageSize, mcVersion: instance.mcVersion, loader: instance.loader,
            categories: [...selectedCategories],
          });
          if (!cancelled) {
            setResults(r.hits.map((h) => ({ ...h, platform: 'modrinth' })));
            setTotalHits(r.total_hits || 0);
          }
        } else {
          const r = await window.api.curseforge.search({
            query, projectType: type, pageSize, index: (page - 1) * pageSize,
            gameVersion: instance.mcVersion, loader: instance.loader, categoryId: selectedCfCategoryId,
          });
          if (!cancelled) {
            if (!r.ok) throw new Error(r.error);
            setResults(r.hits);
            setTotalHits(r.totalCount || r.hits.length);
          }
        }
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    }, 280);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, type, platform, sortIndex, pageSize, page, instance.mcVersion, instance.loader, selectedCategories, selectedCfCategoryId]);

  const totalPages = Math.max(1, Math.ceil(totalHits / pageSize));

  // A different list (platform, type, page, search, sort, filters): start at the top.
  useResetScroll(rootRef, [platform, type, page, query, sortIndex, pageSize, selectedCategories, selectedCfCategoryId]);

  const pageNumbers = useMemo(() => {
    const nums = new Set([1, page - 1, page, page + 1, totalPages]);
    return [...nums].filter((n) => n >= 1 && n <= totalPages).sort((a, b) => a - b);
  }, [page, totalPages]);

  async function quickInstall(hit) {
    const key = `${hit.platform}:${hit.project_id}`;
    setInstalling((prev) => new Set(prev).add(key));
    setRowErrors((prev) => ({ ...prev, [key]: null }));
    setRowNotes((prev) => ({ ...prev, [key]: null }));
    try {
      let installRes = null;
      if (hit.platform === 'modrinth') {
        const versions = await getProjectVersions(hit.project_id);
        const match = versions.find((v) =>
          v.game_versions.includes(instance.mcVersion) && (type !== 'mod' || v.loaders.includes(instance.loader))
        );
        if (!match) throw new Error('No version for this instance.');
        const file = match.files.find((f) => f.primary) || match.files[0];
        const res = await window.api.modrinth.installMod(instance.id, {
          url: file.url, filename: file.filename, sha1: file.hashes?.sha1, size: file.size,
        }, type, match.id);
        if (!res.ok) throw new Error(res.error);
        installRes = res;
      } else {
        const filesRes = await window.api.curseforge.getModFiles(hit.project_id, { gameVersion: instance.mcVersion });
        if (!filesRes.ok) throw new Error(filesRes.error);
        // Loader disambiguation only makes sense for mods — resource packs
        // and shaders aren't loader-specific, any file matching the game
        // version works.
        const file = (type === 'mod'
          ? filesRes.files.find((f) => (f.gameVersions || []).some((g) => g.toLowerCase() === instance.loader))
          : null) || filesRes.files[0];
        if (!file) throw new Error('There\'s no file for this instance.');
        const res = await window.api.curseforge.installMod(instance.id, hit.project_id, file.id, type);
        if (!res.ok) throw new Error(res.error);
        installRes = res;
      }
      const note = depsNote(installRes?.deps);
      if (note && (note.text || note.warning)) setRowNotes((prev) => ({ ...prev, [key]: note }));
      setInstalledKeys((prev) => new Set(prev).add(key));
      onInstalled?.();
    } catch (e) {
      setRowErrors((prev) => ({ ...prev, [key]: e.message || 'Failure to establish' }));
    } finally {
      setInstalling((prev) => { const n = new Set(prev); n.delete(key); return n; });
    }
  }

  const typeLabel = TYPE_TABS.find((t) => t.id === type)?.label.toLowerCase() || '';

  // The list stays mounted (just hidden) under the project page, so its search, filters and scroll survive.
  const listPage = (
    <div className="fp-page" ref={rootRef} style={detail ? { display: 'none' } : undefined}>
      <div className="fp-header">
        <button className="icon-btn" onClick={onClose} title="Back"><ChevronLeft width={20} height={20} /></button>
        <div className="fp-header-icon">
          {instance.icon ? <img src={instance.icon} alt="" /> : <BoxIcon width={26} height={26} />}
        </div>
        <div>
          <h1 className="fp-header-title">{instance.name}</h1>
          <div className="fp-header-sub">
            <span>Content installation</span>
            <span className="dot" />
            <span className="fp-sub-item">Minecraft {instance.mcVersion}</span>
            {instance.loader !== 'vanilla' && (
              <>
                <span className="dot" />
                <span className="fp-sub-item">{cap(instance.loader)}</span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="pill-tabs fp-platform-tabs">
        <button className={`pill-tab ${platform === 'modrinth' ? 'active' : ''}`} onClick={() => setPlatform('modrinth')}>Modrinth</button>
        <button className={`pill-tab ${platform === 'curseforge' ? 'active' : ''}`} onClick={() => setPlatform('curseforge')}>CurseForge</button>
      </div>

      <div className="tab-bar" style={{ marginBottom: 18 }}>
        {TYPE_TABS.map((t) => (
          <button key={t.id} className={`tab-bar-btn ${type === t.id ? 'active' : ''}`} onClick={() => setType(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="fp-body">
        {platform === 'modrinth' && categoryGroups.length > 0 && (
          <aside className="fp-sidebar">
            <div className="fp-sidebar-header">
              <span className="fp-sidebar-title">Filters</span>
              {selectedCategories.size > 0 && (
                <button className="btn-text" onClick={() => setSelectedCategories(new Set())}>Drop it.</button>
              )}
            </div>
            {categoryGroups.map(([header, cats]) => (
              <div className="fp-filter-group" key={header}>
                <div className="fp-filter-group-title">{CATEGORY_HEADERS[header] || header}</div>
                {cats.map((c) => (
                  <label className="fp-filter-checkbox" key={c.name}>
                    <input
                      type="checkbox"
                      checked={selectedCategories.has(c.name)}
                      onChange={() => toggleCategory(c.name)}
                    />
                    <span>{categoryLabel(c.name)}</span>
                  </label>
                ))}
              </div>
            ))}
          </aside>
        )}

        {platform === 'curseforge' && cfCategories.length > 0 && (
          <aside className="fp-sidebar">
            <div className="fp-sidebar-header">
              <span className="fp-sidebar-title">Filters</span>
              {selectedCfCategoryId && (
                <button className="btn-text" onClick={() => setSelectedCfCategoryId(null)}>Drop it.</button>
              )}
            </div>
            <div className="fp-filter-group">
              <div className="fp-filter-group-title">Categories</div>
              {cfCategories.map((c) => (
                <label className="fp-filter-checkbox" key={c.id}>
                  <input
                    type="radio"
                    name="cf-category"
                    checked={selectedCfCategoryId === c.id}
                    onChange={() => setSelectedCfCategoryId(c.id)}
                  />
                  <span>{categoryLabel(c.name)}</span>
                </label>
              ))}
            </div>
          </aside>
        )}

        <div className="fp-main">
      <div className="fp-toolbar">
        <div className="search-bar">
          <SearchIcon width={18} height={18} />
          <input autoFocus placeholder={`Seek ${typeLabel}…`} value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>

      <div className="fp-filter-row">
        <div className="select-chip">
          Sorted:
          <Select value={sortIndex} onChange={setSortIndex} disabled={platform === 'curseforge'} options={SORT_OPTIONS.map((s) => ({ value: s.id, label: s.label }))} />
        </div>
        <div className="select-chip">
          View:
          <Select value={pageSize} onChange={setPageSize} options={PAGE_SIZES.map((n) => ({ value: n, label: String(n) }))} />
        </div>

        <div className="fp-pagination">
          <button className="fp-page-btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeft width={15} height={15} />
          </button>
          {pageNumbers.map((n, i) => (
            <span key={n} style={{ display: 'flex', alignItems: 'center' }}>
              {i > 0 && pageNumbers[i - 1] !== n - 1 && <span style={{ color: 'var(--text-faint)', padding: '0 2px' }}>…</span>}
              <button className={`fp-page-btn ${n === page ? 'active' : ''}`} onClick={() => setPage(n)}>{n}</button>
            </span>
          ))}
          <button className="fp-page-btn" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            <ChevronRight width={15} height={15} />
          </button>
        </div>
      </div>

      <div className="fp-locked-row">
        <span className="fp-locked-chip"><LockIcon width={12} height={12} /> {instance.mcVersion}</span>
        {instance.loader !== 'vanilla' && type === 'mod' && (
          <span className="fp-locked-chip"><LockIcon width={12} height={12} /> {cap(instance.loader)}</span>
        )}
      </div>

      {error && (
        <div style={{ marginBottom: 14 }}>
          <div className="error-text">{error}</div>
          {platform === 'curseforge' && error.includes('API') && (
            <div className="hint-text">CurseForge API key – add it in Settings.</div>
          )}
        </div>
      )}

      {error ? null : results === null ? (
        <div className="progress-label">Loading...</div>
      ) : results.length === 0 ? (
        <div className="empty-state"><p>Nothing found.</p></div>
      ) : (
        <div className="fp-list" key={`${platform}:${type}:${page}:${query}:${sortIndex}:${pageSize}:${[...selectedCategories].join()}:${selectedCfCategoryId}`}>
          {results.map((hit) => {
            const key = `${hit.platform}:${hit.project_id}`;
            const isInstalled = installedKeys.has(key);
            const isInstalling = installing.has(key);
            return (
              <div className="fp-row" key={key} onClick={() => setDetail({ projectId: hit.project_id, type, platform: hit.platform })}>
                {hit.icon_url ? (
                  <img className="fp-row-icon" src={hit.icon_url} alt="" />
                ) : (
                  <div className="fp-row-icon placeholder"><BoxIcon width={26} height={26} /></div>
                )}
                <div className="fp-row-body">
                  <div className="fp-row-title-line">
                    <span className="fp-row-title">{hit.title}</span>
                    <span className="fp-row-author">by {hit.author}</span>
                  </div>
                  <div className="fp-row-desc">{hit.description}</div>
                  <div className="fp-row-tags">
                    {(hit.display_categories || hit.categories || []).slice(0, 4).map((c) => (
                      <span className="fp-tag" key={c}>{categoryLabel(c)}</span>
                    ))}
                  </div>
                  {rowErrors[key] && <div className="error-text" style={{ marginTop: 6 }}>{rowErrors[key]}</div>}
                  {rowNotes[key]?.text && <div className="hint-text" style={{ marginTop: 6 }}>{rowNotes[key].text}</div>}
                  {rowNotes[key]?.warning && <div className="error-text" style={{ marginTop: 6 }}>{rowNotes[key].warning}</div>}
                </div>
                <div className="fp-row-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    className={`fp-install-btn ${isInstalled ? 'installed' : isInstalling ? 'busy' : 'do-install'}`}
                    disabled={isInstalled || isInstalling}
                    onClick={() => quickInstall(hit)}
                  >
                    {isInstalled ? (
                      <><CheckIcon width={13} height={13} /> Installed</>
                    ) : isInstalling ? 'Installation...' : (
                      <><PlusIcon width={13} height={13} /> Install</>
                    )}
                  </button>
                  <div className="fp-row-stats">
                    <span><DownloadIcon width={12} height={12} /> {formatCount(hit.downloads)}</span>
                    <span><HeartIcon width={12} height={12} /> {formatCount(hit.follows || 0)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
        </div>
      </div>

    </div>
  );

  return (
    <>
      {detail && (
        <ErrorBoundary key={`${detail.platform}:${detail.projectId}`}>
          <ProjectPage
            embedded
            platform={detail.platform}
            projectId={detail.projectId}
            type={detail.type}
            instances={[instance]}
            onBack={() => { setDetail(null); refreshInstalled(); onInstalled?.(); }}
          />
        </ErrorBoundary>
      )}
      {listPage}
    </>
  );
}