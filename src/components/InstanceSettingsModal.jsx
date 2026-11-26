import Select, { LOADER_OPTIONS } from './Select.jsx';
import { useEffect, useMemo, useState } from 'react';
import {
  InfoIcon, WrenchIcon, CloseIcon, BoxIcon, CopyIcon, TrashIcon, EditIcon, PlayIcon,
} from './Icons.jsx';
import { MEM_STEP, MEM_FLOOR, memoryCap, formatMb } from '../utils/memory.js';
import GcPicker from './GcPicker.jsx';

const TABS = [
  { id: 'general', label: 'Основные', icon: InfoIcon },
  { id: 'install', label: 'Установка', icon: WrenchIcon },
  { id: 'game', label: 'Game', icon: PlayIcon }, // game settings of this build: the эталон, the shared servers (not for Horizon builds)
];

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function InstanceSettingsModal({ instance, onClose, onRenamed, onDeleted, onDuplicated, onInstallChanged }) {
  const [tab, setTab] = useState('general');

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-modal-header">
          <div className="settings-modal-crumb">
            <div className="settings-modal-icon">
              {instance.icon ? <img src={instance.icon} alt="" /> : <BoxIcon width={18} height={18} />}
            </div>
            <span>{instance.name}</span>
            <span className="settings-modal-sep">›</span>
            <strong>Settings</strong>
          </div>
          <button className="icon-btn" onClick={onClose}><CloseIcon /></button>
        </div>

        <div className="settings-modal-body">
          <div className="settings-modal-nav">
            {TABS.filter((t) => t.id !== 'game' || instance.loader !== 'horizon').map((t) => (
              <button key={t.id} className={`settings-modal-nav-item ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
                <t.icon width={16} height={16} /> {t.label}
              </button>
            ))}
          </div>
          <div className="settings-modal-content">
            {tab === 'general' && (
              <GeneralTab
                instance={instance}
                onClose={onClose}
                onRenamed={onRenamed}
                onDeleted={onDeleted}
                onDuplicated={onDuplicated}
              />
            )}
            {tab === 'install' && (
              <InstallTab instance={instance} onInstallChanged={onInstallChanged} />
            )}
            {tab === 'game' && instance.loader !== 'horizon' && <GameTab instance={instance} />}
          </div>
        </div>
      </div>
    </div>
  );
}

// A Rust (Horizon) build: which Horizon release it plays. "Последняя" = the launcher keeps the newest one (checks once a day when the game starts);
// a dated release stays exactly as it is, so a build that works can be kept while a newer one is broken (or the other way round).
function HorizonVersionPicker({ instance, onInstallChanged }) {
  const [releases, setReleases] = useState(null); // [{ tag, label, date }] | null while loading
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState(null);
  const current = instance.horizonVersion || '';

  const load = (force) => {
    setError(null);
    window.api.instances.horizonReleases(force).then((r) => {
      if (r.ok) setReleases(r.releases); else { setReleases([]); setError(r.error); }
    }).catch((e) => { setReleases([]); setError(e.message); });
  };
  useEffect(() => { load(false); }, []);

  async function pick(value) {
    setSaving(true); setNote(null);
    const res = await window.api.instances.setHorizonVersion(instance.id, value || null);
    setSaving(false);
    if (res.ok) {
      onInstallChanged(res.instance);
      setNote(value ? 'Version сохранена. Нужная сборка Horizon скачается при ближайшем запуске.' : 'Instance будет играть последнюю версию Horizon.');
    } else setError(res.error);
  }

  // A version that is no longer listed stays in the list, so the current choice is always visible
  const options = [{ value: '', label: 'Последняя (обновляется сама)' }];
  const tags = new Set();
  for (const r of releases || []) { tags.add(r.tag); options.push({ value: r.tag, label: r.label }); }
  if (current && !tags.has(current)) options.push({ value: current, label: current.replace(/^nightly-/, '') });

  return (
    <div style={{ marginTop: 14 }}>
      <label className="settings-block-label">Version Horizon</label>
      <Select value={current} onChange={pick} options={options} disabled={saving || releases === null} />
      <p className="settings-block-hint">
        «Последняя» — лаунчер сам берёт новую сборку Horizon (проверяет раз в сутки при запуске). Датированную версию можно закрепить: она не обновится,
        пока вы не смените выбор. Это помогает, если новая сборка сломала игру или мод. Java и файлы Mojang лаунчер подбирает сам.
        Если у сборки включены нативные моды и она собрана, играется собранная версия, а не выбранная.
      </p>
      {releases === null && <div className="progress-label">Загружаем список версий…</div>}
      {note && <div className="hint-text">{note}</div>}
      {error && <div className="error-text">{error} <button className="btn" style={{ marginLeft: 8 }} onClick={() => load(true)}>Повторить</button></div>}
    </div>
  );
}

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const roundStep = (v) => Math.round(v / MEM_STEP) * MEM_STEP;

// Aikar's well-known G1 garbage-collector flags for Minecraft (the "balanced"
// set for heaps up to ~12 GB, and the variant for bigger ones).
const G1_TUNED = '-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions '
  + '-XX:+DisableExplicitGC -XX:G1NewSizePercent=30 -XX:G1MaxNewSizePercent=40 -XX:G1HeapRegionSize=8M '
  + '-XX:G1ReservePercent=20 -XX:G1HeapWastePercent=5 -XX:G1MixedGCCountTarget=4 -XX:InitiatingHeapOccupancyPercent=15 '
  + '-XX:G1MixedGCLiveThresholdPercent=90 -XX:G1RSetUpdatingPauseTimePercent=5 -XX:SurvivorRatio=32 '
  + '-XX:+PerfDisableSharedMem -XX:MaxTenuringThreshold=1';
const G1_TUNED_BIG = G1_TUNED
  .replace('G1NewSizePercent=30', 'G1NewSizePercent=40')
  .replace('G1MaxNewSizePercent=40', 'G1MaxNewSizePercent=50')
  .replace('G1HeapRegionSize=8M', 'G1HeapRegionSize=16M')
  .replace('G1ReservePercent=20', 'G1ReservePercent=15')
  .replace('InitiatingHeapOccupancyPercent=15', 'InitiatingHeapOccupancyPercent=20');

// Launch presets: memory is picked from the machine's RAM (never more than
// 75% of it), plus a matching set of JVM flags.
const PRESETS = [
  {
    id: 'low',
    label: 'Слабый ПК',
    hint: 'Немного памяти и мягкая сборка мусора — меньше нагрузки на слабое железо.',
    compute: (total) => ({
      max: clamp(roundStep(total * 0.2), 2048, 4096),
      min: 1024,
      args: '-XX:+UseG1GC -XX:MaxGCPauseMillis=100 -XX:+DisableExplicitGC',
    }),
  },
  {
    id: 'balance',
    label: 'Баланс',
    hint: 'Около четверти оперативной памяти (4–8 ГБ) и проверенные флаги G1GC — хороший вариант для большинства сборок.',
    compute: (total) => {
      const max = clamp(roundStep(total * 0.25), 4096, 8192);
      return { max, min: roundStep(max / 2), args: G1_TUNED };
    },
  },
  {
    id: 'max',
    label: 'Максимум',
    hint: 'До половины оперативной памяти (6–16 ГБ): для больших сборок с шейдерами и множеством модов.',
    compute: (total) => {
      const max = clamp(roundStep(total * 0.5), 6144, 16384);
      return { max, min: roundStep(max / 2), args: G1_TUNED_BIG };
    },
  },
];

function presetValues(preset, totalMb) {
  const v = preset.compute(totalMb);
  const cap = Math.max(1024, roundStep(totalMb * 0.75));
  const max = Math.min(v.max, cap);
  return { max, min: Math.min(v.min, max), args: v.args };
}

// "Эталон настроек игры": remember this build's game settings, or give the remembered ones to this build (see electron/mc/masterOptions.js).
function GameOptionsBlock({ instance }) {
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null); // { ok, text }
  const [st, setSt] = useState(null); // { hasFile, state } | null while loading
  const loadStatus = () => { try { window.api.masterOptions.status(instance.id).then((r) => r?.ok && setSt(r)).catch(() => {}); } catch { /* shown without status */ } };
  useEffect(() => { loadStatus(); }, [instance.id]);
  async function run(kind) {
    setBusy(kind); setMsg(null);
    try {
      const r = kind === 'capture' ? await window.api.masterOptions.capture(instance.id) : await window.api.masterOptions.apply(instance.id);
      if (!r?.ok) setMsg({ ok: false, text: r?.error || 'Не получилось.' });
      else if (kind === 'capture') setMsg({ ok: true, text: `Запомнено ${r.count} параметров, это теперь ваш эталон. Новые сборки получат его при первом запуске (если включено в Настройках → «Game settings»).` });
      else setMsg({ ok: true, text: r.note || (r.changed ? `Done, изменено параметров: ${r.changed}. Прежний файл настроек сохранён как options.txt.zorya-bak. Запустите игру, чтобы увидеть результат.` : 'Settings этой сборки уже совпадают с эталоном.') });
    } catch (e) { setMsg({ ok: false, text: e.message }); } finally { setBusy(null); loadStatus(); }
  }
  const noFile = st && !st.hasFile;
  return (
    <div className="settings-row-block">
      <label className="settings-block-label">Game settings (эталон)</label>
      {noFile && (
        <p className="error-text" style={{ marginTop: 0 }}>
          Эту сборку ещё ни разу не запускали, поэтому у неё нет файла настроек игры. Сначала запустите сборку, дождитесь главного меню игры и выйдите из игры. После этого здесь станут доступны кнопки.
        </p>
      )}
      {st && st.hasFile && st.state === 'pending' && (
        <p className="settings-block-hint" style={{ marginTop: 0 }}>
          Основная часть эталона (язык, звук, дальность) уже применена. Keybinds, поле зрения и графика добавятся при следующем запуске, или нажмите «Apply эталон» сейчас.
        </p>
      )}
      <div className="java-override-row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <button className="btn" onClick={() => run('capture')} disabled={!!busy || noFile} title={noFile ? 'Сначала запустите сборку и выйдите из игры' : undefined}>{busy === 'capture' ? 'Запоминаю…' : 'Запомнить настройки игры'}</button>
        <button className="btn" onClick={() => run('apply')} disabled={!!busy || noFile} title={noFile ? 'Сначала запустите сборку и выйдите из игры' : undefined}>{busy === 'apply' ? 'Применяю…' : 'Apply эталон'}</button>
      </div>
      {msg && <p className={msg.ok ? 'settings-block-hint' : 'error-text'} style={{ marginTop: 8 }}>{msg.text}</p>}
      <div className="settings-block-hint" style={{ lineHeight: 1.6 }}>
        <strong>Как пользоваться:</strong>
        <ol style={{ margin: '6px 0 6px 18px', padding: 0 }}>
          <li>Запустите сборку, настройте игру как вам нравится (язык, звук, клавиши, графика) и выйдите из игры.</li>
          <li>Нажмите «Запомнить настройки игры»: они станут вашим эталоном.</li>
          <li>Другую готовую сборку запустите один раз, выйдите из игры и нажмите в ней «Apply эталон». Новые сборки получат эталон сами.</li>
        </ol>
        Применять эталон нужно <strong>только после первого запуска сборки</strong> и когда игра закрыта.
      </div>
    </div>
  );
}

// The shared server list: how many of the shared servers this build has, and the button that adds the missing ones (see electron/mc/sharedServers.js).
function SharedServersBlock({ instance }) {
  const [st, setSt] = useState(null); // { total, present, missing, unreadable }
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const load = () => { try { window.api.sharedServers.status(instance.id).then((r) => r?.ok && setSt(r)).catch(() => {}); } catch { /* shown without status */ } };
  useEffect(() => { load(); }, [instance.id]);
  async function apply() {
    setBusy(true); setMsg(null);
    try {
      const r = await window.api.sharedServers.applyTo(instance.id);
      if (!r?.ok) setMsg({ ok: false, text: r?.error || 'Не получилось.' });
      else setMsg({ ok: true, text: r.added ? `Добавлено серверов: ${r.added} (${(r.names || []).join(', ')}). Они появятся в списке игры.` : 'All общие серверы уже есть в этой сборке.' });
    } catch (e) { setMsg({ ok: false, text: e.message }); } finally { setBusy(false); load(); }
  }
  const nothing = st && st.total === 0;
  return (
    <div className="settings-row-block">
      <label className="settings-block-label">General серверы</label>
      {nothing && <p className="settings-block-hint" style={{ marginTop: 0 }}>Общий список пока пуст. Добавьте серверы в Настройках лаунчера, раздел «General серверы».</p>}
      {st && !nothing && (
        <p className="settings-block-hint" style={{ marginTop: 0 }}>
          В этой сборке {st.present} из {st.total} общих серверов.{st.missing.length ? ` Не хватает: ${st.missing.join(', ')}.` : ''}
          {st.unreadable ? ' File серверов сборки не читается, поэтому его не меняем.' : ''}
        </p>
      )}
      <button className="btn" onClick={apply} disabled={busy || nothing || !st}>{busy ? 'Добавляю…' : 'Add общие серверы'}</button>
      {msg && <p className={msg.ok ? 'settings-block-hint' : 'error-text'} style={{ marginTop: 8 }}>{msg.text}</p>}
      <p className="settings-block-hint">
        Перед каждым запуском сборки недостающие общие серверы добавляются сами. Они идут в конец вашего списка в игре, ваши серверы не меняются.
        Server, который вы удалили в игре, сам не вернётся: его возвращает эта кнопка. Game при этом должна быть закрыта. Список общих серверов ведётся в Настройках лаунчера → «General серверы».
      </p>
    </div>
  );
}

// "Game": everything that is about the game's own settings and servers for this build.
function GameTab({ instance }) {
  return (
    <div>
      <GameOptionsBlock instance={instance} />
      <SharedServersBlock instance={instance} />
    </div>
  );
}

function GeneralTab({ instance, onClose, onRenamed, onDeleted, onDuplicated }) {
  const [name, setName] = useState(instance.name);
  const [icon, setIcon] = useState(instance.icon);
  const [iconBusy, setIconBusy] = useState(false);
  const [iconError, setIconError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [minMem, setMinMem] = useState(instance.minMemoryMb || '');
  const [maxMem, setMaxMem] = useState(instance.maxMemoryMb || '');
  const [totalMem, setTotalMem] = useState(16384);

  const [globalMax, setGlobalMax] = useState(null);

  useEffect(() => {
    window.api.system.totalMemoryMb().then(setTotalMem).catch(() => {});
    window.api.settings.get().then((s) => setGlobalMax(s.maxMemoryMb)).catch(() => {});
  }, []);

  useEffect(() => {
    setName(instance.name);
    setIcon(instance.icon);
    setMinMem(instance.minMemoryMb || '');
    setMaxMem(instance.maxMemoryMb || '');
  }, [instance.id]);

  async function saveName() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === instance.name) return;
    const res = await window.api.instances.rename(instance.id, trimmed);
    if (res.ok) onRenamed(res.instance);
  }

  async function persistMemory(nextMin, nextMax) {
    const res = await window.api.instances.updateMemory(instance.id, {
      minMemoryMb: nextMin || null,
      maxMemoryMb: nextMax || null,
    });
    if (res.ok) onRenamed(res.instance);
  }

  const [javaPath, setJavaPath] = useState(instance.javaPath || '');
  const [javaArgs, setJavaArgs] = useState(instance.javaArgs || '');

  useEffect(() => {
    setJavaPath(instance.javaPath || '');
    setJavaArgs(instance.javaArgs || '');
  }, [instance.id]);

  async function persistJava() {
    if ((javaPath.trim() || '') === (instance.javaPath || '') && (javaArgs.trim() || '') === (instance.javaArgs || '')) return;
    const res = await window.api.instances.updateJava(instance.id, { javaPath, javaArgs });
    if (res.ok) onRenamed(res.instance);
  }

  // Выбор G1/ZGC сразу сохраняется (поле ниже показывает получившиеся аргументы)
  async function persistGc(nextArgs) {
    setJavaArgs(nextArgs);
    const res = await window.api.instances.updateJava(instance.id, { javaPath, javaArgs: nextArgs });
    if (res.ok) onRenamed(res.instance);
  }

  const [presetNote, setPresetNote] = useState(null);

  // Applies a launch preset: memory + JVM flags, both still editable afterwards.
  async function applyPreset(preset) {
    const v = presetValues(preset, totalMem);
    setMinMem(v.min);
    setMaxMem(v.max);
    setJavaArgs(v.args);
    const [memRes, javaRes] = await Promise.all([
      window.api.instances.updateMemory(instance.id, { minMemoryMb: v.min, maxMemoryMb: v.max }),
      window.api.instances.updateJava(instance.id, { javaPath, javaArgs: v.args }),
    ]);
    const fresh = javaRes.ok ? javaRes.instance : memRes.instance;
    if (fresh) onRenamed({ ...fresh, minMemoryMb: v.min, maxMemoryMb: v.max });
    setPresetNote(`«${preset.label}»: память ${formatMb(v.min)}–${formatMb(v.max)}, JVM-аргументы записаны ниже. Всё можно поправить вручную.`);
  }

  const activePreset = PRESETS.find((p) => {
    const v = presetValues(p, totalMem);
    return Number(minMem) === v.min && Number(maxMem) === v.max && javaArgs.trim() === v.args;
  });

  const overrideOn = minMem !== '' || maxMem !== '';
  const sliderMax = memoryCap(totalMem);
  const effectiveMax = Math.min(overrideOn ? Number(maxMem) || Math.min(4096, sliderMax) : Math.min(4096, sliderMax), sliderMax);

  // One slider, like Modrinth's launcher — it sets the ceiling (-Xmx); the
  // floor (-Xms) just tags along at MEM_FLOOR so it's never above the
  // ceiling, since Java refuses to start otherwise.
  function toggleOverride(on) {
    if (on) {
      const defMax = Math.min(4096, sliderMax);
      setMinMem(MEM_FLOOR);
      setMaxMem(defMax);
      persistMemory(MEM_FLOOR, defMax);
    } else {
      setMinMem('');
      setMaxMem('');
      persistMemory(null, null);
    }
  }

  function onMaxChange(e) {
    const v = Number(e.target.value);
    setMaxMem(v);
    setMinMem(MEM_FLOOR);
  }

  function onSliderRelease() {
    persistMemory(MEM_FLOOR, maxMem || Math.min(4096, sliderMax));
  }

  async function pickIcon() {
    setIconBusy(true); setIconError(null);
    let res;
    try { res = await window.api.instances.setIcon(instance.id); } finally { setIconBusy(false); }
    if (!res.ok && !res.canceled) setIconError(res.error || 'Failed поставить иконку.');
    if (res.ok) { setIcon(res.instance.icon); onRenamed(res.instance); }
    else if (!res.canceled && res.error) alert(res.error);
  }

  async function handleDuplicate() {
    setBusy(true);
    const res = await window.api.instances.duplicate(instance.id);
    setBusy(false);
    if (res.ok) { onDuplicated(res.instance); onClose(); } else alert(res.error || 'Failed скопировать сборку');
  }

  async function handleDelete() {
    if (!confirm(`Delete «${instance.name}»? Files будут удалены безвозвратно.`)) return;
    try {
      await window.api.instances.delete(instance.id);
    } catch (err) {
      alert(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
      return;
    }
    onDeleted(instance.id);
    onClose();
  }

  return (
    <div>
      <div className="settings-row-block">
        <label className="settings-block-label">Name</label>
        <div className="settings-name-row">
          <input value={name} onChange={(e) => setName(e.target.value)} onBlur={saveName} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
          <div>
            <label className="settings-block-label">Иконка</label>
            <button className="settings-icon-picker" onClick={pickIcon} disabled={iconBusy} title="Изменить иконку: подойдёт любая картинка PNG, JPG, GIF или WebP до 25 МБ, лаунчер сам уменьшит её">
              {icon ? <img src={icon} alt="" /> : <BoxIcon width={28} height={28} />}
              <span className="settings-icon-picker-edit"><EditIcon width={13} height={13} /></span>
            </button>
          </div>
        </div>
        {iconBusy && <p className="settings-block-hint">Обрабатываю картинку…</p>}
        {iconError && <p className="error-text" style={{ marginTop: 8 }}>{iconError}</p>}
        <p className="settings-block-hint">Иконка сборки: любая картинка PNG, JPG, GIF или WebP до 25 МБ. Лаунчер сам уменьшит её до маленького квадратного значка.</p>
      </div>

      {/* Horizon is a Rust game: no JVM, so memory and Java settings mean nothing for it. */}
      {instance.loader !== 'horizon' && (
      <div className="settings-row-block">
        <div className="field-label-row">
          <label className="settings-block-label" style={{ marginBottom: 0 }}>Оперативная память</label>
          <label className="snapshot-toggle">
            своё значение для сборки
            <input type="checkbox" className="switch small" checked={overrideOn} onChange={(e) => toggleOverride(e.target.checked)} />
          </label>
        </div>

        <div className="preset-row">
          <span className="preset-row-label">Пресеты:</span>
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`shot-editor-tool ${activePreset?.id === p.id ? 'active' : ''}`}
              title={p.hint}
              onClick={() => applyPreset(p)}
            >
              {p.label}
            </button>
          ))}
        </div>
        {presetNote && <p className="settings-block-hint" style={{ marginTop: 0 }}>{presetNote}</p>}

        {overrideOn ? (
          <div className="memory-sliders">
            <div className="memory-slider-row">
              <div className="memory-slider-head"><span>Оперативная память</span><strong>{formatMb(effectiveMax)}</strong></div>
              <input
                type="range" className="mem-range"
                min={MEM_FLOOR} max={sliderMax} step={MEM_STEP}
                value={effectiveMax}
                onChange={onMaxChange}
                onMouseUp={onSliderRelease} onTouchEnd={onSliderRelease} onKeyUp={onSliderRelease}
              />
            </div>
          </div>
        ) : (
          <p className="settings-block-hint">Сейчас используется общее значение по умолчанию — {formatMb(globalMax)} (меняется в Настройках лаунчера).</p>
        )}
        <p className="settings-block-hint">Всего на устройстве: {formatMb(totalMem)}.</p>
      </div>
      )}

      {instance.loader !== 'horizon' && (
      <div className="settings-row-block">
        <label className="settings-block-label">Сборщик мусора</label>
        <GcPicker args={javaArgs} onChange={persistGc} />
        <input
          className="text-input"
          style={{ marginTop: 10 }}
          value={javaArgs}
          onChange={(e) => setJavaArgs(e.target.value)}
          onBlur={persistJava}
          placeholder="Доп. аргументы JVM только для этой сборки, например -XX:+UseZGC"
        />
        <p className="settings-block-hint">Аргументы добавляются к общим из Настроек лаунчера. Саму Java (её версию) для сборки выбирайте на вкладке «Установка».</p>
      </div>
      )}

      <div className="settings-row-block">
        <label className="settings-block-label">Создание копии сборки</label>
        <button className="btn" onClick={handleDuplicate} disabled={busy}>
          <CopyIcon width={15} height={15} /> {busy ? 'Копирование…' : 'Create копию'}
        </button>
        <p className="settings-block-hint">Создаёт копию сборки, включая миры, настройки, моды и т. д.</p>
      </div>

      <div className="settings-row-block">
        <label className="settings-block-label" style={{ color: 'var(--danger)' }}>Удаление сборки</label>
        <button className="btn btn-danger" onClick={handleDelete}>
          <TrashIcon width={15} height={15} /> Delete instance
        </button>
        <p className="settings-block-hint">
          Навсегда удаляет сборку с устройства, в том числе миры, настройки и весь установленный контент.
          Учтите, что после удаления сборку невозможно восстановить.
        </p>
      </div>
    </div>
  );
}

// Which Java runs this build: "Автоматически" (the launcher picks and downloads the one Mojang names for this version), one of the Javas
// installed on this computer, or a file of the person's own. The choice is stored as the build's own javaPath (empty = automatic).
const BROWSE = '__browse__';
const homeName = (p) => String(p || '').replace(/\\/g, '/').split('/').slice(-3, -2)[0] || '';
// "1.8.0_51" -> 8, "17.0.15" -> 17, "25" -> 25
const majorOfJava = (v) => {
  const m = /^(\d+)(?:\.(\d+))?/.exec(String(v || ''));
  if (!m) return null;
  const first = Number(m[1]);
  return first === 1 ? (Number(m[2]) || null) : first;
};

function JavaPicker({ instance, onChanged }) {
  const [data, setData] = useState(null); // { installed, required }
  const [globalPath, setGlobalPath] = useState('');
  const [customInfo, setCustomInfo] = useState(null); // { major, version } of a path that is not in the list
  const [note, setNote] = useState(null); // { ok, text }
  const [busy, setBusy] = useState(false);
  const current = instance.javaPath || '';

  useEffect(() => {
    let alive = true;
    window.api.java.list(instance.mcVersion).then((r) => { if (alive && r?.ok) setData(r); }).catch(() => {});
    window.api.settings.get().then((s) => { if (alive) setGlobalPath((s?.javaPath || '').trim()); }).catch(() => {});
    return () => { alive = false; };
  }, [instance.id, instance.mcVersion]);

  const listed = data ? data.installed.find((j) => j.path.toLowerCase() === current.toLowerCase()) : null;
  useEffect(() => {
    setCustomInfo(null);
    if (!current || !data || listed) return undefined;
    let alive = true;
    window.api.java.check(current).then((r) => { if (alive && r?.ok) setCustomInfo({ version: r.version }); }).catch(() => {});
    return () => { alive = false; };
  }, [current, data, listed]);

  const options = useMemo(() => {
    const out = [{ value: '', label: 'Автоматически (рекомендуется)', hint: data?.required ? `Java ${data.required}` : '' }];
    for (const j of (data?.installed || [])) out.push({ value: j.path, label: `Java ${j.version || '?'}${j.vendor ? ` · ${j.vendor}` : ''}`, hint: homeName(j.path) });
    if (current && !listed) out.push({ value: current, label: 'Свой файл', hint: homeName(current) });
    out.push({ value: BROWSE, label: 'Выбрать файл java…' });
    return out;
  }, [data, current, listed]);

  async function save(value) {
    const res = await window.api.instances.updateJava(instance.id, { javaPath: value, javaArgs: instance.javaArgs || '' });
    if (res.ok) { onChanged(res.instance); setNote({ ok: true, text: value ? 'Сохранено. Эта Java будет использована при следующем запуске.' : 'Сохранено. Лаунчер сам подберёт Java под версию игры.' }); }
    else setNote({ ok: false, text: res.error || 'Failed сохранить.' });
  }
  async function pick(value) {
    setBusy(true); setNote(null);
    try {
      if (value === BROWSE) {
        const r = await window.api.java.browse();
        if (r?.ok) await save(r.path);
        else if (!r?.canceled) setNote({ ok: false, text: r?.error || 'Failed выбрать файл.' });
      } else await save(value);
    } finally { setBusy(false); }
  }

  const major = listed ? listed.major : majorOfJava(customInfo && customInfo.version);
  const req = data?.required || null;
  let warn = null;
  if (current && major && req && major < req) warn = { bad: true, text: `Эта Java (${major}) старше, чем нужно для Minecraft ${instance.mcVersion} (Java ${req}). Game, скорее всего, не запустится.` };
  else if (current && major && req && req <= 8 && major > 8) warn = { bad: false, text: 'Старые версии Minecraft и моды для них часто не работают на новой Java. Если игра не запускается, верните «Автоматически».' };

  return (
    <div className="settings-row-block" style={{ marginTop: 28 }}>
      <label className="settings-block-label">Java для этой сборки</label>
      <Select value={current} onChange={pick} options={options} disabled={busy || !data} />
      {note && <p className={note.ok ? 'settings-block-hint' : 'error-text'} style={{ marginTop: 8 }}>{note.text}</p>}
      {warn && <p className={warn.bad ? 'error-text' : 'settings-block-hint'} style={{ marginTop: 8 }}>{warn.text}</p>}
      {!current && (
        <p className="settings-block-hint">
          {globalPath
            ? `В Настройках лаунчера задан общий путь к Java (${globalPath}): пока здесь «Автоматически», будет использована она.`
            : `Лаунчер сам скачает и использует Java${req ? ` ${req}` : ''}, подходящую для Minecraft ${instance.mcVersion}. Это самый надёжный вариант.`}
        </p>
      )}
      {current && (
        <p className="settings-block-hint" style={{ wordBreak: 'break-all' }}>Используется: {current}</p>
      )}
      <p className="settings-block-hint">Менять Java нужно только если так требует мод или сборка. Выбранная версия применяется при следующем запуске игры.</p>
    </div>
  );
}

function InstallTab({ instance, onInstallChanged }) {
  const [editing, setEditing] = useState(false);
  const [manifest, setManifest] = useState(null);
  const [mcVersion, setMcVersion] = useState(instance.mcVersion);
  const [loader, setLoader] = useState(instance.loader);
  const [loaderVersions, setLoaderVersions] = useState([]);
  const [loaderVersion, setLoaderVersion] = useState(instance.loaderVersion || '');
  const [savingInstall, setSavingInstall] = useState(false);

  const [repairing, setRepairing] = useState(false);
  const [repairProgress, setRepairProgress] = useState(null);
  const [repairError, setRepairError] = useState(null);
  const [repairDone, setRepairDone] = useState(false);

  useEffect(() => {
    if (!editing || manifest) return;
    window.api.mc.versionManifest().then(setManifest).catch(() => {});
  }, [editing]);

  const LOADER_FETCHERS = {
    fabric: window.api.mc.fabricLoaders,
    quilt: window.api.mc.quiltLoaders,
    forge: window.api.mc.forgeLoaders,
    neoforge: window.api.mc.neoforgeLoaders,
  };

  useEffect(() => {
    if (!editing || !mcVersion) return;
    const fetcher = LOADER_FETCHERS[loader];
    if (fetcher) {
      fetcher(mcVersion).then(setLoaderVersions).catch(() => setLoaderVersions([]));
    } else {
      setLoaderVersions([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, loader, mcVersion]);

  useEffect(() => {
    return window.api.instances.onRepairProgress((p) => {
      if (p.instanceId !== instance.id) return;
      if (p.stage === 'error') { setRepairError(p.error); setRepairing(false); }
      else if (p.stage === 'done') { setRepairing(false); setRepairDone(true); }
      else setRepairProgress(p);
    });
  }, [instance.id]);

  async function saveInstall() {
    setSavingInstall(true);
    const res = await window.api.instances.updateInstall(instance.id, {
      mcVersion, loader, loaderVersion: loader === 'vanilla' ? null : loaderVersion,
    });
    setSavingInstall(false);
    if (res.ok) { onInstallChanged(res.instance); setEditing(false); }
  }

  async function handleRepair() {
    setRepairing(true);
    setRepairError(null);
    setRepairDone(false);
    setRepairProgress(null);
    const res = await window.api.instances.repair(instance.id);
    if (!res.ok) { setRepairError(res.error); setRepairing(false); }
  }

  const versionList = useMemo(() => (manifest ? manifest.versions.filter((v) => v.type === 'release') : []), [manifest]);

  return (
    <div>
      <label className="settings-block-label">Сведения об установке</label>
      <div className="install-info-table">
        <div className="install-info-row"><span>Платформа</span><strong>{cap(instance.loader)}</strong></div>
        <div className="install-info-row"><span>Version игры</span><strong>{instance.mcVersion}</strong></div>
        {instance.loader !== 'vanilla' && instance.loader !== 'horizon' && (
          <div className="install-info-row"><span>Version {cap(instance.loader)}</span><strong>{instance.loaderVersion}</strong></div>
        )}
      </div>

      {instance.loader === 'horizon' ? (
        <HorizonVersionPicker instance={instance} onInstallChanged={onInstallChanged} />
      ) : !editing ? (
        <button className="btn" style={{ marginTop: 14 }} onClick={() => setEditing(true)}>
          <EditIcon width={15} height={15} /> Изменить
        </button>
      ) : (
        <div className="install-edit-form">
          <div className="field">
            <label>Loader</label>
            <Select value={loader} onChange={setLoader} options={LOADER_OPTIONS} />
          </div>
          <div className="field">
            <label>Version Minecraft</label>
            <Select
              value={mcVersion}
              onChange={setMcVersion}
              disabled={!manifest}
              options={manifest ? versionList.map((v) => ({ value: v.id, label: v.id })) : [{ value: mcVersion, label: mcVersion }]}
            />
          </div>
          {loader !== 'vanilla' && (
            <div className="field">
              <label>Version загрузчика</label>
              <Select
                value={loaderVersion}
                onChange={setLoaderVersion}
                disabled={loaderVersions.length === 0}
                placeholder="No доступных версий"
                options={loaderVersions.map((l) => ({ value: l.loaderVersion, label: l.loaderVersion }))}
              />
            </div>
          )}
          <div className="modal-actions" style={{ marginTop: 4 }}>
            <button className="btn" onClick={() => setEditing(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={saveInstall} disabled={savingInstall}>
              {savingInstall ? 'Сохранение…' : 'Save'}
            </button>
          </div>
        </div>
      )}
      {instance.loader !== 'horizon' && (
        <p className="settings-block-hint">
          Не рекомендуется изменять установку после добавления контента. Это может привести к ошибкам совместимости.
        </p>
      )}

      {instance.loader !== 'horizon' && <JavaPicker instance={instance} onChanged={onInstallChanged} />}

      <div className="settings-row-block" style={{ marginTop: 28 }}>
        <label className="settings-block-label">Исправление сборки</label>
        <button className="btn" onClick={handleRepair} disabled={repairing}>
          <WrenchIcon width={15} height={15} /> {repairing ? 'Проверка…' : 'Исправить'}
        </button>
        <p className="settings-block-hint">
          Переустанавливает зависимости Minecraft и восстанавливает повреждённые файлы. Может устранить проблемы с запуском.
        </p>
        {repairing && repairProgress && (
          <div className="progress-label">{repairProgress.stage}{repairProgress.total ? ` (${repairProgress.completed}/${repairProgress.total})` : ''}</div>
        )}
        {repairError && <div className="error-text">{repairError}</div>}
        {repairDone && <div style={{ color: 'var(--success)', fontSize: 13 }}>Done — файлы сборки проверены.</div>}
      </div>
    </div>
  );
}
