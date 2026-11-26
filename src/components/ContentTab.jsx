import { useEffect, useMemo, useState } from 'react';
import OptimizeModal from './OptimizeModal.jsx';
import {
  SearchIcon, UploadIcon, DownloadIcon, RefreshIcon, TrashIcon, BoxIcon,
} from './Icons.jsx';

const KIND_LABEL = { mod: 'Mod', shader: 'Шейдерпак', resourcepack: 'Текстурпак' };
const KIND_LABEL_PLURAL = { mod: 'моды', shader: 'шейдерпаки', resourcepack: 'текстурпаки' };

export default function ContentTab({ instance, onFindProjects, onOpenProject, refreshKey }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [filterKind, setFilterKind] = useState('all');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(new Set());
  const [updates, setUpdates] = useState({});
  const [checkingAll, setCheckingAll] = useState(false);
  const [updateSummary, setUpdateSummary] = useState(null);
  const [applyProgress, setApplyProgress] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [dragging, setDragging] = useState(false);
  const [dropError, setDropError] = useState(null);
  const [optimizeOpen, setOptimizeOpen] = useState(false);

  async function load() {
    setError(null);
    const res = await window.api.content.list(instance.id);
    if (res.ok) setItems(res.items);
    else setError(res.error);
  }

  useEffect(() => { setItems(null); setSelected(new Set()); load(); }, [instance.id, refreshKey]);

  function toggleSelected(filename) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(filename)) next.delete(filename); else next.add(filename);
      return next;
    });
  }

  async function bulkAction(action) {
    const targets = filtered.filter((i) => selected.has(i.filename));
    for (const item of targets) {
      if (action === 'delete') {
        // eslint-disable-next-line no-await-in-loop
        await window.api.content.delete(instance.id, item.filename, item.kind);
      } else if (action === 'enable' && !item.enabled) {
        // eslint-disable-next-line no-await-in-loop
        await window.api.content.toggle(instance.id, item.filename, item.kind);
      } else if (action === 'disable' && item.enabled) {
        // eslint-disable-next-line no-await-in-loop
        await window.api.content.toggle(instance.id, item.filename, item.kind);
      }
    }
    setSelected(new Set());
    load();
  }

  function markBusy(filename, on) {
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(filename); else next.delete(filename);
      return next;
    });
  }

  async function toggle(item) {
    markBusy(item.filename, true);
    const res = await window.api.content.toggle(instance.id, item.filename, item.kind);
    markBusy(item.filename, false);
    if (res.ok) load();
  }

  async function remove(item) {
    if (item.kind !== 'mod' && !confirm(`Delete «${item.resolved?.title || item.displayName}»?`)) return;
    markBusy(item.filename, true);
    await window.api.content.delete(instance.id, item.filename, item.kind);
    markBusy(item.filename, false);
    load();
  }

  async function addFiles(kind) {
    const res = await window.api.content.addFiles(instance.id, kind);
    if (res.ok && res.added.length) load();
  }

  function handleDragOver(e) {
    e.preventDefault();
    setDragging(true);
  }

  function handleDragLeave(e) {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setDragging(false);
  }

  async function handleDrop(e) {
    e.preventDefault();
    setDragging(false);
    setDropError(null);
    const filePaths = [...e.dataTransfer.files].map((f) => window.api.files.pathFor(f)).filter(Boolean);
    if (!filePaths.length) return;
    // On a specific tab, everything dropped goes into that bucket; on "Всё"
    // each file's kind is auto-detected (.jar -> mod, .zip peeked for a
    // shaders/ folder vs a plain resource pack).
    const res = await window.api.content.addFilePaths(instance.id, filterKind === 'all' ? null : filterKind, filePaths);
    if (!res.ok) { setDropError(res.error); return; }
    if (res.skipped?.length) setDropError(`Failed определить тип файла: ${res.skipped.join(', ')}`);
    if (res.added.length) load();
  }

  async function checkUpdate(item) {
    markBusy(item.filename, true);
    const res = await window.api.content.checkUpdate(instance.id, item, instance.mcVersion, instance.loader);
    markBusy(item.filename, false);
    if (res.ok) setUpdates((prev) => ({ ...prev, [item.filename]: res.update || false }));
  }

  async function applyUpdateWith(item, update) {
    markBusy(item.filename, true);
    const res = await window.api.content.applyUpdate(instance.id, item, update);
    markBusy(item.filename, false);
    if (res.ok) {
      setUpdates((prev) => { const next = { ...prev }; delete next[item.filename]; return next; });
    }
    return res.ok;
  }

  async function applyUpdate(item) {
    const update = updates[item.filename];
    if (!update) return;
    if (await applyUpdateWith(item, update)) load();
  }

  // Checks every Modrinth project (four at a time), then offers to update
  // all that have a newer version in one go. CurseForge projects can't be
  // checked for updates yet, so they're counted and skipped.
  async function checkAllUpdates() {
    setCheckingAll(true);
    setUpdateSummary(null);
    const checkable = (items || []).filter((i) => i.resolved?.platform === 'modrinth');
    let next = 0;
    async function worker() {
      while (next < checkable.length) {
        const item = checkable[next++];
        // eslint-disable-next-line no-await-in-loop
        await checkUpdate(item);
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, checkable.length) }, worker));
    setUpdateSummary({
      checked: checkable.length,
      skipped: (items || []).filter((i) => i.resolved && i.resolved.platform !== 'modrinth').length,
    });
    setCheckingAll(false);
  }

  async function applyAllUpdates() {
    const todo = (items || [])
      .filter((i) => updates[i.filename])
      .map((i) => ({ item: i, update: updates[i.filename] }));
    if (!todo.length) return;
    setApplyProgress({ done: 0, total: todo.length, failed: 0 });
    let failed = 0;
    for (let idx = 0; idx < todo.length; idx++) {
      // eslint-disable-next-line no-await-in-loop
      const ok = await applyUpdateWith(todo[idx].item, todo[idx].update);
      if (!ok) failed++;
      setApplyProgress({ done: idx + 1, total: todo.length, failed });
    }
    setApplyProgress(null);
    setUpdateSummary((prev) => (prev ? { ...prev, failed } : prev));
    load();
  }

  // After an update check with results, the list narrows to just the
  // projects that can be updated (until the bar is dismissed).
  const availableCount = Object.values(updates).filter(Boolean).length;
  const updatesOnly = (!!updateSummary && availableCount > 0) || !!applyProgress;

  const filtered = useMemo(() => {
    if (!items) return [];
    return items
      .filter((i) => filterKind === 'all' || i.kind === filterKind)
      .filter((i) => !updatesOnly || updates[i.filename])
      .filter((i) => {
        const label = (i.resolved?.title || i.displayName).toLowerCase();
        return label.includes(search.toLowerCase());
      })
      .sort((a, b) => (a.resolved?.title || a.displayName).localeCompare(b.resolved?.title || b.displayName));
  }, [items, filterKind, search, updatesOnly, updates]);

  const counts = useMemo(() => {
    if (!items) return { all: 0, mod: 0, shader: 0, resourcepack: 0 };
    return {
      all: items.length,
      mod: items.filter((i) => i.kind === 'mod').length,
      shader: items.filter((i) => i.kind === 'shader').length,
      resourcepack: items.filter((i) => i.kind === 'resourcepack').length,
    };
  }, [items]);

  const addKind = filterKind === 'all' ? 'mod' : filterKind;

  return (
    <div
      className={`content-dropzone ${dragging ? 'dragging' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {dragging && (
        <div className="content-dropzone-hint">
          <UploadIcon width={28} height={28} />
          <p>Отпустите, чтобы добавить {filterKind === 'all' ? 'файлы' : KIND_LABEL_PLURAL[filterKind]}</p>
        </div>
      )}
      <div className="content-toolbar">
        <div className="search-bar">
          <SearchIcon width={18} height={18} />
          <input placeholder={`Search (${counts.all} проектов)…`} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <button className="btn" onClick={() => addFiles(addKind)}>
          <UploadIcon width={16} height={16} /> Add файлы
        </button>
        <button className="btn" onClick={() => setOptimizeOpen(true)} disabled={instance.loader === 'vanilla'} title={instance.loader === 'vanilla' ? 'Нужен загрузчик модов (Fabric, Quilt, Forge или NeoForge)' : 'Установить моды для FPS в один клик'}>
          Оптимизация
        </button>
        <button className="btn btn-primary" onClick={onFindProjects}>
          <SearchIcon width={16} height={16} /> Найти проекты
        </button>
      </div>

      {dropError && <div className="error-text" style={{ marginBottom: 12 }}>{dropError}</div>}

      <div className="filter-row">
        <div className="pill-tabs" style={{ marginBottom: 0 }}>
          <button className={`pill-tab ${filterKind === 'all' ? 'active' : ''}`} onClick={() => setFilterKind('all')}>Всё</button>
          <button className={`pill-tab ${filterKind === 'mod' ? 'active' : ''}`} onClick={() => setFilterKind('mod')}>Mods</button>
          <button className={`pill-tab ${filterKind === 'shader' ? 'active' : ''}`} onClick={() => setFilterKind('shader')}>Shaders</button>
          <button className={`pill-tab ${filterKind === 'resourcepack' ? 'active' : ''}`} onClick={() => setFilterKind('resourcepack')}>Текстурпаки</button>
        </div>
        <div className="filter-row-right">
          <button className="btn-text" onClick={checkAllUpdates} disabled={checkingAll || !items?.length}>
            <DownloadIcon width={15} height={15} /> {checkingAll ? 'Проверка…' : 'Check обновления'}
          </button>
          <button className="btn-text" onClick={load}>
            <RefreshIcon width={15} height={15} /> Перезагрузить
          </button>
        </div>
      </div>

      {error && <div className="error-text" style={{ marginBottom: 12 }}>{error}</div>}

      {(updateSummary || applyProgress) && (() => {
        const available = availableCount;
        return (
          <div className="update-bar">
            {applyProgress ? (
              <span>Обновление {applyProgress.done} из {applyProgress.total}…</span>
            ) : available > 0 ? (
              <>
                <span>Доступно обновлений: <strong>{available}</strong></span>
                <button className="btn btn-primary" onClick={applyAllUpdates}>
                  <DownloadIcon width={15} height={15} /> Refresh все ({available})
                </button>
                <button className="btn" onClick={() => setUpdateSummary(null)}>Cancel</button>
              </>
            ) : (
              <span>
                {updateSummary.failed ? `Failed обновить: ${updateSummary.failed}. ` : ''}
                {updateSummary.checked ? `Всё актуально (проверено проектов: ${updateSummary.checked}).` : 'Нечего проверять — обновления ищутся для проектов с Modrinth.'}
              </span>
            )}
            {!applyProgress && updateSummary?.skipped > 0 && (
              <span className="update-bar-note">CurseForge-проекты пропущены: {updateSummary.skipped}</span>
            )}
            {!applyProgress && (
              <button className="icon-btn" title="Hide" onClick={() => setUpdateSummary(null)}>✕</button>
            )}
          </div>
        );
      })()}
      {items === null ? (
        <div className="progress-label">Сканирование папки сборки…</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <p>Ничего не найдено. Добавьте файлы или найдите проекты на Modrinth/CurseForge.</p>
        </div>
      ) : (
        <div className="content-table">
          <div className="content-table-head">
            <input
              type="checkbox"
              className="content-row-check"
              checked={selected.size > 0 && filtered.every((i) => selected.has(i.filename))}
              onChange={(e) => setSelected(e.target.checked ? new Set(filtered.map((i) => i.filename)) : new Set())}
            />
            {selected.size > 0 ? (
              <div style={{ gridColumn: '2 / span 2', display: 'flex', gap: 14, alignItems: 'center' }}>
                <span className="progress-label">Выбрано: {selected.size}</span>
                <button className="btn-text" onClick={() => bulkAction('enable')}>Enable</button>
                <button className="btn-text" onClick={() => bulkAction('disable')}>Отключить</button>
                <button className="btn-text" style={{ color: 'var(--danger)' }} onClick={() => bulkAction('delete')}>Delete</button>
              </div>
            ) : (
              <>
                <span>Project</span>
                <span className="content-row-version">Version</span>
              </>
            )}
            <span style={{ textAlign: 'right' }}>{selected.size === 0 && 'Действия'}</span>
          </div>
          {filtered.map((item) => {
            const update = updates[item.filename];
            const isBusy = busy.has(item.filename);
            return (
              <div className={`content-row ${item.enabled ? '' : 'disabled-row'}`} key={item.filename}>
                <input
                  type="checkbox"
                  className="content-row-check"
                  checked={selected.has(item.filename)}
                  onChange={() => toggleSelected(item.filename)}
                />
                <div
                  className={`content-row-project ${item.resolved?.projectId && onOpenProject ? 'clickable' : ''}`}
                  onClick={() => item.resolved?.projectId && onOpenProject?.(item.resolved.platform, String(item.resolved.projectId), item.kind)}
                  title={item.resolved?.projectId && onOpenProject ? 'Open страницу проекта' : undefined}
                >
                  {item.resolved?.icon ? (
                    <img className="content-row-icon" src={item.resolved.icon} alt="" />
                  ) : (
                    <div className="content-row-icon placeholder"><BoxIcon width={20} height={20} /></div>
                  )}
                  <div className="content-row-title-wrap">
                    <div className="content-row-title">{item.resolved?.title || item.displayName}</div>
                    <div className="content-row-sub">
                      {item.resolved ? (
                        <>
                          <span className={`platform-chip ${item.resolved.platform}`}>{item.resolved.platform === 'modrinth' ? 'MR' : 'CF'}</span>
                          {item.resolved.author && <span className="content-row-author">{item.resolved.author}</span>}
                        </>
                      ) : (
                        KIND_LABEL[item.kind]
                      )}
                    </div>
                  </div>
                </div>
                <div className="content-row-version">
                  <div className="content-row-version-num">{item.resolved?.versionNumber || '—'}</div>
                  <div className="content-row-filename">{item.filename}</div>
                </div>
                <div className="content-row-actions">
                  {update ? (
                    <button className="icon-btn accent" title={`Refresh до ${update.versionNumber}`} onClick={() => applyUpdate(item)} disabled={isBusy}>
                      <DownloadIcon width={17} height={17} />
                    </button>
                  ) : item.resolved?.platform === 'modrinth' ? (
                    <button className={`icon-btn ${isBusy ? 'spin' : ''}`} title="Check обновление" onClick={() => checkUpdate(item)} disabled={isBusy}>
                      <RefreshIcon width={17} height={17} />
                    </button>
                  ) : null}
                  <input
                    type="checkbox"
                    className="switch"
                    checked={item.enabled}
                    disabled={isBusy}
                    onChange={() => toggle(item)}
                    title={item.enabled ? 'Отключить' : 'Enable'}
                  />
                  <button className="icon-btn danger" title="Delete" onClick={() => remove(item)} disabled={isBusy}>
                    <TrashIcon width={17} height={17} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {optimizeOpen && (
        <OptimizeModal
          instance={instance}
          onClose={() => setOptimizeOpen(false)}
          onInstalled={load}
        />
      )}
    </div>
  );
}
