import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CheckIcon, PlayIcon, StopIcon, BoxIcon, PinIcon, GearIcon, CopyIcon, DownloadCloudIcon, TrashIcon, FolderMinusIcon, FolderIcon, ChevronDownIcon, ExternalLinkIcon,
} from './Icons.jsx';
import { useContextMenuDismiss, clampMenuPos } from '../hooks/useContextMenuDismiss.js';
import { getInstanceSize, cachedInstanceSize } from '../utils/instanceSizes.js';
import { formatBytes } from '../utils/formatBytes.js';
import { formatDuration, formatRelativeDate } from '../api/modrinth.js';
import { stageLabel, stagePercent } from '../utils/launchStages.js';

export default function InstanceTile({
  instance, onClick, onPinnedChange, onOpenSettings, onDuplicated, onDeleted, onMoveToFolder, inFolder,
  settings, runningIds, preparingIds, crashedIds, launchProgress, onPlayInstance, onStopInstance,
  selectable, selected, selectionMode, onToggleSelect, onMergeRequest,
}) {
  const showWeight = !!settings?.showInstanceWeight;
  const showStats = settings?.showInstanceStats !== false;
  const showPlay = settings?.showPlayButton !== false && !!onPlayInstance;
  const running = !!runningIds?.has(instance.id);
  const preparing = !!preparingIds?.has(instance.id);
  const crashed = !running && !preparing && !!crashedIds?.has(instance.id);

  const [menuPos, setMenuPos] = useState(null);
  const [sizeInfo, setSizeInfo] = useState(() => (showWeight ? cachedInstanceSize(instance.id) : null));

  useEffect(() => {
    if (!showWeight) return undefined;
    let cancelled = false;
    getInstanceSize(instance.id).then((info) => { if (!cancelled && info) setSizeInfo(info); });
    return () => { cancelled = true; };
  }, [showWeight, instance.id]);

  function handlePlayClick(e) {
    e.stopPropagation();
    if (running) onStopInstance?.(instance.id);
    else if (!preparing) onPlayInstance?.(instance.id);
  }

  const [busy, setBusy] = useState(false);
  const [folders, setFolders] = useState(null);
  const [folderSubmenu, setFolderSubmenu] = useState(false);
  const menuRef = useContextMenuDismiss(!!menuPos, () => setMenuPos(null));

  async function togglePin(e) {
    e.stopPropagation();
    const res = await window.api.instances.setPinned(instance.id, !instance.pinned);
    if (res.ok) onPinnedChange?.(res.instance);
  }

  function handleContextMenu(e) {
    e.preventDefault();
    setMenuPos(clampMenuPos(e.clientX, e.clientY));
    setFolderSubmenu(false);
    if (onMoveToFolder && folders === null) {
      window.api.folders.list().then(setFolders);
    }
  }

  function handleMoveToFolder(folderId) {
    setMenuPos(null);
    setFolderSubmenu(false);
    onMoveToFolder?.(instance.id, folderId);
  }

  async function handleDuplicate() {
    setMenuPos(null);
    setBusy(true);
    const res = await window.api.instances.duplicate(instance.id);
    setBusy(false);
    if (res.ok) onDuplicated?.(res.instance);
    else alert(res.error || 'Failed скопировать сборку');
  }

  async function handleExport() {
    setMenuPos(null);
    setBusy(true);
    const res = await window.api.instances.export(instance.id);
    setBusy(false);
    if (!res.ok && !res.canceled) alert(`Failed экспортировать сборку: ${res.error}`);
  }

  async function handleCreateShortcut() {
    setMenuPos(null);
    setBusy(true);
    const res = await window.api.app.createShortcut(instance.id);
    setBusy(false);
    if (!res.ok) alert(`Failed создать ярлык: ${res.error}`);
  }

  async function handleDelete() {
    setMenuPos(null);
    if (!confirm(`Delete «${instance.name}»? Files будут удалены безвозвратно.`)) return;
    try {
      await window.api.instances.delete(instance.id);
    } catch (err) {
      alert(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
      return;
    }
    onDeleted?.(instance.id);
  }

  // Dropping one instance tile onto another either merges them into a new
  // folder (neither has one yet) or moves the dragged one into whichever
  // folder the drop target is already in.
  const [mergeDragOver, setMergeDragOver] = useState(false);
  function handleTileDragOver(e) {
    if (!onMergeRequest || !e.dataTransfer.types.includes('application/x-voxel-instance')) return;
    e.preventDefault();
    e.stopPropagation();
    setMergeDragOver(true);
  }
  function handleTileDrop(e) {
    if (!onMergeRequest || !e.dataTransfer.types.includes('application/x-voxel-instance')) return;
    e.preventDefault();
    e.stopPropagation();
    setMergeDragOver(false);
    const draggedId = e.dataTransfer.getData('application/x-voxel-instance');
    if (!draggedId || draggedId === instance.id) return;
    onMergeRequest(draggedId, instance);
  }

  return (
    <div
      className={`instance-tile ${busy ? 'busy' : ''} ${selected ? 'selected' : ''} ${selectionMode ? 'selection-mode' : ''} ${mergeDragOver ? 'merge-drag-over' : ''}`}
      role="button"
      tabIndex={0}
      onDragOver={handleTileDragOver}
      onDragLeave={() => setMergeDragOver(false)}
      onDrop={handleTileDrop}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-voxel-instance', instance.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={busy ? undefined : onClick}
      onKeyDown={(e) => { if (!busy && (e.key === 'Enter' || e.key === ' ')) onClick?.(); }}
      onContextMenu={handleContextMenu}
    >
      {selectable && (
        <span
          className={`instance-tile-select ${selected ? 'active' : ''}`}
          role="checkbox"
          aria-checked={!!selected}
          onClick={(e) => { e.stopPropagation(); onToggleSelect?.(instance.id); }}
          title={selected ? 'Снять выделение' : 'Выделить'}
        >
          {selected && <CheckIcon width={14} height={14} />}
        </span>
      )}
      {onPinnedChange && (
        <span
          className={`instance-tile-pin ${instance.pinned ? 'active' : ''}`}
          onClick={togglePin}
          title={instance.pinned ? 'Unpin' : 'Pin сверху'}
        >
          <PinIcon width={13} height={13} />
        </span>
      )}
      <div className="instance-tile-icon">
        {instance.icon ? (
          <img src={instance.icon} alt="" />
        ) : (
          <BoxIcon width={46} height={46} />
        )}
      </div>
      {crashed && (
        <span className="instance-tile-status crashed" title="Game завершилась с ошибкой — откройте сборку, чтобы узнать причину">
          <span className="instance-tile-status-dot" />
          Вылет
        </span>
      )}
      {preparing && (
        <div className="instance-tile-progress" title={stageLabel(launchProgress?.[instance.id], instance)}>
          <div className={`progress-bar-track ${stagePercent(launchProgress?.[instance.id]) == null ? 'indeterminate' : ''}`}>
            <div
              className="progress-bar-fill"
              style={stagePercent(launchProgress?.[instance.id]) == null ? undefined : { width: `${stagePercent(launchProgress?.[instance.id])}%` }}
            />
          </div>
        </div>
      )}
      {(running || preparing) && (
        <span className={`instance-tile-status ${running ? 'running' : 'preparing'}`}>
          <span className="instance-tile-status-dot" />
          {running ? 'Запущена' : 'Launch…'}
        </span>
      )}
      {showPlay && (
        <button
          type="button"
          className={`instance-tile-play ${running ? 'stop' : ''} ${preparing ? 'preparing' : ''}`}
          title={running ? 'Остановить' : preparing ? 'Запускается…' : 'Играть'}
          onClick={handlePlayClick}
          disabled={preparing}
        >
          {running ? <StopIcon width={14} height={14} /> : <PlayIcon width={15} height={15} />}
        </button>
      )}
      <div className="instance-tile-text">
        <div className="instance-tile-name" title={instance.name}>{instance.name}</div>
        <div className="instance-tile-meta">
          {instance.loader !== 'vanilla' ? `${capitalize(instance.loader)} ` : ''}
          {instance.mcVersion}
        </div>
        {(showStats || showWeight) && (
          <div className="instance-tile-extra">
            {showStats && (
              <>
                <div><span>В игре</span>{' '}{formatDuration(instance.totalPlaytimeMs)}</div>
                <div>
                  {instance.lastPlayed
                    ? <><span>Играл</span>{' '}{formatRelativeDate(new Date(instance.lastPlayed).toISOString())}</>
                    : <span>Never launched</span>}
                </div>
              </>
            )}
            {showWeight && <div><span>Size</span>{' '}{sizeInfo ? formatBytes(sizeInfo.bytes) : '…'}</div>}
          </div>
        )}
      </div>

      {menuPos && createPortal(
        <div className="tile-context-menu" ref={menuRef} style={{ left: menuPos.x, top: menuPos.y }} onClick={(e) => e.stopPropagation()}>
          <button className="tab-bar-btn" onClick={(e) => { e.stopPropagation(); setMenuPos(null); onOpenSettings?.(); }}>
            <GearIcon width={15} height={15} /> Settings
          </button>
          <button className="tab-bar-btn" onClick={(e) => { e.stopPropagation(); handleDuplicate(); }}>
            <CopyIcon width={15} height={15} /> Create копию
          </button>
          <button className="tab-bar-btn" onClick={(e) => { e.stopPropagation(); handleExport(); }}>
            <DownloadCloudIcon width={15} height={15} /> Экспортировать
          </button>
          <button className="tab-bar-btn" onClick={(e) => { e.stopPropagation(); handleCreateShortcut(); }}>
            <ExternalLinkIcon width={15} height={15} /> Ярлык на рабочий стол
          </button>
          {onMoveToFolder && (
            <div className="tile-context-submenu-wrap">
              <button className="tab-bar-btn" onClick={(e) => { e.stopPropagation(); setFolderSubmenu((v) => !v); }}>
                <FolderIcon width={15} height={15} /> Add в папку
                <ChevronDownIcon width={13} height={13} style={{ marginLeft: 'auto', transform: folderSubmenu ? 'rotate(180deg)' : 'none' }} />
              </button>
              {folderSubmenu && (
                <div className="tile-context-submenu">
                  {folders === null ? (
                    <div className="tile-context-submenu-hint">Loading…</div>
                  ) : folders.length === 0 ? (
                    <div className="tile-context-submenu-hint">Папок пока нет — создайте в Библиотеке.</div>
                  ) : (
                    folders.map((f) => (
                      <button
                        key={f.id}
                        className={`tab-bar-btn ${instance.folderId === f.id ? 'active' : ''}`}
                        onClick={(e) => { e.stopPropagation(); handleMoveToFolder(f.id); }}
                      >
                        {f.icon ? <img className="tile-context-submenu-icon" src={f.icon} alt="" /> : <FolderIcon width={14} height={14} />}
                        {f.name}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          )}
          {inFolder && (
            <button className="tab-bar-btn" onClick={(e) => { e.stopPropagation(); setMenuPos(null); onMoveToFolder?.(instance.id, null); }}>
              <FolderMinusIcon width={15} height={15} /> Убрать из папки
            </button>
          )}
          <button className="tab-bar-btn" style={{ color: 'var(--danger)' }} onClick={(e) => { e.stopPropagation(); handleDelete(); }}>
            <TrashIcon width={15} height={15} /> Delete
          </button>
        </div>,
        document.body
      )}
    </div>
  );
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
