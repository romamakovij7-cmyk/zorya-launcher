import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  FolderIcon, GearIcon, TrashIcon, PinIcon,
} from './Icons.jsx';
import { useContextMenuDismiss, clampMenuPos } from '../hooks/useContextMenuDismiss.js';
import { getInstanceSize } from '../utils/instanceSizes.js';
import { formatBytes } from '../utils/formatBytes.js';

export default function FolderTile({
  folder, count, instanceIds = [], settings, onOpen, onDropInstance, onRenamed, onDeleted,
}) {
  const showWeight = !!settings?.showInstanceWeight;
  const showStats = settings?.showInstanceStats !== false;
  const [totalBytes, setTotalBytes] = useState(null);

  // Folder weight = sum of its instances' folders (shares the size cache and
  // the two-at-a-time scan queue with the instance tiles).
  const idsKey = instanceIds.join(',');
  useEffect(() => {
    if (!showWeight) return undefined;
    let cancelled = false;
    setTotalBytes(null);
    Promise.all(instanceIds.map((id) => getInstanceSize(id))).then((infos) => {
      if (!cancelled) setTotalBytes(infos.reduce((sum, info) => sum + (info?.bytes || 0), 0));
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showWeight, idsKey]);

  const [menuPos, setMenuPos] = useState(null);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(folder.name);
  const [dragOver, setDragOver] = useState(false);
  const menuRef = useContextMenuDismiss(!!menuPos, () => setMenuPos(null));

  function handleContextMenu(e) {
    e.preventDefault();
    setMenuPos(clampMenuPos(e.clientX, e.clientY));
  }

  function startRename() {
    setMenuPos(null);
    setNameDraft(folder.name);
    setRenaming(true);
  }

  async function commitRename() {
    setRenaming(false);
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === folder.name) return;
    const res = await window.api.folders.rename(folder.id, trimmed);
    if (res.ok) onRenamed?.(res.folder);
  }

  async function handleSetIcon() {
    setMenuPos(null);
    const res = await window.api.folders.setIcon(folder.id);
    if (res.ok) onRenamed?.(res.folder);
    else if (!res.canceled && res.error) alert(res.error);
  }

  async function handleDelete() {
    setMenuPos(null);
    if (!confirm(`Delete папку «${folder.name}»? Instances внутри останутся, просто окажутся вне папки.`)) return;
    await window.api.folders.delete(folder.id);
    onDeleted?.(folder.id);
  }

  function handleDragOver(e) {
    if (![...e.dataTransfer.types].includes('application/x-voxel-instance')) return;
    e.preventDefault();
    setDragOver(true);
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const instanceId = e.dataTransfer.getData('application/x-voxel-instance');
    if (instanceId) onDropInstance?.(instanceId, folder.id);
  }

  async function togglePin(e) {
    e.stopPropagation();
    const res = await window.api.folders.setPinned(folder.id, !folder.pinned);
    if (res.ok) onRenamed?.(res.folder);
  }

  return (
    <div
      className={`instance-tile folder-tile ${dragOver ? 'drag-over' : ''}`}
      role="button"
      tabIndex={0}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-voxel-folder', folder.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={renaming ? undefined : onOpen}
      onKeyDown={(e) => { if (!renaming && (e.key === 'Enter' || e.key === ' ')) onOpen?.(); }}
      onContextMenu={handleContextMenu}
      onDragOver={handleDragOver}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      <span
        className={`instance-tile-pin ${folder.pinned ? 'active' : ''}`}
        onClick={togglePin}
        title={folder.pinned ? 'Unpin' : 'Pin сверху'}
      >
        <PinIcon width={13} height={13} />
      </span>
      <div className="instance-tile-icon folder-tile-icon">
        {folder.icon ? <img src={folder.icon} alt="" /> : <FolderIcon width={44} height={44} />}
      </div>
      <div className="instance-tile-text">
        {renaming ? (
          <input
            autoFocus
            className="folder-tile-rename-input"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setRenaming(false); }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <div className="instance-tile-name" title={folder.name}>{folder.name}</div>
        )}
        {!showStats && <div className="instance-tile-meta">{count} {countLabel(count)}</div>}
        {(showStats || showWeight) && (
          <div className="instance-tile-extra folder-extra">
            {showStats && <div><span>Сборок</span>{' '}{count}</div>}
            {showWeight && <div><span>Size</span>{' '}{totalBytes != null ? formatBytes(totalBytes) : '…'}</div>}
          </div>
        )}
      </div>

      {menuPos && createPortal(
        <div className="tile-context-menu" ref={menuRef} style={{ left: menuPos.x, top: menuPos.y }} onClick={(e) => e.stopPropagation()}>
          <button className="tab-bar-btn" onClick={(e) => { e.stopPropagation(); startRename(); }}>
            <GearIcon width={15} height={15} /> Rename
          </button>
          <button className="tab-bar-btn" onClick={(e) => { e.stopPropagation(); handleSetIcon(); }}>
            <FolderIcon width={15} height={15} /> Сменить иконку
          </button>
          <button className="tab-bar-btn" style={{ color: 'var(--danger)' }} onClick={(e) => { e.stopPropagation(); handleDelete(); }}>
            <TrashIcon width={15} height={15} /> Delete папку
          </button>
        </div>,
        document.body
      )}
    </div>
  );
}

function countLabel(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'сборка';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'сборки';
  return 'сборок';
}
