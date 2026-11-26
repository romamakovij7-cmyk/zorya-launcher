// The "Mods" tab of a Horizon (Rust) instance: Horizon's own content mods (.hmod), native mods (.hnmod),
// shader packs and resource packs in the game folder, the Horizon mod catalog, and drag-and-drop install.
// Java mods (Fabric/Forge/.jar) don't run on Horizon, so the usual Modrinth/CurseForge content tab isn't shown for it.
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  SearchIcon, UploadIcon, DownloadIcon, RefreshIcon, TrashIcon, BoxIcon,
} from './Icons.jsx';

const KIND_LABEL = {
  mod: 'Mod', native: 'Нативный мод', shader: 'Шейдер', resourcepack: 'Resource pack',
};
const GROUPS = [
  ['mod', 'Mods'],
  ['native', 'Нативные моды'],
  ['shader', 'Shaders'],
  ['resourcepack', 'Ресурспаки'],
];

// A project's picture from the registry, or the plain box when there is none (or it fails to load).
function ModIcon({ src }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <div className="content-row-icon placeholder"><BoxIcon width={20} height={20} /></div>;
  return <img className="content-row-icon" src={src} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} />;
}

const NATIVE_TEXT = {
  none: 'Нативные моды выключены: игра запускается обычной сборкой Horizon.',
  notBuilt: 'Нативные моды включены, но игра собрана без них. Соберите игру вместе с ними.',
  outdated: 'Набор включённых модов изменился с последней сборки: нужна пересборка.',
  upToDate: 'Актуально: Horizon играет с этими модами.',
};

// "Нативная компиляция": builds the game together with the turned-on native mods, with Horizon Launcher's compiler.
function NativeCard({ instance, reloadKey }) {
  const [info, setInfo] = useState(null); // { status, profiles }
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState('');
  const [result, setResult] = useState(null); // the last build's outcome
  const [profile, setProfile] = useState('performance');
  const [showLog, setShowLog] = useState(false);
  // GitHub token for the compiler (the window can set/remove it, never read it back)
  const [tokenOpen, setTokenOpen] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [tokenMsg, setTokenMsg] = useState(null); // { ok, text }

  async function saveToken() {
    const r = await window.api.horizonNative.setGithubToken(tokenInput);
    if (r.ok) { setTokenInput(''); setTokenMsg({ ok: true, text: 'Токен сохранён. Теперь запустите сборку снова.' }); load(); } else setTokenMsg({ ok: false, text: r.error });
  }
  async function removeToken() {
    const r = await window.api.horizonNative.clearGithubToken();
    if (r.ok) { setTokenMsg({ ok: true, text: 'Токен удалён.' }); load(); } else setTokenMsg({ ok: false, text: r.error });
  }

  const load = useCallback(async () => {
    const r = await window.api.horizonNative.status(instance.id);
    if (r.ok) { setInfo(r); setBusy(r.building); setProfile((p) => (r.profiles[p] ? p : r.status.profile)); }
  }, [instance.id]);
  useEffect(() => { load(); }, [load, reloadKey]);
  useEffect(() => {
    const offProgress = window.api.horizonNative.onProgress((p) => { if (p.instanceId === instance.id) setStep(p.step); });
    const offDone = window.api.horizonNative.onDone((d) => {
      if (d.instanceId !== instance.id) return;
      setBusy(false); setStep(''); setResult(d); load();
    });
    return () => { offProgress?.(); offDone?.(); };
  }, [instance.id, load]);

  async function start(allowMismatch) {
    // The consent about native code is asked by the main process (a native dialog), not here.
    setResult(null); setShowLog(false); setBusy(true); setStep('Подготовка…');
    const r = await window.api.horizonNative.build(instance.id, profile, !!allowMismatch);
    if (!r.ok) {
      setBusy(false); setStep('');
      if (r.error !== 'Instance отменена') setResult({ ok: false, error: r.error });
    }
  }

  if (!info) return null;
  const { status, profiles } = info;
  const canBuild = status.launcherFound && status.enabled.length > 0 && !busy;
  return (
    <div className="update-bar" style={{ display: 'block', marginBottom: 18 }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>Нативная компиляция: Horizon</div>
      <div className="progress-label" style={{ marginBottom: 8 }}>
        {NATIVE_TEXT[status.state]}
        {status.state === 'upToDate' && status.mods.length > 0 && ` (${status.mods.map((m) => `${m.id} ${m.version}`).join(', ')})`}
      </div>
      {status.leftOut.length > 0 && <div className="error-text" style={{ marginBottom: 8 }}>При сборке пропущены: {status.leftOut.join(', ')}</div>}
      {!status.launcherFound && (
        <div className="error-text" style={{ marginBottom: 8 }}>
          Для сборки нужен Horizon Launcher: Zorya использует его компилятор Rust (сам по себе он весит гигабайты).{' '}
          <button className="btn-text" onClick={() => window.api.shell.openExternal('https://playhorizon.dev')}>Download Horizon Launcher</button>
        </div>
      )}
      <div className="pill-tabs" style={{ marginBottom: 8 }}>
        {Object.entries(profiles).map(([id, p]) => (
          <button key={id} className={`pill-tab ${profile === id ? 'active' : ''}`} disabled={busy} onClick={() => { setProfile(id); window.api.horizonNative.setProfile(id); }} title={p.hint}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="progress-label" style={{ marginBottom: 10 }}>{profiles[profile]?.hint}</div>
      <button className="btn btn-primary" disabled={!canBuild} onClick={() => start(false)}>
        {busy ? 'Собираю…' : status.state === 'upToDate' ? 'Пересобрать' : 'Собрать'}
      </button>
      {busy && <div className="progress-label" style={{ marginTop: 10 }}>{step || 'Идёт сборка…'} (можно закрыть вкладку, сборка продолжится)</div>}
      <div style={{ marginTop: 12 }}>
        <button className="btn-text" onClick={() => setTokenOpen((v) => !v)}>
          {info.githubToken ? 'GitHub-токен: задан' : 'GitHub-токен (если сборка пишет про «rate limit»)'} {tokenOpen ? '▴' : '▾'}
        </button>
        {tokenOpen && (
          <div style={{ marginTop: 8 }}>
            <div className="progress-label" style={{ marginBottom: 8 }}>
              GitHub пускает без токена только 60 запросов в час с одного адреса, и сборка может упасть. Создайте токен на{' '}
              <button className="btn-text" style={{ display: 'inline', padding: 0 }} onClick={() => window.api.shell.openExternal('https://github.com/settings/tokens/new')}>github.com/settings/tokens</button>
              {' '}(классический, все галочки оставьте пустыми: права не нужны) и вставьте сюда. Он хранится зашифрованным средствами Windows и отдаётся только компилятору Horizon.
            </div>
            {info.githubToken ? (
              <button className="btn" onClick={removeToken}>Delete токен</button>
            ) : (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="password" autoComplete="off" spellCheck={false} placeholder="ghp_…" maxLength={255}
                  value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} style={{ maxWidth: 320 }}
                />
                <button className="btn btn-primary" disabled={!tokenInput.trim()} onClick={saveToken}>Save</button>
              </div>
            )}
            {tokenMsg && <div className={tokenMsg.ok ? 'progress-label' : 'error-text'} style={{ marginTop: 8 }}>{tokenMsg.text}</div>}
          </div>
        )}
      </div>
      {result && result.ok && <div style={{ color: 'var(--success)', fontSize: 13, marginTop: 10 }}>Done: нативные моды собраны в игру.</div>}
      {result && !result.ok && /rate limit/i.test(`${result.error || ''} ${result.log || ''}`) && !info.githubToken && (
        <div className="error-text" style={{ marginTop: 10 }}>
          GitHub ограничил запросы с вашего адреса (60 в час). Добавьте свой токен GitHub ниже, и сборка пройдёт.
        </div>
      )}
      {result && !result.ok && (
        <div style={{ marginTop: 10 }}>
          <div className="error-text" style={{ whiteSpace: 'pre-line' }}>{result.mismatch || result.error}</div>
          {result.mismatch && <button className="btn" style={{ marginTop: 8 }} onClick={() => start(true)}>Собрать всё равно</button>}
          {result.log && (
            <>
              <button className="btn-text" style={{ marginTop: 8 }} onClick={() => setShowLog((v) => !v)}>{showLog ? 'Hide журнал сборки' : 'Show журнал сборки'}</button>
              {showLog && <pre className="progress-label" style={{ whiteSpace: 'pre-wrap', maxHeight: 220, overflow: 'auto', userSelect: 'text' }}>{result.log}</pre>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Catalog({ instance, installed, onInstalled, onMessage }) {
  const [projects, setProjects] = useState(null);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('all');
  const [busy, setBusy] = useState(null);

  async function load(force) {
    setError(null);
    if (force) setProjects(null);
    const res = await window.api.horizonMods.catalog(instance.id, !!force);
    if (res.ok) setProjects(res.projects); else setError(res.error);
  }
  useEffect(() => { load(false); }, [instance.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (projects || [])
      .filter((p) => (kind === 'all' || p.kind === kind)
        && (!q || p.name.toLowerCase().includes(q) || p.summary.toLowerCase().includes(q) || p.authors.some((a) => a.toLowerCase().includes(q))))
      .sort((a, b) => (b.downloads || 0) - (a.downloads || 0) || a.name.localeCompare(b.name));
  }, [projects, search, kind]);

  async function install(p) {
    setBusy(p.id);
    const res = await window.api.horizonMods.installProject(instance.id, p.id);
    setBusy(null);
    if (res.ok) { onMessage({ ok: true, text: res.message }); onInstalled(); } else onMessage({ ok: false, text: res.error });
  }

  return (
    <div className="horizon-catalog">
      <div className="content-toolbar">
        <div className="search-bar">
          <SearchIcon width={18} height={18} />
          <input placeholder="Search в каталоге Horizon…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <button className="btn" onClick={() => load(true)}><RefreshIcon width={16} height={16} /> Refresh</button>
      </div>
      <div className="pill-tabs" style={{ marginBottom: 12 }}>
        {[['all', 'Всё'], ['mod', 'Mods'], ['native', 'Нативные'], ['shader', 'Shaders'], ['resourcepack', 'Ресурспаки']].map(([id, label]) => (
          <button key={id} className={`pill-tab ${kind === id ? 'active' : ''}`} onClick={() => setKind(id)}>{label}</button>
        ))}
      </div>
      {error && <div className="error-text" style={{ marginBottom: 12 }}>{error}</div>}
      {projects === null && !error && <div className="progress-label">Загружаю каталог…</div>}
      {projects && shown.length === 0 && <div className="empty-state"><p>Ничего не найдено.</p></div>}
      {shown.length > 0 && (
        <div className="content-table">
          {shown.map((p) => {
            const have = (p.kind === 'mod' || p.kind === 'native') && installed.has(`${p.kind}:${p.id}`);
            return (
              <div className="content-row" key={`${p.kind}:${p.id}`} style={{ gridTemplateColumns: 'minmax(0, 1fr) auto' }}>
                <div className="content-row-project">
                  <ModIcon src={p.icon} />
                  <div className="content-row-title-wrap">
                    <div className="content-row-title">{p.name}</div>
                    <div className="content-row-sub">
                      {KIND_LABEL[p.kind]}{p.authors.length ? ` · ${p.authors.join(', ')}` : ''}{p.version ? ` · ${p.version}` : ''}
                      {p.downloads != null ? ` · ${p.downloads} загрузок` : ''}
                    </div>
                    {p.summary && <div className="content-row-filename">{p.summary}</div>}
                  </div>
                </div>
                <div className="content-row-actions">
                  {have ? <span className="progress-label">Установлен</span> : (
                    <button className="btn btn-primary" disabled={busy !== null || !p.compatible} onClick={() => install(p)}
                      title={p.compatible ? undefined : `No версии для Minecraft ${instance.mcVersion}`}>
                      <DownloadIcon width={15} height={15} /> {busy === p.id ? 'Установка…' : 'Установить'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function HorizonModsTab({ instance }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null); // { ok, text }
  const [busy, setBusy] = useState(new Set());
  const [dragging, setDragging] = useState(false);
  const [showCatalog, setShowCatalog] = useState(false);
  const [filter, setFilter] = useState('');

  async function load() {
    const res = await window.api.horizonMods.list(instance.id);
    if (res.ok) { setItems(res.items); setError(null); } else setError(res.error);
  }
  useEffect(() => { setItems(null); load(); }, [instance.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pictures of what is installed come from the catalog (the files themselves carry none), looked up in the background.
  const [pictures, setPictures] = useState([]);
  useEffect(() => {
    let alive = true;
    window.api.horizonMods.catalog(instance.id).then((res) => { if (alive && res.ok) setPictures(res.projects.filter((p) => p.icon)); }).catch(() => {});
    return () => { alive = false; };
  }, [instance.id]);
  const iconFor = (item) => {
    if (item.kind === 'mod' || item.kind === 'native') return pictures.find((p) => p.kind === item.kind && p.id === item.id)?.icon || null;
    // shaders / resource packs: the file is named after the project ("abelha_skull-1.0.0.zip")
    const file = item.file.toLowerCase();
    return pictures.find((p) => p.kind === item.kind && file.startsWith(p.id.toLowerCase()))?.icon || null;
  };

  const key = (i) => `${i.kind}:${i.file}`;
  const mark = (k, on) => setBusy((prev) => { const n = new Set(prev); if (on) n.add(k); else n.delete(k); return n; });
  const installed = useMemo(() => new Set((items || []).filter((i) => i.kind === 'mod' || i.kind === 'native').map((i) => `${i.kind}:${i.id}`)), [items]);

  async function toggle(item) {
    mark(key(item), true);
    const res = await window.api.horizonMods.setEnabled(instance.id, item.kind, item.file, !item.enabled);
    mark(key(item), false);
    if (!res.ok) setMessage({ ok: false, text: res.error });
    load();
  }

  async function remove(item) {
    if (!window.confirm(`Delete «${item.name}»?`)) return;
    mark(key(item), true);
    const res = await window.api.horizonMods.remove(instance.id, item.kind, item.file);
    mark(key(item), false);
    if (!res.ok) setMessage({ ok: false, text: res.error });
    load();
  }

  function report(res) {
    if (!res.ok) { setMessage({ ok: false, text: res.error }); return; }
    const lines = [...res.added, ...res.errors];
    if (lines.length) setMessage({ ok: res.errors.length === 0, text: lines.join('\n') });
    load();
  }

  async function pickFiles() { report(await window.api.horizonMods.pickFiles(instance.id)); }

  async function handleDrop(e) {
    e.preventDefault();
    setDragging(false);
    const filePaths = [...e.dataTransfer.files].map((f) => window.api.files.pathFor(f)).filter(Boolean);
    if (filePaths.length) report(await window.api.horizonMods.installPaths(instance.id, filePaths));
  }

  const q = filter.trim().toLowerCase();
  const visible = (items || []).filter((i) => !q || i.name.toLowerCase().includes(q) || i.id.toLowerCase().includes(q));

  return (
    <div
      className={`content-dropzone ${dragging ? 'dragging' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false); }}
      onDrop={handleDrop}
    >
      {dragging && (
        <div className="content-dropzone-hint">
          <UploadIcon width={28} height={28} />
          <p>Отпустите, чтобы добавить моды, шейдеры или ресурспаки Horizon</p>
        </div>
      )}
      <div className="content-toolbar">
        <div className="search-bar">
          <SearchIcon width={18} height={18} />
          <input placeholder={`Фильтр установленных (${items ? items.length : 0})…`} value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <button className="btn" onClick={pickFiles}><UploadIcon width={16} height={16} /> Add файлы</button>
        <button className={`btn ${showCatalog ? '' : 'btn-primary'}`} onClick={() => setShowCatalog((v) => !v)}>
          <SearchIcon width={16} height={16} /> {showCatalog ? 'К установленным' : 'Найти моды'}
        </button>
      </div>

      {message && (
        <div className={message.ok ? 'update-bar' : 'error-text'} style={{ marginBottom: 12, whiteSpace: 'pre-line' }}>
          <span>{message.text}</span>
          <button className="icon-btn" title="Hide" onClick={() => setMessage(null)}>✕</button>
        </div>
      )}
      {error && <div className="error-text" style={{ marginBottom: 12 }}>{error}</div>}

      {showCatalog ? (
        <Catalog instance={instance} installed={installed} onInstalled={load} onMessage={setMessage} />
      ) : items === null ? (
        <div className="progress-label">Сканирование папки сборки…</div>
      ) : (
        <>
          {items.length === 0 && (
            <div className="empty-state">
              <p>mods Horizon пока нет. Найдите их в каталоге, добавьте файлом (.hmod, .hnmod, шейдер, ресурспак) или перетащите файл сюда.</p>
              <p className="progress-label">Java-моды (Fabric, Forge, .jar) в Horizon не работают: игра написана на Rust.</p>
            </div>
          )}
          {items.some((i) => i.kind === 'native') && <NativeCard instance={instance} reloadKey={items} />}
          {GROUPS.map(([kind, title]) => {
            const rows = visible.filter((i) => i.kind === kind);
            if (!rows.length) return null;
            return (
              <div key={kind} style={{ marginBottom: 22 }}>
                <label className="settings-block-label">{title} · {rows.length}</label>
                {kind === 'native' && (
                  <p className="settings-block-hint" style={{ marginTop: 4 }}>
                    Нативный мод работает только в игре, собранной вместе с ним: включите нужные и нажмите «Собрать» в карточке выше.
                  </p>
                )}
                <div className="content-table">
                  {rows.map((item) => (
                    <div className={`content-row hz-row ${item.enabled || kind === 'resourcepack' ? '' : 'disabled-row'}`} key={key(item)}>
                      <div className="content-row-project">
                        <ModIcon src={iconFor(item)} />
                        <div className="content-row-title-wrap">
                          <div className="content-row-title">{item.name}</div>
                          <div className="content-row-sub">{KIND_LABEL[item.kind]}{kind === 'mod' || kind === 'native' ? ` · ${item.id}` : ''}</div>
                        </div>
                      </div>
                      <div className="content-row-version">
                        <div className="content-row-version-num">{item.version || '—'}</div>
                        <div className="content-row-filename">{item.file}</div>
                      </div>
                      <div className="content-row-actions">
                        {kind !== 'resourcepack' && (
                          <input
                            type="checkbox"
                            className="switch"
                            checked={item.enabled}
                            disabled={busy.has(key(item))}
                            onChange={() => toggle(item)}
                            title={kind === 'shader' ? (item.enabled ? 'Снять выбор шейдера' : 'Выбрать этот шейдер') : (item.enabled ? 'Отключить' : 'Enable')}
                          />
                        )}
                        <button className="icon-btn danger" title="Delete" onClick={() => remove(item)} disabled={busy.has(key(item))}>
                          <TrashIcon width={17} height={17} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
