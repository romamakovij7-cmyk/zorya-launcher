import { useEffect, useMemo, useRef, useState } from 'react';
import Select from '../components/Select.jsx';
import { BoxIcon, GearIcon } from '../components/Icons.jsx';
import { formatDuration } from '../api/modrinth.js';
import { useContextMenuDismiss } from '../hooks/useContextMenuDismiss.js';
import { isRecapSeason, recapNow, recapYear } from '../utils/recap.js';

const DAY = 24 * 60 * 60 * 1000;
const WEEKDAYS_SHORT = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс']; // Monday first
const WEEKDAYS_LONG = ['понедельник', 'вторник', 'среду', 'четверг', 'пятницу', 'субботу', 'воскресенье'];
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

const PERIODS = [
  { id: '7', label: '7 дней', days: 7, prev: 'прошлых 7 дней' },
  { id: '30', label: '30 дней', days: 30, prev: 'прошлых 30 дней' },
  { id: '90', label: '90 дней', days: 90, prev: 'прошлых 90 дней' },
  { id: '365', label: '365 дней', days: 365, prev: 'прошлого года' },
  { id: 'all', label: 'Всё время', days: null },
];

const BLOCKS = [
  { id: 'cards', label: 'Карточки с итогами' },
  { id: 'chart', label: 'График' },
  { id: 'heatmap', label: 'Календарь активности за год' },
  { id: 'when', label: 'Когда вы играете (дни недели и часы)' },
  { id: 'top', label: 'Больше всего играли' },
  { id: 'facts', label: 'Интересные факты' },
];

const DEFAULT_PREFS = {
  period: '30', group: 'auto', metric: 'time', chart: 'bars',
  blocks: { cards: true, chart: true, heatmap: true, when: true, top: true, facts: true },
};
const PREFS_KEY = 'zorya.stats.prefs';

function loadPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
    if (saved && typeof saved === 'object') return { ...DEFAULT_PREFS, ...saved, blocks: { ...DEFAULT_PREFS.blocks, ...(saved.blocks || {}) } };
  } catch { /* unreadable — start from defaults */ }
  return DEFAULT_PREFS;
}

// ---- date helpers (all DST-safe: they step with setDate/setMonth, never +24h) ----
const startOfDay = (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
const addDays = (ts, n) => { const d = new Date(ts); d.setDate(d.getDate() + n); return d.getTime(); };
const weekStart = (ts) => addDays(startOfDay(ts), -((new Date(ts).getDay() + 6) % 7));
const monthStart = (ts) => { const d = new Date(ts); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); };
const bucketStart = (ts, mode) => (mode === 'day' ? startOfDay(ts) : mode === 'week' ? weekStart(ts) : monthStart(ts));
const nextBucket = (ts, mode) => {
  if (mode === 'day') return addDays(ts, 1);
  if (mode === 'week') return addDays(ts, 7);
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
};

function formatShort(ms) {
  const totalMin = Math.round(ms / 60000);
  if (totalMin < 1) return ms > 0 ? '<1 мин' : '0';
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} мин`;
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}
const formatTiny = (ms) => formatShort(ms).replace(' мин', 'м').replace(' ч ', 'ч ');
const fmtHour = (h) => `${String(h).padStart(2, '0')}:00`;

// Spreads a session's time over the hours it actually spans.
function addByHour(hours, start, durationMs) {
  let t = start;
  const end = start + durationMs;
  while (t < end) {
    const d = new Date(t);
    const hourEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1).getTime();
    const chunk = Math.min(end, hourEnd) - t;
    if (chunk <= 0) break;
    hours[d.getHours()] += chunk;
    t += chunk;
  }
}

function bucketLabel(ts, i, n, mode) {
  const d = new Date(ts);
  if (mode === 'day') {
    return { top: String(d.getDate()), sub: n <= 14 ? WEEKDAYS_SHORT[(d.getDay() + 6) % 7] : (d.getDate() === 1 || i === 0 ? MONTHS_SHORT[d.getMonth()] : '') };
  }
  if (mode === 'week') return { top: `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`, sub: '' };
  return { top: MONTHS_SHORT[d.getMonth()], sub: d.getMonth() === 0 || i === 0 ? String(d.getFullYear()) : '' };
}

function bucketTitle(ts, mode) {
  const d = new Date(ts);
  if (mode === 'day') return d.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
  if (mode === 'week') return `Неделя с ${d.toLocaleDateString('ru-RU')}`;
  return d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
}

const reduceMotion = () => document.documentElement.dataset.reduceMotion === 'true';

// Counts up to its value (and from the previous value when it changes), one
// requestAnimationFrame loop per number — only a handful on the page.
function Num({ value, format }) {
  const [shown, setShown] = useState(0);
  const shownRef = useRef(0);
  useEffect(() => {
    if (reduceMotion()) { shownRef.current = value; setShown(value); return undefined; }
    const from = shownRef.current;
    const start = performance.now();
    const duration = 750;
    let raf;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 3;
      shownRef.current = from + (value - from) * eased;
      setShown(shownRef.current);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{format(shown)}</>;
}

function MiniBars({
  values, labels, format, labelEvery = 1, title,
}) {
  const max = Math.max(...values, 1);
  const peak = values.indexOf(Math.max(...values));
  return (
    <div className="stats-mini">
      <div className="stats-mini-title">{title}</div>
      <div className="stats-mini-bars" style={{ gridTemplateColumns: `repeat(${values.length}, minmax(0, 1fr))` }}>
        {values.map((v, i) => (
          <div className="stats-mini-col" key={labels[i]} title={`${labels[i]}: ${v ? format(v) : 'не играли'}`}>
            <div
              className={`stats-mini-bar ${v === 0 ? 'zero' : ''} ${v > 0 && i === peak ? 'peak' : ''}`}
              style={{ height: v === 0 ? 3 : `${Math.max((v / max) * 100, 5)}%`, '--i': i }}
            />
          </div>
        ))}
      </div>
      <div className="stats-mini-axis" style={{ gridTemplateColumns: `repeat(${values.length}, minmax(0, 1fr))` }}>
        {labels.map((l, i) => <span key={l}>{i % labelEvery === 0 ? l : ''}</span>)}
      </div>
    </div>
  );
}

export default function Stats({ instances, onOpenRecap, onInstanceChanged }) {
  const [confirmClear, setConfirmClear] = useState(false); // "delete the statistics of this build" is asked twice
  const [clearing, setClearing] = useState(false);
  const [sessions, setSessions] = useState(null);
  const [deleted, setDeleted] = useState([]); // удалённые сборки: их время остаётся в статистике
  const [prefs, setPrefs] = useState(loadPrefs);
  const [instanceFilter, setInstanceFilter] = useState('all');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useContextMenuDismiss(settingsOpen, () => setSettingsOpen(false));

  useEffect(() => {
    window.api.stats.get().then((res) => {
      setSessions(res.ok ? res.sessions : []);
      setDeleted(res.ok && Array.isArray(res.deleted) ? res.deleted : []);
    });
    // The instance list is refreshed by App whenever a game session ends, so
    // re-reading the history then keeps the chart in step with the totals.
  }, [instances]);

  function updatePrefs(patch) {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* private mode — fine */ }
      return next;
    });
  }
  const toggleBlock = (id) => updatePrefs({ blocks: { ...prefs.blocks, [id]: !prefs.blocks[id] } });

  useEffect(() => { setConfirmClear(false); }, [instanceFilter]);

  // Deletes the statistics (time and sessions) of the build picked in "Instance:"; the build itself stays (a deleted build leaves the lists)
  async function clearSelected() {
    if (instanceFilter === 'all' || clearing) return;
    setClearing(true);
    try {
      const res = await window.api.stats.clearInstance(instanceFilter);
      if (res?.ok) {
        if (res.instance && onInstanceChanged) onInstanceChanged(res.instance);
        const fresh = await window.api.stats.get();
        setSessions(fresh.ok ? fresh.sessions : []);
        setDeleted(fresh.ok && Array.isArray(fresh.deleted) ? fresh.deleted : []);
        if (!res.instance) setInstanceFilter('all'); // a deleted build is gone from the list
      }
    } finally {
      setClearing(false);
      setConfirmClear(false);
    }
  }

  const { period, group, metric, chart: chartType, blocks } = prefs;
  const periodDef = PERIODS.find((p) => p.id === period) || PERIODS[1];
  // Живые сборки + удалённые (у них остались имя, иконка и общее время). Сессии удалённых без «визитки» (удалены до этой версии)
  // тоже не пропадают: они попадают в «Удалённая сборка».
  const allInstances = useMemo(() => {
    const known = new Set(instances.map((i) => i.id));
    const list = [...instances, ...deleted.filter((d) => !known.has(d.id)).map((d) => ({ ...d, deleted: true }))];
    const have = new Set(list.map((i) => i.id));
    const orphanIds = new Set((sessions || []).map((s) => s.instanceId).filter((id) => !have.has(id)));
    let idx = 0;
    for (const id of orphanIds) {
      idx += 1;
      const ms = (sessions || []).filter((s) => s.instanceId === id).reduce((sum, s) => sum + s.durationMs, 0);
      list.push({ id, name: orphanIds.size > 1 ? `Удалённая сборка ${idx}` : 'Удалённая сборка', icon: null, totalPlaytimeMs: ms, deleted: true });
    }
    return list;
  }, [instances, deleted, sessions]);
  const instById = useMemo(() => new Map(allInstances.map((i) => [i.id, i])), [allInstances]);

  const model = useMemo(() => {
    if (!sessions) return null;
    const today = startOfDay(Date.now());
    const rangeEnd = addDays(today, 1);
    const list = instanceFilter === 'all' ? sessions : sessions.filter((s) => s.instanceId === instanceFilter);

    // Session history only goes back to the first recorded game, so a 365-day
    // window on a young history would be a wall of empty bars. The chart starts
    // at the first recorded day instead (but never narrower than two weeks).
    const histStart = startOfDay(list.reduce((m, s) => Math.min(m, s.start), Date.now()));
    const nominalStart = periodDef.days ? addDays(today, -(periodDef.days - 1)) : null;
    let rangeStart;
    if (periodDef.days) rangeStart = Math.max(nominalStart, Math.min(histStart, addDays(today, -13)));
    else rangeStart = Math.min(histStart, addDays(today, -29));
    const trimmed = nominalStart !== null && rangeStart > nominalStart && list.length > 0;
    const span = Math.round((rangeEnd - rangeStart) / DAY);

    let mode = group === 'auto' ? (span <= 31 ? 'day' : span <= 120 ? 'week' : 'month') : group;
    if (mode === 'day' && span > 400) mode = 'week';
    if (mode === 'week' && span > 400 * 7) mode = 'month';

    const buckets = [];
    for (let t = bucketStart(rangeStart, mode); t < rangeEnd; t = nextBucket(t, mode)) buckets.push({ start: t, ms: 0, count: 0 });
    const bucketIdx = new Map(buckets.map((b, i) => [b.start, i]));

    const weekdayMs = new Array(7).fill(0);
    const hourMs = new Array(24).fill(0);
    const perInstance = new Map();
    const dayTotals = new Map(); // every day with any play, for the heatmap + best day
    const activeAll = new Set();
    let periodMs = 0;
    let periodCount = 0;
    let longest = 0;
    let prevMs = 0;
    // Only compare with the previous period when history covers all of it —
    // against a half-recorded window the percentage would be meaningless.
    const prevStart = periodDef.days ? addDays(addDays(today, -(periodDef.days - 1)), -periodDef.days) : null;
    const prevComparable = prevStart !== null && histStart <= prevStart;

    for (const s of list) {
      const day = startOfDay(s.start);
      activeAll.add(day);
      dayTotals.set(day, (dayTotals.get(day) || 0) + s.durationMs);
      if (prevComparable && s.start >= prevStart && s.start < nominalStart) prevMs += s.durationMs;
      if (s.start < rangeStart || s.start >= rangeEnd) continue;
      periodMs += s.durationMs;
      periodCount += 1;
      if (s.durationMs > longest) longest = s.durationMs;
      const b = buckets[bucketIdx.get(bucketStart(s.start, mode))];
      if (b) { b.ms += s.durationMs; b.count += 1; }
      weekdayMs[(new Date(s.start).getDay() + 6) % 7] += s.durationMs;
      addByHour(hourMs, s.start, s.durationMs);
      perInstance.set(s.instanceId, (perInstance.get(s.instanceId) || 0) + s.durationMs);
    }

    const activeInPeriod = [...dayTotals.keys()].filter((d) => d >= rangeStart && d < rangeEnd);
    let bestDay = null;
    for (const d of activeInPeriod) if (!bestDay || dayTotals.get(d) > bestDay.ms) bestDay = { day: d, ms: dayTotals.get(d) };

    let streak = 0;
    for (let c = activeAll.has(today) ? today : addDays(today, -1); activeAll.has(c); c = addDays(c, -1)) streak += 1;
    let bestStreak = 0;
    let run = 0;
    let prevDay = null;
    for (const d of [...activeAll].sort((a, b) => a - b)) {
      run = prevDay !== null && addDays(prevDay, 1) === d ? run + 1 : 1;
      if (run > bestStreak) bestStreak = run;
      prevDay = d;
    }

    // Heatmap: always the last 365 days, aligned to whole weeks.
    const heatStart = weekStart(addDays(today, -364));
    const heat = [];
    for (let t = heatStart, col = 0, row = 0; t <= today; t = addDays(t, 1)) {
      heat.push({ day: t, ms: dayTotals.get(t) || 0, col });
      row += 1;
      if (row === 7) { row = 0; col += 1; }
    }
    const heatMax = Math.max(...heat.map((h) => h.ms), 1);

    // Top builds: from the session history for a period, from the lifetime
    // totals for "all time" (those also cover time before history was kept).
    let top = [];
    if (instanceFilter === 'all') {
      top = periodDef.days
        ? [...perInstance].map(([id, ms]) => ({ inst: instById.get(id), ms })).filter((r) => r.inst)
        : allInstances.map((inst) => ({ inst, ms: inst.totalPlaytimeMs || 0 }));
      top = top.filter((r) => r.ms > 0).sort((a, b) => b.ms - a.ms).slice(0, 8);
    }

    // Time that has no dated sessions behind it: played in another launcher before the import, or before the history was kept. It is in the
    // total of the build (and in the all-time ranking) but cannot be put on a day, so it gets a block of its own.
    const histByInst = new Map();
    for (const s of sessions) histByInst.set(s.instanceId, (histByInst.get(s.instanceId) || 0) + s.durationMs);
    const prior = allInstances
      .filter((i) => instanceFilter === 'all' || i.id === instanceFilter)
      .map((inst) => ({ inst, ms: (inst.totalPlaytimeMs || 0) - (histByInst.get(inst.id) || 0) }))
      .filter((r) => r.ms >= 5 * 60000)
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 8);

    const allTimeMs = instanceFilter === 'all'
      ? allInstances.reduce((sum, i) => sum + (i.totalPlaytimeMs || 0), 0)
      : (instById.get(instanceFilter)?.totalPlaytimeMs || 0);

    return {
      mode, buckets, trimmed, rangeStart, periodMs, periodCount, prevMs, longest, weekdayMs, hourMs, bestDay, streak, bestStreak,
      activeDays: activeInPeriod.length, span, heat, heatMax, heatStart, top, prior, allTimeMs, hasHistory: list.length > 0,
    };
  }, [sessions, instances, allInstances, instById, instanceFilter, periodDef, group]);

  if (!model) return <div className="progress-label">Loading…</div>;

  const valueOf = (b) => (metric === 'time' ? b.ms : b.count);
  const fmtValue = (v) => (metric === 'time' ? formatShort(v) : `${v}`);
  const n = model.buckets.length;
  const chartMax = Math.max(...model.buckets.map(valueOf), metric === 'time' ? 60000 : 1);
  const labelStep = n > 16 ? Math.ceil(n / 14) : 1;
  const showValues = n <= 16;
  const animKey = `${period}|${group}|${metric}|${chartType}|${instanceFilter}`;

  const peakHour = model.hourMs.some((v) => v > 0) ? model.hourMs.indexOf(Math.max(...model.hourMs)) : null;
  const peakWeekday = model.weekdayMs.some((v) => v > 0) ? model.weekdayMs.indexOf(Math.max(...model.weekdayMs)) : null;
  const heatWeeks = model.heat[model.heat.length - 1].col + 1;
  const topMax = model.top[0]?.ms || 1;
  const topTotal = model.top.reduce((s, r) => s + r.ms, 0) || 1;

  const delta = periodDef.days && model.prevMs > 0 ? Math.round(((model.periodMs - model.prevMs) / model.prevMs) * 100) : null;
  const avgPerActiveDay = model.activeDays ? model.periodMs / model.activeDays : 0;

  const cards = [
    { label: instanceFilter === 'all' ? 'Total playtime' : 'Всего в этой сборке', value: model.allTimeMs, format: formatTiny },
    {
      label: periodDef.days ? `За ${periodDef.label}` : 'За всё время',
      value: model.periodMs,
      format: formatTiny,
      note: delta !== null ? (
        <span className={`stat-delta ${delta >= 0 ? 'up' : 'down'}`}>{delta >= 0 ? '▲' : '▼'} {Math.abs(delta)}% к {periodDef.prev}</span>
      ) : (!periodDef.days && model.allTimeMs > model.periodMs + 60000 ? 'Подробная история ведётся с первого записанного запуска' : null),
    },
    { label: 'Сессий', value: model.periodCount, format: (v) => `${Math.round(v)}` },
    {
      label: 'Активных дней', value: model.activeDays, format: (v) => `${Math.round(v)}`, note: `из ${model.span}`,
    },
    {
      label: 'Дней подряд', value: model.streak, format: (v) => `${Math.round(v)}`, note: model.bestStreak > 0 ? `рекорд: ${model.bestStreak}` : null,
    },
    { label: 'В среднем за день', value: avgPerActiveDay, format: formatTiny, note: 'по дням, когда играли' },
    ...(instanceFilter === 'all' ? [{ label: 'Сборок', value: instances.length, format: (v) => `${Math.round(v)}` }] : []),
  ];

  return (
    <div className="stats-page">
      <div className="page-header stats-header">
        <h1>Stats</h1>
        <div className="stats-header-right">
          {onOpenRecap && isRecapSeason(recapNow()) && (
            <button className="btn btn-primary" onClick={onOpenRecap}>Итоги {recapYear(recapNow())}</button>
          )}
          <div className="pill-tabs stats-period-tabs">
            {PERIODS.map((p) => (
              <button key={p.id} className={`pill-tab ${period === p.id ? 'active' : ''}`} onClick={() => updatePrefs({ period: p.id })}>{p.label}</button>
            ))}
          </div>
          <div className="stats-settings-wrap" ref={settingsRef}>
            <button className={`icon-btn ${settingsOpen ? 'accent' : ''}`} title="Что показывать" onClick={() => setSettingsOpen((v) => !v)}>
              <GearIcon width={18} height={18} />
            </button>
            {settingsOpen && (
              <div className="stats-settings-pop">
                <div className="stats-settings-title">Что показывать</div>
                {BLOCKS.map((b) => (
                  <label className="stats-settings-row" key={b.id}>
                    <span>{b.label}</span>
                    <input type="checkbox" className="switch small" checked={!!blocks[b.id]} onChange={() => toggleBlock(b.id)} />
                  </label>
                ))}
                <button className="btn-text" style={{ marginTop: 6 }} onClick={() => updatePrefs({ blocks: DEFAULT_PREFS.blocks })}>Show всё</button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="stats-toolbar">
        <div className="select-chip">
          Instance:
          <Select
            value={instanceFilter}
            onChange={setInstanceFilter}
            options={[{ value: 'all', label: 'All instances' }, ...[...allInstances].sort((a, b) => (a.deleted === b.deleted ? a.name.localeCompare(b.name, 'ru') : a.deleted ? 1 : -1)).map((i) => ({ value: i.id, label: i.deleted ? `${i.name} (удалена)` : i.name }))]}
          />
        </div>
        {instanceFilter !== 'all' && (
          confirmClear ? (
            <span className="stats-clear-confirm">
              Delete всю статистику этой сборки?
              <button className="btn btn-danger" onClick={clearSelected} disabled={clearing}>{clearing ? 'Удаляем…' : 'Yes, удалить'}</button>
              <button className="btn" onClick={() => setConfirmClear(false)} disabled={clearing}>Cancel</button>
            </span>
          ) : (
            <button className="btn" onClick={() => setConfirmClear(true)} title="Delete время игры и историю запусков только этой сборки. Сама сборка и её файлы не затрагиваются.">Delete статистику сборки</button>
          )
        )}
        <div className="select-chip">
          Группировка:
          <Select
            value={group}
            onChange={(v) => updatePrefs({ group: v })}
            options={[{ value: 'auto', label: 'Auto' }, { value: 'day', label: 'По дням' }, { value: 'week', label: 'По неделям' }, { value: 'month', label: 'По месяцам' }]}
          />
        </div>
        <div className="pill-tabs stats-mini-tabs">
          <button className={`pill-tab ${metric === 'time' ? 'active' : ''}`} onClick={() => updatePrefs({ metric: 'time' })}>Time</button>
          <button className={`pill-tab ${metric === 'sessions' ? 'active' : ''}`} onClick={() => updatePrefs({ metric: 'sessions' })}>Сессии</button>
        </div>
        <div className="pill-tabs stats-mini-tabs">
          <button className={`pill-tab ${chartType === 'bars' ? 'active' : ''}`} onClick={() => updatePrefs({ chart: 'bars' })}>Столбцы</button>
          <button className={`pill-tab ${chartType === 'line' ? 'active' : ''}`} onClick={() => updatePrefs({ chart: 'line' })}>Линия</button>
        </div>
      </div>

      {blocks.cards && (
        <div className="stats-grid">
          {cards.map((c, i) => (
            <div className="stat-card" key={c.label} style={{ '--i': i }}>
              <div className="stat-card-label">{c.label}</div>
              <div className="stat-card-value"><Num value={c.value} format={c.format} /></div>
              {c.note && <div className="stat-card-note">{c.note}</div>}
            </div>
          ))}
        </div>
      )}

      {blocks.chart && (
        <>
          <h2 className="section-heading">
            {metric === 'time' ? 'Time в игре' : 'Количество сессий'} · {model.trimmed ? `с ${new Date(model.rangeStart).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}` : periodDef.label.toLowerCase()}
          </h2>
          <div className="stats-chart2" key={animKey}>
            <div className="stats2-plot">
              {chartType === 'bars' ? (
                <div className={`stats2-cols ${n > 60 ? 'many' : ''}`} style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
                  {model.buckets.map((b, i) => {
                    const v = valueOf(b);
                    const pct = v > 0 ? Math.max((v / chartMax) * 100, 3) : 0;
                    return (
                      <div className="stats2-col" key={b.start} title={`${bucketTitle(b.start, model.mode)}: ${v ? fmtValue(v) : 'не играли'}`}>
                        {showValues && v > 0 && <span className="stats2-val" style={{ bottom: `calc(${pct}% + 3px)`, '--i': i }}>{metric === 'time' ? formatTiny(v) : v}</span>}
                        <div className={`stats2-bar ${v === 0 ? 'zero' : ''}`} style={{ height: v === 0 ? 3 : `${pct}%`, '--i': i }} />
                      </div>
                    );
                  })}
                </div>
              ) : (
                <>
                  <svg className="stats2-line" viewBox="0 0 1000 200" preserveAspectRatio="none">
                    {(() => {
                      // x at each column's centre, so the points sit right over their axis labels
                      const pts = model.buckets.map((b, i) => [((i + 0.5) / n) * 1000, 190 - (valueOf(b) / chartMax) * 170]);
                      const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
                      return (
                        <>
                          <defs>
                            <linearGradient id="statsArea" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="var(--rose)" stopOpacity="0.38" />
                              <stop offset="100%" stopColor="var(--rose)" stopOpacity="0" />
                            </linearGradient>
                          </defs>
                          <path className="stats2-area" d={`${d} L${pts[pts.length - 1][0]} 200 L${pts[0][0]} 200 Z`} fill="url(#statsArea)" />
                          <path className="stats2-stroke" d={d} fill="none" />
                        </>
                      );
                    })()}
                  </svg>
                  <div className="stats2-hits" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
                    {model.buckets.map((b) => {
                      const v = valueOf(b);
                      return <div className="stats2-hit" key={b.start} title={`${bucketTitle(b.start, model.mode)}: ${v ? fmtValue(v) : 'не играли'}`} />;
                    })}
                  </div>
                </>
              )}
            </div>
            <div className="stats2-axis" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
              {model.buckets.map((b, i) => {
                const l = bucketLabel(b.start, i, n, model.mode);
                const show = i % labelStep === 0;
                return (
                  <div className="stats2-axis-cell" key={b.start}>
                    <span>{show ? l.top : ''}</span>
                    <small>{show ? l.sub : ''}</small>
                  </div>
                );
              })}
            </div>
          </div>
          {!model.hasHistory && (
            <p className="hint-text">График начинает заполняться с первой записанной сессии — запустите игру, и здесь появятся данные. Общее время по сборкам учитывается с самого начала.</p>
          )}
          {model.trimmed && (
            <p className="hint-text">Подробная история сессий ведётся с {new Date(model.rangeStart).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })} — раньше данных нет, поэтому график начинается с этого дня и будет расти по мере игры.</p>
          )}
        </>
      )}

      {blocks.heatmap && (
        <>
          <h2 className="section-heading">Календарь активности · 365 дней</h2>
          <div className="stats-heat-card">
            <div className="stats-heat-scroll">
              <div className="stats-heat-wrap">
                <div className="stats-heat-days"><span>пн</span><span /><span>ср</span><span /><span>пт</span><span /><span /></div>
                <div className="stats-heat-main">
                  <div className="stats-heat-months">
                    {(() => {
                      // A label above the first Monday of each month; the very first
                      // column only gets one if the next month starts far enough away.
                      const labels = model.heat.filter((h) => new Date(h.day).getDay() === 1 && new Date(h.day).getDate() <= 7);
                      if (!labels.length || labels[0].col >= 3) labels.unshift(model.heat[0]);
                      return labels.map((h) => <span key={h.day} style={{ left: `${(h.col / heatWeeks) * 100}%` }}>{MONTHS_SHORT[new Date(h.day).getMonth()]}</span>);
                    })()}
                  </div>
                  <div className="stats-heat-grid" key={instanceFilter} style={{ gridTemplateColumns: `repeat(${heatWeeks}, minmax(0, 1fr))` }}>
                    {model.heat.map((h) => {
                      const lvl = h.ms === 0 ? 0 : h.ms < model.heatMax * 0.25 ? 1 : h.ms < model.heatMax * 0.5 ? 2 : h.ms < model.heatMax * 0.75 ? 3 : 4;
                      return (
                        <div
                          key={h.day}
                          className={`stats-heat-cell lvl${lvl}`}
                          style={{ '--c': h.col }}
                          title={`${new Date(h.day).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}: ${h.ms ? formatShort(h.ms) : 'не играли'}`}
                        />
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
            <div className="stats-heat-legend">
              <span>меньше</span>
              {[0, 1, 2, 3, 4].map((l) => <i key={l} className={`stats-heat-cell lvl${l}`} />)}
              <span>больше</span>
            </div>
          </div>
        </>
      )}

      {blocks.when && model.periodMs > 0 && (
        <>
          <h2 className="section-heading">Когда вы играете</h2>
          <div className="stats-when" key={`${period}|${instanceFilter}`}>
            <MiniBars title="По дням недели" values={model.weekdayMs} labels={WEEKDAYS_SHORT} format={formatShort} />
            <MiniBars title="По часам суток" values={model.hourMs} labels={model.hourMs.map((_, h) => String(h))} labelEvery={3} format={formatShort} />
          </div>
        </>
      )}

      {blocks.facts && model.periodCount > 0 && (
        <div className="stats-facts">
          <div><span>Самая долгая сессия</span><strong>{formatShort(model.longest)}</strong></div>
          <div><span>Средняя сессия</span><strong>{formatShort(model.periodMs / model.periodCount)}</strong></div>
          {model.bestDay && <div><span>Лучший день</span><strong>{new Date(model.bestDay.day).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })} · {formatShort(model.bestDay.ms)}</strong></div>}
          {peakWeekday !== null && <div><span>Чаще всего играете в</span><strong>{WEEKDAYS_LONG[peakWeekday]}</strong></div>}
          {peakHour !== null && <div><span>Любимое время</span><strong>{fmtHour(peakHour)}–{fmtHour((peakHour + 1) % 24)}</strong></div>}
          {model.top[0] && <div><span>Любимая сборка</span><strong>{model.top[0].inst.name}</strong></div>}
        </div>
      )}

      {blocks.top && periodDef.days && model.prior.length > 0 && (
        <>
          <h2 className="section-heading">Играли раньше</h2>
          <p className="hint-text">Time без дат: перенесённое при импорте из другого лаунчера или сыгранное до того, как Zorya стал вести историю. В графики по дням оно не входит, но учтено в «Total playtime» и в рейтинге за всё время.</p>
          <div className="stats-top">
            {model.prior.map((row, idx) => (
              <div className="stats-top-row" key={row.inst.id} style={{ '--i': idx }}>
                <span className="stats-top-rank">{idx + 1}</span>
                <div className="stats-top-icon">
                  {row.inst.icon ? <img src={row.inst.icon} alt="" /> : <BoxIcon width={18} height={18} />}
                </div>
                <div className="stats-top-main">
                  <div className="stats-top-name">{row.inst.name}{row.inst.deleted && <small className="stats-top-gone"> · удалена</small>}</div>
                  <div className="stats-top-bar"><div style={{ '--p': row.ms / (model.prior[0].ms || 1) }} /></div>
                </div>
                <span className="stats-top-time">{formatDuration(row.ms)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {blocks.top && instanceFilter === 'all' && (
        <>
          <h2 className="section-heading">Больше всего играли{periodDef.days ? ` · ${periodDef.label.toLowerCase()}` : ''}</h2>
          {model.top.length === 0 ? (
            <div className="empty-state"><p>{periodDef.days ? 'За этот период никто не играл.' : 'Пока никто не играл — статистика появится после первого запуска.'}</p></div>
          ) : (
            <div className="stats-top" key={period}>
              {model.top.map((row, idx) => (
                <div className="stats-top-row" key={row.inst.id} style={{ '--i': idx }}>
                  <span className="stats-top-rank">{idx + 1}</span>
                  <div className="stats-top-icon">
                    {row.inst.icon ? <img src={row.inst.icon} alt="" /> : <BoxIcon width={18} height={18} />}
                  </div>
                  <div className="stats-top-main">
                    <div className="stats-top-name">{row.inst.name}{row.inst.deleted && <small className="stats-top-gone"> · удалена</small>}</div>
                    <div className="stats-top-bar"><div style={{ '--p': row.ms / topMax }} /></div>
                  </div>
                  <span className="stats-top-time">{formatDuration(row.ms)}<small>{Math.round((row.ms / topTotal) * 100)}%</small></span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
