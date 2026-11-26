// «Итоги года»: считаются из истории сессий (playSessions: { instanceId, start, durationMs }) и списка сборок. Чистые функции: ничего не
// читают и не пишут, кроме подсказки «показывали ли сегодня» и необязательной подмены даты для проверки.
const HOUR = 60 * 60 * 1000;
const SHOWN_KEY = 'zorya.recap.shown';
const FAKE_DATE_KEY = 'zorya.recap.fakeDate'; // 'ГГГГ-ММ-ДД': показать, как будто сегодня этот день (для проверки)

// «Сегодня» для итогов
export function recapNow() {
  try {
    const f = localStorage.getItem(FAKE_DATE_KEY);
    if (f && /^\d{4}-\d{2}-\d{2}$/.test(f)) return new Date(`${f}T12:00:00`);
  } catch { /* storage not available */ }
  return new Date();
}

// 28 декабря: итоги всплывают сами
export const isRecapDay = (d) => d.getMonth() === 11 && d.getDate() === 28;
// Неделя итогов: с 25 по 31 декабря (7 дней) их можно открыть с главного экрана и из «Статистики»
export const RECAP_FIRST_DAY = 25;
export const isRecapSeason = (d) => d.getMonth() === 11 && d.getDate() >= RECAP_FIRST_DAY;
export const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function wasShownToday(now) {
  try { return localStorage.getItem(SHOWN_KEY) === dayKey(now); } catch { return false; }
}
export function markShown(now) {
  try { localStorage.setItem(SHOWN_KEY, dayKey(now)); } catch { /* ignore */ }
}

const WEEKDAYS = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье']; // с понедельника
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const LOTR_MS = 11.4 * HOUR; // «Властелин колец», расширенные версии трёх фильмов подряд

// За какой год итоги: в январе это прошлый год (итоги открываются из «Статистики» до конца января)
export const recapYear = (now) => (now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear());

export function computeRecap(sessions, instances, now = new Date()) {
  const year = recapYear(now);
  const from = new Date(year, 0, 1).getTime();
  // до конца года; в течение года — до сейчас (сессия, идущая прямо сейчас, тоже не теряется)
  const to = year < now.getFullYear() ? new Date(year + 1, 0, 1).getTime() : now.getTime() + HOUR;
  const byInst = new Map();
  const byVersion = new Map();
  const byLoader = new Map();
  const hours = new Array(24).fill(0);
  const weekdays = new Array(7).fill(0);
  const months = new Array(12).fill(0);
  const days = new Map(); // 'ГГГГ-ММ-ДД' -> мс
  const info = new Map((instances || []).map((i) => [i.id, i]));
  let total = 0;
  let count = 0;
  let longest = null;

  for (const s of Array.isArray(sessions) ? sessions : []) {
    if (!s || !Number.isFinite(s.start) || !Number.isFinite(s.durationMs) || s.durationMs <= 0) continue;
    if (s.start < from || s.start >= to) continue;
    count += 1;
    total += s.durationMs;
    if (!longest || s.durationMs > longest.durationMs) longest = { start: s.start, durationMs: s.durationMs, instanceId: s.instanceId };
    byInst.set(s.instanceId, (byInst.get(s.instanceId) || 0) + s.durationMs);
    const inst = info.get(s.instanceId);
    if (inst) {
      if (inst.mcVersion) byVersion.set(inst.mcVersion, (byVersion.get(inst.mcVersion) || 0) + s.durationMs);
      const loader = inst.loader || 'vanilla';
      byLoader.set(loader, (byLoader.get(loader) || 0) + s.durationMs);
    }
    // время делится по часам, в которые игра действительно шла (сессия может пересекать полночь)
    let t = s.start;
    const end = s.start + s.durationMs;
    while (t < end) {
      const d = new Date(t);
      const hourEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1).getTime();
      const chunk = Math.min(end, hourEnd) - t;
      if (chunk <= 0) break;
      hours[d.getHours()] += chunk;
      weekdays[(d.getDay() + 6) % 7] += chunk;
      if (d.getFullYear() === year) months[d.getMonth()] += chunk;
      const k = dayKey(d);
      days.set(k, (days.get(k) || 0) + chunk);
      t += chunk;
    }
  }

  const argmax = (arr) => arr.reduce((best, v, i) => (v > arr[best] ? i : best), 0);
  const top = [...byInst.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id, ms]) => {
    const inst = info.get(id);
    return { id, ms, share: total ? ms / total : 0, name: inst ? inst.name : 'Удалённая сборка', icon: inst?.icon || null, mcVersion: inst?.mcVersion || '', loader: inst?.loader || '' };
  });
  const pickTop = (m) => { const e = [...m.entries()].sort((a, b) => b[1] - a[1])[0]; return e ? { name: e[0], ms: e[1], share: total ? e[1] / total : 0 } : null; };

  // самая длинная серия дней подряд
  const keys = [...days.keys()].sort();
  let streak = 0;
  let bestStreak = 0;
  let prev = null;
  for (const k of keys) {
    const [y, m, dd] = k.split('-').map(Number);
    const cur = new Date(y, m - 1, dd);
    if (prev && Math.round((cur - prev) / (24 * HOUR)) === 1) streak += 1; else streak = 1;
    if (streak > bestStreak) bestStreak = streak;
    prev = cur;
  }

  let bestDay = null;
  for (const [k, ms] of days) if (!bestDay || ms > bestDay.ms) bestDay = { key: k, ms };
  const night = hours.slice(0, 6).reduce((a, b) => a + b, 0);
  const morning = hours.slice(6, 12).reduce((a, b) => a + b, 0);
  const evening = hours.slice(18, 24).reduce((a, b) => a + b, 0);
  let type = 'Дневной игрок';
  if (total > 0) {
    if (night / total >= 0.28) type = 'Ночная сова';
    else if (morning / total >= 0.4) type = 'Жаворонок';
    else if (evening / total >= 0.45) type = 'Вечерний игрок';
  }

  return {
    year,
    total,
    count,
    activeDays: days.size,
    average: count ? total / count : 0,
    longest,
    longestName: longest ? (info.get(longest.instanceId)?.name || 'Удалённая сборка') : '',
    top,
    version: pickTop(byVersion),
    loader: pickTop(byLoader),
    hours,
    weekdays,
    months,
    peakHour: argmax(hours),
    favWeekday: argmax(weekdays),
    favWeekdayName: WEEKDAYS[argmax(weekdays)],
    busiestMonth: argmax(months),
    busiestMonthName: MONTHS[argmax(months)],
    bestDay,
    bestStreak,
    type,
    lotr: total / LOTR_MS,
    empty: total < 10 * 60 * 1000, // меньше 10 минут за год: итогов нет
  };
}

// Склонение: plural(5, 'час', 'часа', 'часов')
export function plural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
