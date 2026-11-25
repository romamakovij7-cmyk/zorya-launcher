// Кнопка Premium — просто золотая пиксельная звезда (открывает окно Premium) и ник с выбранным цветом.
import { openPremium, usePremium, nickStyle } from '../utils/usePremium.js';
import starPng from '../assets/pixel/star_x8.png';

// variant: 'side' (боковая панель) | 'pill' (главный экран, настройки)
export default function PremiumButton({ variant = 'pill', className = '' }) {
  const p = usePremium();
  return (
    <button
      type="button"
      className={`pm-star ${variant} ${p.active ? 'active' : ''} ${className}`}
      onClick={openPremium}
      title={p.active ? 'Premium: subscription active' : 'What does Premium give?'}
      aria-label="Premium"
    >
      <img src={starPng} alt="" />
    </button>
  );
}

// Имя игрока: если у подписчика выбран цвет — градиентом.
export function NickText({ name, className }) {
  const p = usePremium();
  const style = p.active && p.nickColor ? nickStyle(p.colors, p.nickColor) : undefined;
  return <span className={className} style={style}>{name}</span>;
}
