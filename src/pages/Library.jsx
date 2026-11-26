import { useEffect, useMemo, useState } from 'react';
import InstanceTile from '../components/InstanceTile.jsx';
import FolderTile from '../components/FolderTile.jsx';
import DownloadTile from '../components/DownloadTile.jsx';
import CreateInstanceModal from '../components/CreateInstanceModal.jsx';
import CreateFolderModal from '../components/CreateFolderModal.jsx';
import ImportPackButton, { pickAndImportPack } from '../components/ImportPackButton.jsx';
import MergeIntoFolderModal from '../components/MergeIntoFolderModal.jsx';
import { createPortal } from 'react-dom';
import { useContextMenuDismiss, clampMenuPos } from '../hooks/useContextMenuDismiss.js';
import ImportLauncherModal from '../components/ImportLauncherModal.jsx';
import {
  PlusIcon, FolderPlusIcon, ChevronLeft, SearchIcon, ChevronDownIcon, CopyIcon, FolderIcon, FolderMinusIcon, TrashIcon, CloseIcon, UploadIcon, DownloadCloudIcon, GearIcon, LayersIcon,
} from '../components/Icons.jsx';

const SORT_OPTIONS = [
  { id: 'name', label: 'Name' },
  { id: 'lastPlayed', label: 'Последний запуск' },
  { id: 'created', label: 'Дата создания' },
];

function compareBy(sortBy, a, b) {
  if (sortBy === 'name') return a.name.localeCompare(b.name, 'ru');
  if (sortBy === 'lastPlayed') return (a.lastPlayed || 0) - (b.lastPlayed || 0);
  return (a.createdAt || 0) - (b.createdAt || 0);
}

export default function Library({
  instances, onOpenInstance, onInstanceCreated, onInstanceUpdated, onInstanceDeleted,
  onInstancesAdded, onInstancesDeleted,
  settings, runningIds, preparingIds, crashedIds, launchProgress, onPlayInstance, onStopInstance,
  installs, onDismissInstall, onControlInstall, onImportInstance, onImportPackFile, initialFolderId = null,
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [showImportLauncher, setShowImportLauncher] = useState(false);
  const [emptyMenuPos, setEmptyMenuPos] = useState(null);
  const emptyMenuRef = useContextMenuDismiss(!!emptyMenuPos, () => setEmptyMenuPos(null));

  // Right-click on the library's own background (not a tile/folder/button) —
  // the same set of actions as the toolbar above, just reachable without
  // reaching for the mouse all the way up there. Attached to .main-content
  // itself (not this page's own root div) because that div only sizes to its
  // content — .main-content is the actual scroll container that always
  // fills the visible page, padding included, so this is the only element
  // right-clicks anywhere on an otherwise-empty page are guaranteed to hit.
  useEffect(() => {
    const el = document.querySelector('.main-content');
    if (!el) return undefined;
    function handlePageContextMenu(e) {
      if (e.target.closest('.instance-tile, .folder-tile, .library-section-header, button, a, input, .tile-context-menu, .library-selection-bar')) return;
      e.preventDefault();
      setEmptyMenuPos(clampMenuPos(e.clientX, e.clientY, { width: 240, height: 250 }));
    }
    el.addEventListener('contextmenu', handlePageContextMenu);
    return () => el.removeEventListener('contextmenu', handlePageContextMenu);
  }, []);

  function handleImportZip() {
    setEmptyMenuPos(null);
    pickAndImportPack(onImportPackFile);
  }
  const [folders, setFolders] = useState([]);
  const [currentFolderId, setCurrentFolderId] = useState(initialFolderId);
  const [rootDragOver, setRootDragOver] = useState(false);
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState('name');
  const [sortDir, setSortDir] = useState('asc');
  const [mergePair, setMergePair] = useState(null); // [instanceA, instanceB] — dragged one tile onto another

  // ---- custom "sections": named groups stacked on the same page (a header
  // + its own grid, one block after another), not a tab switcher. Everything
  // without a section falls into the implicit "Library и все сборки"
  // group, which only gets a visible header once at least one custom
  // section exists — with none, the page is just the plain grid it always was.
  const [sections, setSections] = useState([]);
  const [addingSection, setAddingSection] = useState(false);
  const [newSectionName, setNewSectionName] = useState('');
  const [sectionRenameId, setSectionRenameId] = useState(null);
  const [sectionRenameDraft, setSectionRenameDraft] = useState('');
  const [sectionMenu, setSectionMenu] = useState(null); // { id, pos }
  const [dragOverSectionId, setDragOverSectionId] = useState(undefined); // undefined = none; null is a valid target (the default group)
  const sectionMenuRef = useContextMenuDismiss(!!sectionMenu, () => setSectionMenu(null));

  useEffect(() => { window.api.sections.list().then(setSections); }, []);

  async function commitAddSection() {
    const trimmed = newSectionName.trim();
    setAddingSection(false);
    setNewSectionName('');
    if (!trimmed) return;
    const res = await window.api.sections.create(trimmed);
    if (res.ok) setSections((prev) => [...prev, res.section]);
  }

  function startSectionRename(s) {
    setSectionMenu(null);
    setSectionRenameId(s.id);
    setSectionRenameDraft(s.name);
  }

  async function commitSectionRename() {
    const id = sectionRenameId;
    setSectionRenameId(null);
    const trimmed = sectionRenameDraft.trim();
    if (!id || !trimmed) return;
    const res = await window.api.sections.rename(id, trimmed);
    if (res.ok) setSections((prev) => prev.map((s) => (s.id === id ? res.section : s)));
  }

  async function deleteSection(id) {
    setSectionMenu(null);
    if (!confirm('Delete раздел? Folders и сборки в нём никуда не денутся — просто перестанут быть в этом разделе.')) return;
    await window.api.sections.delete(id);
    setSections((prev) => prev.filter((s) => s.id !== id));
    setFolders((prev) => prev.map((f) => (f.sectionId === id ? { ...f, sectionId: null } : f)));
    instances.forEach((i) => { if (i.sectionId === id) onInstanceUpdated({ ...i, sectionId: null }); });
  }

  function handleSectionDragOver(e, targetId) {
    const types = [...e.dataTransfer.types];
    if (!types.some((t) => ['application/x-voxel-section', 'application/x-voxel-instance', 'application/x-voxel-folder'].includes(t))) return;
    e.preventDefault();
    setDragOverSectionId(targetId);
  }

  async function handleSectionDrop(e, targetId) {
    e.preventDefault();
    setDragOverSectionId(undefined);
    const types = [...e.dataTransfer.types];
    if (types.includes('application/x-voxel-section')) {
      const draggedId = e.dataTransfer.getData('application/x-voxel-section');
      if (!draggedId || draggedId === targetId || targetId === null) return; // the default pill is fixed in place
      const ids = sections.map((s) => s.id);
      const from = ids.indexOf(draggedId);
      const to = ids.indexOf(targetId);
      if (from < 0 || to < 0) return;
      ids.splice(from, 1);
      ids.splice(to, 0, draggedId);
      const byId = new Map(sections.map((s) => [s.id, s]));
      setSections(ids.map((id) => byId.get(id)));
      const res = await window.api.sections.reorder(ids);
      if (res.ok) setSections(res.sections);
      return;
    }
    const instanceId = e.dataTransfer.getData('application/x-voxel-instance');
    const folderId = e.dataTransfer.getData('application/x-voxel-folder');
    if (instanceId) {
      const res = await window.api.instances.setSection(instanceId, targetId);
      if (res.ok) onInstanceUpdated(res.instance);
    } else if (folderId) {
      const res = await window.api.folders.setSection(folderId, targetId);
      if (res.ok) setFolders((prev) => prev.map((f) => (f.id === folderId ? res.folder : f)));
    }
  }

  // Dropping one instance tile onto another: merge into a new folder, unless
  // the target is already in one — then just move the dragged one there too.
  function handleMergeRequest(draggedId, target) {
    if (draggedId === target.id) return;
    if (target.folderId) { moveInstanceToFolder(draggedId, target.folderId); return; }
    const draggedInstance = instances.find((i) => i.id === draggedId);
    if (draggedInstance) setMergePair([draggedInstance, target]);
  }

  function handleMerged(folder, updatedInstances) {
    setFolders((prev) => [...prev, folder]);
    updatedInstances.forEach(onInstanceUpdated);
    setMergePair(null);
  }

  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [moveMenuOpen, setMoveMenuOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const moveMenuRef = useContextMenuDismiss(moveMenuOpen, () => setMoveMenuOpen(false));

  function loadFolders() {
    window.api.folders.list().then(setFolders);
  }

  useEffect(loadFolders, []);

  // Selection follows what's actually still in the library, and is dropped
  // when moving between folders (so a bulk action never hits something the
  // user can't currently see) or on Escape. Search doesn't clear it, so
  // matches can be picked across several queries.
  const selectedList = useMemo(() => instances.filter((i) => selectedIds.has(i.id)), [instances, selectedIds]);
  const selectionActive = selectedList.length > 0;

  useEffect(() => { setSelectedIds(new Set()); setMoveMenuOpen(false); }, [currentFolderId]);

  useEffect(() => {
    if (!selectionActive) return undefined;
    function onKey(e) { if (e.key === 'Escape') setSelectedIds(new Set()); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectionActive]);

  function toggleSelect(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
    setMoveMenuOpen(false);
  }

  async function bulkCopy() {
    setBulkBusy(true);
    const created = [];
    for (const inst of selectedList) {
      // eslint-disable-next-line no-await-in-loop
      const res = await window.api.instances.duplicate(inst.id);
      if (res.ok) created.push(res.instance);
    }
    setBulkBusy(false);
    if (created.length) onInstancesAdded?.(created);
    if (created.length < selectedList.length) alert(`Скопировано ${created.length} из ${selectedList.length}.`);
    clearSelection();
  }

  async function bulkDelete() {
    const running = selectedList.filter((i) => runningIds?.has(i.id));
    const deletable = selectedList.filter((i) => !runningIds?.has(i.id));
    if (deletable.length === 0) {
      alert('Выбранные сборки сейчас запущены — сначала остановите их.');
      return;
    }
    const skipNote = running.length ? `\n\nЗапущенные сборки (${running.length}) будут пропущены.` : '';
    if (!confirm(`Delete сборки (${deletable.length})? Files будут удалены безвозвратно.${skipNote}`)) return;
    setBulkBusy(true);
    const deleted = [];
    for (const inst of deletable) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await window.api.instances.delete(inst.id);
        deleted.push(inst.id);
      } catch { /* leave it in the list */ }
    }
    setBulkBusy(false);
    if (deleted.length) onInstancesDeleted?.(deleted);
    clearSelection();
  }

  async function bulkMove(folderId) {
    setMoveMenuOpen(false);
    setBulkBusy(true);
    for (const inst of selectedList) {
      // eslint-disable-next-line no-await-in-loop
      await moveInstanceToFolder(inst.id, folderId);
    }
    setBulkBusy(false);
    clearSelection();
  }

  const currentFolder = currentFolderId ? folders.find((f) => f.id === currentFolderId) : null;
  const searching = query.trim().length > 0;
  const q = query.trim().toLowerCase();
  // Sections only group the top-level view — a search flattens across
  // everything regardless of section, and browsing inside a folder shows
  // just that folder's own contents, same as before either way.
  const grouping = !searching && !currentFolderId;

  function sortInstanceList(list) {
    const out = [...list];
    out.sort((a, b) => {
      const pinDiff = (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
      if (pinDiff !== 0) return pinDiff;
      const cmp = compareBy(sortBy, a, b);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return out;
  }
  const sortFolderList = (list) => list.slice().sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));

  // With a search query, look across the whole library regardless of which
  // folder something is in — otherwise stay scoped to the folder being
  // browsed, same as before.
  const scopedInstances = useMemo(() => {
    if (searching) return instances.filter((i) => i.name.toLowerCase().includes(q));
    if (currentFolderId) return instances.filter((i) => i.folderId === currentFolderId);
    return instances.filter((i) => !i.folderId);
  }, [instances, searching, q, currentFolderId]);

  const visibleFolders = useMemo(() => {
    if (currentFolderId) return [];
    if (searching) return folders.filter((f) => f.name.toLowerCase().includes(q));
    return folders;
  }, [folders, currentFolderId, searching, q]);

  const sorted = useMemo(() => sortInstanceList(scopedInstances), [scopedInstances, sortBy, sortDir]);

  // Top-level, non-search view: one block per section (default bucket
  // first, always), each with its own sorted folders/instances.
  const groups = useMemo(() => {
    if (!grouping) return null;
    const bucket = (id, name) => ({
      id,
      name,
      folders: sortFolderList(folders.filter((f) => (f.sectionId || null) === id)),
      instances: sortInstanceList(instances.filter((i) => !i.folderId && (i.sectionId || null) === id)),
    });
    return [bucket(null, 'Library и все сборки'), ...sections.map((s) => bucket(s.id, s.name))];
  }, [grouping, folders, instances, sections, sortBy, sortDir]);

  function toggleSort(id) {
    if (sortBy === id) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(id);
      setSortDir(id === 'name' ? 'asc' : 'desc');
    }
  }

  function folderCount(folderId) {
    return instances.filter((i) => i.folderId === folderId).length;
  }

  async function moveInstanceToFolder(instanceId, folderId) {
    const res = await window.api.instances.setFolder(instanceId, folderId);
    if (res.ok) onInstanceUpdated(res.instance);
  }

  function handleFolderRenamed(folder) {
    setFolders((prev) => prev.map((f) => (f.id === folder.id ? folder : f)));
  }

  function handleFolderDeleted(id) {
    setFolders((prev) => prev.filter((f) => f.id !== id));
    if (currentFolderId === id) setCurrentFolderId(null);
    // instance.folderId was cleared on the backend — reflect it locally too.
    instances.forEach((i) => { if (i.folderId === id) onInstanceUpdated({ ...i, folderId: null }); });
  }

  function handleRootDragOver(e) {
    if (![...e.dataTransfer.types].includes('application/x-voxel-instance')) return;
    e.preventDefault();
    setRootDragOver(true);
  }

  function handleRootDrop(e) {
    e.preventDefault();
    setRootDragOver(false);
    const instanceId = e.dataTransfer.getData('application/x-voxel-instance');
    if (instanceId) moveInstanceToFolder(instanceId, null);
  }

  const hasDownloads = !currentFolderId && !searching && (installs || []).length > 0;
  const showEmptyLibrary = instances.length === 0 && folders.length === 0 && !hasDownloads;
  const showNothingFound = !showEmptyLibrary && !hasDownloads && sorted.length === 0 && visibleFolders.length === 0;

  function renderFolderTile(folder) {
    return (
      <FolderTile
        key={folder.id}
        folder={folder}
        count={folderCount(folder.id)}
        instanceIds={instances.filter((i) => i.folderId === folder.id).map((i) => i.id)}
        settings={settings}
        onOpen={() => setCurrentFolderId(folder.id)}
        onDropInstance={moveInstanceToFolder}
        onRenamed={handleFolderRenamed}
        onDeleted={handleFolderDeleted}
      />
    );
  }

  function renderInstanceTile(inst) {
    return (
      <InstanceTile
        key={inst.id}
        instance={inst}
        inFolder={!!inst.folderId}
        settings={settings}
        runningIds={runningIds}
        preparingIds={preparingIds}
        crashedIds={crashedIds}
        launchProgress={launchProgress}
        onPlayInstance={onPlayInstance}
        onStopInstance={onStopInstance}
        onClick={() => (selectionActive ? toggleSelect(inst.id) : onOpenInstance(inst.id))}
        selectable
        selected={selectedIds.has(inst.id)}
        selectionMode={selectionActive}
        onToggleSelect={toggleSelect}
        onPinnedChange={onInstanceUpdated}
        onOpenSettings={() => onOpenInstance(inst.id, null, true)}
        onDuplicated={onInstanceCreated}
        onDeleted={onInstanceDeleted}
        onMoveToFolder={moveInstanceToFolder}
        onMergeRequest={handleMergeRequest}
      />
    );
  }

  return (
    <div>
      <div className="page-header">
        <h1>Library</h1>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn" onClick={() => setShowCreateFolder(true)}>
            <FolderPlusIcon width={16} height={16} /> Новая папка
          </button>
          <ImportPackButton onImportPackFile={onImportPackFile} onImportInstance={onImportInstance} />
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            <PlusIcon width={16} height={16} /> Create instance
          </button>
        </div>
      </div>

      {!showEmptyLibrary && (
        <div className="shots-toolbar">
          <div className="search-bar" style={{ marginBottom: 0 }}>
            <SearchIcon width={18} height={18} />
            <input placeholder="Search по сборкам и папкам…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="pill-tabs library-sort-tabs" style={{ marginBottom: 0 }}>
            {SORT_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                className={`pill-tab ${sortBy === opt.id ? 'active' : ''}`}
                onClick={() => toggleSort(opt.id)}
              >
                {opt.label}
                {sortBy === opt.id && (
                  <ChevronDownIcon width={13} height={13} style={{ transform: sortDir === 'asc' ? 'rotate(180deg)' : 'none', transition: 'transform .15s ease' }} />
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {selectionActive && (
        <div className="library-selection-bar">
          <span className="library-selection-count">Выбрано: {selectedList.length}</span>
          <button className="btn" onClick={() => setSelectedIds(new Set(sorted.map((i) => i.id)))} disabled={bulkBusy}>
            Выделить все
          </button>
          <div className="library-selection-actions">
            <button className="btn" onClick={bulkCopy} disabled={bulkBusy}>
              <CopyIcon width={15} height={15} /> {bulkBusy ? 'Подождите…' : 'Copy'}
            </button>
            <div className="library-move-wrap" ref={moveMenuRef}>
              <button className="btn" onClick={() => setMoveMenuOpen((v) => !v)} disabled={bulkBusy}>
                <FolderIcon width={15} height={15} /> В папку <ChevronDownIcon width={13} height={13} />
              </button>
              {moveMenuOpen && (
                <div className="library-move-menu">
                  {folders.length === 0 && <div className="tile-context-submenu-hint">Папок пока нет — создайте «Новая папка».</div>}
                  {folders.map((f) => (
                    <button key={f.id} className="tab-bar-btn" onClick={() => bulkMove(f.id)}>
                      {f.icon ? <img src={f.icon} alt="" /> : <FolderIcon width={14} height={14} />}
                      {f.name}
                    </button>
                  ))}
                  <button className="tab-bar-btn" onClick={() => bulkMove(null)}>
                    <FolderMinusIcon width={14} height={14} /> Убрать из папок
                  </button>
                </div>
              )}
            </div>
            <button className="btn btn-danger" onClick={bulkDelete} disabled={bulkBusy}>
              <TrashIcon width={15} height={15} /> Delete
            </button>
            <button className="icon-btn" title="Снять выделение (Esc)" onClick={clearSelection}>
              <CloseIcon />
            </button>
          </div>
        </div>
      )}

      {currentFolder && !searching && (
        <button
          className={`library-breadcrumb ${rootDragOver ? 'drag-over' : ''}`}
          onClick={() => setCurrentFolderId(null)}
          onDragOver={handleRootDragOver}
          onDragLeave={() => setRootDragOver(false)}
          onDrop={handleRootDrop}
        >
          <ChevronLeft width={16} height={16} /> Library <span className="dot" /> {currentFolder.name}
        </button>
      )}

      {showEmptyLibrary ? (
        <div className="empty-state">
          <p>Сборок пока нет.</p>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            <PlusIcon width={16} height={16} /> Create первую сборку
          </button>
        </div>
      ) : grouping ? (
        <>
          {groups.map((g) => {
            const showHeader = g.id !== null || sections.length > 0;
            const isEmpty = g.id !== null && g.folders.length === 0 && g.instances.length === 0;
            return (
              <div key={g.id ?? '__default'} className="library-section-group">
                {showHeader && (
                  <div
                    className={`library-section-header ${dragOverSectionId === g.id ? 'drag-over' : ''}`}
                    draggable={g.id !== null && sectionRenameId !== g.id}
                    onDragStart={(e) => { e.dataTransfer.setData('application/x-voxel-section', g.id); e.dataTransfer.effectAllowed = 'move'; }}
                    onDragOver={(e) => handleSectionDragOver(e, g.id)}
                    onDragLeave={() => setDragOverSectionId(undefined)}
                    onDrop={(e) => handleSectionDrop(e, g.id)}
                    onContextMenu={g.id === null ? undefined : (e) => { e.preventDefault(); e.stopPropagation(); setSectionMenu({ id: g.id, pos: clampMenuPos(e.clientX, e.clientY, { width: 180, height: 90 }) }); }}
                  >
                    {g.id !== null && sectionRenameId === g.id ? (
                      <input
                        autoFocus
                        className="library-section-name-input"
                        value={sectionRenameDraft}
                        onChange={(e) => setSectionRenameDraft(e.target.value)}
                        onBlur={commitSectionRename}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setSectionRenameId(null); }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : g.name}
                  </div>
                )}
                <div
                  className={`library-grid ${dragOverSectionId === g.id ? 'drag-over' : ''}`}
                  onDragOver={(e) => handleSectionDragOver(e, g.id)}
                  onDragLeave={() => setDragOverSectionId(undefined)}
                  onDrop={(e) => handleSectionDrop(e, g.id)}
                >
                  {g.id === null && (installs || []).filter((i) => !i.isPackUpdate).map((inst) => (
                    <DownloadTile key={inst.id} install={inst} onDismiss={() => onDismissInstall?.(inst.id)} onControl={onControlInstall} />
                  ))}
                  {g.folders.map(renderFolderTile)}
                  {g.instances.map(renderInstanceTile)}
                  {isEmpty && <div className="library-section-empty-hint">Перетащите сюда папки или сборки</div>}
                </div>
              </div>
            );
          })}
          {addingSection && (
            <div className="library-section-group">
              <div className="library-section-header">
                <input
                  autoFocus
                  className="library-section-name-input"
                  value={newSectionName}
                  placeholder="Name раздела"
                  onChange={(e) => setNewSectionName(e.target.value)}
                  onBlur={commitAddSection}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setAddingSection(false); setNewSectionName(''); } }}
                />
              </div>
              <div className="library-grid">
                <div className="library-section-empty-hint">Перетащите сюда папки или сборки</div>
              </div>
            </div>
          )}
        </>
      ) : showNothingFound ? (
        <div className="empty-state"><p>Ничего не найдено.</p></div>
      ) : currentFolderId && !searching && sorted.length === 0 ? (
        <div className="empty-state"><p>В этой папке пока пусто — перетащите сюда сборку.</p></div>
      ) : (
        <div className="library-grid">
          {visibleFolders.map(renderFolderTile)}
          {sorted.map(renderInstanceTile)}
        </div>
      )}

      {selectionActive && <div className="library-selection-bar-spacer" />}

      {mergePair && (
        <MergeIntoFolderModal
          instanceA={mergePair[0]}
          instanceB={mergePair[1]}
          onClose={() => setMergePair(null)}
          onMerged={handleMerged}
        />
      )}

      {sectionMenu && createPortal(
        <div className="tile-context-menu" ref={sectionMenuRef} style={{ left: sectionMenu.pos.x, top: sectionMenu.pos.y }}>
          <button className="tab-bar-btn" onClick={() => startSectionRename(sections.find((s) => s.id === sectionMenu.id))}>
            <GearIcon width={15} height={15} /> Rename
          </button>
          <button className="tab-bar-btn" style={{ color: 'var(--danger)' }} onClick={() => deleteSection(sectionMenu.id)}>
            <TrashIcon width={15} height={15} /> Delete раздел
          </button>
        </div>,
        document.body,
      )}

      {showCreate && (
        <CreateInstanceModal
          onClose={() => setShowCreate(false)}
          onCreated={(instance) => {
            setShowCreate(false);
            onInstanceCreated(instance);
          }}
        />
      )}

      {showCreateFolder && (
        <CreateFolderModal
          onClose={() => setShowCreateFolder(false)}
          onCreated={(folder) => {
            setShowCreateFolder(false);
            setFolders((prev) => [...prev, folder]);
          }}
        />
      )}

      {showImportLauncher && (
        <ImportLauncherModal
          onClose={() => setShowImportLauncher(false)}
          onImport={onImportInstance}
        />
      )}

      {emptyMenuPos && createPortal(
        <div className="tile-context-menu" ref={emptyMenuRef} style={{ left: emptyMenuPos.x, top: emptyMenuPos.y }}>
          <button className="tab-bar-btn" onClick={() => { setEmptyMenuPos(null); setShowCreate(true); }}>
            <PlusIcon width={15} height={15} /> Create instance
          </button>
          <button className="tab-bar-btn" onClick={() => { setEmptyMenuPos(null); setShowCreateFolder(true); }}>
            <FolderPlusIcon width={15} height={15} /> Новая папка
          </button>
          <button className="tab-bar-btn" onClick={handleImportZip}>
            <UploadIcon width={15} height={15} /> Импортировать (.mrpack/zip)
          </button>
          <button className="tab-bar-btn" onClick={() => { setEmptyMenuPos(null); setShowImportLauncher(true); }}>
            <DownloadCloudIcon width={15} height={15} /> Import из другого лаунчера
          </button>
          <button className="tab-bar-btn" onClick={() => { setEmptyMenuPos(null); setAddingSection(true); }}>
            <LayersIcon width={15} height={15} /> Add раздел
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}
