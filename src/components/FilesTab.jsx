import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FolderIcon, FileTextIcon, ChevronRight, UploadIcon, PlusIcon, RefreshIcon,
  TrashIcon, EditIcon, SearchIcon, CloseIcon, ChevronDownIcon,
} from './Icons.jsx';
import FileEditorModal from './FileEditorModal.jsx';
import { extensionOf } from '../utils/configParse.js';

const QUICK_LINKS = [
  { label: 'Fashions', path: 'mods' },
  { label: 'Config.', path: 'config' },
  { label: 'Resources', path: 'resourcepacks' },
  { label: 'Shaderpaks', path: 'shaderpacks' },
  { label: 'Screenshots', path: 'screenshots' },
  { label: 'Worlds', path: 'saves' },
  { label: 'Logs.', path: 'logs' },
];

// Extensions the built-in editor opens on double click.
const TEXT_EXTENSIONS = new Set([
  'txt', 'json', 'json5', 'jsonc', 'toml', 'cfg', 'conf', 'config', 'properties', 'yml', 'yaml', 'ini', 'xml',
  'mcmeta', 'snbt', 'log', 'md', 'csv', 'lang', 'mcfunction', 'js', 'ts', 'html', 'css', 'txt~', 'bak',
  'env', 'gitignore', 'sh', 'bat', 'cmd', 'ps1', 'lua', 'py', 'java', 'kts', 'gradle',
]);
const MAX_EDIT_BYTES = 2 * 1024 * 1024;

function isEditable(entry) {
  if (entry.isDir || entry.size > MAX_EDIT_BYTES) return false;
  const ext = extensionOf(entry.name);
  return TEXT_EXTENSIONS.has(ext) || (!ext && entry.size < 64 * 1024 && !entry.name.startsWith('.'));
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B.`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const SORTS = { name: 'Name.', size: 'Size', mtime: 'Changed.' };

export default function FilesTab({ instance }) {
  const [currentPath, setCurrentPath] = useState('');
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState(null);
  const [renaming, setRenaming] = useState(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [creating, setCreating] = useState(null); // 'folder' | 'file' | null
  const [newName, setNewName] = useState('');
  const [query, setQuery] = useState('');
  const [deep, setDeep] = useState(false); // search subfolders too
  const [searchRes, setSearchRes] = useState(null); // { results, truncated } | 'loading'
  const [sort, setSort] = useState({ key: 'name', dir: 'asc' });
  const [selected, setSelected] = useState(new Set());
  const [editing, setEditing] = useState(null); // relPath being edited
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const searchSeq = useRef(0);
  const inlineBusy = useRef(false); // Enter + blur both fire the same handler; run it once

  const segments = useMemo(() => currentPath.split('/').filter(Boolean), [currentPath]);
  const searching = deep && query.trim().length > 0;

  async function load() {
    setError(null);
    const res = await window.api.files.list(instance.id, currentPath);
    if (res.ok) setEntries(res.entries);
    else { setError(res.error); setEntries([]); }
  }

  useEffect(() => { setEntries(null); setSelected(new Set()); load(); }, [instance.id, currentPath]);
  useEffect(() => { setCurrentPath(''); setQuery(''); }, [instance.id]);

  // Subfolder search: debounced, and stale answers are ignored.
  useEffect(() => {
    if (!searching) { setSearchRes(null); return undefined; }
    setSearchRes('loading');
    const seq = ++searchSeq.current;
    const timer = setTimeout(async () => {
      const res = await window.api.files.search(instance.id, currentPath, query.trim());
      if (seq !== searchSeq.current) return;
      setSearchRes(res.ok ? { results: res.results, truncated: res.truncated } : { results: [], truncated: false, error: res.error });
    }, 350);
    return () => clearTimeout(timer);
  }, [searching, query, currentPath, instance.id, refreshTick]);

  function joinPath(name) {
    return currentPath ? `${currentPath}/${name}` : name;
  }

  // Path of a row: search results carry their own relative path.
  const pathOf = (entry) => entry.relPath || joinPath(entry.name);

  const rows = useMemo(() => {
    let list;
    if (searching) list = searchRes && searchRes !== 'loading' ? searchRes.results : [];
    else {
      const q = query.trim().toLowerCase();
      list = (entries || []).filter((e) => !q || e.name.toLowerCase().includes(q));
    }
    const sign = sort.dir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1; // folders always first
      if (sort.key === 'size') return sign * (a.size - b.size);
      if (sort.key === 'mtime') return sign * (a.mtime - b.mtime);
      return sign * a.name.localeCompare(b.name, 'ru');
    });
  }, [entries, query, searching, searchRes, sort]);

  function toggleSort(key) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' ? 'asc' : 'desc' }));
  }

  function goTo(path) {
    setQuery('');
    setCurrentPath(path);
  }

  function goToSegment(index) {
    goTo(segments.slice(0, index + 1).join('/'));
  }

  async function handleOpen(entry) {
    if (entry.isDir) { goTo(pathOf(entry)); return; }
    if (isEditable(entry)) { setEditing(pathOf(entry)); return; }
    const res = await window.api.files.open(instance.id, pathOf(entry));
    if (res && !res.ok) setError(res.error);
  }

  async function systemOpen(entry) {
    const res = await window.api.files.open(instance.id, pathOf(entry));
    if (res && !res.ok) setError(res.error);
  }

  async function reveal(entry) {
    const res = await window.api.files.reveal(instance.id, pathOf(entry));
    if (res && !res.ok) setError(res.error);
  }

  async function handleDelete(entry) {
    if (!confirm(`Delete "${entry.name}»?${entry.isDir ? ' The folder will be deleted with all the contents.' : ''}`)) return;
    const res = await window.api.files.delete(instance.id, pathOf(entry));
    if (res.ok) { reloadAll(); } else setError(res.error);
  }

  async function bulkDelete() {
    const targets = rows.filter((r) => selected.has(pathOf(r)));
    if (!targets.length) return;
    if (!confirm(`Delete the selected (${targets.length}? The folders are removed with all the contents.`)) return;
    for (const t of targets) {
      // eslint-disable-next-line no-await-in-loop
      const res = await window.api.files.delete(instance.id, pathOf(t));
      if (!res.ok) { setError(res.error); break; }
    }
    setSelected(new Set());
    reloadAll();
  }

  // Refreshes the folder listing and, if a subfolder search is showing, re-runs it.
  function reloadAll() {
    load();
    setRefreshTick((t) => t + 1);
  }

  function startRename(entry) {
    setRenaming(pathOf(entry));
    setRenameDraft(entry.name);
  }

  async function confirmRename(entry) {
    if (inlineBusy.current) return;
    inlineBusy.current = true;
    const name = renameDraft.trim();
    setRenaming(null);
    try {
      if (!name || name === entry.name) return;
      const res = await window.api.files.rename(instance.id, pathOf(entry), name);
      if (res.ok) reloadAll(); else setError(res.error);
    } finally {
      inlineBusy.current = false;
    }
  }

  async function handleCreate() {
    if (inlineBusy.current) return;
    inlineBusy.current = true;
    const name = newName.trim();
    const kind = creating;
    setCreating(null);
    setNewName('');
    try {
      if (!name || !kind) return;
      const res = kind === 'folder'
        ? await window.api.files.mkdir(instance.id, currentPath, name)
        : await window.api.files.createFile(instance.id, currentPath, name);
      if (!res.ok) { setError(res.error); return; }
      await load();
      if (kind === 'file') setEditing(joinPath(name));
    } finally {
      inlineBusy.current = false;
    }
  }

  async function handleAddFiles() {
    const res = await window.api.files.addFiles(instance.id, currentPath);
    if (res.ok && res.added.length) { flash(`Added: ${res.added.length}`); load(); }
    else if (!res.ok) setError(res.error);
  }

  function flash(text) {
    setNotice(text);
    setTimeout(() => setNotice(null), 2500);
  }

  // Files dragged in from Explorer.
  async function handleDrop(e) {
    e.preventDefault();
    setDragging(false);
    const filePaths = [...e.dataTransfer.files].map((f) => window.api.files.pathFor(f)).filter(Boolean);
    if (!filePaths.length) return;
    const res = await window.api.files.copyIn(instance.id, currentPath, filePaths);
    if (res.ok) { flash(`Added: ${res.added.length}`); load(); } else setError(res.error);
  }

  function toggleSelect(entry) {
    const key = pathOf(entry);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(pathOf(r)));

  return (
    <div
      className={`fm-wrap ${dragging ? 'dragging' : ''}`}
      onDragOver={(e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false); }}
      onDrop={handleDrop}
    >
      {dragging && (
        <div className="content-dropzone-hint">
          <UploadIcon width={28} height={28} />
          <p>Let go to add to \"{currentPath || 'instance'}»</p>
        </div>
      )}

      <div className="jump-back-row" style={{ marginBottom: 16, gap: 8 }}>
        {QUICK_LINKS.map((q) => (
          <button key={q.path} className={`pill-tab ${currentPath === q.path ? 'active' : ''}`} style={{ marginBottom: 0 }} onClick={() => goTo(q.path)}>
            {q.label}
          </button>
        ))}
      </div>

      <div className="fm-breadcrumbs">
        <button className="fm-crumb" onClick={() => goTo('')}>instance root</button>
        {segments.map((seg, i) => (
          <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <ChevronRight width={14} height={14} style={{ color: 'var(--text-faint)' }} />
            <button className="fm-crumb" onClick={() => goToSegment(i)}>{seg}</button>
          </span>
        ))}
      </div>

      <div className="content-toolbar">
        <div className="search-bar" style={{ marginBottom: 0 }}>
          <SearchIcon width={17} height={17} />
          <input
            placeholder={deep ? 'Search by name in all nested folders...' : 'The filter by name in this folder...'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button className="icon-btn" style={{ width: 26, height: 26 }} onClick={() => setQuery('')} title="Clean up">
              <CloseIcon width={14} height={14} />
            </button>
          )}
        </div>
        <label className="snapshot-toggle" title="Search in subfolders (up to 300 results)">
          nested
          <input type="checkbox" className="switch small" checked={deep} onChange={(e) => setDeep(e.target.checked)} />
        </label>
      </div>

      <div className="content-toolbar">
        <button className="btn" onClick={() => { setCreating('file'); setNewName(''); }}>
          <PlusIcon width={16} height={16} /> File
        </button>
        <button className="btn" onClick={() => { setCreating('folder'); setNewName(''); }}>
          <FolderIcon width={16} height={16} /> Folder
        </button>
        <button className="btn" onClick={handleAddFiles}>
          <UploadIcon width={16} height={16} /> Add files
        </button>
        <button className="btn" onClick={() => systemOpen({ name: '', relPath: currentPath })}>
          Open in conductor
        </button>
        {notice && <span className="file-editor-ok">{notice}</span>}
        <button className="btn-text" style={{ marginLeft: 'auto' }} onClick={reloadAll}>
          <RefreshIcon width={15} height={15} /> Refresh
        </button>
      </div>

      {error && (
        <div className="error-text" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ flex: 1, whiteSpace: 'pre-wrap' }}>{error}</span>
          <button className="btn-text" onClick={() => setError(null)}>Hide.</button>
        </div>
      )}

      {selected.size > 0 && (
        <div className="library-selection-bar" style={{ marginBottom: 12 }}>
          <span className="library-selection-count">Selected: {selected.size}</span>
          <div className="library-selection-actions">
            <button className="btn btn-danger" onClick={bulkDelete}><TrashIcon width={15} height={15} /> Delete</button>
            <button className="icon-btn" onClick={() => setSelected(new Set())} title="Remove allocation"><CloseIcon /></button>
          </div>
        </div>
      )}

      <div className="fm-table">
        <div className="fm-line fm-head">
          <input
            type="checkbox" className="content-row-check"
            checked={allSelected}
            onChange={(e) => setSelected(e.target.checked ? new Set(rows.map(pathOf)) : new Set())}
          />
          {Object.entries(SORTS).map(([key, label]) => (
            <button key={key} className={`fm-sort ${sort.key === key ? 'active' : ''} fm-col-${key}`} onClick={() => toggleSort(key)}>
              {label}
              {sort.key === key && (
                <ChevronDownIcon width={12} height={12} style={{ transform: sort.dir === 'asc' ? 'rotate(180deg)' : 'none' }} />
              )}
            </button>
          ))}
          <span className="fm-col-actions">Action</span>
        </div>

        {creating && !searching && (
          <div className="fm-line">
            <span />
            <div className="fm-name">
              <div className="fm-icon">{creating === 'folder' ? <FolderIcon width={17} height={17} /> : <FileTextIcon width={17} height={17} />}</div>
              <input
                autoFocus
                className="fm-inline-input"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') { setCreating(null); setNewName(''); } }}
                onBlur={handleCreate}
                placeholder={creating === 'folder' ? 'Folder name.' : 'File name, such as my-config.toml'}
              />
            </div>
            <span /><span /><span />
          </div>
        )}

        {entries === null || searchRes === 'loading' ? (
          <div className="progress-label" style={{ padding: 18 }}>{searching ? 'Search' : 'Loading...'}</div>
        ) : rows.length === 0 && !creating ? (
          <div className="empty-state" style={{ padding: '60px 24px' }}>
            <p>{query ? 'Nothing found.' : 'The file is empty.'}</p>
          </div>
        ) : (
          rows.map((entry) => {
            const key = pathOf(entry);
            const editable = isEditable(entry);
            const parent = searching ? key.split('/').slice(0, -1).join('/') : '';
            return (
              <div className={`fm-line fm-item ${selected.has(key) ? 'selected' : ''}`} key={key} onDoubleClick={() => handleOpen(entry)}>
                <input
                  type="checkbox" className="content-row-check"
                  checked={selected.has(key)} onChange={() => toggleSelect(entry)}
                  onDoubleClick={(e) => e.stopPropagation()}
                />
                <div className="fm-name">
                  <div className={`fm-icon ${entry.isDir ? 'dir' : ''}`}>
                    {entry.isDir ? <FolderIcon width={17} height={17} /> : <FileTextIcon width={17} height={17} />}
                  </div>
                  {renaming === key ? (
                    <input
                      autoFocus
                      className="fm-inline-input"
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') confirmRename(entry); if (e.key === 'Escape') setRenaming(null); }}
                      onBlur={() => confirmRename(entry)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <div className="fm-name-text">
                      <button className="fm-name-btn" onClick={() => handleOpen(entry)} title={key}>{entry.name}</button>
                      {searching && parent && <span className="fm-parent" title={parent}>{parent}</span>}
                    </div>
                  )}
                </div>
                <span className="fm-col-size">{entry.isDir ? '—' : formatSize(entry.size)}</span>
                <span className="fm-col-mtime">{entry.mtime ? new Date(entry.mtime).toLocaleString('en-US') : '—'}</span>
                <div className="fm-col-actions fm-actions">
                  {editable && (
                    <button className="btn fm-edit-btn" onClick={() => setEditing(key)} title="Open in the built-in editor">
                      Edit
                    </button>
                  )}
                  {!entry.isDir && (
                    <button className="icon-btn" title="Open in the program by default" onClick={() => systemOpen(entry)}>
                      <UploadIcon width={15} height={15} style={{ transform: 'rotate(45deg)' }} />
                    </button>
                  )}
                  <button className="icon-btn" title="Show in the guide" onClick={() => reveal(entry)}>
                    <FolderIcon width={15} height={15} />
                  </button>
                  <button className="icon-btn" title="Rename" onClick={() => startRename(entry)}>
                    <EditIcon width={15} height={15} />
                  </button>
                  <button className="icon-btn danger" title="Delete" onClick={() => handleDelete(entry)}>
                    <TrashIcon width={15} height={15} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {searching && searchRes && searchRes !== 'loading' && (
        <p className="hint-text" style={{ marginTop: 10 }}>
          Found: {searchRes.results.length}{searchRes.truncated ? ' (Showed the first – clarify the request)' : ''}.
          {searchRes.error ? ` ${searchRes.error}` : ''}
        </p>
      )}

      {editing && (
        <FileEditorModal
          instanceId={instance.id}
          relPath={editing}
          onClose={() => setEditing(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}
