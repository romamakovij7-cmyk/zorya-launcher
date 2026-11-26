import { useRef, useState } from 'react';
import { translateDom, restoreDom } from '../utils/translateDom.js';

// Sanitised rich text (already-safe HTML) with an optional "translate to
// Russian" toggle. Links open in the system browser.
export default function RichContent({ html, translatable = true, compact = false, protect = [] }) {
  const ref = useRef(null);
  const [state, setState] = useState('idle'); // idle | working | done | error
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);

  async function toggle() {
    const root = ref.current;
    if (!root) return;
    if (state === 'done') { restoreDom(root); setState('idle'); return; }
    setState('working');
    setError(null);
    try {
      await translateDom(root, (done, total) => setProgress({ done, total }), protect);
      setState('done');
    } catch (err) {
      setError(err.message);
      setState('error');
    }
  }

  function onClick(e) {
    const a = e.target.closest?.('a');
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute('href');
    if (href && /^(https?:|mailto:)/i.test(href)) window.api.shell.openExternal(href);
  }

  return (
    <div className={`rich-wrap ${compact ? 'compact' : ''}`}>
      {translatable && html && (
        <div className="rich-toolbar">
          <button className="btn" onClick={toggle} disabled={state === 'working'}>
            {state === 'working'
              ? `Перевод… ${progress ? `${progress.done}/${progress.total}` : ''}`
              : state === 'done' ? 'Show оригинал' : 'Перевести на русский'}
          </button>
          {state === 'done' && <span className="hint-text">Машинный перевод — может быть неточным.</span>}
          {state === 'error' && <span className="error-text">Failed перевести: {error}</span>}
        </div>
      )}
      <div ref={ref} className="rich" onClick={onClick} dangerouslySetInnerHTML={{ __html: html || '' }} />
    </div>
  );
}
