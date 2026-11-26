import { DownloadIcon, HeartIcon } from './Icons.jsx';
import { formatCount } from '../api/modrinth.js';
import { PLATFORM_CHIP } from '../utils/platforms.js';

export default function ModRow({ project, onClick }) {
  return (
    <div className="mod-row" onClick={onClick}>
      <img className="mod-row-icon" src={project.icon_url} alt="" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
      <div className="mod-row-info">
        <div className="mod-row-title">
          {project.title}
          <span className={`platform-chip ${project.platform}`}>{PLATFORM_CHIP[project.platform] || 'CF'}</span>
        </div>
        <div className="mod-row-desc">{project.description}</div>
      </div>
      <div className="mod-row-stats">
        <span><DownloadIcon width={14} height={14} /> {formatCount(project.downloads)}</span>
        <span><HeartIcon width={14} height={14} /> {formatCount(project.follows || 0)}</span>
      </div>
    </div>
  );
}
