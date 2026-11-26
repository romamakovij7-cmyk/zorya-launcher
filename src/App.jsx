import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import TitleBar from './components/TitleBar.jsx';
import Sidebar from './components/Sidebar.jsx';
import Home from './pages/Home.jsx';
import Library from './pages/Library.jsx';
import Instance from './pages/Instance.jsx';
import HomePlay from './pages/HomePlay.jsx';
import { setBackgroundSaver, setFrameCap } from './utils/backgroundSaver.js';
import HomeLayoutChoice from './components/HomeLayoutChoice.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import LoadingScreen from './components/LoadingScreen.jsx';
import { applyAppearance, uiZoomFactor } from './utils/theme.js';
import { matchesBinding, DEFAULT_KEYBINDINGS } from './utils/keybind.js';
import CommandPalette from './components/CommandPalette.jsx';
import { usePresence } from './utils/usePresence.js';
import { useUpdater } from './utils/useUpdater.js';
import UpdateBanner from './components/UpdateBanner.jsx';
import { applyLanguage } from './i18n.js';

// Pages that are not needed at the moment the window opens are loaded when first visited (smaller first load, less memory at start).
// Home, Library and Instance stay in the main bundle: they are what most people see right away.
// A piece that cannot be read right now (the file is being replaced, a disk or antivirus hiccup) is asked for again a few times; when
// it still fails, the window reloads itself once instead of staying on "Что-то пошло не так" (a failed lazy page is never retried by React).
function lazyPage(load) {
  return lazy(async () => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await load();
      } catch (err) {
        if (attempt < 2) { await new Promise((r) => setTimeout(r, 400 * (attempt + 1))); continue; }
        let recent = false;
        try { recent = Date.now() - Number(sessionStorage.getItem('zorya.chunkReload') || 0) < 30000; } catch { /* no storage */ }
        if (!recent) {
          try { sessionStorage.setItem('zorya.chunkReload', String(Date.now())); } catch { /* no storage */ }
          window.location.reload();
          return new Promise(() => {}); // the window is reloading
        }
        throw err;
      }
    }
  });
}
const Search = lazyPage(() => import('./pages/Search.jsx'));
const Settings = lazyPage(() => import('./pages/Settings.jsx'));
const Skins = lazyPage(() => import('./pages/Skins.jsx'));
const Screenshots = lazyPage(() => import('./pages/Screenshots.jsx'));
const Schematics = lazyPage(() => import('./pages/Schematics.jsx'));
const Stats = lazyPage(() => import('./pages/Stats.jsx'));
const ProjectPage = lazyPage(() => import('./components/ProjectPage.jsx'));

// An install call that throws (instead of answering { ok: false }) would leave its card
// "downloading" forever and the same pack impossible to start again — turn it into an error result.
async function runInstallCall(fn) {
  try {
    return await fn();
  } catch (err) {
    return { ok: false, error: String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') };
  }
}

const PAGE_TITLES = {
  home: 'Home', search: 'Search', library: 'Library', settings: 'Settings', skins: 'Skins', screenshots: 'Screenshots', project: 'Project', schematics: 'Schematics', stats: 'Stats',
};

export default function App() {
  const [history, setHistory] = useState([{ page: 'home', params: {} }]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [instances, setInstances] = useState([]);
  const [account, setAccount] = useState(null);
  const [runningIds, setRunningIds] = useState(new Set());
  const [preparingIds, setPreparingIds] = useState(new Set());
  const [crashedIds, setCrashedIds] = useState(new Set());
  const [launchProgress, setLaunchProgress] = useState({}); // instanceId -> latest launch:progress
  const installStarted = useRef(new Set()); // keys of installs already kicked off (guards against a double click)
  const importQueue = useRef(Promise.resolve()); // launcher imports run one after another
  const cancelledQueued = useRef(new Set()); // ids of queued imports cancelled before they started
  const [installs, setInstalls] = useState([]); // modpack downloads running in the background (survive leaving the project page)
  const scrollByIndex = useRef({}); // main-content scroll position per history entry
  const [searchVisited, setSearchVisited] = useState(false); // keep the Search page alive (hidden) while a project is open
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settings, setSettings] = useState(null);
  const [dataReady, setDataReady] = useState(false);
  const [minTimeElapsed, setMinTimeElapsed] = useState(false);
  const [finderOpen, setFinderOpen] = useState(false); // the in-instance mod finder

  const updater = useUpdater();
  useEffect(() => { updater.check(); }, []);
  useEffect(() => { if (settings) applyLanguage(settings.language || 'en'); }, [settings]);
  const current = history[historyIndex];
  usePresence({ page: current.page, projectOpen: current.page === 'project', finderOpen: finderOpen && current.page === 'instance' });

  useEffect(() => {
    Promise.all([
      window.api.instances.list().then(setInstances),
      window.api.auth.getAccount().then(setAccount),
      window.api.settings.get().then(setSettings),
    ]).catch(() => { /* a failed read must not leave the splash screen up forever */ }).then(() => setDataReady(true));
    // Local IPC calls resolve almost instantly, which would make the splash
    // just flicker — hold it up for a short minimum so the entrance actually
    // reads as a deliberate loading screen rather than a flash of nothing.
    const timer = setTimeout(() => setMinTimeElapsed(true), 1100);
    return () => clearTimeout(timer);
  }, []);

  // Launch state lives here (not in the instance page) so library cards
  // stay accurate no matter which page a game was started or closed from.
  useEffect(() => {
    const setIn = (setter, id, on) => setter((prev) => {
      if (prev.has(id) === on) return prev;
      const next = new Set(prev);
      if (on) next.add(id); else next.delete(id);
      return next;
    });
    // Playtime and "last played" are written by the main process when a
    // session ends (and at launch), so pull the fresh list to keep cards,
    // the instance page and the statistics in sync.
    const refreshInstances = () => window.api.instances.list().then(setInstances);
    const clearProgress = (id) => setLaunchProgress((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    const offProgress = window.api.instances.onProgress((p) => {
      if (p.stage === 'running') {
        setIn(setPreparingIds, p.instanceId, false);
        setIn(setRunningIds, p.instanceId, true);
        clearProgress(p.instanceId);
        refreshInstances();
      } else if (p.stage === 'error') {
        setIn(setPreparingIds, p.instanceId, false);
        clearProgress(p.instanceId);
      } else {
        setIn(setPreparingIds, p.instanceId, true);
        setIn(setCrashedIds, p.instanceId, false);
        setLaunchProgress((prev) => ({ ...prev, [p.instanceId]: p }));
      }
    });
    const offExit = window.api.instances.onExit((p) => {
      setIn(setPreparingIds, p.instanceId, false);
      setIn(setRunningIds, p.instanceId, false);
      clearProgress(p.instanceId);
      refreshInstances();
    });
    const offCrash = window.api.instances.onCrash((p) => setIn(setCrashedIds, p.instanceId, true));
    // Games that kept running while the launcher was closed are picked up by the main process at startup
    window.api.instances.runningIds?.().then((ids) => {
      if (Array.isArray(ids) && ids.length) setRunningIds((prev) => new Set([...prev, ...ids]));
    }).catch(() => {});
    return () => { offProgress(); offExit(); offCrash(); };
  }, []);

  // Quick-launch from the Windows taskbar jump list: either the launcher was
  // already running (event) or was just started by it (pending id, picked up
  // once the instance list has loaded).
  const playRef = useRef(null);
  useEffect(() => {
    const off = window.api.app.onLaunchRequest(({ instanceId }) => playRef.current?.(instanceId));
    return off;
  }, []);
  useEffect(() => {
    if (!dataReady) return;
    window.api.app.takePendingLaunch().then((id) => { if (id) playRef.current?.(id); });
  }, [dataReady]);

  async function playInstance(id) {
    const res = await runInstallCall(() => window.api.instances.zoryaLaunch(id));
    if (!res.ok) {
      console.error('[Zorya] launch failed:', res.error);
      setPreparingIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
      return;
    }
    setRunningIds((prev) => new Set(prev).add(id));
  }

  playRef.current = playInstance;

  function stopInstance(id) {
    window.api.instances.stop(id);
  }

  const tileProps = {
    settings,
    runningIds,
    preparingIds,
    crashedIds,
    launchProgress,
    installs,
    onDismissInstall: dismissInstall,
    onControlInstall: controlInstall,
    onPlayInstance: playInstance,
    onStopInstance: stopInstance,
    onImportPackFile: startPackFileImport,
    onImportInstance: startLauncherImport,
    onOpenRecap: () => {},
  };

  // The sidebar entry disappears the moment this is turned off — bounce
  // away from the page itself too, in case it was open when that happened.
  useEffect(() => {
    if (settings && !settings.showBuilderTools && current.page === 'schematics') {
      navigate('home');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.showBuilderTools]);

  const showSearchPage = settings?.showSearchPage !== false;
  useEffect(() => {
    if (settings && settings.showSearchPage === false && current.page === 'search') navigate('home');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.showSearchPage]);

  const showStatsTab = settings?.showStatsTab !== false;
  useEffect(() => {
    if (settings && settings.showStatsTab === false && current.page === 'stats') navigate('home');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.showStatsTab]);

  useEffect(() => {
    document.documentElement.dataset.reduceMotion = settings?.reduceMotion ? 'true' : 'false';
  }, [settings?.reduceMotion]);

  // Лаунчер не на переднем плане: анимации, 3D и стекло стоят (Settings → «Save resources in background»)
  useEffect(() => { setBackgroundSaver(settings?.pauseInBackground !== false); }, [settings?.pauseInBackground]);
  useEffect(() => { setFrameCap(settings?.animationFps || 0); }, [settings?.animationFps]);

  // Eternych the worm instead of progress bars. Also remembered locally, so the
  // loading screen (which shows before settings arrive) already knows (see main.jsx).
  useEffect(() => {
    if (!settings) return;
    const on = !!settings.wormProgress;
    document.documentElement.dataset.worm = on ? 'true' : 'false';
    try { localStorage.setItem('zorya.worm', on ? '1' : '0'); } catch { /* storage unavailable — only the loading screen misses out */ }
  }, [settings?.wormProgress, !!settings]);

  // Appearance: theme, accent, glass, background picture, density, interface size (Settings → Interface → Appearance).
  const [bgUrl, setBgUrl] = useState(null);
  useEffect(() => {
    let alive = true;
    let url = null;
    if (!settings?.bgFile) { setBgUrl(null); return undefined; }
    window.api.appearance.getBackground().then((res) => {
      if (!alive || !res?.ok) { if (alive) setBgUrl(null); return; }
      url = URL.createObjectURL(new Blob([res.data], { type: res.mime }));
      setBgUrl(url);
    }).catch(() => {});
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [settings?.bgFile]);
  useEffect(() => {
    if (!settings) return;
    applyAppearance(settings, bgUrl);
  }, [settings?.theme, settings?.accentColor, settings?.accentCustom, settings?.glassOpacity, settings?.glassBlur,
    settings?.bgDim, settings?.bgBlur, settings?.density, bgUrl, !!settings]);
  useEffect(() => {
    if (settings) window.api.appearance.setZoom(uiZoomFactor(settings));
  }, [settings?.uiScale, !!settings]);

  // Command palette — default Ctrl+F, rebindable in Settings → Горячие клавиши.
  useEffect(() => {
    const binding = settings?.keybindings?.commandPalette || DEFAULT_KEYBINDINGS.commandPalette;
    function onKeyDown(e) {
      if (!matchesBinding(e, binding)) return;
      // The file/screenshot editors have their own Ctrl+F (find in file) — leave it to them.
      if (document.querySelector('.shot-editor-overlay')) return;
      e.preventDefault();
      setPaletteOpen((v) => !v);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [settings?.keybindings]);

  // Visual style: "classic" (the default look) or "liquid" (iOS-style glass).
  useEffect(() => {
    document.documentElement.dataset.style = settings?.interfaceStyle === 'liquid' ? 'liquid' : 'classic';
  }, [settings?.interfaceStyle]);

  function saveScroll() {
    const el = document.querySelector('.main-content');
    if (el) scrollByIndex.current[historyIndex] = el.scrollTop;
  }

  // Each history entry remembers how far it was scrolled (new ones start at the top).
  useLayoutEffect(() => {
    const el = document.querySelector('.main-content');
    if (el) el.scrollTop = scrollByIndex.current[historyIndex] || 0;
  }, [historyIndex]);

  useEffect(() => { if (current.page === 'search') setSearchVisited(true); }, [current.page]);

  function navigate(page, params = {}) {
    saveScroll();
    const next = history.slice(0, historyIndex + 1);
    next.push({ page, params });
    setHistory(next);
    setHistoryIndex(next.length - 1);
  }

  // Окна поверх приложения (например «Твой Premium») просят перейти на страницу событием, а не получают navigate в пропсах.
  const navRef = useRef(null);
  navRef.current = navigate;
  useEffect(() => {
    const onNav = (e) => { const d = e.detail || {}; if (typeof d.page === 'string') navRef.current(d.page, d.params || {}); };
    window.addEventListener('zorya:navigate', onNav);
    return () => window.removeEventListener('zorya:navigate', onNav);
  }, []);

  function goBack() {
    if (historyIndex > 0) { saveScroll(); setHistoryIndex(historyIndex - 1); }
  }
  function goForward() {
    if (historyIndex < history.length - 1) { saveScroll(); setHistoryIndex(historyIndex + 1); }
  }

  // ---- background modpack installs -------------------------------------------
  // The download itself runs in the main process; here we only track it, so it
  // keeps showing (library card, title bar) and finishes into the library no
  // matter which page the user is on.
  useEffect(() => {
    const onProgress = (p) => {
      if (!p?.installId) return;
      // A new stage starts its counters from zero — "files 3/120" must not
      // inherit the byte totals of the stage before it.
      setInstalls((prev) => prev.map((i) => (i.id === p.installId
        ? {
          ...i,
          stage: p.stage,
          completed: p.completed ?? (i.stage === p.stage ? i.completed : 0),
          total: p.total ?? (i.stage === p.stage ? i.total : 0),
        }
        : i)));
    };
    const offs = [
      window.api.modrinth.onInstallProgress(onProgress),
      window.api.curseforge.onInstallProgress(onProgress),
      window.api.technic.onInstallProgress(onProgress),
      window.api.importers.onImportProgress(onProgress),
      window.api.instances.onImportProgress(onProgress),
    ];
    return () => offs.forEach((off) => off?.());
  }, []);

  async function startModpackInstall({ platform, project, version, title, icon }) {
    const key = `${platform}:${platform === 'modrinth' ? project.id : project.project_id}`;
    if (installStarted.current.has(key)) return { ok: false, error: 'Эта сборка уже скачивается' };
    installStarted.current.add(key);
    const id = `${key}:${Date.now()}`;
    setInstalls((prev) => [...prev.filter((i) => i.key !== key), {
      id, key, title, icon, stage: 'download-pack', completed: 0, total: 0, status: 'running',
    }]);
    const res = await runInstallCall(() => window.api[platform].installModpack(project, version, id));
    installStarted.current.delete(key);
    if (res.ok) {
      setInstances((prev) => [res.instance, ...prev.filter((i) => i.id !== res.instance.id)]);
      setInstalls((prev) => prev.filter((i) => i.id !== id));
    } else if (res.cancelled) {
      setInstalls((prev) => prev.filter((i) => i.id !== id)); // cancelled on purpose: nothing to report
    } else {
      setInstalls((prev) => prev.map((i) => (i.id === id ? { ...i, status: 'error', error: res.error } : i)));
    }
    return res;
  }

  // A modpack file (.mrpack / CurseForge .zip) picked from disk: same card,
  // title-bar progress and pause/cancel as a Modrinth or CurseForge download.
  async function startPackFileImport({ filePath, title }) {
    const key = `file:${filePath}`;
    if (installStarted.current.has(key)) return { ok: false, error: 'Этот файл уже импортируется' };
    installStarted.current.add(key);
    const id = `${key}:${Date.now()}`;
    setInstalls((prev) => [...prev.filter((i) => i.key !== key), {
      id, key, title, icon: null, stage: 'extract-overrides', completed: 0, total: 0, status: 'running',
    }]);
    const res = await runInstallCall(() => window.api.instances.importPackFile(filePath, id));
    installStarted.current.delete(key);
    if (res.ok) {
      setInstances((prev) => [res.instance, ...prev.filter((i) => i.id !== res.instance.id)]);
      setInstalls((prev) => prev.filter((i) => i.id !== id));
    } else if (res.cancelled) {
      setInstalls((prev) => prev.filter((i) => i.id !== id));
    } else {
      setInstalls((prev) => prev.map((i) => (i.id === id ? { ...i, status: 'error', error: res.error } : i)));
    }
    return res;
  }

  // Copies one instance detected in another launcher (Prism/MultiMC,
  // ATLauncher) in as a new instance here — same background tracking as a
  // modpack download (pause/resume/cancel, survives leaving the page).
  async function startLauncherImport({
    launcherId, root, key, title, icon, mode,
  }) {
    const uniqueKey = `import:${launcherId}:${root}:${key}`;
    if (installStarted.current.has(uniqueKey)) return { ok: false, error: 'Эта сборка уже импортируется' };
    installStarted.current.add(uniqueKey);
    const id = `${uniqueKey}:${Date.now()}`;
    setInstalls((prev) => [...prev.filter((i) => i.key !== uniqueKey), {
      id, key: uniqueKey, title, icon, stage: 'queued', completed: 0, total: 0, status: 'running',
    }]);
    // One copy at a time: "Перенести все" can queue dozens of multi-GB
    // profiles, and copying them all in parallel would thrash the disk.
    const run = importQueue.current.then(() => (cancelledQueued.current.delete(id)
      ? { ok: false, cancelled: true }
      : runInstallCall(() => window.api.importers.import(launcherId, root, key, id, mode))));
    importQueue.current = run.catch(() => {});
    const res = await run;
    installStarted.current.delete(uniqueKey);
    if (res.ok) {
      setInstances((prev) => [res.instance, ...prev.filter((i) => i.id !== res.instance.id)]);
      setInstalls((prev) => prev.filter((i) => i.id !== id));
    } else if (res.cancelled) {
      setInstalls((prev) => prev.filter((i) => i.id !== id));
    } else {
      setInstalls((prev) => prev.map((i) => (i.id === id ? { ...i, status: 'error', error: res.error } : i)));
    }
    return res;
  }

  // Re-installs an already-installed Modrinth/CurseForge modpack in place to
  // its newest version. Uses the exact same tracking as a fresh install
  // (pause/resume/cancel, survives leaving the page) — just flagged so the
  // library grid doesn't also draw a "downloading" ghost card for an
  // instance that's already there.
  async function startPackUpdate(instance) {
    const key = `update:${instance.id}`;
    if (installStarted.current.has(key)) return { ok: false, error: 'Обновление уже идёт' };
    installStarted.current.add(key);
    const id = `${key}:${Date.now()}`;
    setInstalls((prev) => [...prev.filter((i) => i.key !== key), {
      id, key, title: instance.name, icon: instance.icon, stage: 'download-pack', completed: 0, total: 0, status: 'running', isPackUpdate: true, instanceId: instance.id,
    }]);
    const res = await runInstallCall(() => window.api.instances.updatePack(instance.id, id));
    installStarted.current.delete(key);
    if (res.ok) {
      setInstances((prev) => prev.map((i) => (i.id === res.instance.id ? res.instance : i)));
      setInstalls((prev) => prev.filter((i) => i.id !== id));
    } else if (res.cancelled) {
      setInstalls((prev) => prev.filter((i) => i.id !== id));
    } else {
      setInstalls((prev) => prev.map((i) => (i.id === id ? { ...i, status: 'error', error: res.error } : i)));
    }
    return res;
  }

  // Pause / resume / cancel a running download (the main process holds the switch).
  async function controlInstall(id, action) {
    // A queued import hasn't started in the main process yet, so there is
    // nothing there to pause or cancel — cancelling just drops it from the queue.
    if (installs.find((i) => i.id === id)?.stage === 'queued') {
      if (action === 'cancel') {
        cancelledQueued.current.add(id);
        setInstalls((prev) => prev.filter((i) => i.id !== id));
      }
      return;
    }
    const status = { pause: 'paused', resume: 'running', cancel: 'cancelling' }[action];
    setInstalls((prev) => prev.map((i) => (i.id === id ? { ...i, status } : i)));
    await window.api.installs.control(id, action);
  }

  function dismissInstall(id) {
    setInstalls((prev) => prev.filter((i) => i.id !== id));
  }
  function openInstance(id, quickPlay = null, openSettings = false, tab = null) {
    navigate('instance', { id, quickPlay, openSettings, tab });
  }

  function openProject(projectId, type, platform = 'modrinth') {
    navigate('project', { projectId, type, platform });
  }

  function handleInstanceCreated(instance) {
    setInstances((prev) => [instance, ...prev]);
    navigate('instance', { id: instance.id });
  }

  function handleInstanceDeleted(id) {
    setInstances((prev) => prev.filter((i) => i.id !== id));
    // Only bounce away if we were actually looking at the deleted instance's
    // own page — deleting from Home or the Library grid should leave you
    // right where you were.
    if (current.page === 'instance' && current.params.id === id) navigate('library');
  }

  // Bulk variants (library multi-select): update the list without jumping
  // to another page.
  function handleInstancesAdded(list) {
    setInstances((prev) => [...list, ...prev]);
  }

  function handleInstancesDeleted(ids) {
    const gone = new Set(ids);
    setInstances((prev) => prev.filter((i) => !gone.has(i.id)));
  }

  function handleInstanceRenamed(updated) {
    setInstances((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
  }

  const activeInstance = current.page === 'instance' ? instances.find((i) => i.id === current.params.id) : null;

  const title = useMemo(() => {
    if (current.page === 'instance') return activeInstance?.name || 'Instance';
    return PAGE_TITLES[current.page] || '';
  }, [current, activeInstance]);

  const showApp = dataReady && minTimeElapsed;

  // «Игровой» вид главного экрана работает без боковой панели: переходы — карточки на самом экране.
  const gameHome = current.page === 'home' && settings?.homeLayout === 'play';

  return (
    <div className={`app-shell ${gameHome ? 'no-sidebar' : ''}`}>
      {!showApp && <LoadingScreen />}
      {/* Один раз после входа: какой главный экран нужен (тем, кто уже включил «Игровой» вручную, не предлагаем) */}
      {showApp && settings && settings.homeLayoutChosen !== true && settings.homeLayout !== 'play' && (
        <HomeLayoutChoice onChoose={(layout) => { window.api.settings.set({ homeLayout: layout, homeLayoutChosen: true }).then(setSettings); }} />
      )}
      <div className="bg-scene" />
      <div className="bg-photo" />
      <TitleBar
        title={title}
        canGoBack={historyIndex > 0}
        canGoForward={historyIndex < history.length - 1}
        onBack={goBack}
        onForward={goForward}
        instances={instances}
        runningIds={runningIds}
        preparingIds={preparingIds}
        installs={installs}
        onDismissInstall={dismissInstall}
        onControlInstall={controlInstall}
        onOpenInstance={openInstance}
        onStopInstance={stopInstance}
      />
      {!gameHome && <Sidebar page={current.page === 'project' ? 'search' : current.page} onNavigate={navigate} account={account} onAccountChange={setAccount} showBuilderTools={!!settings?.showBuilderTools} showStats={showStatsTab} showSearch={showSearchPage} />}
      <div className={`main-content ${gameHome ? 'hp-main' : ''}`}>
      {/* Search keeps its own boundary and stays mounted (hidden) while a project is open, so its query/results survive going back. */}
      {showSearchPage && (searchVisited || current.page === 'search') && (
        <ErrorBoundary key="search-page">
          <Suspense fallback={null}>
            <div style={{ display: current.page === 'search' ? 'block' : 'none' }}>
              <Search onOpenProject={openProject} />
            </div>
          </Suspense>
        </ErrorBoundary>
      )}
      <ErrorBoundary key={`${current.page}:${current.params?.id || ''}`}>
        <Suspense fallback={null}>
        {current.page === 'home' && settings?.homeLayout === 'play' && (
          <HomePlay
            {...tileProps}
            instances={instances}
            account={account}
            onNavigate={navigate}
            onOpenInstance={openInstance}
          />
        )}
        {current.page === 'home' && settings?.homeLayout !== 'play' && (
          <Home
            {...tileProps}
            instances={instances}
            onOpenInstance={openInstance}
            onInstanceCreated={handleInstanceCreated}
            onInstanceUpdated={handleInstanceRenamed}
            onInstanceDeleted={handleInstanceDeleted}
            onOpenLibraryFolder={(folderId) => navigate('library', { folderId })}
          />
        )}
        {current.page === 'project' && (
          <ProjectPage
            key={`${current.params.platform}:${current.params.projectId}`}
            platform={current.params.platform}
            projectId={current.params.projectId}
            type={current.params.type}
            instances={instances}
            installs={installs}
            onControlInstall={controlInstall}
            onInstallModpack={startModpackInstall}
            onBack={goBack}
            onOpenInstance={openInstance}
          />
        )}
        {current.page === 'library' && (
          <Library
            key={current.params.folderId || 'root'}
            initialFolderId={current.params.folderId || null}
            {...tileProps}
            onInstancesAdded={handleInstancesAdded}
            onInstancesDeleted={handleInstancesDeleted}
            instances={instances}
            onOpenInstance={openInstance}
            onInstanceCreated={handleInstanceCreated}
            onInstanceUpdated={handleInstanceRenamed}
            onInstanceDeleted={handleInstanceDeleted}
            onImportInstance={startLauncherImport}
          />
        )}
        {current.page === 'instance' && activeInstance && (
          <Instance
            instance={activeInstance}
            account={account}
            onDeleted={handleInstanceDeleted}
            onRenamed={handleInstanceRenamed}
            onDuplicated={handleInstanceCreated}
            runningIds={runningIds}
            setRunningIds={setRunningIds}
            initialQuickPlay={current.params.quickPlay || null}
            initialShowSettings={current.params.openSettings || false}
            initialTab={current.params.tab || null}
            onFindingChange={setFinderOpen}
            packInstall={installs.find((i) => i.instanceId === activeInstance.id)}
            onControlInstall={controlInstall}
            onUpdatePack={startPackUpdate}
            onCrashDismiss={(id) => setCrashedIds((prev) => { const next = new Set(prev); next.delete(id); return next; })}
          />
        )}
        {current.page === 'settings' && (
          <Settings account={account} onAccountChange={setAccount} onSettingsChange={setSettings} updater={updater} />
        )}
        {current.page === 'skins' && (
          <Skins account={account} onAccountChange={setAccount} initialView={current.params?.view} />
        )}
        {current.page === 'screenshots' && <Screenshots />}
        {current.page === 'schematics' && settings?.showBuilderTools && <Schematics instances={instances} />}
        {current.page === 'stats' && showStatsTab && <Stats instances={instances} onOpenRecap={() => {}} onInstanceChanged={handleInstanceRenamed} />}
        </Suspense>
      </ErrorBoundary>
      </div>

      <UpdateBanner updater={updater} />

      {paletteOpen && (
        <CommandPalette
          instances={instances}
          settings={settings}
          onNavigate={(page, params) => navigate(page, params)}
          onClose={() => setPaletteOpen(false)}
        />
      )}
    </div>
  );
}
