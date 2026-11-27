// Background behind the character на «Игровом» главном экране: ночное небо с мерцающими квадратными звёздами и луной,
// две ступенчатые (пиксельные) горные гряды и квадратные искры, что поднимаются вверх — как на карточках сайта.
// Цвета берутся of темы (--rose-rgb / --wine-rgb), поэтому сцена подстраивается под акцент. Включается в Settings → Interface.
import { useMemo } from 'react';

const rnd = (a, b) => a + Math.random() * (b - a);

// Ступенчатый силуэт: столбики одинаковой ширины, высота плавно гуляет — выглядит как «пиксельные» горы.
function ridge(seed, cols, base, amp, rough) {
  let h = base;
  let dir = 1;
  const pts = [];
  for (let i = 0; i < cols; i++) {
    const r = Math.sin(seed + i * 0.37) * 0.6 + Math.sin(seed * 2.3 + i * 0.91) * 0.4;
    h += dir * rough * (0.4 + Math.abs(r));
    if (h > base + amp) dir = -1;
    if (h < base - amp) dir = 1;
    pts.push(Math.round(h));
  }
  return pts;
}

function Ridge({ seed, base, amp, rough, fill, cols = 40 }) {
  const w = 100 / cols;
  const pts = ridge(seed, cols, base, amp, rough);
  const d = pts.map((y, i) => `M${(i * w).toFixed(2)} ${y}h${(w + 0.02).toFixed(2)}V100h-${(w + 0.02).toFixed(2)}z`).join('');
  return <path d={d} fill={fill} />;
}

// imageUrl: the player's own picture instead of the night scene.
export default function HeroScene({ imageUrl }) {
  const stars = useMemo(() => Array.from({ length: 34 }, () => ({
    '--x': `${rnd(2, 98).toFixed(1)}%`, '--y': `${rnd(3, 52).toFixed(1)}%`, '--s': `${Math.random() < 0.18 ? 4 : rnd(2, 3.2).toFixed(1)}px`,
    '--t': `${rnd(2.2, 5).toFixed(2)}s`, '--d': `${(-rnd(0, 5)).toFixed(2)}s`,
  })), []);
  const sparks = useMemo(() => Array.from({ length: 14 }, () => ({
    '--x': `${rnd(4, 96).toFixed(1)}%`, '--s': `${rnd(3, 6).toFixed(1)}px`, '--t': `${rnd(3.2, 6).toFixed(2)}s`,
    '--d': `${(-rnd(0, 6)).toFixed(2)}s`, '--dx': `${rnd(-30, 30).toFixed(0)}px`,
  })), []);

  if (imageUrl) return <div className="hs hs-custom" aria-hidden="true" style={{ backgroundImage: `url("${imageUrl}")` }} />;
  return (
    <div className="hs" aria-hidden="true">
      <div className="hs-sky" />
      <div className="hs-aurora" />
      <div className="hs-moon" />
      {stars.map((s, i) => <i key={i} className="hs-star" style={s} />)}
      <svg className="hs-ridges" viewBox="0 0 100 100" preserveAspectRatio="none">
        <Ridge seed={1.7} base={52} amp={9} rough={2.6} fill="rgba(var(--hs-far), 0.55)" />
        <Ridge seed={4.1} base={66} amp={8} rough={2.2} fill="rgba(var(--hs-mid), 0.8)" cols={32} />
        <Ridge seed={7.3} base={82} amp={5} rough={1.6} fill="rgba(var(--hs-near), 0.95)" cols={26} />
      </svg>
      <div className="hs-ground" />
      <span className="hs-sparks">{sparks.map((s, i) => <i key={i} style={s} />)}</span>
    </div>
  );
}
