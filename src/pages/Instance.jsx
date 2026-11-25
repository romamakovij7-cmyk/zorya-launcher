import ProjectPage from '../components/ProjectPage.jsx';
import ErrorBoundary from '../components/ErrorBoundary.jsx';
import { useEffect, useRef, useState } from 'react';
import {
  BoxIcon, PlayIcon, StopIcon, FolderIcon, TrashIcon, GearIcon, MoreVerticalIcon, PauseIcon, CloseIcon, RefreshIcon,
} from '../components/Icons.jsx';
import { installPercent, installLabel, isActiveInstall } from '../utils/installs.js';
import ContentTab from '../components/ContentTab.jsx';
import HorizonModsTab from '../components/HorizonModsTab.jsx';
import FilesTab from '../components/FilesTab.jsx';
import WorldsTab from '../components/WorldsTab.jsx';
import ServersTab from '../components/ServersTab.jsx';
import LogTab from '../components/LogTab.jsx';
import InstanceSettingsModal from '../components/InstanceSettingsModal.jsx';
import ProjectFinder from '../components/ProjectFinder.jsx';
import CrashPanel from '../components/CrashPanel.jsx';
import MonitorTab from '../components/MonitorTab.jsx';
import { formatDuration, formatRelativeDate } from '../api/modrinth.js';
import { formatBytes } from '../utils/formatBytes.js';
import { stageLabel, stagePercent } from '../utils/launchStages.js';
import { useOrder } from '../utils/useOrder.js';

const TABS = [
  { id: 'content', label: 'Content' },
  { id: 'files', label: 'Files' },
  { id: 'worlds', label: 'Worlds' },
  { id: 'servers', label: 'Servers' },
  { id: 'log', label: 'Log' },
];

const TAB_IDS = TABS.map((t) => t.id);

// MR/CF badge + "check for a pack update" button shown next to a modpack
// instance's name — separate from the per-mod update checker on the Контент
// tab, this asks whether the *pack itself* (as published on Modrinth/
// CurseForge) has a newer version.
function PackUpdateRow({
  instance, packInstall, onControlInstall, onUpdatePack,
}) {
  const [check, setCheck] = useState(null); // null | 'checking' | { ok, hasUpdate, latest, error }
  const running = packInstall && isActiveInstall(packInstall);
  const paused = packInstall?.status === 'paused';

  async function runCheck() {
    setCheck('checking');
    setCheck(await window.api.instances.checkPackUpdate(instance.id));
  }

  return (
    <div className="pack-update-row">
      <span className={`platform-chip ${instance.source}`}>{instance.source === 'modrinth' ? 'MR' : 'CF'}</span>
      {running ? (
        <div className="download-tile-bar" style={{ flex: 1, maxWidth: 260 }}>
          <div className={`progress-bar-track ${installPercent(packInstall) == null && !paused ? 'indeterminate' : ''}`}>
            <div className="progress-bar-fill" style={installPercent(packInstall) == null ? (paused ? { width: '4%' } : undefined) : { width: `${installPercent(packInstall)}%` }} />
          </div>
          <span className="download-tile-pct">{installLabel(packInstall)}</span>
          <button className="download-tile-btn" title={paused ? 'Continue' : 'Pause'} disabled={packInstall.status === 'cancelling'} onClick={() => onControlInstall(packInstall.id, paused ? 'resume' : 'pause')}>
            {paused ? <PlayIcon width={12} height={12} /> : <PauseIcon width={12} height={12} />}
          </button>
          <button className="download-tile-btn danger" title="Cancel" disabled={packInstall.status === 'cancelling'} onClick={() => { if (confirm('Cancel build update?')) onControlInstall(packInstall.id, 'cancel'); }}>
            <CloseIcon width={12} height={12} />
          </button>
        </div>
      ) : check?.hasUpdate ? (
        <>
          <span className="hint-text">Доступна новая версия сборки{check.latest?.name ? `: ${check.latest.name}` : ''}</span>
          <button className="btn btn-primary" style={{ padding: '6px 14px', fontSize: 13 }} onClick={() => onUpdatePack(instance)}>Refresh сборку</button>
        </>
      ) : (
        <button className="btn" style={{ padding: '6px 14px', fontSize: 13 }} onClick={runCheck} disabled={check === 'checking'}>
          <RefreshIcon width={13} height={13} className={check === 'checking' ? 'pack-update-spin' : ''} />
          {check === 'checking' ? 'Examination…' : 'Check build update'}
        </button>
      )}
      {check && check.ok === false && <span className="error-text">{check.error}</span>}
      {check && check.ok && !check.hasUpdate && <span className="hint-text">Установлена последняя версия сборки.</span>}
    </div>
  );
}

export default function Instance({
  instance, account, onDeleted, onRenamed, onDuplicated, runningIds, setRunningIds, initialQuickPlay, initialShowSettings, onCrashDismiss, onFindingChange,
  packInstall, onControlInstall, onUpdatePack, initialTab,
}) {
  const [status, setStatus] = useState('idle');
  const [progress, setProgress] = useState(null);
  const [logLines, setLogLines] = useState([]);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState(TAB_IDS.includes(initialTab) ? initialTab : 'content');
  const { order: tabOrder, itemProps: tabProps } = useOrder('instanceTabOrder', TAB_IDS); // draggable tab buttons
  const [logView, setLogView] = useState('log'); // 'log' | 'monitor' inside the Log tab
  const [logToolbarSlot, setLogToolbarSlot] = useState(null); // where LogTab puts its filters: next to the Log/Монитор switch
  const [menuOpen, setMenuOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(!!initialShowSettings);
  const [finding, setFinding] = useState(false);
  const [viewProject, setViewProject] = useState(null); // { platform, projectId, type } — a project page opened from the content list

  // Lets the app (Discord status) know the mod finder is open.
  useEffect(() => {
    onFindingChange?.(finding || !!viewProject);
    return () => onFindingChange?.(false);
  }, [finding, viewProject]);
  const [contentRefreshKey, setContentRefreshKey] = useState(0);
  const [launchKey, setLaunchKey] = useState(0);
  const [sizeInfo, setSizeInfo] = useState(null);

  // Folder size + mod count: on open, and again after a launch/install
  // finishes or mods change (the game can add gigabytes of worlds/logs).
  useEffect(() => {
    let cancelled = false;
    window.api.instances.getSize(instance.id).then((res) => {
      if (!cancelled && res?.ok) setSizeInfo(res);
    });
    return () => { cancelled = true; };
  }, [instance.id, status, contentRefreshKey]);
  const consumedQuickPlayRef = useRef(null);

  // Crash analysis: whatever happened last time this instance was launched
  // (also when it was started from a library card), plus live crashes.
  const [crash, setCrash] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setCrash(null);
    window.api.instances.getLastCrash(instance.id).then((c) => { if (!cancelled) setCrash(c); });
    const off = window.api.instances.onCrash((p) => { if (p.instanceId === instance.id) setCrash(p.analysis); });
    return () => { cancelled = true; off(); };
  }, [instance.id]);

  function dismissCrash() {
    setCrash(null);
    window.api.instances.clearCrash(instance.id);
    onCrashDismiss?.(instance.id);
  }

  const isRunning = runningIds.has(instance.id);

  useEffect(() => {
    setStatus(isRunning ? 'running' : 'idle');
    setLogLines([]);
    setError(null);
    setProgress(null);
    setTab(TAB_IDS.includes(initialTab) ? initialTab : 'content');
    setFinding(false);
  }, [instance.id, initialTab]);

  // Opening the page of a game that is already running (or just ran): pick up what it has printed so far — the live
  // feed below only delivers lines while this page is open, so with two games the other one's log would be empty.
  useEffect(() => {
    let cancelled = false;
    window.api.instances.getLiveLog(instance.id).then((lines) => {
      if (!cancelled && Array.isArray(lines) && lines.length) setLogLines(lines);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [instance.id]);

  useEffect(() => {
    const offProgress = window.api.instances.onProgress((p) => {
      if (p.instanceId !== instance.id) return;
      if (p.stage === 'preparing') setCrash(null); // a new launch replaces the old crash report
      setProgress(p);
      if (p.stage === 'error') { setStatus('error'); setError(p.error); }
      else if (p.stage === 'running') setStatus('running');
      else setStatus('preparing');
    });
    const offLog = window.api.instances.onLog((p) => {
      if (p.instanceId !== instance.id) return;
      setLogLines((prev) => [...prev.slice(-2000), p.line]);
    });
    const offExit = window.api.instances.onExit((p) => {
      if (p.instanceId !== instance.id) return;
      setStatus('idle');
      setRunningIds((prev) => { const next = new Set(prev); next.delete(instance.id); return next; });
      const message = p.signal === 'stopped' ? 'Stopped by user'
        : p.signal === 'stale' ? 'Game has already been closed'
        : `Process завершился с кодом ${p.code}`;
      setLogLines((prev) => [...prev, `\n[launcher] ${message}\n`]);
    });
    return () => { offProgress(); offLog(); offExit(); };
  }, [instance.id]);

  async function handlePlay(quickPlay = null, forceRestart = false) {
    setError(null);
    setCrash(null);
    setStatus('preparing');
    setLogLines([]);
    setLaunchKey((k) => k + 1);
    setTab('log');
    // Zorya Launcher: start the local Horizon build directly (no GitHub).
    const res = await window.api.instances.zoryaLaunch(instance.id);
    if (!res.ok) {
      setStatus('error');
      console.error('[Zorya] launch failed:', res.error);
      setError(res.error);
      return;
    }
    setRunningIds((prev) => new Set(prev).add(instance.id));
  }

  // Arriving here from a "recent world/server" entry — jump straight into
  // launching it instead of waiting for the user to hit Play. Guarded by
  // reference so re-renders (or navigating to the same instance again with a
  // fresh quickPlay object) don't repeat a launch that's already underway.
  useEffect(() => {
    if (initialQuickPlay && initialQuickPlay !== consumedQuickPlayRef.current && account && !isRunning) {
      consumedQuickPlayRef.current = initialQuickPlay;
      handlePlay(initialQuickPlay);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuickPlay, account]);

  async function handleStop() {
    await window.api.instances.stop(instance.id);
  }

  async function handleDelete() {
    setMenuOpen(false);
    if (!confirm(`Delete «${instance.name}»? Files будут удалены безвозвратно.`)) return;
    try {
      await window.api.instances.delete(instance.id);
    } catch (err) {
      alert(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
      return;
    }
    onDeleted(instance.id);
  }

  const busy = status === 'preparing';

  if (viewProject) {
    return (
      <div className="instance-page">
        <ErrorBoundary key={`${viewProject.platform}:${viewProject.projectId}`}>
          <ProjectPage
            embedded
            platform={viewProject.platform}
            projectId={viewProject.projectId}
            type={viewProject.type}
            instances={[instance]}
            onBack={() => { setViewProject(null); setContentRefreshKey((k) => k + 1); }}
          />
        </ErrorBoundary>
      </div>
    );
  }

  if (finding) {
    return (
      <div className="instance-page">
        <ProjectFinder
          instance={instance}
          onClose={() => { setFinding(false); setContentRefreshKey((k) => k + 1); }}
          onInstalled={() => setContentRefreshKey((k) => k + 1)}
        />
      </div>
    );
  }

  return (
    <div className="instance-page">
      <div className="instance-hero">
        <div className="instance-hero-icon">
          {instance.icon ? <img src={instance.icon} alt="" /> : <BoxIcon width={42} height={42} />}
        </div>
        <div className="instance-hero-info">
          <h1>{instance.name}</h1>
          {(instance.source === 'modrinth' || instance.source === 'curseforge') && (
            <PackUpdateRow instance={instance} packInstall={packInstall} onControlInstall={onControlInstall} onUpdatePack={onUpdatePack} />
          )}
          <div className="meta">
            <span>{instance.loader !== 'vanilla' ? `${cap(instance.loader)} ${instance.mcVersion}` : `Vanilla ${instance.mcVersion}`}</span>
            <span className="dot" />
            <span>{formatDuration(instance.totalPlaytimeMs)}</span>
            <span className="dot" />
            <span>{instance.lastPlayed ? `Последний запуск: ${formatRelativeDate(new Date(instance.lastPlayed).toISOString())}` : 'Never launched'}</span>
          </div>
          {sizeInfo && (
            <div className="meta meta-secondary">
              <span>Size: {formatBytes(sizeInfo.bytes)}</span>
              {(instance.loader !== 'vanilla' || sizeInfo.mods > 0) && (
                <>
                  <span className="dot" />
                  <span>
                    mods: {sizeInfo.mods}
                    {sizeInfo.modsDisabled > 0 && ` (выключено: ${sizeInfo.modsDisabled})`}
                  </span>
                </>
              )}
            </div>
          )}
        </div>
        <div className="instance-hero-actions">
          {isRunning ? (
            <button className="btn btn-danger" onClick={handleStop}>
              <StopIcon width={16} height={16} /> Стоп
            </button>
          ) : (
            <button className="btn btn-primary" onClick={() => handlePlay()} disabled={busy || !account}>
              <PlayIcon width={16} height={16} /> {busy ? 'Preparation…' : 'Play'}
            </button>
          )}
          <button className="btn btn-icon" title="Build Settings" onClick={() => setShowSettings(true)}>
            <GearIcon width={18} height={18} />
          </button>
          <div style={{ position: 'relative' }}>
            <button className="btn btn-icon" title="Ещё" onClick={() => setMenuOpen((v) => !v)}>
              <MoreVerticalIcon width={18} height={18} />
            </button>
            {menuOpen && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 59 }} onClick={() => setMenuOpen(false)} />
                <div className="modal" style={{
                  position: 'absolute', top: 44, right: 0, width: 200, padding: 6, zIndex: 60,
                }}>
                  <button className="tab-bar-btn" style={{ width: '100%', justifyContent: 'flex-start' }}
                    onClick={async () => {
                      setMenuOpen(false);
                      const res = await window.api.instances.openFolder(instance.id);
                      if (res && !res.ok) alert(`Failed открыть папку: ${res.error}`);
                    }}>
                    <FolderIcon width={16} height={16} /> Open папку
                  </button>
                  <button className="tab-bar-btn" style={{ width: '100%', justifyContent: 'flex-start', color: 'var(--danger)' }}
                    onClick={handleDelete}>
                    <TrashIcon width={16} height={16} /> Delete сборку
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {!account && <div className="error-text" style={{ marginBottom: 14 }}>Войдите в аккаунт в Настройках перед запуском.</div>}

      {crash && !isRunning && (
        <CrashPanel
          instance={instance}
          crash={crash}
          onDismiss={dismissCrash}
          onInstanceChanged={onRenamed}
          onFindMods={() => { dismissCrash(); setFinding(true); }}
          onModsChanged={() => setContentRefreshKey((k) => k + 1)}
          onOpenLog={() => setTab('log')}
        />
      )}

      <div className="tab-bar">
        {tabOrder.map((id) => (
          <button key={id} className={`tab-bar-btn ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)} {...tabProps(id)}>
            {id === 'content' && instance.loader === 'horizon' ? 'Mods' : TABS.find((t) => t.id === id).label}
          </button>
        ))}
      </div>

      {tab === 'content' && instance.loader === 'horizon' && <HorizonModsTab instance={instance} />}
      {tab === 'content' && instance.loader !== 'horizon' && (
        <ContentTab
          instance={instance}
          onFindProjects={() => setFinding(true)}
          onOpenProject={(platform, projectId, type) => setViewProject({ platform, projectId, type })}
          refreshKey={contentRefreshKey}
        />
      )}
      {tab === 'files' && <FilesTab instance={instance} />}
      {tab === 'worlds' && <WorldsTab instance={instance} onPlay={handlePlay} busy={busy} account={account} />}
      {tab === 'servers' && <ServersTab instance={instance} onPlay={handlePlay} busy={busy} account={account} />}
      {tab === 'log' && (
        <div className="log-tab">
          <div className="log-head-row">
            <div className="log-head-slot" ref={setLogToolbarSlot} />
            <div className="pill-tabs log-view-tabs">
              <button className={`pill-tab ${logView === 'log' ? 'active' : ''}`} onClick={() => setLogView('log')}>Log</button>
              <button className={`pill-tab ${logView === 'monitor' ? 'active' : ''}`} onClick={() => setLogView('monitor')}>Монитор</button>
            </div>
          </div>
          {busy && (
            <div>
              <div className="progress-label">{stageLabel(progress, instance)}</div>
              <div className={`progress-bar-track ${stagePercent(progress) == null ? 'indeterminate' : ''}`}>
                <div
                  className="progress-bar-fill"
                  style={stagePercent(progress) == null ? undefined : { width: `${stagePercent(progress)}%` }}
                />
              </div>
              {progress?.line && <div className="hint-text progress-line">{progress.line}</div>}
            </div>
          )}
          {error && (
            error.stale ? (
              <div className="error-text" style={{ whiteSpace: 'pre-wrap', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span>Instance всё ещё выглядит запущенной (процесс не завершился сам собой) — играть сейчас нельзя.</span>
                <button className="btn btn-danger" onClick={() => handlePlay(error.quickPlay, true)}>
                  Завершить и запустить заново
                </button>
              </div>
            ) : (
              <div className="error-text" style={{ whiteSpace: 'pre-wrap' }}>{error}</div>
            )
          )}
          {logView === 'monitor' ? (
            <MonitorTab instance={instance} running={isRunning} onOpenSettings={() => setShowSettings(true)} />
          ) : (
            <LogTab
              instance={instance}
              liveText={logLines.join('')}
              launchKey={launchKey}
              toolbarSlot={logToolbarSlot}
              emptyMessage="Logs will appear here after starting the build."
            />
          )}
        </div>
      )}

      {showSettings && (
        <InstanceSettingsModal
          instance={instance}
          onClose={() => setShowSettings(false)}
          onRenamed={onRenamed}
          onInstallChanged={onRenamed}
          onDeleted={onDeleted}
          onDuplicated={onDuplicated}
        />
      )}
    </div>
  );
}

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
