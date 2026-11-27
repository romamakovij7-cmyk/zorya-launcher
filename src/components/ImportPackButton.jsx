import { useEffect, useRef, useState } from 'react';
import { UploadIcon, DownloadCloudIcon, ChevronDownIcon } from './Icons.jsx';
import ImportLauncherModal from './ImportLauncherModal.jsx';

// Picks a modpack file already on disk (.mrpack, or a CurseForge-style .zip
// with manifest.json — the backend tells them apart). The import itself then
// runs in the background with a progress card in the library, like a Modrinth
// or CurseForge download (see App.jsx: startPackFileImport).
export async function pickAndImportPack(onImportPackFile) {
  const picked = await window.api.instances.pickPack();
  if (!picked.ok) return;
  onImportPackFile({ filePath: picked.filePath, title: picked.title });
}

// «Import» открывает выбор: файл со сборкой (.mrpack / .zip) или готовые сборки of другого лаунчера
// (Modrinth App, Prism/MultiMC, CurseForge, ATLauncher) — второй путь копирует их в Eternal.
export default function ImportPackButton({ onImportPackFile, onImportInstance }) {
  const [open, setOpen] = useState(false);
  const [launcherModal, setLauncherModal] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div className="import-wrap" ref={wrapRef}>
      <button className="btn" onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open}>
        <UploadIcon width={16} height={16} /> Import <ChevronDownIcon width={14} height={14} />
      </button>
      {open && (
        <div className="import-menu" role="menu">
          <button className="import-item" role="menuitem" onClick={() => { setOpen(false); pickAndImportPack(onImportPackFile); }}>
            <UploadIcon width={18} height={18} />
            <span><b>From the file</b><i>.mrpack or CurseForge archive (.zip)</i></span>
          </button>
          {onImportInstance && (
            <button className="import-item" role="menuitem" onClick={() => { setOpen(false); setLauncherModal(true); }}>
              <DownloadCloudIcon width={18} height={18} />
              <span><b>From another launcher.</b><i>Modrinth App, Prism, CurseForge, ATLauncher</i></span>
            </button>
          )}
        </div>
      )}
      {launcherModal && <ImportLauncherModal onClose={() => setLauncherModal(false)} onImport={onImportInstance} />}
    </div>
  );
}
