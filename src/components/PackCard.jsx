import { DownloadIcon, HeartIcon, CalendarIcon } from './Icons.jsx';
import { formatCount, formatRelativeDate } from '../api/modrinth.js';
import { PLATFORM_CHIP } from '../utils/platforms.js';

export default function PackCard({ project, onClick }) {
  return (
    <div className="pack-card" onClick={onClick}>
      {project.featured_gallery || project.gallery?.[0] ? (
        <img className="pack-card-image" src={project.featured_gallery || project.gallery[0]} alt="" loading="lazy" />
      ) : null}
      <div className="pack-card-body">
        <div className="pack-card-title-row">
          <img className="pack-card-icon" src={project.icon_url} alt="" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="pack-card-title">{project.title}</div>
            <div className="pack-card-author">{project.author}</div>
          </div>
          <span className={`platform-chip ${project.platform}`}>{PLATFORM_CHIP[project.platform] || 'CF'}</span>
        </div>
        <div className="pack-card-stats">
          <span><DownloadIcon width={14} height={14} /> {formatCount(project.downloads)}</span>
          {project.platform !== 'technic' && <span><HeartIcon width={14} height={14} /> {formatCount(project.follows || 0)}</span>}
          {project.date_modified && <span><CalendarIcon width={14} height={14} /> {formatRelativeDate(project.date_modified)}</span>}
        </div>
        <div className="pack-card-desc">{project.description}</div>
      </div>
    </div>
  );
}
