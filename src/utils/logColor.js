// Раскраска строк консоли игры. Строка делится на части с классами lg-*, цвета лежат в CSS (.log-view .lg-*).
// Форматы, которые встречаются:
//   [12:34:56] [Render thread/INFO]: Message            — vanilla / Fabric
//   [12:34:56] [main/WARN] [net.minecraft.Foo]: Message — Forge
//   [12:34:56 INFO]: Message                           — старые версии и серверы
//   [launcher] ...                                     — сообщения самого лаунчера
//   \tat a.b.C.method(C.java:12)  /  Caused by: ...     — стек ошибки

const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;
const LEVEL_IN_LINE = /(?:\/|\s)(INFO|WARN|WARNING|ERROR|SEVERE|DEBUG|FATAL|TRACE)\]/i;
const GROUP = /^(\[[^\]\n]*\]|\([^)\n]*\))/;
const TIME = /^\[?\d{1,2}[:.]\d{2}[:.]\d{2}(?:[.,]\d+)?\]?$|^\[\d{2}[A-Za-z]{3}\d{4} [\d:.]+\]$/;
const EXC = /\b((?:[a-zA-Z_$][\w$]*\.)+[A-Z][\w$]*(?:Exception|Error|Throwable)|[A-Z][\w$]*(?:Exception|Error))\b/g;
const OK_WORDS = /\bDone \([\d.,]+s\)|\bLoaded \d+ mods?\b|\bSuccessfully\b|\bStopping the server\b|\bSaving worlds\b/i;

export const normLevel = (s) => {
  const v = String(s || '').toUpperCase();
  if (v === 'WARNING') return 'WARN';
  if (v === 'SEVERE') return 'ERROR';
  return v;
};

// Уровень строки: of самой строки; у продолжений (стек, пустые, с отступом) — как у предыдущей
export function lineLevel(line, prev) {
  const m = LEVEL_IN_LINE.exec(line);
  if (m) return normLevel(m[1]);
  if (/^\[launcher\]/i.test(line)) return /fail|error|mistake|failed/i.test(line) ? 'ERROR' : 'LAUNCHER';
  if (/^\s+at\s|^\s*\.\.\. \d+ more|^\s*Caused by:|^\s*Suppressed:|^\s*$|^\s/.test(line)) return prev === 'ERROR' || prev === 'WARN' || prev === 'FATAL' ? prev : null;
  return null;
}

function splitExceptions(text, cls) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(EXC)) {
    if (m.index > last) out.push({ t: text.slice(last, m.index), c: cls });
    out.push({ t: m[0], c: 'lg-exc' });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ t: text.slice(last), c: cls });
  return out.length ? out : [{ t: text, c: cls }];
}

// Строка длиннее этого красится только в начале (дальше — обычным текстом): шаблоны ниже на мегабайтной строке без переводов
// строк (мод может напечатать что угодно) работали бы минуты.
const MAX_COLORED = 1500;

export function colorize(rawLine, level) {
  if (rawLine.length > MAX_COLORED) {
    const head = colorize(rawLine.slice(0, MAX_COLORED), level);
    head.push({ t: rawLine.slice(MAX_COLORED), c: '' });
    return head;
  }
  const line = rawLine.replace(ANSI, '');
  if (/^\s+at\s/.test(line)) return [{ t: line, c: 'lg-stack' }];
  if (/^\s*\.\.\. \d+ (?:more|common frames omitted)/.test(line)) return [{ t: line, c: 'lg-stack' }];
  const caused = /^(\s*)(Caused by|Suppressed):\s?(.*)$/.exec(line);
  if (caused) return [{ t: `${caused[1]}${caused[2]}: `, c: 'lg-caused' }, ...splitExceptions(caused[3], 'lg-error')];

  const segs = [];
  let rest = line;
  let guard = 0;
  // ведущие скобочные группы: время, поток/уровень, источник
  while (guard++ < 5) {
    const m = GROUP.exec(rest);
    if (!m) break;
    const g = m[1];
    const inner = g.slice(1, -1);
    let cls = 'lg-src';
    const hasLevel = LEVEL_IN_LINE.test(g) || /^(?:INFO|WARN|WARNING|ERROR|SEVERE|DEBUG|FATAL|TRACE)$/i.test(inner);
    if (!hasLevel && (TIME.test(g) || /^\d{1,2}:\d{2}:\d{2}/.test(inner))) cls = 'lg-time';
    else if (/^launcher$/i.test(inner)) cls = 'lg-launcher';
    else if (hasLevel) {
      const lv = normLevel((/(INFO|WARN|WARNING|ERROR|SEVERE|DEBUG|FATAL|TRACE)/i.exec(g) || [])[1]);
      // "[12:34:56 INFO]" — время и уровень вместе
      const tm = /^(\d{1,2}:\d{2}:\d{2}(?:[.,]\d+)?)\s+(\w+)$/.exec(inner);
      if (tm) { segs.push({ t: `[${tm[1]} `, c: 'lg-time' }, { t: `${tm[2]}]`, c: `lg-badge lg-${lv.toLowerCase()}` }); rest = rest.slice(g.length); continue; }
      const th = /^(.*?)\/(\w+)$/.exec(inner);
      if (th) { segs.push({ t: `[${th[1]}/`, c: 'lg-thread' }, { t: `${th[2]}]`, c: `lg-badge lg-${lv.toLowerCase()}` }); rest = rest.slice(g.length); continue; }
      cls = `lg-badge lg-${lv.toLowerCase()}`;
    } else if (g.startsWith('(')) cls = 'lg-src';
    segs.push({ t: g, c: cls });
    const sp = /^\s*/.exec(rest.slice(g.length))[0];
    if (sp) segs.push({ t: sp, c: '' });
    rest = rest.slice(g.length + sp.length);
  }
  const colon = /^:\s?/.exec(rest);
  if (colon) { segs.push({ t: colon[0], c: 'lg-dim' }); rest = rest.slice(colon[0].length); }
  const msgCls = level === 'ERROR' || level === 'FATAL' ? 'lg-error' : level === 'WARN' ? 'lg-warn' : level === 'DEBUG' || level === 'TRACE' ? 'lg-debug' : level === 'LAUNCHER' ? 'lg-launcher-msg' : OK_WORDS.test(rest) ? 'lg-ok' : '';
  segs.push(...splitExceptions(rest, msgCls));
  return segs;
}
