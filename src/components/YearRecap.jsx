// «Results of the year»: листаемые карточки (как истории) про то, как человек играл в этом году. Открываются сами 28 декабря, а всю неделю 25–31 декабря
// и с главного экрана, и of «Статистики».
// Считает src/utils/recap.js of истории сессий; в конце картинка-карточка, которую можно сохранить и выложить.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { computeRecap, plural } from '../utils/recap.js';
import { BoxIcon } from './Icons.jsx';
import { NickText } from './PremiumButton.jsx';
import { bytesToDataUrl } from '../utils/thumbs.js';

const SLIDE_MS = 7000;
const reduceMotion = () => document.documentElement.dataset.reduceMotion === 'true';
const hoursOf = (ms) => ms / 3600000;
// Game time в часах, без «дней» (в итогах «9 дней» про игру читается странно): 45 мин, 3 ч 20 мин, 216 ч
function dur(ms) {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${Math.max(1, min)} mine`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h >= 10 || !m ? `${h} ?` : `${h} ? ${m} mine`;
}

// Число, которое «набегает» до значения
function Count({ value, decimals = 0, suffix = '' }) {
  const [shown, setShown] = useState(reduceMotion() ? value : 0);
  useEffect(() => {
    if (reduceMotion()) { setShown(value); return undefined; }
    const start = performance.now();
    let raf;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / 1100);
      setShown(value * (1 - (1 - t) ** 3));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{shown.toFixed(decimals).replace('.', ',')}{suffix}</>;
}

function Bars({ values, highlight, labels, height = 96 }) {
  const max = Math.max(1, ...values);
  return (
    <div className="yr-bars" style={{ height }}>
      {values.map((v, i) => (
        <div className="yr-bar-col" key={i} title={labels ? `${labels[i]}: ${dur(v)}` : undefined}>
          <div className={`yr-bar ${i === highlight ? 'hot' : ''}`} style={{ height: `${Math.max(v > 0 ? 4 : 0, (v / max) * 100)}%`, animationDelay: `${i * 22}ms` }} />
        </div>
      ))}
    </div>
  );
}

function loadImg(src) {
  return new Promise((resolve) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => resolve(null);
    im.src = src;
  });
}

function rr(c, x, y, w, h, r) {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
}

// Картинка для публикации: 1080 × 1350. Сверху кадр of the game (случайный скриншот; без него — ночная сцена), поверх ник и тип игрока,
// дальше главное число, график month-by-month и плитки с цифрами года.
function drawCard(canvas, r, nick, shot) {
  const W = 1080;
  const H = 1350;
  canvas.width = W; canvas.height = H;
  const c = canvas.getContext('2d');
  const HERO = 620;

  // фон
  const bg = c.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#2a0f1f'); bg.addColorStop(0.5, '#150a14'); bg.addColorStop(1, '#0d060c');
  c.fillStyle = bg; c.fillRect(0, 0, W, H);
  const glow = (x, y, rad, col) => { const g = c.createRadialGradient(x, y, 0, x, y, rad); g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(0, 0, W, H); };
  glow(960, 700, 520, 'rgba(255,120,170,0.20)');
  glow(120, 1180, 480, 'rgba(255,200,120,0.10)');

  // верх: кадр of the game или ночная сцена
  c.save();
  c.beginPath(); c.rect(0, 0, W, HERO); c.clip();
  if (shot) {
    const s = Math.max(W / shot.width, HERO / shot.height);
    const sw = shot.width * s; const sh = shot.height * s;
    c.drawImage(shot, (W - sw) / 2, (HERO - sh) / 2, sw, sh);
    c.fillStyle = 'rgba(20,8,20,0.18)'; c.fillRect(0, 0, W, HERO);
  } else {
    const sky = c.createLinearGradient(0, 0, 0, HERO);
    sky.addColorStop(0, '#1b0d24'); sky.addColorStop(1, '#5a2347');
    c.fillStyle = sky; c.fillRect(0, 0, W, HERO);
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 90; i += 1) { c.fillStyle = `rgba(255,255,255,${0.15 + rnd() * 0.55})`; const s = 2 + Math.floor(rnd() * 3); c.fillRect(Math.floor(rnd() * W), Math.floor(rnd() * 360), s, s); }
    c.fillStyle = '#f7e9c9'; c.fillRect(820, 110, 96, 96); c.fillStyle = 'rgba(0,0,0,0.12)'; c.fillRect(842, 134, 26, 26);
    c.fillStyle = '#7a2f55';
    for (let x = 0; x < W; x += 40) { const h = 150 + Math.round(Math.sin(x / 140) * 50 + Math.sin(x / 57) * 20); c.fillRect(x, HERO - h, 40, h); }
  }
  // затемнение внof, чтобы кадр плавно уходил в фон
  const fade = c.createLinearGradient(0, HERO - 300, 0, HERO);
  fade.addColorStop(0, 'rgba(21,10,20,0)'); fade.addColorStop(1, 'rgba(21,10,20,1)');
  c.fillStyle = fade; c.fillRect(0, HERO - 300, W, 300);
  const top = c.createLinearGradient(0, 0, 0, 200);
  top.addColorStop(0, 'rgba(13,6,12,0.65)'); top.addColorStop(1, 'rgba(13,6,12,0)');
  c.fillStyle = top; c.fillRect(0, 0, W, 200);
  c.restore();

  // шапка
  c.textBaseline = 'alphabetic';
  rr(c, 64, 56, 330, 60, 30); c.fillStyle = 'rgba(255,255,255,0.14)'; c.fill();
  rr(c, 64, 56, 330, 60, 30); c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = 2; c.stroke();
  c.fillStyle = '#fff'; c.font = '800 26px Unbounded, Manrope, sans-serif'; c.textAlign = 'center';
  c.fillText(`Results ${r.year}`, 64 + 165, 96);
  c.textAlign = 'right'; c.fillStyle = '#ffe3ee'; c.font = '800 28px Unbounded, Manrope, sans-serif'; c.fillText('ETERNAL', W - 64, 96);

  // ник и тип игрока
  c.textAlign = 'left';
  c.shadowColor = 'rgba(0,0,0,0.6)'; c.shadowBlur = 24;
  c.fillStyle = '#ffffff'; c.font = '800 76px Unbounded, Manrope, sans-serif';
  let name = nick || 'Player.';
  while (c.measureText(name).width > W - 128 && name.length > 3) name = `${name.slice(0, -2)}…`;
  c.fillText(name, 64, HERO - 62);
  c.shadowBlur = 0;
  c.font = '700 30px Manrope, sans-serif';
  const tw = c.measureText(r.type).width + 44;
  rr(c, 64, HERO - 40, tw, 50, 25); c.fillStyle = 'rgba(255,159,195,0.22)'; c.fill();
  rr(c, 64, HERO - 40, tw, 50, 25); c.strokeStyle = 'rgba(255,159,195,0.7)'; c.lineWidth = 2; c.stroke();
  c.fillStyle = '#ffc2d9'; c.fillText(r.type, 86, HERO - 4);

  // главное число
  const hrs = Math.round(hoursOf(r.total));
  const numGrad = c.createLinearGradient(0, 700, 0, 900);
  numGrad.addColorStop(0, '#ffffff'); numGrad.addColorStop(1, '#ff9fc3');
  c.fillStyle = numGrad; c.font = '800 220px Unbounded, Manrope, sans-serif';
  c.fillText(String(hrs), 56, 860);
  const numW = c.measureText(String(hrs)).width;
  c.fillStyle = '#ffc2d9'; c.font = '700 40px Manrope, sans-serif';
  c.fillText(`${plural(hrs, 'hour', 'hour', 'hours')} Minecraft`, 64, 918);

  // график month-by-month справа от числа
  const gx = Math.max(64 + numW + 50, 600); const gw = W - 64 - gx; const gy = 700; const gh = 190;
  if (gw > 160) {
    const max = Math.max(1, ...r.months);
    const bw = gw / 12;
    for (let m = 0; m < 12; m += 1) {
      const h = Math.max(r.months[m] > 0 ? 8 : 0, (r.months[m] / max) * gh);
      const x = gx + m * bw + 3;
      if (m === r.busiestMonth) { const g = c.createLinearGradient(0, gy + gh - h, 0, gy + gh); g.addColorStop(0, '#ffcf8a'); g.addColorStop(1, '#ff9fc3'); c.fillStyle = g; } else c.fillStyle = 'rgba(255,255,255,0.22)';
      rr(c, x, gy + gh - h, bw - 6, h, 6); c.fill();
    }
    c.fillStyle = 'rgba(255,255,255,0.55)'; c.font = '700 22px Manrope, sans-serif'; c.textAlign = 'left';
    c.fillText('month-by-month', gx, gy - 14);
  }

  // три плитки
  const tiles = [
    [String(r.count), plural(r.count, 'launch', 'launch', 'launches')],
    [String(r.activeDays), `${plural(r.activeDays, 'day', 'day', 'days')} play`],
    [String(r.bestStreak), `${plural(r.bestStreak, 'day', 'day', 'days')} consecutively`],
  ];
  const tw3 = (W - 128 - 40) / 3;
  tiles.forEach(([big, small], k) => {
    const x = 64 + k * (tw3 + 20); const y = 968;
    rr(c, x, y, tw3, 150, 26);
    const g = c.createLinearGradient(x, y, x + tw3, y + 150); g.addColorStop(0, 'rgba(255,255,255,0.12)'); g.addColorStop(1, 'rgba(255,255,255,0.05)');
    c.fillStyle = g; c.fill();
    rr(c, x, y, tw3, 150, 26); c.strokeStyle = 'rgba(255,255,255,0.14)'; c.lineWidth = 2; c.stroke();
    c.textAlign = 'left'; c.fillStyle = '#fff'; c.font = '800 66px Unbounded, Manrope, sans-serif'; c.fillText(big, x + 28, y + 80);
    c.fillStyle = '#d6b8c6'; c.font = '600 27px Manrope, sans-serif'; c.fillText(small, x + 28, y + 122);
  });

  // любимая сборка
  const fav = r.top[0];
  rr(c, 64, 1140, W - 128, 120, 26); c.fillStyle = 'rgba(255,159,195,0.13)'; c.fill();
  rr(c, 64, 1140, W - 128, 120, 26); c.strokeStyle = 'rgba(255,159,195,0.4)'; c.lineWidth = 2; c.stroke();
  c.fillStyle = '#ff9fc3'; c.font = '800 22px Manrope, sans-serif'; c.fillText('Favourite Instance', 92, 1180);
  let fname = fav ? fav.name : '—';
  c.fillStyle = '#fff'; c.font = '800 44px Unbounded, Manrope, sans-serif';
  while (c.measureText(fname).width > 560 && fname.length > 3) fname = `${fname.slice(0, -2)}…`;
  c.fillText(fname, 92, 1236);
  if (fav) {
    const bx = 700; const bwid = W - 64 - 28 - bx;
    c.fillStyle = 'rgba(255,255,255,0.15)'; rr(c, bx, 1212, bwid, 14, 7); c.fill();
    const fill = c.createLinearGradient(bx, 0, bx + bwid, 0); fill.addColorStop(0, '#ff9fc3'); fill.addColorStop(1, '#ffcf8a');
    c.fillStyle = fill; rr(c, bx, 1212, Math.max(14, bwid * fav.share), 14, 7); c.fill();
    c.textAlign = 'right'; c.fillStyle = '#ffe3ee'; c.font = '800 30px Manrope, sans-serif'; c.fillText(`${Math.round(fav.share * 100)}percentage`, W - 92, 1186);
    c.textAlign = 'left';
  }

  // подвал
  c.fillStyle = '#ffffff'; c.font = '700 28px Unbounded, Manrope, sans-serif'; c.fillText('Zorya Launcher', 64, H - 36);
  c.textAlign = 'right'; c.fillStyle = '#d6b8c6'; c.font = '600 26px Manrope, sans-serif'; c.fillText('aestmc.ru', W - 64, H - 36);
  c.textAlign = 'left';
}

export default function YearRecap({ sessions, instances, account, now, onClose }) {
  const r = useMemo(() => computeRecap(sessions, instances, now), [sessions, instances, now]);
  const [i, setI] = useState(0);
  const [saveMsg, setSaveMsg] = useState('');
  const cardRef = useRef(null);
  const nick = account?.name || '';
  // Случайные кадры of скриншотов этого года (только с этого компьютера, никуда не отправляются): для отдельной карточки и для картинки
  const [shots, setShots] = useState([]); // [{ key, url, img, name }]
  const [cardShot, setCardShot] = useState(0); // What’s the picture picture?; -1 — frameless
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await window.api.screenshots.list();
        if (!alive || !list?.ok) return;
        const from = new Date(r.year, 0, 1).getTime();
        const to = new Date(r.year + 1, 0, 1).getTime();
        const inYear = list.items.filter((s) => s.mtime >= from && s.mtime < to);
        for (let k = inYear.length - 1; k > 0; k -= 1) { const j = Math.floor(Math.random() * (k + 1)); [inYear[k], inYear[j]] = [inYear[j], inYear[k]]; }
        const loaded = await Promise.all(inYear.slice(0, 6).map(async (s) => {
          const t = await window.api.screenshots.thumbnail(s.instanceId, s.filename).catch(() => null);
          if (!t?.ok || !t.bytes) return null;
          const url = await bytesToDataUrl(t.bytes);
          if (!url) return null;
          const img = await loadImg(url);
          return img ? { key: `${s.instanceId}:${s.filename}`, url, img, name: s.instanceName } : null;
        }));
        if (alive) setShots(loaded.filter(Boolean));
      } catch { /* Without staff, the results are also good. */ }
    })();
    return () => { alive = false; };
  }, [r.year]);

  const slides = useMemo(() => {
    if (r.empty) {
      return [{ key: 'empty', body: () => (
        <>
          <div className="yr-kicker">Outcomes {r.year}</div>
          <div className="yr-title">You hardly played this year.</div>
          <div className="yr-sub">It’s a whole year ahead of us, the instances are waiting.</div>
        </>
      ) }];
    }
    const hrs = hoursOf(r.total);
    const list = [
      { key: 'intro', body: () => (
        <>
          <div className="yr-kicker">Results of the year</div>
          <div className="yr-mega">{r.year}</div>
          <div className="yr-title"><NickText name={nick || 'Player.'} />That's how you played.</div>
          <div className="yr-sub">Flick with a click or arrows</div>
        </>
      ) },
      { key: 'total', body: () => (
        <>
          <div className="yr-kicker">All in play.</div>
          <div className="yr-big"><Count value={hrs} decimals={hrs < 10 ? 1 : 0} /><span> ?</span></div>
          <div className="yr-sub">
            {hrs >= 24 ? `It's ${(hrs / 24).toFixed(1).replace('.', ',')} day without interruption. ` : ''}
            {r.lotr >= 1 ? `Or ${Math.floor(r.lotr)} ${plural(Math.floor(r.lotr), 'marathon', 'marathon', 'marathons')} "Lord of the Rings" in extended versions.` : 'Every minute counts.'}
          </div>
        </>
      ) },
      { key: 'sessions', body: () => (
        <>
          <div className="yr-kicker">Game launches</div>
          <div className="yr-big"><Count value={r.count} /></div>
          <div className="yr-sub">
            Medium launch: {dur(r.average)}. You played. {r.activeDays} {plural(r.activeDays, 'day', 'day', 'days')} year
            {r.bestStreak > 1 ? `The longest series: ${r.bestStreak} ${plural(r.bestStreak, 'day', 'day', 'days')} in a row.` : '.'}
          </div>
        </>
      ) },
    ];
    if (r.longest) {
      list.push({ key: 'longest', body: () => (
        <>
          <div className="yr-kicker">Longest session</div>
          <div className="yr-big">{dur(r.longest.durationMs)}</div>
          <div className="yr-sub">
            {new Date(r.longest.start).toLocaleDateString('en-US', { day: 'numeric', month: 'long' })}, instance «{r.longestName}? We hope you ate at least.
          </div>
        </>
      ) });
    }
    if (r.top.length) {
      list.push({ key: 'top', body: () => (
        <>
          <div className="yr-kicker">You played the most.</div>
          <div className="yr-top">
            {r.top.map((t, n) => (
              <div className="yr-top-row" key={t.id} style={{ animationDelay: `${n * 140}ms` }}>
                <span className="yr-top-n">{n + 1}</span>
                <span className="yr-top-icon">{t.icon ? <img src={t.icon} alt="" /> : <BoxIcon width={24} height={24} />}</span>
                <span className="yr-top-body">
                  <span className="yr-top-name">{t.name}</span>
                  <span className="yr-top-meta">{dur(t.ms)} · {Math.round(t.share * 100)}%{t.mcVersion ? ` · ${t.mcVersion}` : ''}</span>
                  <span className="yr-top-track"><span style={{ width: `${Math.max(3, t.share * 100)}%` }} /></span>
                </span>
              </div>
            ))}
          </div>
        </>
      ) });
    }
    list.push({ key: 'when', body: () => (
      <>
        <div className="yr-kicker">When you play</div>
        <div className="yr-title">{r.type}</div>
        <Bars values={r.hours} highlight={r.peakHour} labels={r.hours.map((_, h) => `${String(h).padStart(2, '0')}:00`)} />
        <div className="yr-axis"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div>
        <div className="yr-sub">Peak in {String(r.peakHour).padStart(2, '0')}:00, favorite day: {r.favWeekdayName}.</div>
      </>
    ) });
    list.push({ key: 'months', body: () => (
      <>
        <div className="yr-kicker">The most playful month</div>
        <div className="yr-title" style={{ textTransform: 'capitalize' }}>{r.busiestMonthName}</div>
        <Bars values={r.months} highlight={r.busiestMonth} labels={['jan', 'fem', 'mar', 'pra', 'may', 'June', 'July', 'aug', 'sen', 'octa', 'noah', 'dec']} />
        <div className="yr-axis yr-axis-12"><span>jan</span><span>mar</span><span>June</span><span>sen</span><span>dec</span></div>
        {r.bestDay && <div className="yr-sub">Record day: {dur(r.bestDay.ms)} in a game in one day.</div>}
      </>
    ) });
    if (r.version || r.loader) {
      list.push({ key: 'ver', body: () => (
        <>
          <div className="yr-kicker">Your version.</div>
          <div className="yr-big">{r.version ? r.version.name : '—'}</div>
          <div className="yr-sub">
            {r.version ? `${Math.round(r.version.share * 100)}% of the time.` : ''}{' '}
            {r.loader && r.loader.name !== 'vanilla' ? `Most often with a loader ${r.loader.name[0].toUpperCase()}${r.loader.name.slice(1)}.` : r.loader ? 'Mostly pure Vanilla.' : ''}
          </div>
        </>
      ) });
    }
    if (shots.length) {
      list.push({ key: 'shots', body: () => (
        <>
          <div className="yr-kicker">Footage of the year</div>
          <div className="yr-title">What did you film?</div>
          <div className={`yr-shots n${Math.min(shots.length, 4)}`}>
            {shots.slice(0, 4).map((s, n) => (
              <figure className="yr-shot" key={s.key} style={{ animationDelay: `${n * 160}ms`, '--tilt': `${[-2.4, 1.8, 2.2, -1.6][n]}deg` }}>
                <img src={s.url} alt="" />
                <figcaption>{s.name}</figcaption>
              </figure>
            ))}
          </div>
        </>
      ) });
    }
    list.push({ key: 'card', final: true, body: () => (
      <>
        <div className="yr-kicker">Your card.</div>
        <canvas ref={cardRef} className="yr-card" />
        <div className="yr-actions">
          <button type="button" className="btn btn-primary" onClick={saveCard}>Save the picture.</button>
          {shots.length > 0 && (
            <button type="button" className="btn" onClick={() => setCardShot((n) => (n + 1 >= shots.length ? -1 : n + 1))}>
              {cardShot < 0 ? 'Add a frame.' : 'Another shot'}
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>Close.</button>
        </div>
        {saveMsg && <div className="yr-sub">{saveMsg}</div>}
      </>
    ) });
    return list;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r, nick, saveMsg, shots, cardShot]);

  const last = slides.length - 1;
  const cur = slides[Math.min(i, last)];
  const next = useCallback(() => setI((n) => Math.min(last, n + 1)), [last]);
  const prev = useCallback(() => setI((n) => Math.max(0, n - 1)), []);

  // картинка рисуется, когда доходим до последней карточки
  const cardImage = cardShot >= 0 && shots[cardShot] ? shots[cardShot].img : null;
  useEffect(() => {
    if (!cur.final || !cardRef.current) return;
    drawCard(cardRef.current, r, nick, cardImage);
    // шрифты могут догрузиться после первого рисования: один раз перерисовываем, когда они готовы
    if (document.fonts?.ready) document.fonts.ready.then(() => { if (cardRef.current) drawCard(cardRef.current, r, nick, cardImage); });
  }, [cur.final, r, nick, cardImage]);

  async function saveCard() {
    if (!cardRef.current) return;
    drawCard(cardRef.current, r, nick, cardImage);
    const res = await window.api.recap.saveCard(cardRef.current.toDataURL('image/png'), `eternal-itogi-${r.year}.png`);
    setSaveMsg(res?.ok ? 'Picture saved.' : (res?.canceled ? '' : res?.error || 'Failed to save.'));
  }

  // Само листается, когда заполнится полоска сверху (CSS-анимация; пока курсор на карточке, она стоит); на последней карточке и при «меньше анимаций» стоит.
  const autoplay = !cur.final && !r.empty && !reduceMotion();

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft') prev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev, onClose]);

  function onStageClick(e) {
    if (e.target.closest('button, canvas, a')) return;
    const box = e.currentTarget.getBoundingClientRect();
    if (e.clientX - box.left < box.width * 0.3) prev(); else next();
  }

  return (
    <div className="yr-overlay" role="dialog" aria-label={`Results of the year ${r.year}`}>
      <div className="yr-stars" aria-hidden="true" />
      <button type="button" className="yr-close" onClick={onClose} title="Close (Esc)">✕</button>
      <div
        className="yr-stage"
        onClick={onStageClick}
      >
        <div className="yr-progress">
          {slides.map((s, n) => (
            <span key={s.key} className={`yr-seg ${n < i ? 'done' : ''} ${n === i ? 'on' : ''}`}>
              <span className={n === i && autoplay ? 'fill' : ''} style={n === i && autoplay ? { animationDuration: `${SLIDE_MS}ms` } : undefined} onAnimationEnd={n === i && autoplay ? next : undefined} />
            </span>
          ))}
        </div>
        <div className="yr-slide" key={cur.key}>{cur.body()}</div>
        {i > 0 && !cur.final && <div className="yr-hint">← Back · Forward →</div>}
      </div>
    </div>
  );
}
