import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronLeft, ChevronRight,
  MinimizeIcon, MaximizeIcon, CloseIcon, BoxIcon, StopIcon, PauseIcon, PlayIcon, LifeBuoyIcon,
} from './Icons.jsx';
import appIcon from '../assets/icon.png';
import { installPercent, installLabel, isActiveInstall } from '../utils/installs.js';

// Technical support: the Telegram bot (opens in the browser / Telegram through the main process, which allows web links only)
const SUPPORT_URL = 'https://t.me/zorya_minecraft_bot';

export default function TitleBar({
  title, canGoBack, canGoForward, onBack, onForward,
  instances = [], runningIds, preparingIds, onOpenInstance, onStopInstance, installs = [], onDismissInstall, onControlInstall,
}) {
  const [maximized, setMaximized] = useState(false);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState(null);
  const pillRef = useRef(null);
  const popRef = useRef(null);

  useEffect(() => {
    window.api.window.isMaximized().then(setMaximized);
    return window.api.window.onMaximizedChange(setMaximized);
  }, []);

  const running = instances.filter((i) => runningIds?.has(i.id));
  const starting = instances.filter((i) => preparingIds?.has(i.id) && !runningIds?.has(i.id));
  const runningCount = runningIds?.size || 0;
  const downloading = installs.filter(isActiveInstall);
  const shownDownload = downloading[0] || null;

  // Close on any click outside the popover (the pill itself toggles it).
  useEffect(() => {
    if (!open) return undefined;
    function onDown(e) {
      if (popRef.current?.contains(e.target) || pillRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    function onKey(e) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey);
    const onBlur = () => setOpen(false);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onBlur);
    };
  }, [open]);

  function togglePopover() {
    if (!open && pillRef.current) {
      const rect = pillRef.current.getBoundingClientRect();
      setAnchor({ top: rect.bottom + 8, right: Math.max(8, window.innerWidth - rect.right) });
    }
    setOpen((v) => !v);
  }

  function stopOne(inst) {
    if (!confirm(`Close «${inst.name}»? Несохранённый прогресс в игре может пропасть.`)) return;
    onStopInstance?.(inst.id);
  }

  function stopAll() {
    if (!confirm(`Close все запущенные сборки (${running.length})? Несохранённый прогресс в играх может пропасть.`)) return;
    running.forEach((inst) => onStopInstance?.(inst.id));
  }

  return (
    <div className="titlebar">
      <div className="titlebar-left">
        <button className="nav-btn" disabled={!canGoBack} onClick={onBack} title="Back">
          <ChevronLeft />
        </button>
        <button className="nav-btn" disabled={!canGoForward} onClick={onForward} title="Forward">
          <ChevronRight />
        </button>
        <span className="titlebar-title">{title}</span>
      </div>

      <div className="titlebar-brand">
        <img src={appIcon} alt="" />
        <span>Zorya Launcher</span>
      </div>

      <div className="titlebar-right">
        {shownDownload && (
          <button className="titlebar-install" onClick={togglePopover} title={`${shownDownload.status === 'paused' ? 'On pause' : 'Downloading'}: ${shownDownload.title}`}>
            <span className="titlebar-install-icon">{shownDownload.icon ? <img src={shownDownload.icon} alt="" /> : <BoxIcon width={14} height={14} />}</span>
            <span className="titlebar-install-bar">
              <span className={`progress-bar-track ${installPercent(shownDownload) == null ? 'indeterminate' : ''}`} style={{ display: 'block' }}>
                <span className="progress-bar-fill" style={installPercent(shownDownload) == null ? undefined : { width: `${installPercent(shownDownload)}%` }} />
              </span>
            </span>
            <span className="titlebar-install-pct">{installPercent(shownDownload) == null ? '…' : `${installPercent(shownDownload)}%`}</span>
            {downloading.length > 1 && <span className="titlebar-install-more">+{downloading.length - 1}</span>}
          </button>
        )}
        <button className="status-pill clickable support-pill" onClick={() => window.api.shell.openExternal(SUPPORT_URL)} title="Technical support: Telegram bot @zorya_minecraft_bot" aria-label="Technical support">
          <LifeBuoyIcon width={17} height={17} />
        </button>
        <button ref={pillRef} className={`status-pill clickable ${open ? 'open' : ''}`} onClick={togglePopover} title="Running builds">
          <span className={`status-dot ${runningCount > 0 ? 'active' : ''}`} />
          {runningCount > 0 ? `Запущено сборок: ${runningCount}` : 'No running builds'}
        </button>
        <div className="window-controls">
          <button onClick={() => window.api.window.minimize()} title="Collapse"><MinimizeIcon /></button>
          <button onClick={() => window.api.window.maximizeToggle()} title="Expand"><MaximizeIcon /></button>
          <button className="close-btn" onClick={() => window.api.window.close()} title="Close"><CloseIcon /></button>
        </div>
      </div>

      {open && anchor && createPortal(
        <div className="running-popover" ref={popRef} style={{ top: anchor.top, right: anchor.right }}>
          {running.length === 0 && starting.length === 0 && installs.length === 0 ? (
            <div className="running-popover-empty">Сейчас ничего не запущено.</div>
          ) : (
            <>
              {installs.length > 0 && <div className="running-popover-section">Скачивание</div>}
              {installs.map((inst) => (
                <div className="running-popover-row starting" key={inst.id}>
                  <div className="running-popover-icon">{inst.icon ? <img src={inst.icon} alt="" /> : <BoxIcon width={16} height={16} />}</div>
                  <div className="running-popover-main" style={{ cursor: 'default' }}>
                    <span className="running-popover-name">{inst.title}</span>
                    <span className="running-popover-sub">{inst.status === 'error' ? (inst.error || 'Error') : installLabel(inst)}</span>
                    {inst.status !== 'error' && (
                      <span className="running-popover-progress">
                        <span className={`progress-bar-track ${installPercent(inst) == null ? 'indeterminate' : ''}`} style={{ display: 'block' }}>
                          <span className="progress-bar-fill" style={installPercent(inst) == null ? undefined : { width: `${installPercent(inst)}%` }} />
                        </span>
                        <span>{installPercent(inst) == null ? '' : `${installPercent(inst)}%`}</span>
                      </span>
                    )}
                  </div>
                  {inst.status === 'error' && <button className="running-popover-stop" onClick={() => onDismissInstall?.(inst.id)}>Убрать</button>}
                  {inst.status !== 'error' && (
                    <span style={{ display: 'flex', gap: 6 }}>
                      <button className="download-tile-btn" disabled={inst.status === 'cancelling'} title={inst.status === 'paused' ? 'Continue' : 'Pause'} onClick={() => onControlInstall?.(inst.id, inst.status === 'paused' ? 'resume' : 'pause')}>
                        {inst.status === 'paused' ? <PlayIcon width={13} height={13} /> : <PauseIcon width={13} height={13} />}
                      </button>
                      <button className="download-tile-btn danger" disabled={inst.status === 'cancelling'} title="Cancel download" onClick={() => { if (confirm(`Отменить загрузку «${inst.title}»? Уже скачанные файлы будут удалены.`)) onControlInstall?.(inst.id, 'cancel'); }}>
                        <CloseIcon width={13} height={13} />
                      </button>
                    </span>
                  )}
                </div>
              ))}
              {running.map((inst) => (
                <div className="running-popover-row" key={inst.id}>
                  <div className="running-popover-icon">
                    {inst.icon ? <img src={inst.icon} alt="" /> : <BoxIcon width={16} height={16} />}
                  </div>
                  <button
                    className="running-popover-main"
                    title="Open assembly"
                    onClick={() => { setOpen(false); onOpenInstance?.(inst.id); }}
                  >
                    <span className="running-popover-name">{inst.name}</span>
                    <span className="running-popover-sub">
                      {inst.loader !== 'vanilla' ? `${inst.loader} ` : ''}{inst.mcVersion}
                    </span>
                  </button>
                  <button className="running-popover-stop" title="Close game" onClick={() => stopOne(inst)}>
                    <StopIcon width={12} height={12} /> Close
                  </button>
                </div>
              ))}
              {starting.map((inst) => (
                <div className="running-popover-row starting" key={inst.id}>
                  <div className="running-popover-icon">
                    {inst.icon ? <img src={inst.icon} alt="" /> : <BoxIcon width={16} height={16} />}
                  </div>
                  <button
                    className="running-popover-main"
                    onClick={() => { setOpen(false); onOpenInstance?.(inst.id); }}
                  >
                    <span className="running-popover-name">{inst.name}</span>
                    <span className="running-popover-sub">Запускается…</span>
                  </button>
                </div>
              ))}
              {running.length > 1 && (
                <button className="running-popover-all" onClick={stopAll}>Close все</button>
              )}
            </>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
