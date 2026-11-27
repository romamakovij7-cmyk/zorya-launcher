import { useEffect, useMemo, useState } from 'react';
import InstanceTile from '../components/InstanceTile.jsx';
import FolderTile from '../components/FolderTile.jsx';
import DownloadTile from '../components/DownloadTile.jsx';
import CreateInstanceModal from '../components/CreateInstanceModal.jsx';
import MergeIntoFolderModal from '../components/MergeIntoFolderModal.jsx';
import ImportPackButton from '../components/ImportPackButton.jsx';
import RecapBanner from '../components/RecapBanner.jsx';
import {
  PlusIcon, SearchIcon, PlayIcon, GlobeIcon, ServerIcon, MoreVerticalIcon, BoxIcon, TrashIcon,
} from '../components/Icons.jsx';
import { formatRelativeDate } from '../api/modrinth.js';

function cap(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function InstanceBadge({ item }) {
  return (
    <span className="recent-play-instance-badge">
      {item.instanceIcon ? <img src={item.instanceIcon} alt="" /> : <BoxIcon width={11} height={11} />}
      {item.instanceName}
    </span>
  );
}

function RecentPlayRow({ item, kind, onPlay, onOpenInstance, onDismiss }) {
  const isServer = kind === 'server';
  const [menuOpen, setMenuOpen] = useState(false);
  const unreachable = isServer && item.reachable === false;

  return (
    <div className="recent-play-row">
      <div className="recent-play-icon">
        {item.icon ? (
          <img src={item.icon} alt="" />
        ) : isServer ? (
          <ServerIcon width={24} height={24} />
        ) : (
          <GlobeIcon width={24} height={24} />
        )}
      </div>

      <div className="recent-play-body">
        <div className="recent-play-title-line">
          <span className="recent-play-title">{isServer ? item.name : item.levelName}</span>
          {unreachable && <span className="recent-play-offline">Not online.</span>}
        </div>
        <div className="recent-play-sub">
          {isServer ? (
            item.reachable ? (
              <>
                <span>{item.online ?? '?'}/{item.max ?? '?'} online</span>
                <span className="dot" />
                <span>{item.ping} miss</span>
                <span className="dot" />
                <InstanceBadge item={item} />
              </>
            ) : (
              <InstanceBadge item={item} />
            )
          ) : (
            <>
              <span>{item.instanceLoader !== 'vanilla' ? `${cap(item.instanceLoader)} ${item.instanceMcVersion}` : `Vanilla ${item.instanceMcVersion}`}</span>
              <span className="dot" />
              <InstanceBadge item={item} />
              <span className="dot" />
              <span>{formatRelativeDate(new Date(item.lastPlayed).toISOString())}</span>
            </>
          )}
        </div>
      </div>

      {unreachable && <div className="recent-play-error">It is impossible to connect to the server</div>}

      <button
        className="btn btn-primary recent-play-play"
        title={item.canQuickPlay ? 'Play' : 'Play (this version of Minecraft does not support direct transition – the game’s main screen will open)'}
        onClick={() => onPlay(item, kind)}
      >
        <PlayIcon width={15} height={15} /> Play
      </button>

      <div className="recent-play-menu-wrap">
        <button className="icon-btn" title="More." onClick={() => setMenuOpen((v) => !v)}>
          <MoreVerticalIcon width={18} height={18} />
        </button>
        {menuOpen && (
          <>
            <div className="dropdown-backdrop" onClick={() => setMenuOpen(false)} />
            <div className="recent-play-menu">
              <button className="tab-bar-btn" onClick={() => { setMenuOpen(false); onOpenInstance(item.instanceId); }}>
                <BoxIcon width={15} height={15} /> Open instance
              </button>
              <button className="tab-bar-btn" style={{ color: 'var(--danger)' }} onClick={() => { setMenuOpen(false); onDismiss(item, kind); }}>
                <TrashIcon width={15} height={15} /> Remove from recent
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function Home({
  instances, onOpenInstance, onInstanceCreated, onInstanceUpdated, onInstanceDeleted,
  settings, runningIds, preparingIds, crashedIds, launchProgress, onPlayInstance, onStopInstance,
  installs, onDismissInstall, onControlInstall, onOpenLibraryFolder, onImportPackFile, onImportInstance, onOpenRecap,
}) {
  const [query, setQuery] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [recentWorlds, setRecentWorlds] = useState(null);
  const [recentServers, setRecentServers] = useState(null);
  const [showRecent, setShowRecent] = useState(true);
  const [folders, setFolders] = useState([]);
  const [mergePair, setMergePair] = useState(null); // [instanceA, instanceB] — dragged one tile onto another

  useEffect(() => {
    window.api.settings.get().then((s) => setShowRecent(s.showRecent !== false));
    window.api.recents.worlds().then((res) => setRecentWorlds(res.ok ? res.items : []));
    window.api.recents.servers().then((res) => setRecentServers(res.ok ? res.items : []));
    window.api.folders.list().then(setFolders);
  }, []);

  function handleFolderRenamed(folder) {
    setFolders((prev) => prev.map((f) => (f.id === folder.id ? folder : f)));
  }

  function handleFolderDeleted(id) {
    setFolders((prev) => prev.filter((f) => f.id !== id));
    instances.forEach((i) => { if (i.folderId === id) onInstanceUpdated({ ...i, folderId: null }); });
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

  function handlePlayRecent(item, kind) {
    const quickPlay = kind === 'world'
      ? { type: 'world', target: item.folderName }
      : { type: 'server', target: item.address };
    onOpenInstance(item.instanceId, item.canQuickPlay ? quickPlay : null);
  }

  async function moveInstanceToFolder(instanceId, folderId) {
    const res = await window.api.instances.setFolder(instanceId, folderId);
    if (res.ok) onInstanceUpdated(res.instance);
  }

  function dismissOne(item, kind) {
    const itemKey = kind === 'world' ? item.folderName : item.address;
    window.api.recents.dismiss(kind, item.instanceId, itemKey);
    if (kind === 'world') setRecentWorlds((prev) => prev.filter((w) => w !== item));
    else setRecentServers((prev) => prev.filter((s) => s !== item));
  }

  function dismissAll(kind) {
    const list = kind === 'world' ? recentWorlds : recentServers;
    for (const item of list || []) {
      const itemKey = kind === 'world' ? item.folderName : item.address;
      window.api.recents.dismiss(kind, item.instanceId, itemKey);
    }
    if (kind === 'world') setRecentWorlds([]);
    else setRecentServers([]);
  }

  const searching = query.trim().length > 0;
  // Same rule as the Library page: while browsing, an instance filed in a
  // folder shows only via that folder's tile; searching looks at everything
  // regardless of where it's filed.
  const filteredLibrary = useMemo(() => {
    const q = query.toLowerCase();
    if (searching) return instances.filter((i) => i.name.toLowerCase().includes(q));
    return instances.filter((i) => !i.folderId);
  }, [instances, query, searching]);

  const visibleFolders = useMemo(() => {
    if (!searching) return folders;
    const q = query.toLowerCase();
    return folders.filter((f) => f.name.toLowerCase().includes(q));
  }, [folders, query, searching]);

  function folderCount(folderId) {
    return instances.filter((i) => i.folderId === folderId).length;
  }

  const hasRecentPlay = showRecent && ((recentWorlds && recentWorlds.length > 0) || (recentServers && recentServers.length > 0));

  return (
    <div>
      <RecapBanner onOpen={onOpenRecap} />
      {hasRecentPlay && (
        <>
          <h2 className="section-heading">Recent</h2>

          {recentWorlds && recentWorlds.length > 0 && (
            <div className="recent-play-group">
              <div className="recent-play-group-header">
                <div className="recent-play-group-title">Worlds</div>
                <button className="btn-text" onClick={() => dismissAll('world')}>Clean up</button>
              </div>
              <div className="recent-play-list">
                {recentWorlds.map((w) => (
                  <RecentPlayRow key={`${w.instanceId}:${w.folderName}`} item={w} kind="world" onPlay={handlePlayRecent} onOpenInstance={onOpenInstance} onDismiss={dismissOne} />
                ))}
              </div>
            </div>
          )}

          {recentServers && recentServers.length > 0 && (
            <div className="recent-play-group">
              <div className="recent-play-group-header">
                <div className="recent-play-group-title">Servers</div>
                <button className="btn-text" onClick={() => dismissAll('server')}>Clean up</button>
              </div>
              <div className="recent-play-list">
                {recentServers.map((s) => (
                  <RecentPlayRow key={`${s.instanceId}:${s.address}`} item={s} kind="server" onPlay={handlePlayRecent} onOpenInstance={onOpenInstance} onDismiss={dismissOne} />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <div className="page-header" style={{ marginTop: 34 }}>
        <h2 className="section-heading" style={{ margin: 0 }}>Library</h2>
        <div style={{ display: 'flex', gap: 10 }}>
          <ImportPackButton onImportPackFile={onImportPackFile} onImportInstance={onImportInstance} />
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            <PlusIcon width={16} height={16} /> Create instance
          </button>
        </div>
      </div>

      {instances.length === 0 && folders.length === 0 && !(installs || []).length ? (
        <div className="empty-state">
          <p>No instance yet.</p>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            <PlusIcon width={16} height={16} /> Create the first instance
          </button>
        </div>
      ) : (
        <>
          <div className="search-bar">
            <SearchIcon width={18} height={18} />
            <input placeholder="Search for instances..." value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>

          {filteredLibrary.length === 0 && visibleFolders.length === 0 && !(installs || []).length ? (
            <div className="empty-state"><p>Nothing found.</p></div>
          ) : (
            <div className="library-grid">
              {!query.trim() && (installs || []).filter((i) => !i.isPackUpdate).map((inst) => (
                <DownloadTile key={inst.id} install={inst} onDismiss={() => onDismissInstall?.(inst.id)} onControl={onControlInstall} />
              ))}
              {visibleFolders
                .slice()
                .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0))
                .map((folder) => (
                  <FolderTile
                    key={folder.id}
                    folder={folder}
                    count={folderCount(folder.id)}
                    instanceIds={instances.filter((i) => i.folderId === folder.id).map((i) => i.id)}
                    settings={settings}
                    onOpen={() => onOpenLibraryFolder?.(folder.id)}
                    onDropInstance={moveInstanceToFolder}
                    onRenamed={handleFolderRenamed}
                    onDeleted={handleFolderDeleted}
                  />
                ))}
              {filteredLibrary
                .slice()
                .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0))
                .map((inst) => (
                  <InstanceTile
                    key={inst.id}
                    instance={inst}
                    inFolder={!!inst.folderId}
                    onClick={() => onOpenInstance(inst.id)}
                    onPinnedChange={onInstanceUpdated}
                    onOpenSettings={() => onOpenInstance(inst.id, null, true)}
                    onDuplicated={onInstanceCreated}
                    onDeleted={onInstanceDeleted}
                    onMoveToFolder={moveInstanceToFolder}
                    onMergeRequest={handleMergeRequest}
                    settings={settings}
                    runningIds={runningIds}
                    preparingIds={preparingIds}
              crashedIds={crashedIds}
              launchProgress={launchProgress}
                    onPlayInstance={onPlayInstance}
                    onStopInstance={onStopInstance}
                  />
                ))}
            </div>
          )}
        </>
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

      {mergePair && (
        <MergeIntoFolderModal
          instanceA={mergePair[0]}
          instanceB={mergePair[1]}
          onClose={() => setMergePair(null)}
          onMerged={handleMerged}
        />
      )}
    </div>
  );
}
