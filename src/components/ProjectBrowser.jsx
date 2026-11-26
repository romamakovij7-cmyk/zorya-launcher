import { useEffect, useMemo, useRef, useState } from 'react';
import { useResetScroll } from '../utils/useResetScroll.js';
import { searchProjects, getCategoryTags, getGameVersions } from '../api/modrinth.js';
import { categoryLabel, CATEGORY_HEADERS } from '../utils/categoryNames.js';
import PackCard from './PackCard.jsx';
import ModRow from './ModRow.jsx';
import Select from './Select.jsx';
import { SearchIcon } from './Icons.jsx';

const TYPE_LABELS = { modpack: 'Instances', mod: 'Mods', resourcepack: 'Текстурпаки', shader: 'Shaders' };
const PAGE = 30; // how many more each "Show ещё" brings

// Same sorts as Modrinth's launcher; CurseForge has its own set of fields (sortField).
const MODRINTH_SORTS = [
  { value: 'relevance', label: 'Релевантность' },
  { value: 'downloads', label: 'Загрузки' },
  { value: 'follows', label: 'Подписки' },
  { value: 'newest', label: 'Новые' },
  { value: 'updated', label: 'Обновлённые' },
];
const CURSEFORGE_SORTS = [
  { value: '2', label: 'Популярность' },
  { value: '6', label: 'Загрузки' },
  { value: '11', label: 'Новые' },
  { value: '3', label: 'Обновлённые' },
];
const LOADERS = [
  { id: 'fabric', label: 'Fabric' },
  { id: 'forge', label: 'Forge' },
  { id: 'neoforge', label: 'NeoForge' },
  { id: 'quilt', label: 'Quilt' },
];
const SIDES = [{ id: 'client', label: 'Клиент' }, { id: 'server', label: 'Server' }];

const toggled = (set, value) => { const next = new Set(set); if (next.has(value)) next.delete(value); else next.add(value); return next; };

export default function ProjectBrowser({ allowedTypes = ['modpack', 'mod'], initialType, onOpenProject }) {
  const [platform, setPlatform] = useState('modrinth');
  const [type, setType] = useState(initialType || allowedTypes[0]);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('downloads');
  const [mcVersion, setMcVersion] = useState('');
  const [loaders, setLoaders] = useState(new Set());
  const [sides, setSides] = useState(new Set());
  const [categories, setCategories] = useState(new Set());
  const [cfCategory, setCfCategory] = useState(null);
  const [results, setResults] = useState(null);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [allCategories, setAllCategories] = useState([]);
  const [cfCategories, setCfCategories] = useState([]);
  const [versions, setVersions] = useState([]);
  const rootRef = useRef(null);
  const reqRef = useRef(0); // the latest request; answers of older ones are thrown away

  // Technic only has modpacks; CurseForge is searched for mods, modpacks and resource packs (texture packs), not for shaders.
  const canTechnic = allowedTypes.includes('modpack');
  const filterable = platform !== 'technic';
  const hasLoaders = type === 'mod' || type === 'modpack';

  useEffect(() => {
    if (platform === 'curseforge' && type === 'shader') setType('mod');
    if (platform === 'technic' && type !== 'modpack') setType('modpack');
    setSort(platform === 'curseforge' ? '2' : 'downloads');
    setCategories(new Set());
    setCfCategory(null);
  }, [platform]);

  // Switching the kind of project drops the filters that belong to the old kind.
  useEffect(() => { setCategories(new Set()); setCfCategory(null); if (!hasLoaders) setLoaders(new Set()); }, [type]);

  useEffect(() => { getCategoryTags().then(setAllCategories).catch(() => {}); }, []);
  useEffect(() => { getGameVersions().then(setVersions).catch(() => {}); }, []);

  useEffect(() => {
    if (platform !== 'curseforge') return;
    setCfCategories([]);
    window.api.curseforge.getCategories(type).then((res) => { if (res.ok) setCfCategories(res.categories); }).catch(() => {});
  }, [platform, type]);

  const categoryGroups = useMemo(() => {
    const groups = new Map();
    for (const c of allCategories) {
      if (c.project_type !== type) continue;
      if (!groups.has(c.header)) groups.set(c.header, []);
      groups.get(c.header).push(c);
    }
    // Texture-pack resolutions (8x-, 16x, 32x ... 512x+) in ascending order, not as text ("128x" before "16x")
    const resolutions = groups.get('resolutions');
    if (resolutions) resolutions.sort((a, b) => parseInt(a.name, 10) - parseInt(b.name, 10));
    return [...groups.entries()];
  }, [allCategories, type]);

  const filterKey = `${platform}|${type}|${query}|${sort}|${mcVersion}|${[...loaders]}|${[...sides]}|${[...categories]}|${cfCategory}`;
  useResetScroll(rootRef, [platform, type, query]);

  // One page of results for the current search; `offset` > 0 appends to what is shown.
  async function fetchPage(offset) {
    if (platform === 'modrinth') {
      const r = await searchProjects({
        query, projectType: type, limit: PAGE, offset, index: sort, mcVersion: mcVersion || null,
        loaders: [...loaders], environment: [...sides], categories: [...categories],
      });
      return { hits: r.hits.map((h) => ({ ...h, platform: 'modrinth' })), total: r.total_hits || 0 };
    }
    if (platform === 'technic') {
      const r = await window.api.technic.search(query);
      if (!r.ok) throw new Error(r.error);
      return { hits: r.hits, total: r.hits.length };
    }
    const r = await window.api.curseforge.search({
      query, projectType: type, pageSize: PAGE, index: offset, gameVersion: mcVersion || undefined,
      // CurseForge takes one loader at a time
      loader: loaders.size === 1 ? [...loaders][0] : undefined, categoryId: cfCategory || undefined, sortField: Number(sort),
    });
    if (!r.ok) throw new Error(r.error);
    return { hits: r.hits, total: r.totalCount || r.hits.length };
  }

  useEffect(() => {
    const id = ++reqRef.current;
    setResults(null);
    setError(null);
    setLoadingMore(false);
    const timer = setTimeout(async () => {
      try {
        const page = await fetchPage(0);
        if (id !== reqRef.current) return;
        setResults(page.hits);
        setTotal(page.total);
      } catch (e) {
        if (id === reqRef.current) setError(e.message);
      }
    }, 280);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  async function showMore() {
    if (loadingMore || !results) return;
    const id = reqRef.current;
    setLoadingMore(true);
    try {
      const page = await fetchPage(results.length);
      if (id !== reqRef.current) return;
      setResults((prev) => {
        const seen = new Set(prev.map((p) => p.project_id));
        return [...prev, ...page.hits.filter((p) => !seen.has(p.project_id))];
      });
      setTotal(page.total);
    } catch (e) {
      if (id === reqRef.current) setError(e.message);
    } finally {
      if (id === reqRef.current) setLoadingMore(false);
    }
  }

  const anyFilter = !!mcVersion || loaders.size > 0 || sides.size > 0 || categories.size > 0 || !!cfCategory;
  function resetFilters() { setMcVersion(''); setLoaders(new Set()); setSides(new Set()); setCategories(new Set()); setCfCategory(null); }

  const versionOptions = useMemo(() => [{ value: '', label: 'Любая' }, ...versions.map((v) => ({ value: v, label: v }))], [versions]);
  const hasMore = !!results && results.length < total && platform !== 'technic';

  const sidebar = filterable && (
    <aside className="fp-sidebar sp-sidebar">
      <div className="fp-sidebar-header">
        <span className="fp-sidebar-title">Фильтры</span>
        {anyFilter && <button className="btn-text" onClick={resetFilters}>Reset</button>}
      </div>

      <div className="fp-filter-group">
        <div className="fp-filter-group-title">Version игры</div>
        <div className="select-chip sp-version">
          <Select value={mcVersion} onChange={setMcVersion} options={versionOptions} />
        </div>
      </div>

      {hasLoaders && (
        <div className="fp-filter-group">
          <div className="fp-filter-group-title">Loader</div>
          {LOADERS.map((l) => (
            <label className="fp-filter-checkbox" key={l.id}>
              <input type="checkbox" checked={loaders.has(l.id)} onChange={() => setLoaders((p) => toggled(p, l.id))} />
              <span>{l.label}</span>
            </label>
          ))}
          {platform === 'curseforge' && loaders.size > 1 && <div className="hint-text">CurseForge ищет по одному загрузчику — берётся первый.</div>}
        </div>
      )}

      {platform === 'modrinth' && (type === 'mod' || type === 'modpack') && (
        <div className="fp-filter-group">
          <div className="fp-filter-group-title">Среда</div>
          {SIDES.map((s) => (
            <label className="fp-filter-checkbox" key={s.id}>
              <input type="checkbox" checked={sides.has(s.id)} onChange={() => setSides((p) => toggled(p, s.id))} />
              <span>{s.label}</span>
            </label>
          ))}
        </div>
      )}

      {platform === 'modrinth' && categoryGroups.map(([header, cats]) => (
        <div className="fp-filter-group" key={header}>
          <div className="fp-filter-group-title">{CATEGORY_HEADERS[header] || header}</div>
          {cats.map((c) => (
            <label className="fp-filter-checkbox" key={c.name}>
              <input type="checkbox" checked={categories.has(c.name)} onChange={() => setCategories((p) => toggled(p, c.name))} />
              <span>{categoryLabel(c.name)}</span>
            </label>
          ))}
        </div>
      ))}

      {platform === 'curseforge' && cfCategories.length > 0 && (
        <div className="fp-filter-group">
          <div className="fp-filter-group-title">Категории</div>
          {cfCategories.map((c) => (
            <label className="fp-filter-checkbox" key={c.id}>
              <input type="radio" name="sp-cf-category" checked={cfCategory === c.id} onChange={() => setCfCategory(c.id)} />
              <span>{categoryLabel(c.name)}</span>
            </label>
          ))}
        </div>
      )}
    </aside>
  );

  return (
    <div ref={rootRef}>
      <div className="pill-tabs">
        <button className={`pill-tab ${platform === 'modrinth' ? 'active' : ''}`} onClick={() => setPlatform('modrinth')}>Modrinth</button>
        <button className={`pill-tab ${platform === 'curseforge' ? 'active' : ''}`} onClick={() => setPlatform('curseforge')}>CurseForge</button>
        {canTechnic && (
          <button className={`pill-tab ${platform === 'technic' ? 'active' : ''}`} onClick={() => setPlatform('technic')}>Technic</button>
        )}
      </div>

      <div className="search-tabs">
        {allowedTypes.filter((t) => !(platform === 'curseforge' && t === 'shader') && !(platform === 'technic' && t !== 'modpack')).map((t) => (
          <button key={t} className={`search-tab ${type === t ? 'active' : ''}`} onClick={() => setType(t)}>
            {TYPE_LABELS[t]}
          </button>
        ))}
      </div>

      <div className="search-bar">
        <SearchIcon width={18} height={18} />
        <input
          autoFocus
          placeholder={`Search: ${TYPE_LABELS[type].toLowerCase()}…`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="sp-body">
        {sidebar}

        <div className="sp-main">
          {filterable && (
            <div className="fp-filter-row">
              <div className="select-chip">
                Сортировка:
                <Select value={sort} onChange={setSort} options={platform === 'curseforge' ? CURSEFORGE_SORTS : MODRINTH_SORTS} />
              </div>
              {results && !error && <span className="hint-text">Найдено: {total.toLocaleString('ru-RU')}</span>}
            </div>
          )}

          {error && (
            <div style={{ marginBottom: 12 }}>
              <div className="error-text">{error}</div>
              {platform === 'technic' && (
                <div className="hint-text">Не получилось связаться с Technic — проверьте интернет и попробуйте ещё раз.</div>
              )}
              {platform === 'curseforge' && error.includes('API') && (
                <div className="hint-text">
                  Нужен CurseForge API key — добавьте его в Настройках (бесплатно на console.curseforge.com).
                </div>
              )}
            </div>
          )}

          {error && !results ? null : results === null ? (
            <div className="progress-label">Loading…</div>
          ) : type === 'modpack' ? (
            <div className="pack-grid">
              {results.map((p) => (
                <PackCard key={`${p.platform}:${p.project_id}`} project={p} onClick={() => onOpenProject(p.project_id, type, p.platform)} />
              ))}
              {results.length === 0 && <div className="empty-state">Ничего не найдено.</div>}
            </div>
          ) : (
            <div className="mod-list">
              {results.map((p) => (
                <ModRow key={`${p.platform}:${p.project_id}`} project={p} onClick={() => onOpenProject(p.project_id, type, p.platform)} />
              ))}
              {results.length === 0 && <div className="empty-state">Ничего не найдено.</div>}
            </div>
          )}

          {hasMore && (
            <div className="sp-more">
              <button className="btn" onClick={showMore} disabled={loadingMore}>
                {loadingMore ? 'Loading…' : 'Show ещё'}
              </button>
              <span className="hint-text">Показано {results.length} из {total.toLocaleString('ru-RU')}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
