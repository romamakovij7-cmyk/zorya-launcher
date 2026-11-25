// Один раз после входа в лаунчер: какой главный экран нужен — «Library» (сетка сборок) или «Игровой» (персонаж и кнопка «Играть»).
// Выбор применяется сразу и запоминается (homeLayoutChosen); потом его можно поменять в Settings → Interface.
import { useEffect } from 'react';

export default function HomeLayoutChoice({ onChoose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onChoose('library'); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onChoose]);

  return (
    <div className="hlc-overlay" role="dialog" aria-label="Home screen selection">
      <div className="hlc-card">
        <h2 className="hlc-title">Какой главный экран вам нужен?</h2>
        <p className="hlc-sub">Это можно в любой момент поменять: Settings → Interface → Главный экран.</p>

        <div className="hlc-grid">
          <button type="button" className="hlc-option" onClick={() => onChoose('play')}>
            <div className="hlc-preview play">
              <div className="hlc-sky" />
              <div className="lc-row">
                <div className="hlc-col"><span className="lc-block lc-grow" /><span className="lc-block lc-grow" /><span className="lc-block lc-grow" /></div>
                <div className="lc-grow" style={{ display: 'flex', justifyContent: 'center' }}><span className="lc-fig" /></div>
                <div className="hlc-col"><span className="lc-block lc-grow" /><span className="lc-block lc-grow" /></div>
              </div>
              <div className="lc-row" style={{ flex: 'none', height: 26 }}><span className="lc-block lc-grow" /><span className="lc-block hot" style={{ width: 70 }} /></div>
            </div>
            <div className="hlc-name">Игровой</div>
            <div className="hlc-desc">Ваш персонаж, быстрые карточки и большая кнопка «Играть» для последней сборки</div>
          </button>

          <button type="button" className="hlc-option" onClick={() => onChoose('library')}>
            <div className="hlc-preview">
              <div className="lc-block" style={{ height: 16, flex: 'none', width: '46%' }} />
              <div className="lc-row"><span className="lc-block lc-grow" /><span className="lc-block lc-grow" /><span className="lc-block lc-grow" /><span className="lc-block lc-grow" /></div>
              <div className="lc-row"><span className="lc-block lc-grow" /><span className="lc-block lc-grow" /><span className="lc-block lc-grow" /><span className="lc-block lc-grow" /></div>
            </div>
            <div className="hlc-name">Library</div>
            <div className="hlc-desc">Сетка всех сборок, недавние миры и серверы, боковая панель слева</div>
          </button>
        </div>

        <button type="button" className="hlc-skip" onClick={() => onChoose('library')}>Пока оставить по умолчанию</button>
      </div>
    </div>
  );
}
