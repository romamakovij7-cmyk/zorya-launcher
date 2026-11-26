import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CloseIcon, CopyIcon, DownloadCloudIcon, CheckIcon } from './Icons.jsx';

const MAX_HISTORY = 30;
const DEFAULT_ADJUST = { brightness: 100, contrast: 100, saturate: 100 };
const SWATCHES = ['#ff3b30', '#ff9500', '#ffd60a', '#34c759', '#0a84ff', '#bf5af2', '#ffffff', '#000000'];
const TOOLS = [
  { id: 'select', label: 'Кадр' },
  { id: 'brush', label: 'Кисть' },
  { id: 'marker', label: 'Маркер' },
  { id: 'line', label: 'Линия' },
  { id: 'rect', label: 'Рамка' },
];

function cloneCanvas(src) {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  c.getContext('2d').drawImage(src, 0, 0);
  return c;
}

// Quick editor for a screenshot: crop, rotate, flip, draw (brush, marker,
// line, rectangle) and brightness/contrast/saturation. Works on the
// full-resolution pixels. Every action — including each brush stroke and each
// colour-slider change — is one step in a single undo/redo history. The
// result can go to the clipboard, be saved as a new "<name>_edit.png" next to
// the original, or replace the original.
export default function ScreenshotEditor({ item, onClose, onSaved }) {
  const displayRef = useRef(null);
  const stageRef = useRef(null);
  const baseRef = useRef(null); // current pixels
  const adjustRef = useRef(DEFAULT_ADJUST); // mirrors `adjust` for use in handlers
  const undoRef = useRef([]); // [{ canvas, adjust }] oldest first
  const redoRef = useRef([]);
  const dragRef = useRef(null); // crop drag start, or the active drawing stroke
  const sliderStartRef = useRef(null);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);
  const [rev, setRev] = useState(0); // bumps whenever pixels/history change
  const [selection, setSelection] = useState(null); // in base pixels
  const [adjust, setAdjustState] = useState(DEFAULT_ADJUST);
  const [tool, setTool] = useState('select');
  const [color, setColor] = useState('#ff3b30');
  const [size, setSize] = useState(6);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [stageSize, setStageSize] = useState({ w: 800, h: 500 });

  const setAdjust = (next) => { adjustRef.current = next; setAdjustState(next); };

  // Load the original pixels.
  useEffect(() => {
    let cancelled = false;
    window.api.screenshots.original(item.instanceId, item.filename).then((res) => {
      if (cancelled) return;
      if (!res.ok) { setError(res.error); return; }
      const img = new Image();
      img.onload = () => {
        if (cancelled) return;
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        c.getContext('2d').drawImage(img, 0, 0);
        baseRef.current = c;
        undoRef.current = [];
        redoRef.current = [];
        setReady(true);
        setRev((r) => r + 1);
      };
      img.onerror = () => setError('Failed прочитать изображение');
      img.src = res.dataUrl;
    });
    return () => { cancelled = true; };
  }, [item.instanceId, item.filename]);

  // Track the space available for the preview.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setStageSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setStageSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const filterString = `brightness(${adjust.brightness}%) contrast(${adjust.contrast}%) saturate(${adjust.saturate}%)`;

  const scaleFor = useCallback(() => {
    const base = baseRef.current;
    if (!base) return 1;
    return Math.min((stageSize.w - 8) / base.width, (stageSize.h - 8) / base.height, 1);
  }, [stageSize]);

  // Repaint the preview.
  useEffect(() => {
    const base = baseRef.current;
    const canvas = displayRef.current;
    if (!base || !canvas) return;
    const scale = scaleFor();
    const w = Math.max(1, Math.round(base.width * scale));
    const h = Math.max(1, Math.round(base.height * scale));
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.filter = filterString;
    ctx.drawImage(base, 0, 0, w, h);
    ctx.filter = 'none';
    if (selection) {
      const sx = selection.x * scale;
      const sy = selection.y * scale;
      const sw = selection.w * scale;
      const sh = selection.h * scale;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, 0, w, sy);
      ctx.fillRect(0, sy + sh, w, h - sy - sh);
      ctx.fillRect(0, sy, sx, sh);
      ctx.fillRect(sx + sw, sy, w - sx - sw, sh);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(sx + 0.5, sy + 0.5, sw, sh);
      ctx.setLineDash([]);
    }
  }, [rev, selection, filterString, scaleFor, ready]);

  // ---- history -----------------------------------------------------------

  function snapshot() {
    return { canvas: baseRef.current, adjust: adjustRef.current };
  }

  function pushUndo(entry) {
    undoRef.current.push(entry);
    if (undoRef.current.length > MAX_HISTORY) undoRef.current.shift();
    redoRef.current = [];
  }

  function restore(entry) {
    baseRef.current = entry.canvas;
    setAdjust(entry.adjust);
    setSelection(null);
    setRev((r) => r + 1);
  }

  function undo() {
    const prev = undoRef.current.pop();
    if (!prev) return;
    redoRef.current.push(snapshot());
    restore(prev);
  }

  function redo() {
    const next = redoRef.current.pop();
    if (!next) return;
    undoRef.current.push(snapshot());
    restore(next);
  }

  // Applies a new pixel state as one undoable step.
  function commitCanvas(next) {
    pushUndo(snapshot());
    baseRef.current = next;
    setSelection(null);
    setRev((r) => r + 1);
  }

  function resetAll() {
    if (undoRef.current.length === 0) return;
    const original = undoRef.current[0];
    pushUndo(snapshot());
    restore(original);
  }

  // ---- crop / rotate / flip ------------------------------------------------

  function applyCrop() {
    const base = baseRef.current;
    if (!selection || !base) return;
    const c = document.createElement('canvas');
    c.width = Math.round(selection.w);
    c.height = Math.round(selection.h);
    c.getContext('2d').drawImage(base, Math.round(selection.x), Math.round(selection.y), c.width, c.height, 0, 0, c.width, c.height);
    commitCanvas(c);
  }

  function rotate(dir) {
    const base = baseRef.current;
    const c = document.createElement('canvas');
    c.width = base.height;
    c.height = base.width;
    const ctx = c.getContext('2d');
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate((dir * Math.PI) / 2);
    ctx.drawImage(base, -base.width / 2, -base.height / 2);
    commitCanvas(c);
  }

  function flip() {
    const base = baseRef.current;
    const c = document.createElement('canvas');
    c.width = base.width;
    c.height = base.height;
    const ctx = c.getContext('2d');
    ctx.translate(c.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(base, 0, 0);
    commitCanvas(c);
  }

  // ---- colour sliders (one history step per gesture) -----------------------

  function onSliderChange(key, value) {
    setAdjust({ ...adjustRef.current, [key]: value });
  }

  function onSliderStart() {
    if (!sliderStartRef.current) sliderStartRef.current = adjustRef.current;
  }

  function onSliderEnd() {
    const start = sliderStartRef.current;
    sliderStartRef.current = null;
    if (!start) return;
    const now = adjustRef.current;
    if (start.brightness === now.brightness && start.contrast === now.contrast && start.saturate === now.saturate) return;
    pushUndo({ canvas: baseRef.current, adjust: start });
    setRev((r) => r + 1);
  }

  // ---- pointer: crop selection or drawing -----------------------------------

  function pointerToBase(e) {
    const canvas = displayRef.current;
    const base = baseRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * base.width;
    const y = ((e.clientY - rect.top) / rect.height) * base.height;
    return { x: Math.min(Math.max(x, 0), base.width), y: Math.min(Math.max(y, 0), base.height) };
  }

  function styleStroke(ctx, kind) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = kind === 'marker' ? size * 2.4 : size;
    ctx.globalAlpha = kind === 'marker' ? 0.4 : 1;
  }

  // Redraws a stroke from the pixels as they were before it started.
  function renderStroke(stroke) {
    const work = baseRef.current;
    const ctx = work.getContext('2d');
    ctx.save();
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(stroke.before, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    styleStroke(ctx, stroke.kind);
    const pts = stroke.points;
    const first = pts[0];
    const last = pts[pts.length - 1];
    ctx.beginPath();
    if (stroke.kind === 'line') {
      ctx.moveTo(first.x, first.y);
      ctx.lineTo(last.x, last.y);
    } else if (stroke.kind === 'rect') {
      ctx.rect(Math.min(first.x, last.x), Math.min(first.y, last.y), Math.abs(last.x - first.x), Math.abs(last.y - first.y));
    } else {
      ctx.moveTo(first.x, first.y);
      if (pts.length === 1) ctx.lineTo(first.x + 0.01, first.y); // a dot
      pts.forEach((p) => ctx.lineTo(p.x, p.y));
    }
    ctx.stroke();
    ctx.restore();
  }

  function onPointerDown(e) {
    if (!baseRef.current || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = pointerToBase(e);
    if (tool === 'select') {
      dragRef.current = { mode: 'select', start: p };
      setSelection(null);
      return;
    }
    // Drawing: the stroke is drawn onto a fresh copy, so undo can put the
    // untouched pixels back.
    pushUndo(snapshot());
    const before = baseRef.current;
    baseRef.current = cloneCanvas(before);
    dragRef.current = { mode: 'draw', kind: tool, before, points: [p] };
    renderStroke(dragRef.current);
    setRev((r) => r + 1);
  }

  function onPointerMove(e) {
    const drag = dragRef.current;
    if (!drag) return;
    const p = pointerToBase(e);
    if (drag.mode === 'select') {
      const s = drag.start;
      setSelection({
        x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y),
      });
    } else {
      drag.points.push(p);
      renderStroke(drag);
      setRev((r) => r + 1);
    }
  }

  function onPointerUp() {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag?.mode === 'select') {
      setSelection((s) => (s && s.w > 8 && s.h > 8 ? s : null));
    } else if (drag?.mode === 'draw') {
      setRev((r) => r + 1);
    }
  }

  // ---- export ----------------------------------------------------------------

  // Final image with the colour adjustments baked in.
  async function exportBytes() {
    const base = baseRef.current;
    const out = document.createElement('canvas');
    out.width = base.width;
    out.height = base.height;
    const ctx = out.getContext('2d');
    ctx.filter = filterString;
    ctx.drawImage(base, 0, 0);
    const blob = await new Promise((resolve) => out.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Failed получить изображение');
    return new Uint8Array(await blob.arrayBuffer());
  }

  async function run(fn) {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
    } catch (err) {
      setMessage({ error: true, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  const copyToClipboard = () => run(async () => {
    const res = await window.api.screenshots.copyBytes(await exportBytes());
    if (!res.ok) throw new Error(res.error);
    setMessage({ text: 'Скопировано в буфер обмена' });
  });

  const saveCopy = () => run(async () => {
    const res = await window.api.screenshots.saveEdited(item.instanceId, item.filename, await exportBytes(), 'copy');
    if (!res.ok) throw new Error(res.error);
    setMessage({ text: `Сохранено: ${res.filename}` });
    onSaved?.();
  });

  const replaceOriginal = () => {
    if (!confirm('Заменить оригинал отредактированной версией? Вернуть исходный файл будет нельзя.')) return;
    run(async () => {
      const res = await window.api.screenshots.saveEdited(item.instanceId, item.filename, await exportBytes(), 'replace');
      if (!res.ok) throw new Error(res.error);
      onSaved?.();
      onClose();
    });
  };

  useEffect(() => {
    function onKey(e) {
      // e.code is the physical key: e.key would be "я"/"н" on a Russian
      // keyboard layout and Ctrl+Z / Ctrl+Y would silently do nothing.
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === 'Escape') onClose();
      else if (mod && e.code === 'KeyZ' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (mod && (e.code === 'KeyY' || (e.code === 'KeyZ' && e.shiftKey))) { e.preventDefault(); redo(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose]);

  const base = baseRef.current;
  const canUndo = undoRef.current.length > 0;
  const canRedo = redoRef.current.length > 0;
  const drawing = tool !== 'select';

  return createPortal(
    <div className="shot-editor-overlay">
      <div className="shot-editor">
        <div className="shot-editor-head">
          <div>
            <div className="shot-editor-title">Редактор скриншота</div>
            <div className="shot-editor-sub">
              {item.filename}{base ? ` · ${base.width}×${base.height}` : ''}
            </div>
          </div>
          <div className="shot-editor-head-actions">
            <button className="btn" onClick={undo} disabled={!canUndo} title="Шаг назад (Ctrl+Z)">↶ Назад</button>
            <button className="btn" onClick={redo} disabled={!canRedo} title="Шаг вперёд (Ctrl+Y)">↷ Вперёд</button>
            <button className="icon-btn" onClick={onClose} title="Close (Esc)"><CloseIcon /></button>
          </div>
        </div>

        <div className="shot-editor-body">
          <div className="shot-editor-stage" ref={stageRef}>
            {error && <div className="error-text">{error}</div>}
            {!ready && !error && <div className="progress-label">Loading…</div>}
            <canvas
              ref={displayRef}
              className="shot-editor-canvas"
              style={{ display: ready ? 'block' : 'none' }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            />
          </div>

          <div className="shot-editor-side">
            <div className="shot-editor-group">
              <div className="shot-editor-group-title">Инструмент</div>
              <div className="shot-editor-tools">
                {TOOLS.map((t) => (
                  <button
                    key={t.id}
                    className={`shot-editor-tool ${tool === t.id ? 'active' : ''}`}
                    onClick={() => { setTool(t.id); setSelection(null); }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {drawing ? (
              <div className="shot-editor-group">
                <div className="shot-editor-group-title">Рисование</div>
                <div className="shot-editor-swatches">
                  {SWATCHES.map((c) => (
                    <button
                      key={c}
                      className={`shot-editor-swatch ${color.toLowerCase() === c ? 'active' : ''}`}
                      style={{ background: c }}
                      onClick={() => setColor(c)}
                      title={c}
                    />
                  ))}
                  <input type="color" className="shot-editor-color" value={color} onChange={(e) => setColor(e.target.value)} title="Свой цвет" />
                </div>
                <div className="shot-editor-slider">
                  <div className="memory-slider-head"><span>Толщина</span><strong>{size}px</strong></div>
                  <input type="range" className="mem-range" min={1} max={60} step={1} value={size} onChange={(e) => setSize(Number(e.target.value))} />
                </div>
                <p className="settings-block-hint" style={{ margin: 0 }}>Рисуйте прямо на картинке. Каждый штрих — отдельный шаг назад.</p>
              </div>
            ) : (
              <div className="shot-editor-group">
                <div className="shot-editor-group-title">Кадрирование</div>
                <p className="settings-block-hint" style={{ margin: '0 0 8px' }}>Выделите область мышью на картинке.</p>
                <div className="shot-editor-row">
                  <button className="btn" onClick={applyCrop} disabled={!selection || busy}>Обрезать</button>
                  <button className="btn" onClick={() => setSelection(null)} disabled={!selection}>Снять</button>
                </div>
              </div>
            )}

            <div className="shot-editor-group">
              <div className="shot-editor-group-title">Поворот</div>
              <div className="shot-editor-row">
                <button className="btn" onClick={() => rotate(-1)} disabled={!ready || busy} title="Повернуть влево">↺ Влево</button>
                <button className="btn" onClick={() => rotate(1)} disabled={!ready || busy} title="Повернуть вправо">↻ Вправо</button>
                <button className="btn" onClick={flip} disabled={!ready || busy} title="Отразить по горизонтали">⇋ Зеркало</button>
              </div>
            </div>

            <div className="shot-editor-group">
              <div className="shot-editor-group-title">Цвет</div>
              {[
                ['brightness', 'Яркость'],
                ['contrast', 'Контраст'],
                ['saturate', 'Насыщенность'],
              ].map(([key, label]) => (
                <div className="shot-editor-slider" key={key}>
                  <div className="memory-slider-head"><span>{label}</span><strong>{adjust[key]}%</strong></div>
                  <input
                    type="range" className="mem-range" min={40} max={180} step={1}
                    value={adjust[key]}
                    onPointerDown={onSliderStart}
                    onKeyDown={onSliderStart}
                    onChange={(e) => onSliderChange(key, Number(e.target.value))}
                    onPointerUp={onSliderEnd}
                    onKeyUp={onSliderEnd}
                    onBlur={onSliderEnd}
                  />
                </div>
              ))}
            </div>

            <div className="shot-editor-row">
              <button className="btn" onClick={resetAll} disabled={!canUndo}>Reset всё</button>
            </div>

            {message && (
              <p className={message.error ? 'error-text' : 'hint-text'} style={{ marginTop: 10, fontSize: 13 }}>
                {message.error ? message.text : <><CheckIcon width={13} height={13} style={{ verticalAlign: -2 }} /> {message.text}</>}
              </p>
            )}
          </div>
        </div>

        <div className="shot-editor-foot">
          <button className="btn" onClick={copyToClipboard} disabled={!ready || busy}>
            <CopyIcon width={15} height={15} /> Copy
          </button>
          <button className="btn btn-primary" onClick={saveCopy} disabled={!ready || busy}>
            <DownloadCloudIcon width={16} height={16} /> Save как копию
          </button>
          <button className="btn btn-danger" onClick={replaceOriginal} disabled={!ready || busy || !canUndo}>
            Заменить оригинал
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
