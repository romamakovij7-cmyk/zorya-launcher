import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  getProject, getProjectVersions, getTeamMembers, formatCount, formatRelativeDate,
} from '../api/modrinth.js';
import { renderMarkdown, renderHtml } from '../utils/richText.js';
import { translateString } from '../utils/translateDom.js';
import { depsNote } from '../utils/depsSummary.js';
import { installPercent, installLabel as installStageLabel, isActiveInstall } from '../utils/installs.js';
import { categoryLabel } from '../utils/categoryNames.js';
import { PLATFORM_NAME } from '../utils/platforms.js';
import { formatBytes } from '../utils/formatBytes.js';
import RichContent from './RichContent.jsx';
import Select from './Select.jsx';
import {
  ChevronLeft, ChevronRight, CloseIcon, PauseIcon, PlayIcon, DownloadIcon, HeartIcon, CalendarIcon, ExternalLinkIcon, BoxIcon, CheckIcon,
} from './Icons.jsx';

const TYPE_LABELS = { mod: 'fashion', modpack: 'Instance', resourcepack: 'Texturp', shader: 'Scheider' };
const LOADER_NAMES = ['fabric', 'forge', 'quilt', 'neoforge'];
const CF_RELEASE = { 1: 'release', 2: 'beta', 3: 'alpha' };
const VERSION_TYPE_LABELS = { release: 'Release.', beta: 'beta', alpha: 'alpha' };
const ENV_LABELS = { required: 'Sure.', optional: 'Not necessarily.', unsupported: 'Not supported', unknown: 'Unknown.' };
const VERSIONS_PAGE = 30;

const LOADER_LABELS = { neoforge: 'NeoForge', fabric: 'Fabric', forge: 'Forge', quilt: 'Quilt' };
const cap = (s) => LOADER_LABELS[s] || (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const formatDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' }) : '—');

// "1.21.10" > "1.21.9" — newest first
function compareGameVersions(a, b) {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0);
  const pb = b.split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pb[i] || 0) - (pa[i] || 0);
    if (d) return d;
  }
  return 0;
}

function normalizeMrVersion(v) {
  return {
    key: v.id,
    name: v.name || v.version_number,
    number: v.version_number,
    type: v.version_type || 'release',
    date: v.date_published,
    downloads: v.downloads || 0,
    gameVersions: v.game_versions || [],
    loaders: v.loaders || [],
    changelog: v.changelog || '',
    raw: v,
  };
}

function normalizeCfVersion(f) {
  return {
    key: String(f.id),
    name: f.displayName || f.fileName,
    number: f.fileName,
    type: CF_RELEASE[f.releaseType] || 'release',
    date: f.fileDate,
    downloads: f.downloadCount || 0,
    gameVersions: (f.gameVersions || []).filter((g) => /^\d/.test(g)),
    loaders: (f.gameVersions || []).filter((g) => LOADER_NAMES.includes(g.toLowerCase())).map((g) => g.toLowerCase()),
    changelog: null, // loaded on demand (HTML)
    raw: f,
  };
}

function normalizeMrProject(p) {
  const links = [];
  if (p.source_url) links.push({ label: 'Source code', url: p.source_url });
  if (p.issues_url) links.push({ label: 'Report the problem', url: p.issues_url });
  if (p.wiki_url) links.push({ label: 'Vicky.', url: p.wiki_url });
  if (p.discord_url) links.push({ label: 'Discord', url: p.discord_url });
  (p.donation_urls || []).forEach((d) => links.push({ label: `Support (Support)${d.platform})`, url: d.url }));
  const gallery = [...(p.gallery || [])]
    .sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || (a.ordering || 0) - (b.ordering || 0))
    .map((g) => ({ thumb: g.url, full: g.raw_url || g.url, title: g.title || '', description: g.description || '' }));
  return {
    title: p.title,
    summary: p.description || '',
    icon: p.icon_url,
    downloads: p.downloads || 0,
    likes: p.followers || 0,
    likesLabel: 'subscriber',
    categories: [...new Set([...(p.categories || []), ...(p.additional_categories || [])])].filter((c) => !LOADER_NAMES.includes(c)),
    body: p.body || '',
    bodyKind: 'md',
    gallery,
    links,
    license: p.license?.name || p.license?.id || null,
    env: p.project_type === 'mod' ? { client: p.client_side, server: p.server_side } : null,
    published: p.published,
    updated: p.updated,
    gameVersions: [...(p.game_versions || [])].sort(compareGameVersions),
    loaders: (p.loaders || []).filter((l) => LOADER_NAMES.includes(l)),
    teamId: p.team,
    webUrl: `https://modrinth.com/${p.project_type}/${p.slug}`,
    authors: [],
  };
}

function normalizeCfProject(m) {
  const links = [];
  if (m.links?.source) links.push({ label: 'Source code', url: m.links.source });
  if (m.links?.issues) links.push({ label: 'Report the problem', url: m.links.issues });
  if (m.links?.wiki) links.push({ label: 'Vicky.', url: m.links.wiki });
  return {
    title: m.title,
    summary: m.description || '',
    icon: m.icon_url,
    downloads: m.downloads || 0,
    likes: m.likes || 0,
    likesLabel: 'likes',
    categories: m.categories || [],
    body: '',
    bodyKind: 'html',
    gallery: (m.screenshots || []).map((s) => ({ thumb: s.thumb, full: s.url, title: s.title, description: s.description })),
    links,
    license: null,
    env: null,
    published: m.published,
    updated: m.updated,
    gameVersions: [...(m.game_versions || [])].sort(compareGameVersions),
    loaders: m.loaders || [],
    teamId: null,
    webUrl: m.links?.website || null,
    authors: (m.authors || []).map((a) => ({ name: a.name, url: a.url })),
  };
}

// Technic: a pack record from the Technic Platform API (see electron/mc/technic.js).
function normalizeTechnicProject(p) {
  const feed = p.feed || [];
  const news = feed.length
    ? `\n\n#### instance news n${feed.map((f) => `- **${new Date(f.date * 1000).toLocaleDateString('en-US')}** · ${f.user}: ${f.content}`).join('\n')}`
    : '';
  const links = [];
  if (p.platformUrl) links.push({ label: 'Page on Technic', url: p.platformUrl });
  if (p.serverPackUrl) links.push({ label: 'Server version', url: p.serverPackUrl });
  return {
    title: p.title,
    summary: p.description || '',
    icon: p.icon_url,
    downloads: p.installs || 0,
    likes: 0,
    likesLabel: '',
    categories: [],
    body: `${p.description || ''}${news}`,
    bodyKind: 'md',
    gallery: [p.logo?.url, p.background?.url].filter(Boolean).map((u) => ({ thumb: u, full: u, title: '', description: '' })),
    links,
    license: null,
    env: null,
    published: null,
    updated: feed[0]?.date ? new Date(feed[0].date * 1000).toISOString() : null,
    gameVersions: [],
    loaders: [],
    teamId: null,
    webUrl: p.platformUrl || null,
    authors: p.user ? [{ name: p.user }] : [],
  };
}

// Builds arrive newest-first. Anything newer than the recommended build is
// marked beta, so the default pick (newest "release") is the recommended one.
function normalizeTechnicBuilds({ builds, recommended }) {
  const recIdx = recommended ? builds.indexOf(recommended) : -1;
  return builds.map((b, i) => ({
    key: b,
    name: b,
    number: b,
    type: recIdx > 0 && i < recIdx ? 'beta' : 'release',
    date: null,
    downloads: 0,
    gameVersions: [],
    loaders: [],
    changelog: '',
    raw: { build: b },
  }));
}

// Technic installed mods straight into minecraft.jar before 1.7; we can't run those.
const mcOlderThan17 = (v) => {
  const [a, b] = String(v).split('.').map((x) => parseInt(x, 10) || 0);
  return a < 1 || (a === 1 && b < 7);
};

function Lightbox({ items, index, onIndex, onClose }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.code === 'Escape') onClose();
      else if (e.code === 'ArrowRight') onIndex((index + 1) % items.length);
      else if (e.code === 'ArrowLeft') onIndex((index - 1 + items.length) % items.length);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, items.length, onIndex, onClose]);
  const item = items[index];
  const step = (d) => onIndex((index + d + items.length) % items.length);
  return createPortal(
    <div className="lightbox-overlay" onClick={onClose}>
      <div className="lightbox-stage" onClick={(e) => e.stopPropagation()}>
        {items.length > 1 ? (
          <button className="lightbox-nav" onClick={() => step(-1)} title="Back"><ChevronLeft width={24} height={24} /></button>
        ) : <div className="lightbox-nav-spacer" />}
        <div className="lightbox-body">
          <button className="icon-btn lightbox-close" onClick={onClose} title="Close (Esc)"><CloseIcon /></button>
          <div className="lightbox-image-wrap">
            <img src={item.full} alt={item.title} referrerPolicy="no-referrer" />
          </div>
          <div className="lightbox-toolbar">
            <div>
              <div className="lightbox-title">{item.title || `Image: ${index + 1}`}</div>
              <div className="lightbox-sub">{item.description ? `${item.description} · ` : ''}{index + 1} / {items.length}</div>
            </div>
          </div>
        </div>
        {items.length > 1 ? (
          <button className="lightbox-nav" onClick={() => step(1)} title="Forward"><ChevronRight width={24} height={24} /></button>
        ) : <div className="lightbox-nav-spacer" />}
      </div>
    </div>,
    document.body,
  );
}
function VersionRow({
  v, platform, projectId, selected, fits, onSelect, protect,
}) {
  const [open, setOpen] = useState(false);
  const [changelog, setChangelog] = useState(v.changelog);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && changelog === null) {
      setLoading(true);
      setErr(null);
      try {
        const res = await window.api.curseforge.getChangelog(projectId, v.raw.id);
        if (!res.ok) throw new Error(res.error);
        setChangelog(res.html || '');
      } catch (e) {
        setErr(e.message);
      } finally {
        setLoading(false);
      }
    }
  }

  const html = useMemo(() => {
    if (!changelog) return '';
    return platform === 'modrinth' ? renderMarkdown(changelog) : renderHtml(changelog);
  }, [changelog, platform]);

  return (
    <div className={`pp-version ${selected ? 'selected' : ''}`}>
      <div className="pp-version-head">
        <div className="pp-version-main">
          <div className="pp-version-title">
            <span className="pp-version-name">{v.name}</span>
            <span className={`pp-vtype ${v.type}`}>{VERSION_TYPE_LABELS[v.type] || v.type}</span>
            {fits && <span className="pp-fits" title="Suitable for the selected instance"><CheckIcon width={12} height={12} /> Suitable.</span>}
          </div>
          <div className="pp-version-meta">
            <span>{v.number}</span>
            <span>{v.gameVersions.slice(0, 4).join(', ')}{v.gameVersions.length > 4 ? ` +${v.gameVersions.length - 4}` : ''}</span>
            {v.loaders.length > 0 && <span>{v.loaders.map(cap).join(' / ')}</span>}
            {v.date && <span><CalendarIcon width={12} height={12} /> {formatRelativeDate(v.date)}</span>}
            {platform !== 'technic' && <span><DownloadIcon width={12} height={12} /> {formatCount(v.downloads)}</span>}
          </div>
        </div>
        <div className="pp-version-actions">
          {platform !== 'technic' && <button className="btn" onClick={toggle}>{open ? 'Hide.' : 'Changes in changes'}</button>}
          <button className={`btn ${selected ? '' : 'btn-primary'}`} onClick={onSelect} disabled={selected}>{selected ? 'Selected' : 'Choose.'}</button>
        </div>
      </div>
      {open && (
        <div className="pp-version-changelog">
          {loading && <div className="progress-label">Loading...</div>}
          {err && <div className="error-text">{err}</div>}
          {!loading && !err && (html ? <RichContent html={html} compact protect={protect} /> : <div className="hint-text">There is no description of the changes.</div>)}
        </div>
      )}
    </div>
  );
}

export default function ProjectPage({
  platform, projectId, type, instances, embedded = false, onBack, onOpenInstance, installs = [], onInstallModpack, onControlInstall,
}) {
  const [info, setInfo] = useState(null);
  const [rawProject, setRawProject] = useState(null);
  const [versions, setVersions] = useState(null);
  const [description, setDescription] = useState(null); // html (already sanitised)
  const [members, setMembers] = useState([]);
  const [tab, setTab] = useState('description');
  const [error, setError] = useState(null);
  const [selectedKey, setSelectedKey] = useState('');
  const [targetInstanceId, setTargetInstanceId] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [installError, setInstallError] = useState(null);
  const [done, setDone] = useState(false);
  const [depsInfo, setDepsInfo] = useState(null); // { text, warning } about installed dependencies
  const [lightbox, setLightbox] = useState(null);
  const [filterGv, setFilterGv] = useState('');
  const [filterLoader, setFilterLoader] = useState('');
  const [filterType, setFilterType] = useState('');
  const [shown, setShown] = useState(VERSIONS_PAGE);
  const [showAllGv, setShowAllGv] = useState(false);
  const [summaryRu, setSummaryRu] = useState(null);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const rootRef = useRef(null);
  const aliveRef = useRef(true);
  // (set true again on mount: React StrictMode runs the cleanup once during dev)
  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false; }; }, []);

  // Opening a project always starts at the top of the page.
  useLayoutEffect(() => {
    const page = rootRef.current?.closest('.main-content');
    if (page) page.scrollTop = 0;
  }, [projectId, platform]);

  useEffect(() => {
    let alive = true;
    setInfo(null); setRawProject(null); setVersions(null); setDescription(null); setMembers([]);
    setError(null); setSelectedKey(''); setTab('description'); setDone(false); setInstallError(null);
    setSummaryRu(null); setShown(VERSIONS_PAGE); setFilterGv(''); setFilterLoader(''); setFilterType('');

    const fail = (e) => { if (alive) setError(e.message); };
    if (platform === 'modrinth') {
      getProject(projectId).then((p) => {
        if (!alive) return;
        setRawProject(p);
        const n = normalizeMrProject(p);
        setInfo(n);
        setDescription(renderMarkdown(n.body));
        if (n.teamId) getTeamMembers(n.teamId).then((m) => { if (alive) setMembers(m); }).catch(() => {});
      }).catch(fail);
      getProjectVersions(projectId).then((list) => { if (alive) setVersions(list.map(normalizeMrVersion)); }).catch(fail);
    } else if (platform === 'technic') {
      window.api.technic.getModpack(projectId).then((res) => {
        if (!res.ok) throw new Error(res.error);
        if (!alive) return;
        setRawProject(res.pack);
        const n = normalizeTechnicProject(res.pack);
        setInfo(n);
        setDescription(renderMarkdown(n.body));
      }).catch(fail);
      window.api.technic.getBuilds(projectId).then((res) => {
        if (!res.ok) throw new Error(res.error);
        if (alive) setVersions(normalizeTechnicBuilds(res));
      }).catch(fail);
    } else {
      window.api.curseforge.getModDetails(projectId).then((res) => {
        if (!res.ok) throw new Error(res.error);
        if (!alive) return;
        setRawProject(res.mod);
        setInfo(normalizeCfProject(res.mod));
      }).catch(fail);
      window.api.curseforge.getDescription(projectId).then((res) => {
        if (alive) setDescription(res.ok ? renderHtml(res.html) : '');
      }).catch(() => { if (alive) setDescription(''); });
      window.api.curseforge.getModFiles(projectId, {}).then((res) => {
        if (!res.ok) throw new Error(res.error);
        if (alive) setVersions(res.files.map(normalizeCfVersion));
      }).catch(fail);
    }

    const api = window.api[platform] || window.api.curseforge;
    const off = api.onInstallProgress((p) => { if (p.projectId === projectId) setProgress(p); });
    return () => { alive = false; off?.(); };
  }, [projectId, platform]);

  const fitsInstance = (v, inst) => v.gameVersions.includes(inst.mcVersion) && (type !== 'mod' || v.loaders.includes(inst.loader));

  // Pick a sensible default version: the newest one that fits the (only) target instance.
  useEffect(() => {
    if (!versions || !versions.length || selectedKey) return;
    // Newest stable release; if the user has a build it fits, prefer that one.
    const stable = versions.filter((v) => v.type === 'release');
    const pool = stable.length ? stable : versions;
    const fitting = type !== 'modpack' && (instances || []).length
      ? pool.find((v) => instances.some((i) => fitsInstance(v, i)))
      : null;
    const best = fitting || pool[0];
    setSelectedKey(best.key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versions]);

  const installKey = rawProject ? `${platform}:${platform === 'modrinth' ? rawProject.id : rawProject.project_id}` : null;
  const packInstall = installKey ? installs.find((i) => i.key === installKey) : null;
  const packRunning = !!packInstall && isActiveInstall(packInstall);
  const packPaused = packInstall?.status === 'paused';

  const selectedVersion = useMemo(() => versions?.find((v) => v.key === selectedKey) || null, [versions, selectedKey]);

  // Technic builds say nothing about themselves in the list, so what the chosen
  // one consists of (Minecraft, Java, mods, size) is fetched on demand.
  const [buildInfo, setBuildInfo] = useState(null);
  useEffect(() => {
    setBuildInfo(null);
    if (platform !== 'technic' || !selectedKey) return undefined;
    let alive = true;
    window.api.technic.getBuild(projectId, selectedKey).then((res) => {
      if (alive) setBuildInfo(res.ok ? res.build : { error: res.error });
    });
    return () => { alive = false; };
  }, [platform, projectId, selectedKey]);
  const technicTooOld = platform === 'technic' && !!buildInfo?.minecraft && mcOlderThan17(buildInfo.minecraft);

  const compatibleInstances = useMemo(() => {
    if (!selectedVersion || type === 'modpack') return [];
    return (instances || []).filter((i) => fitsInstance(selectedVersion, i));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVersion, instances, type]);

  useEffect(() => {
    if (type === 'modpack') return;
    if (!compatibleInstances.some((i) => i.id === targetInstanceId)) setTargetInstanceId(compatibleInstances[0]?.id || '');
  }, [compatibleInstances]);

  const gameVersionOptions = useMemo(() => {
    const set = new Set();
    (versions || []).forEach((v) => v.gameVersions.forEach((g) => set.add(g)));
    return [...set].sort(compareGameVersions);
  }, [versions]);
  const loaderOptions = useMemo(() => {
    const set = new Set();
    (versions || []).forEach((v) => v.loaders.forEach((l) => set.add(l)));
    return [...set];
  }, [versions]);

  const filteredVersions = useMemo(() => (versions || []).filter((v) => (
    (!filterGv || v.gameVersions.includes(filterGv))
    && (!filterLoader || v.loaders.includes(filterLoader))
    && (!filterType || v.type === filterType)
  )), [versions, filterGv, filterLoader, filterType]);

  async function handleInstall() {
    if (!selectedVersion) return;
    setBusy(true); setInstallError(null); setProgress(null); setDone(false); setDepsInfo(null);
    try {
      if (type === 'modpack') {
        // The download is tracked by the app (library card + title bar), so it
        // carries on if this page is closed; if we're still here, open the new build.
        const res = await onInstallModpack({
          platform, project: rawProject, version: selectedVersion.raw, title: info.title, icon: info.icon,
        });
        if (res.cancelled) return; // the user cancelled: nothing to report
        if (!res.ok) throw new Error(res.error);
        if (aliveRef.current) { setDone(true); onOpenInstance?.(res.instance.id); }
      } else if (platform === 'modrinth') {
        const file = selectedVersion.raw.files.find((f) => f.primary) || selectedVersion.raw.files[0];
        const res = await window.api.modrinth.installMod(targetInstanceId, {
          url: file.url, filename: file.filename, sha1: file.hashes?.sha1, size: file.size,
        }, type, selectedVersion.raw.id);
        if (!res.ok) throw new Error(res.error);
        setDepsInfo(depsNote(res.deps));
        setDone(true);
      } else {
        const res = await window.api.curseforge.installMod(targetInstanceId, projectId, selectedVersion.raw.id, type);
        if (!res.ok) throw new Error(res.error);
        setDepsInfo(depsNote(res.deps));
        setDone(true);
      }
    } catch (e) {
      setInstallError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function translateSummary() {
    if (summaryRu !== null) { setSummaryRu(null); return; }
    setSummaryBusy(true);
    try { setSummaryRu(await translateString(info.summary, [info.title])); } catch { /* keep the original */ } finally { setSummaryBusy(false); }
  }

  if (error && !info) {
    return (
      <div className={`pp ${embedded ? 'embedded' : ''}`} ref={rootRef}>
        <div className="pp-top"><button className="icon-btn" onClick={onBack} title="Back"><ChevronLeft width={20} height={20} /></button></div>
        <div className="error-text">{error}</div>
        {platform === 'curseforge' && /API|key|key/i.test(error) && <div className="hint-text">CurseForge API key – add it in Settings.</div>}
      </div>
    );
  }
  if (!info) {
    return (
      <div className={`pp ${embedded ? 'embedded' : ''}`} ref={rootRef}>
        <div className="pp-top"><button className="icon-btn" onClick={onBack} title="Back"><ChevronLeft width={20} height={20} /></button></div>
        <div className="progress-label">Loading...</div>
      </div>
    );
  }

  const visibleGv = showAllGv ? info.gameVersions : info.gameVersions.slice(0, 14);
  const installLabel = type === 'modpack' ? 'Set as a new instance' : 'Install';
  const authorText = info.authors.length ? info.authors.map((a) => a.name).join(', ') : (members.find((m) => m.role === 'Owner') || members[0])?.user?.username;

  return (
    <div className={`pp ${embedded ? 'embedded' : ''}`} ref={rootRef}>
      <div className="pp-top">
        <button className="icon-btn" onClick={onBack} title="Back"><ChevronLeft width={20} height={20} /></button>
        <span className="pp-crumb">{TYPE_LABELS[type] || 'Project'} · {PLATFORM_NAME[platform] || platform}</span>
        {info.webUrl && (
          <button className="btn pp-web" onClick={() => window.api.shell.openExternal(info.webUrl)}>
            <ExternalLinkIcon width={14} height={14} /> Open on the site
          </button>
        )}
      </div>

      <div className="pp-hero">
        {info.icon ? <img className="pp-icon" src={info.icon} alt="" referrerPolicy="no-referrer" /> : <div className="pp-icon placeholder"><BoxIcon width={40} height={40} /></div>}
        <div className="pp-hero-text">
          <h1 className="pp-title">{info.title}</h1>
          <p className="pp-summary">{summaryRu ?? info.summary}</p>
          <div className="pp-hero-meta">
            {authorText && <span>from {authorText}</span>}
            <span><DownloadIcon width={14} height={14} /> {formatCount(info.downloads)} loading</span>
            {info.likes > 0 && <span><HeartIcon width={14} height={14} /> {formatCount(info.likes)} {info.likesLabel}</span>}
            {info.updated && <span><CalendarIcon width={14} height={14} /> updated {formatRelativeDate(info.updated)}</span>}
            <button className="btn-text" onClick={translateSummary} disabled={summaryBusy}>
              {summaryBusy ? 'Translation...' : summaryRu !== null ? 'Original' : 'Translate description'}
            </button>
          </div>
          {info.categories.length > 0 && (
            <div className="pp-tags">{info.categories.map((c) => <span className="fp-tag" key={c}>{categoryLabel(c)}</span>)}</div>
          )}
        </div>
      </div>

      <div className="pp-cols">
        <div className="pp-main">
          <div className="pill-tabs pp-tabs">
            <button className={`pill-tab ${tab === 'description' ? 'active' : ''}`} onClick={() => setTab('description')}>Description</button>
            <button className={`pill-tab ${tab === 'gallery' ? 'active' : ''}`} onClick={() => setTab('gallery')}>
              Gallery{info.gallery.length ? ` (${info.gallery.length})` : ''}
            </button>
            <button className={`pill-tab ${tab === 'versions' ? 'active' : ''}`} onClick={() => setTab('versions')}>
              Versions{versions ? ` (${versions.length})` : ''}
            </button>
          </div>

          {/* Kept mounted (just hidden) so a translation isn't lost when switching tabs. */}
          <div style={{ display: tab === 'description' ? 'block' : 'none' }}>
            {description === null ? <div className="progress-label">Download description ...</div>
              : description ? <RichContent html={description} protect={[info.title]} />
                : <div className="hint-text">The project does not have a detailed description.</div>}
          </div>

          {tab === 'gallery' && (
            info.gallery.length === 0 ? <div className="empty-state"><p>There's nothing in the gallery yet.</p></div> : (
              <div className="pp-gallery">
                {info.gallery.map((g, i) => (
                  <button className="pp-shot" key={g.full} onClick={() => setLightbox(i)} title={g.title || 'Open'}>
                    <img src={g.thumb} alt={g.title} loading="lazy" referrerPolicy="no-referrer" />
                    {g.title && <span className="pp-shot-title">{g.title}</span>}
                  </button>
                ))}
              </div>
            )
          )}

          {tab === 'versions' && (
            versions === null ? <div className="progress-label">Download versions ...</div> : versions.length === 0 ? (
              <div className="error-text">This project does not have available versions for download.</div>
            ) : (
              <>
                <div className="pp-filters">
                  <Select value={filterGv} onChange={(v) => { setFilterGv(v); setShown(VERSIONS_PAGE); }} className="plain-select"
                    options={[{ value: '', label: 'All versions of the game' }, ...gameVersionOptions.map((g) => ({ value: g, label: g }))]} />
                  {loaderOptions.length > 0 && (
                    <Select value={filterLoader} onChange={(v) => { setFilterLoader(v); setShown(VERSIONS_PAGE); }} className="plain-select"
                      options={[{ value: '', label: 'All loaders.' }, ...loaderOptions.map((l) => ({ value: l, label: cap(l) }))]} />
                  )}
                  <Select value={filterType} onChange={(v) => { setFilterType(v); setShown(VERSIONS_PAGE); }} className="plain-select"
                    options={[{ value: '', label: 'Any type' }, { value: 'release', label: 'Releases' }, { value: 'beta', label: 'beta' }, { value: 'alpha', label: 'alpha' }]} />
                  <span className="hint-text">{filteredVersions.length} from {versions.length}</span>
                </div>
                {filteredVersions.slice(0, shown).map((v) => (
                  <VersionRow
                    key={v.key}
                    v={v}
                    platform={platform}
                    projectId={projectId}
                    selected={v.key === selectedKey}
                    fits={embedded && instances?.length === 1 && type !== 'modpack' && fitsInstance(v, instances[0])}
                    protect={[info.title]}
                    onSelect={() => { setSelectedKey(v.key); setDone(false); setInstallError(null); }}
                  />
                ))}
                {filteredVersions.length === 0 && <div className="empty-state"><p>There are no versions on these filters.</p></div>}
                {filteredVersions.length > shown && (
                  <button className="btn" style={{ marginTop: 12 }} onClick={() => setShown((n) => n + VERSIONS_PAGE)}>Show me more.</button>
                )}
              </>
            )
          )}
        </div>

        <aside className="pp-side">
          <div className="pp-card">
            <div className="pp-card-title">Installation</div>
            {versions === null ? <div className="progress-label">Download versions ...</div> : versions.length === 0 ? (
              <div className="error-text">There are no download versions.</div>
            ) : (
              <>
                <div className="field">
                  <label>Version.</label>
                  <Select
                    value={selectedKey}
                    onChange={(v) => { setSelectedKey(v); setDone(false); setInstallError(null); }}
                    options={versions.map((v) => ({ value: v.key, label: v.gameVersions.length ? `${v.name} · ${v.gameVersions.slice(0, 2).join(', ')}` : v.name, hint: v.type !== 'release' ? VERSION_TYPE_LABELS[v.type] : '' }))}
                  />
                </div>
                {platform === 'technic' && (
                  buildInfo === null ? <div className="hint-text" style={{ marginBottom: 8 }}>Download the composition of the version...</div>
                    : buildInfo.error ? <div className="error-text">{buildInfo.error}</div>
                      : (
                        <div className="hint-text" style={{ marginBottom: 10, lineHeight: 1.6 }}>
                          {buildInfo.minecraft && <div>Minecraft {buildInfo.minecraft}{buildInfo.java ? ` · Java ${buildInfo.java}` : ''}</div>}
                          <div>
                            {buildInfo.modCount > 1 ? `Files: ${buildInfo.modCount}` : 'One archive.'}
                            {buildInfo.totalBytes ? ` · ≈ ${formatBytes(buildInfo.totalBytes)}` : ''}
                            {buildInfo.memory ? ` • memory: ${(buildInfo.memory / 1024).toFixed(buildInfo.memory % 1024 ? 1 : 0)} GB` : ''}
                          </div>
                          {technicTooOld && (
                            <div className="error-text" style={{ marginTop: 6 }}>
                              This version is for Minecraft {buildInfo.minecraft}Technic then put mods straight into minecraft. Jar, and the launcher can not run such instances. Select the version for 1.7 and later.
                            </div>
                          )}
                        </div>
                      )
                )}
                {type !== 'modpack' && (
                  <div className="field">
                    <label>Set in instance</label>
                    {compatibleInstances.length === 0 ? (
                      <div className="hint-text">
                        There’s no suitable instance. We need instance for {selectedVersion?.gameVersions[0] || '—'}{type === 'mod' ? ` / ${selectedVersion?.loaders.map(cap).join(', ') || '—'}` : ''}. Another version can be selected in the tab «Versions».
                      </div>
                    ) : (
                      <Select value={targetInstanceId} onChange={setTargetInstanceId} options={compatibleInstances.map((i) => ({ value: i.id, label: i.name }))} />
                    )}
                  </div>
                )}
                {installError && <div className="error-text">{installError}</div>}
                {done && <div className="pp-done"><CheckIcon width={14} height={14} /> Successfully installed</div>}
                {done && depsInfo?.text && <div className="hint-text" style={{ marginBottom: 8 }}>{depsInfo.text}</div>}
                {done && depsInfo?.warning && <div className="error-text" style={{ marginBottom: 8 }}>{depsInfo.warning}</div>}
                {packRunning && (
                  <div className="download-tile-bar" style={{ marginBottom: 10 }}>
                    <div className={`progress-bar-track ${installPercent(packInstall) == null ? 'indeterminate' : ''}`}>
                      <div className="progress-bar-fill" style={installPercent(packInstall) == null ? undefined : { width: `${installPercent(packInstall)}%` }} />
                    </div>
                    <span className="download-tile-pct">{installPercent(packInstall) == null ? '' : `${installPercent(packInstall)}%`}</span>
                    <button
                      className="download-tile-btn"
                      onClick={() => onControlInstall?.(packInstall.id, packPaused ? 'resume' : 'pause')}
                      disabled={packInstall.status === 'cancelling'}
                      title={packPaused ? 'Continue.' : 'Pause'}
                    >
                      {packPaused ? <PlayIcon width={13} height={13} /> : <PauseIcon width={13} height={13} />}
                    </button>
                    <button
                      className="download-tile-btn danger"
                      disabled={packInstall.status === 'cancelling'}
                      title="Cancel loading"
                      onClick={() => { if (confirm(`Cancel loading “${info.title}? Already downloaded files will be deleted.`)) onControlInstall?.(packInstall.id, 'cancel'); }}
                    >
                      <CloseIcon width={13} height={13} />
                    </button>
                  </div>
                )}
                {packRunning && <div className="hint-text" style={{ marginBottom: 8 }}>{installStageLabel(packInstall)}. You can leave the page – the download will continue.</div>}
                {!packRunning && packInstall?.status === 'error' && <div className="error-text">{packInstall.error}</div>}
                {busy && type !== 'modpack' && progress && <div className="progress-label">{progress.stage}{progress.total ? ` (${progress.completed}/${progress.total})` : ''}</div>}
                <button
                  className="btn btn-primary pp-install"
                  onClick={handleInstall}
                  disabled={busy || packRunning || !selectedVersion || technicTooOld || (platform === 'technic' && buildInfo === null) || (type !== 'modpack' && !targetInstanceId)}
                >
                  {busy || packRunning ? (type === 'modpack' ? 'Downloads...' : 'Installation...') : installLabel}
                </button>
              </>
            )}
          </div>

          {(info.loaders.length > 0 || info.gameVersions.length > 0 || info.env) && (
          <div className="pp-card">
            <div className="pp-card-title">Compatibility</div>
            {info.loaders.length > 0 && (
              <div className="pp-kv"><span>Downloaders.</span><div className="pp-chips">{info.loaders.map((l) => <span className="fp-tag" key={l}>{cap(l)}</span>)}</div></div>
            )}
            {info.gameVersions.length > 0 && (
              <div className="pp-kv">
                <span>Game versions</span>
                <div className="pp-chips">
                  {visibleGv.map((g) => <span className="fp-tag" key={g}>{g}</span>)}
                  {info.gameVersions.length > 14 && (
                    <button className="btn-text" onClick={() => setShowAllGv((v) => !v)}>{showAllGv ? 'Swerve' : `still ${info.gameVersions.length - 14}`}</button>
                  )}
                </div>
              </div>
            )}
            {info.env && (
              <>
                <div className="pp-kv inline"><span>Client</span><strong>{ENV_LABELS[info.env.client] || '—'}</strong></div>
                <div className="pp-kv inline"><span>server</span><strong>{ENV_LABELS[info.env.server] || '—'}</strong></div>
              </>
            )}
          </div>
          )}

          {info.links.length > 0 && (
            <div className="pp-card">
              <div className="pp-card-title">References</div>
              {info.links.map((l) => (
                <button className="pp-link" key={l.url} onClick={() => window.api.shell.openExternal(l.url)}>
                  <ExternalLinkIcon width={13} height={13} /> {l.label}
                </button>
              ))}
            </div>
          )}

          {(members.length > 0 || info.authors.length > 0) && (
            <div className="pp-card">
              <div className="pp-card-title">Makers</div>
              {members.map((m) => (
                <div className="pp-member" key={m.user.id}>
                  {m.user.avatar_url && <img src={m.user.avatar_url} alt="" referrerPolicy="no-referrer" />}
                  <div><strong>{m.user.username}</strong><span>{m.role}</span></div>
                </div>
              ))}
              {info.authors.map((a) => (
                <div className="pp-member" key={a.name}><div><strong>{a.name}</strong></div></div>
              ))}
            </div>
          )}

          <div className="pp-card">
            <div className="pp-card-title">Information</div>
            <div className="pp-kv inline"><span>Posted</span><strong>{formatDate(info.published)}</strong></div>
            <div className="pp-kv inline"><span>Updated</span><strong>{formatDate(info.updated)}</strong></div>
            {info.license && <div className="pp-kv inline"><span>License.</span><strong>{info.license}</strong></div>}
          </div>
        </aside>
      </div>

      {lightbox !== null && (
        <Lightbox items={info.gallery} index={lightbox} onIndex={setLightbox} onClose={() => setLightbox(null)} />
      )}
    </div>
  );
}
