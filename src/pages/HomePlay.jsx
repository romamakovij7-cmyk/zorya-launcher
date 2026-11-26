// Второй вид главного экрана («Игровой»): в центре персонаж активного аккаунта, по бокам быстрые карточки,
// внизу большая панель «Играть» с последней сборкой. Переключается в Settings → Interface → Главный экран.
import {
  Suspense, lazy, useEffect, useMemo, useRef, useState,
} from 'react';
import { SkinViewer, IdleAnimation } from 'skinview3d';
import {
  PlayIcon, StopIcon, BoxIcon, ShirtIcon, PlusIcon,
  GlobeIcon, ServerIcon, ChevronDownIcon, FolderIcon, TerminalIcon,
} from '../components/Icons.jsx';
import HeartParticles from '../components/HeartParticles.jsx';
import { usePremium } from '../utils/usePremium.js';
import { defaultSkinFor } from '../utils/defaultSkin.js';
import HeroScene from '../components/HeroScene.jsx';
import RecapBanner from '../components/RecapBanner.jsx';
import PremiumButton, { NickText } from '../components/PremiumButton.jsx';
import { useSkinReactions } from '../utils/useSkinReactions.js';
import { attachBreasts } from '../utils/breasts.js';
import { useGenderLook } from '../utils/useGenderLook.js';
import { attachFreshEyes } from '../utils/freshEyes.js';
import { useFreshLook } from '../utils/useFreshLook.js';
import libraryPng from '../assets/pixel/library.png';
import skinsPng from '../assets/pixel/skins.png';
import capesPng from '../assets/pixel/capes.png';
import searchPng from '../assets/pixel/search.png';
import screenshotsPng from '../assets/pixel/screenshots.png';
import statsPng from '../assets/pixel/stats.png';
import settingsPng from '../assets/pixel/settings.png';
import { formatDuration, formatRelativeDate } from '../api/modrinth.js';
import { stageLabel, stagePercent } from '../utils/launchStages.js';

const GenderModal = lazy(() => import('../components/GenderModal.jsx'));
const FreshMovesModal = lazy(() => import('../components/FreshMovesModal.jsx'));
const CharacterMenu = lazy(() => import('../components/CharacterMenu.jsx'));

const LAST_KEY = 'zorya.homePlay.instance';

function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

function greeting() {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return 'Доброе утро';
  if (h >= 12 && h < 18) return 'Good afternoon';
  if (h >= 18 && h < 23) return 'Good evening';
  return 'Доброй ночи';
}

function describe(inst) {
  if (!inst) return '';
  if (inst.loader === 'horizon') return 'Rust · Horizon';
  const v = inst.mcVersion;
  return inst.loader && inst.loader !== 'vanilla' ? `${cap(inst.loader)} ${v}` : `Vanilla ${v}`;
}

// «Запущено 1 ч 05 мин» for the live badge
function elapsed(ms) {
  if (!ms || ms < 0) return '';
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'меньше минуты';
  if (m < 60) return `${m} мин`;
  return `${Math.floor(m / 60)} ч ${String(m % 60).padStart(2, '0')} мин`;
}

function readLast() { try { return localStorage.getItem(LAST_KEY); } catch { return null; } }
function writeLast(id) { try { localStorage.setItem(LAST_KEY, id); } catch { /* ignore */ } }

// 3D-персонаж. Skin: у офлайн-аккаунта — выбранный из библиотеки, иначе скин аккаунта. Cape: наш (с сайта) или Mojang.
function Hero({ account, onPickSkin }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const viewerRef = useRef(null);
  const [skins, setSkins] = useState([]);
  const [capes, setCapes] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false); // right click on the character: what to set up
  const [genderOpen, setGenderOpen] = useState(false); // ... Female Gender Mod
  const [freshOpen, setFreshOpen] = useState(false); // ... Fresh Moves

  useEffect(() => {
    window.api.skins.list().then(setSkins).catch(() => {});
    window.api.skins.listCapes().then((r) => setCapes(r?.ok ? r.capes : [])).catch(() => setCapes([]));
  }, []);

  useEffect(() => {
    if (!canvasRef.current || !wrapRef.current) return undefined;
    const box = wrapRef.current.getBoundingClientRect();
    const viewer = new SkinViewer({
      canvas: canvasRef.current, width: Math.max(220, box.width), height: Math.max(300, box.height), fov: 38, zoom: 1.0,
    });
    viewer.animation = new IdleAnimation();
    viewer.controls.enableZoom = false;
    viewer.controls.enablePan = false;
    viewer.playerObject.rotation.y = -0.45;
    viewerRef.current = viewer;
    const ro = new ResizeObserver(() => {
      const r = wrapRef.current?.getBoundingClientRect();
      if (r && r.width > 50 && r.height > 50) viewer.setSize(Math.round(r.width), Math.round(r.height));
    });
    ro.observe(wrapRef.current);
    return () => { ro.disconnect(); viewer.dispose(); viewerRef.current = null; };
  }, []);

  // Грудь и пол по настройкам мода Female Gender (из сборки с модом, в которую играли последней): персонаж выглядит так же, как будет в игре
  const look = useGenderLook(account);
  const breastsRef = useRef(null);
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return undefined;
    const ctrl = attachBreasts(viewer);
    breastsRef.current = ctrl;
    return () => { ctrl.dispose(); breastsRef.current = null; };
  }, []);
  useEffect(() => { breastsRef.current?.update(look); }, [look]);

  // Глаза Fresh Moves, если они нарисованы в скине (см. utils/freshEyes.js)
  const eyesLook = useFreshLook();
  const eyesRef = useRef(null);
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return undefined;
    const ctrl = attachFreshEyes(viewer);
    eyesRef.current = ctrl;
    return () => { ctrl.dispose(); eyesRef.current = null; };
  }, []);
  useEffect(() => { eyesRef.current?.update(eyesLook); }, [eyesLook]);

  // Те же реакции, что на странице «Skins» (занятия в простое, тык по голове, падение), только без удара по животу.
  const { handleViewerClick } = useSkinReactions(viewerRef, canvasRef, { belly: false });

  const worn = account?.type === 'offline' && account.offlineSkinId ? skins.find((s) => s.id === account.offlineSkinId) : null;
  // No skin of its own: one of Minecraft's default characters stands there instead of an empty stage (see utils/defaultSkin.js).
  const fallback = !worn && !account?.skinUrl ? defaultSkinFor(account, skins) : null;
  const skinUrl = worn ? worn.dataUrl : account?.skinUrl || fallback?.dataUrl || null;
  const variant = worn ? worn.variant : account?.skinUrl ? account?.skinVariant : fallback?.variant;

  useEffect(() => {
    const v = viewerRef.current;
    if (!v || !skinUrl) return;
    v.loadSkin(skinUrl, { model: variant === 'slim' ? 'slim' : 'default' }).catch(() => {});
  }, [skinUrl, variant]);

  // Hearts only when they are put on (Skins -> Particles); a subscription known to be over takes them off as well (the server stops showing them too).
  const premium = usePremium();
  const heartsOn = !!account?.heartsEnabled && !(premium.loaded && premium.ok && !premium.active);
  const customCape = capes?.find((c) => c.id === account?.customCapeId) || null;
  const mojangCape = (account?.capes || []).find((c) => c.state === 'ACTIVE') || null;
  const capeUrl = customCape?.url || (account?.type === 'microsoft' ? mojangCape?.url : null) || null;
  useEffect(() => {
    const v = viewerRef.current;
    if (!v) return;
    if (capeUrl) v.loadCape(capeUrl).catch(() => {}); else v.loadCape(null);
  }, [capeUrl]);

  return (
    <div className="hp-hero" ref={wrapRef}>
      <div className="hp-hero-glow" />
      <div className="hp-hero-floor" />
      <canvas
        ref={canvasRef} className={skinUrl ? '' : 'hp-hidden'} onClick={handleViewerClick}
        onContextMenu={(e) => { e.preventDefault(); if (account) setMenuOpen(true); }}
      />
      {menuOpen && (
        <Suspense fallback={null}>
          <CharacterMenu account={account} onClose={() => setMenuOpen(false)} onPick={(id) => { setMenuOpen(false); if (id === 'gender') setGenderOpen(true); else setFreshOpen(true); }} />
        </Suspense>
      )}
      {genderOpen && <Suspense fallback={null}><GenderModal account={account} skinUrl={skinUrl} skinVariant={variant} onClose={() => setGenderOpen(false)} /></Suspense>}
      {freshOpen && <Suspense fallback={null}><FreshMovesModal account={account} skinUrl={skinUrl} skinVariant={variant} onClose={() => setFreshOpen(false)} /></Suspense>}
      {skinUrl && heartsOn && <HeartParticles className="hp-hearts" />}
      {!skinUrl && (
        <button className="hp-hero-empty" onClick={onPickSkin}>
          <ShirtIcon width={34} height={34} />
          <span>{account ? 'Выбрать скин' : 'Войдите в аккаунт'}</span>
        </button>
      )}
    </div>
  );
}

function ShortcutCard({ icon, title, sub, onClick }) {
  return (
    <button className="hp-card hp-shortcut" onClick={onClick}>
      <span className="hp-shortcut-icon"><img src={icon} alt="" /></span>
      <span className="hp-shortcut-text">
        <span className="hp-shortcut-title">{title}</span>
        {sub && <span className="hp-shortcut-sub">{sub}</span>}
      </span>
    </button>
  );
}

export default function HomePlay({
  instances, account, settings, onNavigate, onOpenInstance,
  runningIds, preparingIds, crashedIds, launchProgress, onPlayInstance, onStopInstance, onOpenRecap,
}) {
  const [recent, setRecent] = useState(null); // мировые/серверные «продолжить»
  const [pickerOpen, setPickerOpen] = useState(false);
  const [chosenId, setChosenId] = useState(readLast);
  // The player's own picture behind the character (Settings → Interface → Главный экран); null = the night scene
  const [sceneUrl, setSceneUrl] = useState(null);
  useEffect(() => {
    let alive = true;
    let url = null;
    if (!settings?.homeSceneFile) { setSceneUrl(null); return undefined; }
    window.api.appearance.getSceneBackground().then((res) => {
      if (!alive || !res?.ok) { if (alive) setSceneUrl(null); return; }
      url = URL.createObjectURL(new Blob([res.data], { type: res.mime }));
      setSceneUrl(url);
    }).catch(() => {});
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [settings?.homeSceneFile]);

  useEffect(() => {
    let alive = true;
    Promise.all([
      window.api.recents.worlds().catch(() => null),
      window.api.recents.servers().catch(() => null),
    ]).then(([w, s]) => {
      if (!alive) return;
      const worlds = (w?.ok ? w.items : []).map((i) => ({ ...i, kind: 'world' }));
      const servers = (s?.ok ? s.items : []).slice(0, 2).map((i) => ({ ...i, kind: 'server' }));
      setRecent([...worlds, ...servers].slice(0, 4));
    });
    return () => { alive = false; };
  }, []);

  const sorted = useMemo(
    () => [...instances].sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0) || (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)),
    [instances],
  );
  const picked = sorted.find((i) => i.id === chosenId) || sorted[0] || null;

  // When the player is in a game, the panel is about that game: its name, status, how long, quick buttons and Stop.
  // start times of the running games (and a clock tick so "12 мин" moves), plus the latest RAM/CPU sample of each
  const [startTimes, setStartTimes] = useState({});
  const [samples, setSamples] = useState({});
  const [, setTick] = useState(0);
  const runningKey = [...(runningIds || [])].sort().join(',');
  useEffect(() => {
    let alive = true;
    window.api.instances.runningStartTimes().then((t) => { if (alive) setStartTimes(t || {}); }).catch(() => {});
    return () => { alive = false; };
  }, [runningKey]);
  useEffect(() => {
    const off = window.api.monitor.onSample(({ instanceId, sample }) => setSamples((prev) => ({ ...prev, [instanceId]: sample })));
    const timer = setInterval(() => setTick((n) => n + 1), 15000);
    return () => { off(); clearInterval(timer); };
  }, []);
  const runningList = sorted
    .filter((i) => runningIds?.has(i.id))
    .sort((a, b) => (startTimes[b.id] || 0) - (startTimes[a.id] || 0));
  const [pickedByHand, setPickedByHand] = useState(false); // an explicit choice from the list beats "show the running one"
  const current = picked && runningIds?.has(picked.id) ? picked : (!pickedByHand && runningList[0]) || picked;
  const otherRunning = runningList.filter((i) => i.id !== current?.id).length;

  // Список закрывается кликом снаружи (fixed-подложка не годится: у панели backdrop-filter, и fixed считается от неё).
  const playRef = useRef(null);
  useEffect(() => {
    if (!pickerOpen) return undefined;
    const onDown = (e) => { if (playRef.current && !playRef.current.contains(e.target)) setPickerOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setPickerOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [pickerOpen]);

  function choose(id) { setChosenId(id); setPickedByHand(true); writeLast(id); setPickerOpen(false); }

  const running = !!current && !!runningIds?.has(current.id);
  const preparing = !!current && !!preparingIds?.has(current.id);
  const crashed = !!current && !running && !preparing && !!crashedIds?.has(current.id);
  const progress = current ? launchProgress?.[current.id] : null;
  const pct = stagePercent(progress);
  const sample = current ? samples[current.id] : null;
  const since = running && current ? startTimes[current.id] : null;

  function onMainClick() {
    if (!current || preparing) return;
    if (running) onStopInstance?.(current.id); else onPlayInstance?.(current.id);
  }

  function playRecent(item) {
    const quickPlay = item.kind === 'world'
      ? { type: 'world', target: item.folderName }
      : { type: 'server', target: item.address };
    onOpenInstance(item.instanceId, item.canQuickPlay ? quickPlay : null);
  }

  return (
    <div className="hp-root">
      <div className={`hp-upper ${settings?.homeScene !== false ? 'with-scene' : ''}`}>
        {settings?.homeScene !== false && <HeroScene imageUrl={sceneUrl} />}
      <div className="hp-top">
        <div>
          <div className="hp-hello">{greeting()}{account ? ',' : ''}</div>
          <div className="hp-name"><NickText name={account ? account.name : 'Zorya'} /></div>
        </div>
        <div className="hp-top-actions">
          <RecapBanner variant="pill" onOpen={onOpenRecap} />
          <PremiumButton />
          <button className="hp-settings" onClick={() => onNavigate('settings')} title="Settings">
            <img src={settingsPng} alt="" />
          </button>
        </div>
      </div>

      <div className="hp-stage">
        <div className="hp-side hp-side-left">
          <ShortcutCard icon={libraryPng} title="Library" sub={`${instances.length} ${instances.length === 1 ? 'сборка' : 'сборок'}`} onClick={() => onNavigate('library')} />
          <ShortcutCard icon={skinsPng} title="Skins" onClick={() => onNavigate('skins')} />
          <ShortcutCard icon={capesPng} title="Capes" onClick={() => onNavigate('skins', { view: 'capes' })} />
          {settings?.showSearchPage !== false && <ShortcutCard icon={searchPng} title="Mods & packs" sub="Search" onClick={() => onNavigate('search')} />}
          <ShortcutCard icon={screenshotsPng} title="Screenshots" onClick={() => onNavigate('screenshots')} />
          {settings?.showStatsTab !== false && <ShortcutCard icon={statsPng} title="Stats" onClick={() => onNavigate('stats')} />}
        </div>

        <Hero account={account} onPickSkin={() => onNavigate('skins')} />

        <div className="hp-side hp-side-right">
          <div className="hp-card hp-recent">
            <div className="hp-card-title">Continue</div>
            {recent && recent.length === 0 && <div className="hp-muted">Здесь появятся ваши миры и серверы</div>}
            {(recent || []).map((r) => (
              <button key={`${r.kind}:${r.instanceId}:${r.folderName || r.address}`} className="hp-recent-row" onClick={() => playRecent(r)} title="Играть">
                <span className="hp-recent-icon">
                  {r.icon ? <img src={r.icon} alt="" /> : r.kind === 'server' ? <ServerIcon width={18} height={18} /> : <GlobeIcon width={18} height={18} />}
                </span>
                <span className="hp-recent-body">
                  <span className="hp-recent-title">{r.kind === 'server' ? r.name : r.levelName}</span>
                  <span className="hp-recent-sub">
                    {r.kind === 'server' && r.reachable ? `${r.online ?? '?'}/${r.max ?? '?'} онлайн · ` : ''}{r.instanceName}
                  </span>
                </span>
                <PlayIcon width={14} height={14} />
              </button>
            ))}
          </div>
        </div>
      </div>
      </div>

      <div className={`hp-card hp-play ${running ? 'is-running' : ''} ${preparing ? 'is-preparing' : ''}`} ref={playRef}>
        {current ? (
          <>
            <div className="hp-play-icon">
              {current.icon ? <img src={current.icon} alt="" /> : <BoxIcon width={38} height={38} />}
            </div>
            <div className="hp-play-info">
              {running || preparing ? (
                <div className="hp-play-state">
                  <span className="hp-live-dot" />
                  <span>{running ? 'Запущено' : 'Запускается'}</span>
                  {running && since ? <span className="hp-play-since">· {elapsed(Date.now() - since)}</span> : null}
                  {otherRunning > 0 && (
                    <button className="hp-play-more" onClick={() => setPickerOpen(true)} title="Show список сборок">ещё {otherRunning} в игре</button>
                  )}
                </div>
              ) : (
                <div className="hp-play-label">{current.lastPlayed ? 'Последняя игра' : 'Выбрана сборка'}</div>
              )}
              <button className="hp-play-name" onClick={() => setPickerOpen((v) => !v)} title="Выбрать другую сборку">
                <span>{current.name}</span>
                {sorted.length > 1 && <ChevronDownIcon width={16} height={16} />}
              </button>
              <div className="hp-play-meta">
                <span>{describe(current)}</span>
                <span className="dot" />
                <span>Total playtime {formatDuration(current.totalPlaytimeMs)}</span>
                {running && sample ? (<><span className="dot" /><span title="Memory и нагрузка процессора игры">{Math.round(sample.ramMb)} МБ · ЦП {Math.round(sample.cpu)}%</span></>) : null}
                {current.lastPlayed ? (<><span className="dot" /><span>{formatRelativeDate(new Date(current.lastPlayed).toISOString())}</span></>) : null}
              </div>
              {preparing && (
                <div className="hp-play-progress" title={stageLabel(progress, current)}>
                  <div className={`progress-bar-track ${pct == null ? 'indeterminate' : ''}`}>
                    <div className="progress-bar-fill" style={pct == null ? undefined : { width: `${pct}%` }} />
                  </div>
                  <span>{stageLabel(progress, current)}</span>
                </div>
              )}
              {crashed && <div className="hp-play-crash">Прошлый запуск завершился с ошибкой</div>}
            </div>
            {running || preparing ? (
              <div className="hp-quick">
                <button className="hp-quick-btn" onClick={() => window.api.instances.openFolder(current.id)} title="Open folder сборки в проводнике">
                  <FolderIcon width={18} height={18} /><span>Folder</span>
                </button>
                <button className="hp-quick-btn" onClick={() => onOpenInstance(current.id, null, false, 'log')} title="Log игры">
                  <TerminalIcon width={18} height={18} /><span>Консоль</span>
                </button>
                <button className="hp-quick-btn" onClick={() => onOpenInstance(current.id)} title="Страница сборки">
                  <BoxIcon width={18} height={18} /><span>Instance</span>
                </button>
              </div>
            ) : (
              <button className="hp-link" onClick={() => onOpenInstance(current.id)}>Open</button>
            )}
            <button
              className={`btn btn-primary hp-play-btn ${running ? 'stop' : ''}`}
              disabled={preparing}
              onClick={onMainClick}
            >
              {running ? <StopIcon width={20} height={20} /> : <PlayIcon width={20} height={20} />}
              {running ? 'Остановить' : preparing ? 'Launch…' : 'Играть'}
            </button>

            {pickerOpen && (
              <>
                <div className="hp-picker">
                  {sorted.map((i) => (
                    <button key={i.id} className={`hp-picker-row ${i.id === current.id ? 'active' : ''}`} onClick={() => choose(i.id)}>
                      {runningIds?.has(i.id) && <span className="hp-live-dot" title="Запущено" />}
                      <span className="hp-recent-icon">{i.icon ? <img src={i.icon} alt="" /> : <BoxIcon width={18} height={18} />}</span>
                      <span className="hp-recent-body">
                        <span className="hp-recent-title">{i.name}</span>
                        <span className="hp-recent-sub">{describe(i)}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        ) : (
          <>
            <div className="hp-play-icon"><BoxIcon width={38} height={38} /></div>
            <div className="hp-play-info">
              <div className="hp-play-name static">Пока нет ни одной сборки</div>
            </div>
            <button className="btn btn-primary hp-play-btn" onClick={() => onNavigate('library')}>
              <PlusIcon width={20} height={20} /> Create instance
            </button>
          </>
        )}
      </div>
    </div>
  );
}
