import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDownIcon, CopyIcon, CheckIcon } from './Icons.jsx';
import { colorize, lineLevel } from '../utils/logColor.js';

const BEAR_ARTS = [
  String.raw`
      /\___/\
     (  o.o  )
      >  ᴥ  <
     /       \
    (  ^   ^  )
     \_______/
`,
  'ʕ ᵔᴥᵔ ʔ',
  'ʕ •̀ o •́ ʔ',
  'ʕಠᴥಠʔ',
  '*ʕ ᵔᴥᵔ ʔ *Z z z',
  'ʕノ•ᴥ•ʔノ ︵ ┻━┻',
];

const MAX_LINES = 6000; // even older – no drawing (copy and file is still the whole)
const LEVELS = [
  { id: 'all', label: 'All' },
  { id: 'error', label: 'Error' },
  { id: 'warn', label: 'Warn' },
  { id: 'info', label: 'Info' },
];

// Фильтр по уровню оставляет и «хвост» подходящей записи (стек ошибки), иначе от Error остались бы одни заголовки
function filterByLevel(text, level) {
  if (level === 'all') return text;
  let prev = null;
  const out = [];
  for (const line of text.split('\n')) {
    const lv = lineLevel(line, prev);
    prev = lv;
    if (!lv) continue;
    const want = level === 'error' ? lv === 'ERROR' || lv === 'FATAL' : lv.toLowerCase() === level;
    if (want) out.push(line);
  }
  return out.join('\n');
}

const LogLine = memo(function LogLine({ text, level }) {
  const segs = useMemo(() => colorize(text, level), [text, level]);
  return (
    <div className={`lg-line${level ? ` lv-${level.toLowerCase()}` : ''}`}>
      {text === '' ? '\u200b' : segs.map((s, i) => (s.c ? <span key={i} className={s.c}>{s.t}</span> : s.t))}
    </div>
  );
});

function ColoredLog({ text }) {
  const { lines, levels, hidden } = useMemo(() => {
    const all = text.split('\n').map((l) => l.replace(/\r$/, ''));
    const lv = new Array(all.length);
    let prev = null;
    for (let i = 0; i < all.length; i++) { prev = lineLevel(all[i], prev); lv[i] = prev; }
    const start = Math.max(0, all.length - MAX_LINES);
    return { lines: all.slice(start), levels: lv.slice(start), hidden: start };
  }, [text]);
  return (
    <>
      {hidden > 0 && <div className="lg-note">Showing the latest {MAX_LINES} lines (more) {hidden} above). The copy button copies the entire journal.</div>}
      {lines.map((l, i) => <LogLine key={hidden + i} text={l} level={levels[i]} />)}
    </>
  );
}
export default function LogTab({ instance, liveText, emptyMessage, launchKey, toolbarSlot }) {
  const [bearArt] = useState(() => BEAR_ARTS[Math.floor(Math.random() * BEAR_ARTS.length)]);
  const [logFiles, setLogFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null); // null = Live Log
  const [historicalContent, setHistoricalContent] = useState('');
  const [loadingFile, setLoadingFile] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [level, setLevel] = useState('all');
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    setSelectedFile(null);
    setDropdownOpen(false);
    setLevel('all');
  }, [instance.id, launchKey]);

  useEffect(() => {
    window.api.instances.listLogFiles(instance.id).then(setLogFiles);
  }, [instance.id, launchKey]);

  async function selectFile(name) {
    setDropdownOpen(false);
    setSelectedFile(name);
    if (name === null) return;
    setLoadingFile(true);
    const res = await window.api.instances.readLogFile(instance.id, name);
    setHistoricalContent(res.ok ? res.content : `Failed to open the file: ${res.error}`);
    setLoadingFile(false);
  }

  const rawText = selectedFile ? historicalContent : liveText;
  const displayText = filterByLevel(rawText, level);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [displayText]);

  function handleCopy() {
    navigator.clipboard.writeText(rawText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  const toolbar = (
      <div className="log-toolbar">
        <div className="pill-tabs log-level-tabs">
          {LEVELS.map((l) => (
            <button key={l.id} className={`pill-tab ${level === l.id ? 'active' : ''}`} onClick={() => setLevel(l.id)}>
              {l.label}
            </button>
          ))}
        </div>

        <div className="log-source-dropdown">
          <button className="log-source-btn" onClick={() => setDropdownOpen((v) => !v)}>
            {selectedFile || 'Live Log'}
            <ChevronDownIcon width={14} height={14} style={{ transform: dropdownOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s ease' }} />
          </button>
          {dropdownOpen && (
            <>
              <div className="dropdown-backdrop" onClick={() => setDropdownOpen(false)} />
              <div className="log-source-menu">
                <button className={`log-source-item ${!selectedFile ? 'active' : ''}`} onClick={() => selectFile(null)}>
                  Live Log
                </button>
                {logFiles.map((f) => (
                  <button
                    key={f.name}
                    className={`log-source-item ${selectedFile === f.name ? 'active' : ''}`}
                    onClick={() => selectFile(f.name)}
                  >
                    {f.name}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <button className="btn-text log-copy-btn" onClick={handleCopy} disabled={!rawText}>
          {copied ? <><CheckIcon width={14} height={14} /> Copyed.</> : <><CopyIcon width={14} height={14} /> Copy</>}
        </button>
      </div>
  );

  return (
    <>
      {/* Rendered into the slot beside the Journal/Switch when there is one, so the console below gets the freed height. */}
      {toolbarSlot ? createPortal(toolbar, toolbarSlot) : toolbar}

      <div className="log-view" ref={scrollRef}>
        {loadingFile ? 'Loading...' : displayText ? <ColoredLog text={displayText} /> : rawText ? 'There are no lines that fit this filter.' : (
          <div className="log-empty-bear">
            <pre>{bearArt}</pre>
            <div className="log-empty-message">{emptyMessage}</div>
            <div className="log-empty-signature">by Miha1ych</div>
          </div>
        )}
      </div>
    </>
  );
}
