import ProjectBrowser from '../components/ProjectBrowser.jsx';

export default function Search({ initialType = 'modpack', onOpenProject }) {
  return (
    <div>
      <div className="page-header">
        <h1>Search</h1>
      </div>
      <ProjectBrowser allowedTypes={['modpack', 'mod', 'resourcepack', 'shader']} initialType={initialType} onOpenProject={onOpenProject} />
    </div>
  );
}
