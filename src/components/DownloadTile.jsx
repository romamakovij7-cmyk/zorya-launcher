import { BoxIcon, CloseIcon, PauseIcon, PlayIcon } from './Icons.jsx';
import { installPercent, installLabel } from '../utils/installs.js';

// Library card for a modpack that is still downloading (or failed to).
export default function DownloadTile({ install, onDismiss, onControl }) {
  const pct = installPercent(install);
  const failed = install.status === 'error';
  const paused = install.status === 'paused';
  const cancelling = install.status === 'cancelling';

  function cancel() {
    if (confirm(`Отменить загрузку «${install.title}»? Уже скачанные файлы будут удалены.`)) onControl?.(install.id, 'cancel');
  }

  return (
    <div className={`instance-tile downloading ${failed ? 'failed' : ''} ${paused ? 'paused' : ''}`} title={failed ? install.error : installLabel(install)}>
      {failed && (
        <span className="instance-tile-select active" role="button" onClick={onDismiss} title="Убрать">
          <CloseIcon width={12} height={12} />
        </span>
      )}
      <div className="instance-tile-icon">
        {install.icon ? <img src={install.icon} alt="" /> : <BoxIcon width={46} height={46} />}
      </div>
      <div className="instance-tile-text">
        <div className="instance-tile-name">{install.title}</div>
        <div className="instance-tile-meta">{failed ? (install.error || 'Error') : installLabel(install)}</div>
        {!failed && (
          <div className="download-tile-bar">
            <div className={`progress-bar-track ${pct == null && !paused ? 'indeterminate' : ''}`}>
              <div className="progress-bar-fill" style={pct == null ? (paused ? { width: '4%' } : undefined) : { width: `${pct}%` }} />
            </div>
            <span className="download-tile-pct">{pct == null ? '' : `${pct}%`}</span>
            <button
              className="download-tile-btn"
              onClick={() => onControl?.(install.id, paused ? 'resume' : 'pause')}
              disabled={cancelling}
              title={paused ? 'Continue' : 'Пауза'}
            >
              {paused ? <PlayIcon width={13} height={13} /> : <PauseIcon width={13} height={13} />}
            </button>
            <button className="download-tile-btn danger" onClick={cancel} disabled={cancelling} title="Отменить загрузку">
              <CloseIcon width={13} height={13} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
