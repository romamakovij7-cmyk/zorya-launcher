// «Итоги года» на главных экранах: заметная кнопка в неделю итогов (25-31 декабря). Сама ничего не считает, только зовёт окно итогов.
import { isRecapSeason, recapNow, recapYear } from '../utils/recap.js';

export function recapOn() { return isRecapSeason(recapNow()); }

// variant: 'card' (главный экран-библиотека) или 'pill' (игровой экран)
export default function RecapBanner({ onOpen, variant = 'card' }) {
  if (!onOpen || !recapOn()) return null;
  const year = recapYear(recapNow());
  if (variant === 'pill') {
    return (
      <button type="button" className="recap-pill" onClick={onOpen} title="Ваш год в Minecraft">
        <span className="recap-spark" aria-hidden="true">✦</span>
        <span>Итоги года {year}</span>
      </button>
    );
  }
  return (
    <button type="button" className="recap-banner" onClick={onOpen}>
      <span className="recap-banner-spark" aria-hidden="true">✦</span>
      <span className="recap-banner-text">
        <b>Итоги года {year}</b>
        <small>Ваш год в Minecraft: часы, любимые сборки, ваши кадры. Доступны до 31 декабря.</small>
      </span>
      <span className="recap-banner-go">Смотреть</span>
    </button>
  );
}