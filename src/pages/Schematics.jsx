import Select from '../components/Select.jsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  LayersIcon, SearchIcon, BoxIcon, FolderIcon, TrashIcon, DownloadCloudIcon, CopyIcon, UploadIcon, CloseIcon, CheckIcon,
} from '../components/Icons.jsx';
import SchematicViewer3D, { textureKey } from '../components/SchematicViewer3D.jsx';

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

function decodePreview(preview) {
  if (!preview) return null;
  const { side, rgba } = preview;
  const canvas = document.createElement('canvas');
  canvas.width = side;
  canvas.height = side;
  const ctx = canvas.getContext('2d');
  const bytes = Uint8ClampedArray.from(atob(rgba), (c) => c.charCodeAt(0));
  ctx.putImageData(new ImageData(bytes, side, side), 0, 0);
  return canvas.toDataURL();
}

// Grass/leaves textures come back from the backend as grayscale masks (real
// Minecraft tints them per-biome at render time, which we don't model) —
// multiply in a fixed green here, then restore the original alpha shape
// (the multiply step also messes up transparency, since it's blended
// against an opaque fill) so leaves keep their cutout transparency instead
// of turning into solid green squares.
function applyTint(dataUrl, tint) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = `#${tint.toString(16).padStart(6, '0')}`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = 'destination-in';
      ctx.drawImage(img, 0, 0);
      resolve(canvas.toDataURL());
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

// Animated block textures (water, lava, magma, sea lantern, campfire...)
// are stored as a tall vertical strip of square frames, not a single tile —
// used as-is it'd render as the whole stretched/stacked strip instead of
// one frame. Crop to just the first (top) frame when the image is taller
// than it is wide.
function normalizeFrame(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      if (img.naturalHeight <= img.naturalWidth) { resolve(dataUrl); return; }
      const size = img.naturalWidth;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      canvas.getContext('2d').drawImage(img, 0, 0, size, size, 0, 0, size, size);
      resolve(canvas.toDataURL());
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

async function finishTexture(dataUrl, tint) {
  let out = await normalizeFrame(dataUrl);
  if (tint) out = await applyTint(out, tint);
  return out;
}

// Backend returns { blocks: { key: { parts, tint } }, textures: { path: dataUrl } }.
// Every distinct (texture path, tint) pair used by a face becomes one image
// here (frame-cropped, tinted), keyed by textureKey(); the 3D viewer looks
// faces up by that same key.
async function resolveTextures(data) {
  const wanted = new Map(); // key -> { path, tint }
  for (const block of Object.values(data.blocks)) {
    for (const part of block.parts) {
      for (const el of part.elements) {
        for (const face of Object.values(el.faces)) {
          const tint = face.tint ? block.tint : null;
          wanted.set(textureKey(face.tex, tint), { path: face.tex, tint });
        }
      }
    }
  }
  const images = {};
  await Promise.all([...wanted].map(async ([key, { path, tint }]) => {
    const raw = data.textures[path];
    if (raw) images[key] = await finishTexture(raw, tint);
  }));
  return { blocks: data.blocks, images };
}

function prettyBlockName(id) {
  const [ns, rest] = id.includes(':') ? id.split(':') : ['minecraft', id];
  const name = rest.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  return ns === 'minecraft' ? name : `${name} (${ns})`;
}

function formatStacks(count) {
  if (count < 64) return '';
  const stacks = Math.floor(count / 64);
  const rest = count % 64;
  return rest ? `${stacks} ст. + ${rest}` : `${stacks} ст.`;
}

export default function Schematics({ instances }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [show3d, setShow3d] = useState(false);
  const [voxelData, setVoxelData] = useState(null);
  const [voxelError, setVoxelError] = useState(null);
  const [loadingVoxels, setLoadingVoxels] = useState(false);
  const [blockTextures, setBlockTextures] = useState(null);
  const [loadingTextures, setLoadingTextures] = useState(false);
  const [textureError, setTextureError] = useState(null);
  const [showMaterials, setShowMaterials] = useState(false);
  const [materials, setMaterials] = useState(null);
  const [materialsError, setMaterialsError] = useState(null);
  const [loadingMaterials, setLoadingMaterials] = useState(false);
  const [copied, setCopied] = useState(false);
  const [importInstanceId, setImportInstanceId] = useState(instances[0]?.id || '');
  const [importing, setImporting] = useState(false);
  const [copyTarget, setCopyTarget] = useState('');
  // "Build" animation of the 3D view: progress 0..1 (1 = fully built).
  const [buildProgress, setBuildProgress] = useState(1);
  const [building, setBuilding] = useState(false);
  const [buildSpeed, setBuildSpeed] = useState(1);
  const buildRef = useRef({ progress: 1, speed: 1, total: 0 });
  buildRef.current.speed = buildSpeed;
  buildRef.current.total = voxelData?.blocks?.length || 0;

  useEffect(() => {
    if (!building) return undefined;
    let raf;
    let last = performance.now();
    function tick(now) {
      const dt = (now - last) / 1000;
      last = now;
      // Longer structures take longer, but never absurdly long or short.
      const duration = Math.min(40, Math.max(6, buildRef.current.total / 1500));
      const next = Math.min(1, buildRef.current.progress + (dt * buildRef.current.speed) / duration);
      buildRef.current.progress = next;
      setBuildProgress(next);
      if (next >= 1) { setBuilding(false); return; }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [building]);

  function toggleBuild() {
    if (building) { setBuilding(false); return; }
    if (buildRef.current.progress >= 1) { buildRef.current.progress = 0; setBuildProgress(0); }
    setBuilding(true);
  }

  function scrubBuild(value) {
    setBuilding(false);
    buildRef.current.progress = value;
    setBuildProgress(value);
  }

  function load() {
    window.api.schematics.list().then((res) => {
      if (res.ok) setItems(res.items);
      else { setError(res.error); setItems([]); }
    });
  }

  useEffect(load, []);
  useEffect(() => {
    if (!importInstanceId && instances.length) setImportInstanceId(instances[0].id);
  }, [instances]);

  const filtered = useMemo(() => {
    if (!items) return [];
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => i.name.toLowerCase().includes(q)
      || i.instanceName.toLowerCase().includes(q)
      || (i.author || '').toLowerCase().includes(q));
  }, [items, search]);

  function openDetail(item) {
    setDetail(item);
    setPreviewUrl(null);
    setShow3d(false);
    setShowMaterials(false);
    setMaterials(null);
    setMaterialsError(null);
    setCopied(false);
    setVoxelData(null);
    setVoxelError(null);
    setBlockTextures(null);
    setTextureError(null);
    setBuilding(false);
    buildRef.current.progress = 1;
    setBuildProgress(1);
    setCopyTarget(instances.find((i) => i.id !== item.instanceId)?.id || '');
    if (item.hasPreview) {
      window.api.schematics.preview(item.instanceId, item.filename).then((res) => {
        if (res.ok && res.preview) setPreviewUrl(decodePreview(res.preview));
      });
    }
  }

  async function toggleMaterials() {
    if (showMaterials) { setShowMaterials(false); return; }
    setShowMaterials(true);
    setShow3d(false);
    if (materials || !detail) return;
    setLoadingMaterials(true);
    setMaterialsError(null);
    try {
      const res = await window.api.schematics.materials(detail.instanceId, detail.filename);
      if (res.ok) setMaterials(res);
      else setMaterialsError(res.error);
    } catch (err) {
      setMaterialsError(err.message);
    } finally {
      setLoadingMaterials(false);
    }
  }

  // Russian in-game name when the backend found one, else a prettified id.
  const displayName = (id) => materials?.names?.[id] || prettyBlockName(id);

  async function copyMaterials() {
    if (!materials) return;
    const text = materials.items.map((i) => `${displayName(i.id)} × ${i.count}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      alert('Failed скопировать в буфер обмена');
    }
  }

  async function load3d() {
    if (!detail) return;
    setShow3d(true);
    setShowMaterials(false);
    if (voxelData) return;
    setLoadingVoxels(true);
    setVoxelError(null);
    const res = await window.api.schematics.voxels(detail.instanceId, detail.filename);
    setLoadingVoxels(false);
    if (!res.ok) { setVoxelError(res.error); return; }
    setVoxelData(res);

    const seenKeys = new Set();
    const uniqueBlocks = [];
    for (const b of res.blocks) {
      if (seenKeys.has(b.key)) continue;
      seenKeys.add(b.key);
      uniqueBlocks.push({ key: b.key, name: b.name, props: b.props });
    }
    if (uniqueBlocks.length) {
      setLoadingTextures(true);
      setTextureError(null);
      try {
        const texRes = await window.api.schematics.textures(detail.instanceId, uniqueBlocks);
        if (texRes.ok) {
          setBlockTextures(await resolveTextures(texRes));
          if (Object.keys(texRes.blocks).length === 0) {
            setTextureError('Не нашлось ни одной текстуры для блоков этой схематики (возможно, Minecraft version сборки слишком старая или блоки из модов).');
          }
        } else {
          setTextureError(`Failed загрузить текстуры: ${texRes.error}`);
        }
      } catch (err) {
        setTextureError(`Failed обработать текстуры: ${err.message}`);
      } finally {
        setLoadingTextures(false);
      }
    }
  }

  async function handleImport() {
    if (!importInstanceId) return;
    setImporting(true);
    const res = await window.api.schematics.import(importInstanceId);
    setImporting(false);
    if (res.ok && res.added?.length) load();
  }

  async function handleDelete(item) {
    if (!confirm(`Delete «${item.name}»?`)) return;
    const res = await window.api.schematics.delete(item.instanceId, item.filename);
    if (res.ok) {
      setItems((prev) => prev.filter((i) => !(i.instanceId === item.instanceId && i.filename === item.filename)));
      if (detail === item) setDetail(null);
    }
  }

  async function handleSaveAs(item) {
    const res = await window.api.schematics.saveAs(item.instanceId, item.filename);
    if (!res.ok && !res.canceled) alert(`Failed сохранить: ${res.error}`);
  }

  async function handleCopyTo(item) {
    if (!copyTarget) return;
    const res = await window.api.schematics.copyTo(item.instanceId, item.filename, copyTarget);
    if (res.ok) load();
    else alert(`Failed скопировать: ${res.error}`);
  }

  async function handleOpenFolder(item) {
    const res = await window.api.instances.openFolder(item.instanceId, 'schematics');
    if (res && !res.ok) alert(`Failed открыть папку: ${res.error}`);
  }

  return (
    <div>
      <div className="page-header">
        <h1>Schematics</h1>
      </div>

      {items && items.length > 0 && (
        <div className="shots-toolbar">
          <div className="search-bar" style={{ marginBottom: 0 }}>
            <SearchIcon width={18} height={18} />
            <input placeholder="Search по названию, автору или сборке…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="select-chip">
            <Select value={importInstanceId} onChange={setImportInstanceId} options={instances.map((i) => ({ value: i.id, label: i.name }))} />
          </div>
          <button className="btn btn-primary" onClick={handleImport} disabled={importing || !importInstanceId}>
            <UploadIcon width={16} height={16} /> {importing ? 'Добавление…' : 'Add схематику'}
          </button>
        </div>
      )}

      {error && <div className="error-text" style={{ marginBottom: 16 }}>{error}</div>}

      {items === null ? (
        <div className="progress-label">Loading…</div>
      ) : items.length === 0 ? (
        <div className="empty-state">
          <LayersIcon width={38} height={38} />
          <p>Схематик пока нет. Положите .litematic файлы в папку schematics сборки, или добавьте их здесь.</p>
          <div className="select-chip" style={{ marginTop: 14 }}>
            <Select value={importInstanceId} onChange={setImportInstanceId} options={instances.map((i) => ({ value: i.id, label: i.name }))} />
          </div>
          <button className="btn btn-primary" style={{ marginTop: 10 }} onClick={handleImport} disabled={importing || !importInstanceId}>
            <UploadIcon width={16} height={16} /> {importing ? 'Добавление…' : 'Add схематику'}
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state"><p>Ничего не найдено.</p></div>
      ) : (
        <div className="schem-grid">
          {filtered.map((item) => (
            <button className="schem-card" key={`${item.instanceId}:${item.filename}`} onClick={() => openDetail(item)}>
              <div className="schem-card-icon"><LayersIcon width={28} height={28} /></div>
              <div className="schem-card-body">
                <div className="schem-card-name">{item.name}</div>
                <div className="schem-card-sub">
                  {item.size ? `${item.size.x}×${item.size.y}×${item.size.z}` : item.ext}
                  {item.totalBlocks != null && <> · {item.totalBlocks.toLocaleString('ru-RU')} блоков</>}
                </div>
                <div className="schem-card-instance">
                  {item.instanceIcon ? <img src={item.instanceIcon} alt="" /> : <BoxIcon width={11} height={11} />}
                  {item.instanceName}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {detail && (
        <div className="modal-overlay" onClick={() => setDetail(null)}>
          <div className="modal schem-detail-modal" onClick={(e) => e.stopPropagation()}>
            <div className="schem-detail-header">
              <h2 style={{ margin: 0 }}>{detail.name}</h2>
              <button className="icon-btn" onClick={() => setDetail(null)}><CloseIcon /></button>
            </div>

            {showMaterials ? (
              loadingMaterials ? (
                <div className="progress-label" style={{ padding: 30 }}>Подсчёт блоков…</div>
              ) : materialsError ? (
                <div className="error-text">{materialsError}</div>
              ) : materials ? (
                <div className="schem-materials">
                  <div className="schem-materials-head">
                    <span>{materials.items.length} видов · {materials.total.toLocaleString('ru-RU')} шт.</span>
                    <button className="btn btn-sm" onClick={copyMaterials}>
                      {copied ? <CheckIcon width={14} height={14} /> : <CopyIcon width={14} height={14} />}
                      {copied ? 'Скопировано' : 'Copy список'}
                    </button>
                  </div>
                  <div className="schem-materials-list">
                    {materials.items.map((i) => (
                      <div className="schem-materials-row" key={i.id}>
                        <span className="schem-materials-name">{displayName(i.id)}</span>
                        <span className="schem-materials-stacks">{formatStacks(i.count)}</span>
                        <strong>{i.count.toLocaleString('ru-RU')}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null
            ) : show3d ? (
              loadingVoxels ? (
                <div className="progress-label" style={{ padding: 30 }}>Разбор блоков…</div>
              ) : voxelError ? (
                <div className="error-text">{voxelError}</div>
              ) : voxelData ? (
                <>
                  <SchematicViewer3D blocks={voxelData.blocks} sizeHint={detail.size} textures={blockTextures} progress={buildProgress} />
                  <div className="build-controls">
                    <button className="btn" onClick={toggleBuild}>
                      {building ? '⏸ Пауза' : buildProgress >= 1 ? '▶ Построить' : '▶ Continue'}
                    </button>
                    <input
                      type="range" className="mem-range build-slider" min={0} max={1000} step={1}
                      value={Math.round(buildProgress * 1000)}
                      onChange={(e) => scrubBuild(Number(e.target.value) / 1000)}
                    />
                    <span className="build-percent">{Math.round(buildProgress * 100)}%</span>
                    <Select className="plain-select" value={buildSpeed} onChange={setBuildSpeed} title="Скорость" options={[0.5, 1, 2, 4].map((v) => ({ value: v, label: `×${v}` }))} />
                  </div>
                  {loadingTextures && <p className="hint-text">Подгружаются текстуры блоков…</p>}
                  {textureError && <p className="error-text">{textureError}</p>}
                  {voxelData.truncated && (
                    <p className="hint-text">Показана только часть блоков — схематика слишком большая для полного превью.</p>
                  )}
                </>
              ) : null
            ) : previewUrl ? (
              <img className="schem-preview-img" src={previewUrl} alt="" />
            ) : (
              <div className="schem-preview-placeholder"><LayersIcon width={44} height={44} /></div>
            )}

            <div className="install-info-table" style={{ marginTop: 16 }}>
              {detail.author && <div className="install-info-row"><span>Автор</span><strong>{detail.author}</strong></div>}
              {detail.size && <div className="install-info-row"><span>Размер</span><strong>{detail.size.x}×{detail.size.y}×{detail.size.z}</strong></div>}
              {detail.totalBlocks != null && <div className="install-info-row"><span>Блоков</span><strong>{detail.totalBlocks.toLocaleString('ru-RU')}</strong></div>}
              <div className="install-info-row"><span>File</span><strong>{formatSize(detail.fileSize)}</strong></div>
              <div className="install-info-row"><span>Instance</span><strong>{detail.instanceName}</strong></div>
              {detail.description && <div className="install-info-row"><span>Описание</span><strong>{detail.description}</strong></div>}
            </div>

            <div className="modal-actions" style={{ justifyContent: 'space-between', marginTop: 20, flexWrap: 'wrap', gap: 10 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                {detail.ext === '.litematic' && (
                  <button className="btn" onClick={show3d ? () => setShow3d(false) : load3d}>
                    <BoxIcon width={15} height={15} /> {show3d ? 'Превью' : '3D-просмотр'}
                  </button>
                )}
                {detail.ext === '.litematic' && (
                  <button className="btn" onClick={toggleMaterials}>
                    <LayersIcon width={15} height={15} /> {showMaterials ? 'Превью' : 'Список ресурсов'}
                  </button>
                )}
                <button className="btn" onClick={() => handleOpenFolder(detail)}>
                  <FolderIcon width={15} height={15} /> Folder
                </button>
                <button className="btn" onClick={() => handleSaveAs(detail)}>
                  <DownloadCloudIcon width={15} height={15} /> Save как…
                </button>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {instances.length > 1 && (
                  <>
                    <Select className="plain-select" value={copyTarget} onChange={setCopyTarget} options={instances.filter((i) => i.id !== detail.instanceId).map((i) => ({ value: i.id, label: i.name }))} />
                    <button className="btn" onClick={() => handleCopyTo(detail)}>
                      <CopyIcon width={15} height={15} /> Copy
                    </button>
                  </>
                )}
                <button className="btn btn-danger" onClick={() => handleDelete(detail)}>
                  <TrashIcon width={15} height={15} /> Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
