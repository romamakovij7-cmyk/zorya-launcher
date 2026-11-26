import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDownIcon, CheckIcon } from './Icons.jsx';

export const LOADER_OPTIONS = [
  { value: 'vanilla', label: 'Vanilla' },
  { value: 'fabric', label: 'Fabric' },
  { value: 'quilt', label: 'Quilt' },
  { value: 'forge', label: 'Forge' },
  { value: 'neoforge', label: 'NeoForge' },
];

const MAX_HEIGHT = 320;
const MIN_HEIGHT = 140;

// A dropdown that always opens downward and keeps its own state, so it doesn't
// flip upward, jump around or close when the surrounding screen re-renders
// (which is what the native <select> popup did). Options are
// [{ value, label, hint?, disabled? }]; onChange receives the option's value.
//   ↑/↓/Home/End move, Enter/Space pick, Esc closes, typing jumps to a match.
export default function Select({
  value, onChange, options, disabled = false, placeholder = '', className = '', style, title,
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [box, setBox] = useState(null); // where the trigger is, for placing the popup
  const btnRef = useRef(null);
  const popRef = useRef(null);
  const typed = useRef({ text: '', at: 0 });

  const selected = options.findIndex((o) => String(o.value) === String(value));
  const current = options[selected];

  const measure = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    setBox({ left: r.left, top: r.bottom + 4, width: r.width, room: window.innerHeight - r.bottom - 16 });
  }, []);

  function openList() {
    if (disabled || !options.length) return;
    measure();
    setActive(selected >= 0 ? selected : options.findIndex((o) => !o.disabled));
    setOpen(true);
  }

  function close() { setOpen(false); }

  function pick(i) {
    const o = options[i];
    if (!o || o.disabled) return;
    setOpen(false);
    if (String(o.value) !== String(value)) onChange(o.value);
  }

  // Follow the trigger when the window resizes or something behind it scrolls.
  useEffect(() => {
    if (!open) return undefined;
    const onScroll = (e) => { if (!popRef.current?.contains(e.target)) measure(); };
    const onDown = (e) => {
      if (!popRef.current?.contains(e.target) && !btnRef.current?.contains(e.target)) close();
    };
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', onScroll, true);
    document.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open, measure]);

  // A disabled/emptied select can't stay open.
  useEffect(() => { if (open && (disabled || !options.length)) setOpen(false); }, [open, disabled, options.length]);

  // Keep the highlighted row visible — scrolling only the list itself.
  useLayoutEffect(() => {
    const list = popRef.current;
    const row = list?.children[active];
    if (!row) return;
    if (row.offsetTop < list.scrollTop + 4) list.scrollTop = row.offsetTop - 4;
    else if (row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight - 4) {
      list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight + 4;
    }
  }, [active, open, box === null]);

  // When it opens, put the current value in the middle of the list.
  useLayoutEffect(() => {
    if (!open) return;
    const list = popRef.current;
    const row = list?.children[selected];
    if (list && row) list.scrollTop = Math.max(0, row.offsetTop - list.clientHeight / 2 + row.offsetHeight / 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, box === null]);

  function move(from, dir) {
    let i = from;
    for (let n = 0; n < options.length; n++) {
      i = (i + dir + options.length) % options.length;
      if (!options[i].disabled) return i;
    }
    return from;
  }

  function onKeyDown(e) {
    if (disabled) return;
    const key = e.key;
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(key)) { e.preventDefault(); openList(); }
      return;
    }
    if (key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (key === 'ArrowDown') { e.preventDefault(); setActive((a) => move(a, 1)); return; }
    if (key === 'ArrowUp') { e.preventDefault(); setActive((a) => move(a, -1)); return; }
    if (key === 'Home') { e.preventDefault(); setActive(options.findIndex((o) => !o.disabled)); return; }
    if (key === 'End') {
      e.preventDefault();
      for (let i = options.length - 1; i >= 0; i--) if (!options[i].disabled) { setActive(i); break; }
      return;
    }
    if (key === 'Enter' || key === ' ') { e.preventDefault(); pick(active); return; }
    if (key === 'Tab') { close(); return; }
    if (key.length === 1 && !e.ctrlKey && !e.metaKey) {
      const now = Date.now();
      typed.current.text = now - typed.current.at > 700 ? key.toLowerCase() : typed.current.text + key.toLowerCase();
      typed.current.at = now;
      const hit = options.findIndex((o) => !o.disabled && String(o.label).toLowerCase().startsWith(typed.current.text));
      if (hit >= 0) setActive(hit);
    }
  }

  // The popup can be wider than the button (long labels + hints): measure it once it is on screen and shift it left so it never runs
  // past the window's right edge.
  const [popWidth, setPopWidth] = useState(0);
  useLayoutEffect(() => {
    if (!open || !box || !popRef.current) return;
    const w = popRef.current.offsetWidth;
    if (w && Math.abs(w - popWidth) > 0.5) setPopWidth(w);
  }, [open, box, popWidth, options]);
  const left = box ? Math.max(8, Math.min(box.left, window.innerWidth - Math.max(box.width, popWidth) - 8)) : 0;

  return (
    <>
      <button
        type="button"
        ref={btnRef}
        className={`sel-btn ${open ? 'open' : ''} ${className}`}
        style={style}
        title={title}
        disabled={disabled}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="sel-btn-label">{current ? current.label : (placeholder || '—')}</span>
        <ChevronDownIcon width={14} height={14} className="sel-btn-chevron" />
      </button>
      {open && box && createPortal(
        <div
          ref={popRef}
          className="sel-pop"
          role="listbox"
          style={{
            left, top: box.top, minWidth: box.width, maxWidth: window.innerWidth - 16, maxHeight: Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, box.room)),
          }}
        >
          {options.map((o, i) => (
            <div
              key={String(o.value)}
              role="option"
              aria-selected={i === selected}
              className={`sel-opt ${i === active ? 'active' : ''} ${i === selected ? 'selected' : ''} ${o.disabled ? 'disabled' : ''}`}
              onMouseEnter={() => !o.disabled && setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => { e.stopPropagation(); pick(i); }}
            >
              <span className="sel-opt-label">{o.label}</span>
              {o.hint && <span className="sel-opt-hint">{o.hint}</span>}
              {i === selected && <CheckIcon width={14} height={14} />}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
