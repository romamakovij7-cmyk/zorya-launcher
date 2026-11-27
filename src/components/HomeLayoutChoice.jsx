// Один раз после входа в лаунчер: какой главный экран нужен — «Library» (grid сборок) или «Игровой» (персонаж и кнопка «Play»).
// Выбор применяется сразу и запоминается (homeLayoutChosen); потом его можно поменять в Settings → Interface.
import { useEffect } from 'react';

export default function HomeLayoutChoice({ onChoose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onChoose('library'); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onChoose]);

  return (
    <div className="hlc-overlay" role="dialog" aria-label="Selection of the main screen">
      <div className="hlc-card">
        <h2 className="hlc-title">What main screen do you need?</h2>
        <p className="hlc-sub">This can be changed at any time: Settings → Interface → Main screen.</p>

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
            <div className="hlc-name">Play view</div>
            <div className="hlc-desc">Your character, quick cards and a big “Play” button for the latest instance</div>
          </button>

          <button type="button" className="hlc-option" onClick={() => onChoose('library')}>
            <div className="hlc-preview">
              <div className="lc-block" style={{ height: 16, flex: 'none', width: '46%' }} />
              <div className="lc-row"><span className="lc-block lc-grow" /><span className="lc-block lc-grow" /><span className="lc-block lc-grow" /><span className="lc-block lc-grow" /></div>
              <div className="lc-row"><span className="lc-block lc-grow" /><span className="lc-block lc-grow" /><span className="lc-block lc-grow" /><span className="lc-block lc-grow" /></div>
            </div>
            <div className="hlc-name">Library</div>
            <div className="hlc-desc">Grid of all instances, recent worlds and servers, sidebar on the left</div>
          </button>
        </div>

        <button type="button" className="hlc-skip" onClick={() => onChoose('library')}>Until you default.</button>
      </div>
    </div>
  );
}
