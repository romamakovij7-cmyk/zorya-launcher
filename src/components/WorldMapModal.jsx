import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CloseIcon } from './Icons.jsx';

const REGION = 512; // blocks per region side
const MIN_SCALE = 0.08; // screen px per block
const MAX_SCALE = 8;
const MAX_PARALLEL = 3;

const DIM_LABELS = { overworld: 'Обычный мир', nether: 'Незер', end: 'Энд' };

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

// A view that shows every region of a dimension.
function fitView(regions, w, h) {
  const minX = Math.min(...regions.map((r) => r.rx)) * REGION;
  const maxX = (Math.max(...regions.map((r) => r.rx)) + 1) * REGION;
  const minZ = Math.min(...regions.map((r) => r.rz)) * REGION;
  const maxZ = (Math.max(...regions.map((r) => r.rz)) + 1) * REGION;
  const scale = clamp(Math.min(w / (maxX - minX), h / (maxZ - minZ)) * 0.92, MIN_SCALE, 2);
  return { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, scale };
}

export default function WorldMapModal({ instanceId, world, onClose }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  const [dimension, setDimension] = useState('overworld');
  const [pending, setPending] = useState(0);
  const [showGrid, setShowGrid] = useState(true);
  const [readout, setReadout] = useState(null);
  const [emptyNote, setEmptyNote] = useState(false);
  const [tileError, setTileError] = useState(null);

  // Mutable view/tile state lives in refs so panning never re-renders React.
  const view = useRef({ x: 0, z: 0, scale: 0.5 });
  const tiles = useRef(new Map()); // `${dim}:${rx}:${rz}` -> { img, status }
  const queue = useRef([]);
  const active = useRef(0);
  const stats = useRef({ ok: 0, unsupported: 0 });
  const raf = useRef(0);
  const drag = useRef(null);
  const infoRef = useRef(null);
  const dimRef = useRef('overworld');
  const gridRef = useRef(true);
  const size = useRef({ w: 0, h: 0, dpr: 1 });

  infoRef.current = info;
  dimRef.current = dimension;
  gridRef.current = showGrid;

  const draw = useCallback(() => {
    raf.current = 0;
    const canvas = canvasRef.current;
    const data = infoRef.current;
    if (!canvas || !data) return;
    const ctx = canvas.getContext('2d');
    const { w, h, dpr } = size.current;
    const { x, z, scale } = view.current;
    const dim = dimRef.current;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#1b1116';
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = scale < 1;

    const toScreenX = (bx) => (bx - x) * scale + w / 2;
    const toScreenZ = (bz) => (bz - z) * scale + h / 2;

    const regions = data.dimensions[dim] || [];
    const wanted = [];
    for (const r of regions) {
      const sx = toScreenX(r.rx * REGION);
      const sz = toScreenZ(r.rz * REGION);
      const px = REGION * scale;
      if (sx > w || sz > h || sx + px < 0 || sz + px < 0) continue;
      const key = `${dim}:${r.rx}:${r.rz}`;
      const tile = tiles.current.get(key);
      if (tile?.img) {
        ctx.drawImage(tile.img, Math.floor(sx), Math.floor(sz), Math.ceil(px) + 1, Math.ceil(px) + 1);
      } else if (!tile) {
        wanted.push({ key, r, d: Math.hypot(r.rx * REGION + 256 - x, r.rz * REGION + 256 - z) });
      } else if (tile.status === 'loading') {
        ctx.fillStyle = 'rgba(255,255,255,0.04)';
        ctx.fillRect(sx, sz, px, px);
      }
      if (gridRef.current) {
        ctx.strokeStyle = 'rgba(255,255,255,0.13)';
        ctx.lineWidth = 1;
        ctx.strokeRect(Math.floor(sx) + 0.5, Math.floor(sz) + 0.5, px, px);
      }
    }

    // Chunk grid once zoomed in far enough to be useful.
    if (gridRef.current && scale >= 2) {
      ctx.strokeStyle = 'rgba(255,255,255,0.07)';
      ctx.beginPath();
      const x0 = Math.floor((x - w / 2 / scale) / 16) * 16;
      const x1 = x + w / 2 / scale;
      const z0 = Math.floor((z - h / 2 / scale) / 16) * 16;
      const z1 = z + h / 2 / scale;
      for (let bx = x0; bx <= x1; bx += 16) {
        const sx = Math.floor(toScreenX(bx)) + 0.5;
        ctx.moveTo(sx, 0); ctx.lineTo(sx, h);
      }
      for (let bz = z0; bz <= z1; bz += 16) {
        const sz = Math.floor(toScreenZ(bz)) + 0.5;
        ctx.moveTo(0, sz); ctx.lineTo(w, sz);
      }
      ctx.stroke();
    }

    // Markers
    const marker = (bx, bz, color, label, shape) => {
      const sx = toScreenX(bx);
      const sz = toScreenZ(bz);
      if (sx < -20 || sz < -20 || sx > w + 20 || sz > h + 20) return;
      ctx.save();
      ctx.translate(sx, sz);
      ctx.fillStyle = color;
      ctx.strokeStyle = '#120608';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      if (shape === 'diamond') {
        ctx.moveTo(0, -9); ctx.lineTo(8, 0); ctx.lineTo(0, 9); ctx.lineTo(-8, 0); ctx.closePath();
      } else {
        ctx.arc(0, 0, 6.5, 0, Math.PI * 2);
      }
      ctx.stroke();
      ctx.fill();
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(10,4,6,0.9)';
      ctx.strokeText(label, 13, 0);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, 13, 0);
      ctx.restore();
    };
    if (data.spawn && dim === 'overworld') marker(data.spawn.x, data.spawn.z, '#f5c542', 'Спавн', 'diamond');
    if (data.player && data.player.dimension === dim) marker(data.player.x, data.player.z, '#ff5d7a', 'Player', 'dot');

    if (wanted.length) {
      wanted.sort((a, b) => a.d - b.d);
      for (const item of wanted.slice(0, 24)) {
        if (!tiles.current.has(item.key)) {
          tiles.current.set(item.key, { img: null, status: 'queued' });
          queue.current.push({ ...item, dim });
        }
      }
      pumpRef.current();
    }
  }, []);

  const requestDraw = useCallback(() => {
    if (!raf.current) raf.current = requestAnimationFrame(draw);
  }, [draw]);

  const pumpRef = useRef(() => {});
  pumpRef.current = () => {
    while (active.current < MAX_PARALLEL && queue.current.length) {
      const { key, r, dim } = queue.current.shift();
      // Stale request (user switched dimension): forget it so it can be re-requested.
      if (dim !== dimRef.current) { tiles.current.delete(key); continue; }
      active.current += 1;
      setPending((n) => n + 1);
      tiles.current.set(key, { img: null, status: 'loading' });
      window.api.worldmap.tile(instanceId, world, dim, r.rx, r.rz).then((res) => {
        if (res?.ok && res.dataUrl) {
          const img = new Image();
          img.onload = () => {
            tiles.current.set(key, { img, status: 'done' });
            stats.current.ok += 1;
            requestDraw();
          };
          img.src = res.dataUrl;
        } else {
          if (res && res.ok === false) setTileError(res.error || 'error отрисовки');
          if (res?.unsupported) stats.current.unsupported += res.unsupported;
          tiles.current.set(key, { img: null, status: 'empty' });
          if (!stats.current.ok && stats.current.unsupported) setEmptyNote(true);
        }
      }).catch((err) => {
        setTileError(String(err?.message || err));
        tiles.current.set(key, { img: null, status: 'empty' });
      }).finally(() => {
        active.current -= 1;
        setPending((n) => n - 1);
        pumpRef.current();
        requestDraw();
      });
    }
  };

  // Load world info, then centre the view on the player / spawn.
  useEffect(() => {
    let cancelled = false;
    window.api.worldmap.info(instanceId, world).then((res) => {
      if (cancelled) return;
      if (!res?.ok) { setError(res?.error || 'Failed прочитать мир'); return; }
      const dims = Object.keys(res.dimensions);
      if (!dims.length) { setError('В этом мире ещё нет исследованных областей.'); return; }
      const startDim = res.player && res.dimensions[res.player.dimension]
        ? res.player.dimension
        : (res.dimensions.overworld ? 'overworld' : dims[0]);
      const regions = res.dimensions[startDim];
      const inRegions = (p) => regions.some((r) => Math.floor(p.x / REGION) === r.rx && Math.floor(p.z / REGION) === r.rz);
      const focus = [res.player && res.player.dimension === startDim ? res.player : null,
        startDim === 'overworld' ? res.spawn : null].find((p) => p && inRegions(p));
      if (focus) {
        view.current = { x: focus.x, z: focus.z, scale: 1 };
      } else {
        // Nothing explored around the player/spawn: show the explored area instead.
        view.current = fitView(regions, size.current.w || 1000, size.current.h || 600);
      }
      setDimension(startDim);
      setInfo(res);
    });
    return () => { cancelled = true; };
  }, [instanceId, world]);

  // Canvas size tracking
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return undefined;
    const apply = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      size.current = { w, h, dpr };
      requestDraw();
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [requestDraw, info]);

  useEffect(() => { requestDraw(); }, [info, dimension, showGrid, requestDraw]);
  // Reset the id too: React StrictMode (dev) runs this cleanup and then re-mounts,
  // and a stale non-zero id would make requestDraw think a frame is still queued.
  useEffect(() => () => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = 0;
  }, []);

  // Wheel zoom (needs a non-passive listener to preventDefault).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left - rect.width / 2;
      const my = e.clientY - rect.top - rect.height / 2;
      const v = view.current;
      const next = clamp(v.scale * (e.deltaY < 0 ? 1.18 : 1 / 1.18), MIN_SCALE, MAX_SCALE);
      // keep the block under the cursor fixed
      v.x += mx / v.scale - mx / next;
      v.z += my / v.scale - my / next;
      v.scale = next;
      requestDraw();
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [requestDraw, info]);

  // Esc closes
  useEffect(() => {
    const onKey = (e) => { if (e.code === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function switchDimension(dim) {
    if (dim === dimension) return;
    queue.current = [];
    for (const [key, t] of tiles.current) {
      if (t.status === 'queued') tiles.current.delete(key);
    }
    const regions = info.dimensions[dim];
    const focus = info.player && info.player.dimension === dim
      ? info.player
      : (dim === 'overworld' && info.spawn ? info.spawn : null);
    view.current = focus
      ? { x: focus.x, z: focus.z, scale: view.current.scale }
      : { x: regions[0].rx * REGION + 256, z: regions[0].rz * REGION + 256, scale: view.current.scale };
    setDimension(dim);
  }

  function goTo(point, dim) {
    if (!point) return;
    if (dim !== dimension) { switchDimension(dim); }
    view.current = { x: point.x, z: point.z, scale: Math.max(view.current.scale, 1) };
    requestDraw();
  }

  function fitAll() {
    view.current = fitView(info.dimensions[dimension], size.current.w, size.current.h);
    requestDraw();
  }

  function onPointerDown(e) {
    if (e.button !== 0 && e.button !== 1) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY };
  }

  function onPointerMove(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const v = view.current;
    const bx = Math.floor((e.clientX - rect.left - rect.width / 2) / v.scale + v.x);
    const bz = Math.floor((e.clientY - rect.top - rect.height / 2) / v.scale + v.z);
    setReadout({ x: bx, z: bz });
    if (!drag.current) return;
    v.x -= (e.clientX - drag.current.x) / v.scale;
    v.z -= (e.clientY - drag.current.y) / v.scale;
    drag.current = { x: e.clientX, y: e.clientY };
    requestDraw();
  }

  function onPointerUp() { drag.current = null; }

  const dims = info ? Object.keys(info.dimensions) : [];

  return createPortal(
    <div className="shot-editor-overlay">
      <div className="file-editor worldmap-modal">
        <div className="shot-editor-head">
          <div style={{ minWidth: 0 }}>
            <div className="shot-editor-title">Карта мира · {world}</div>
            <div className="shot-editor-sub">
              {info?.version ? `Minecraft ${info.version} · ` : ''}колесо — масштаб, перетаскивание — перемещение
            </div>
          </div>
          <div className="shot-editor-head-actions">
            {dims.length > 1 && (
              <div className="pill-tabs file-editor-modes">
                {dims.map((d) => (
                  <button key={d} className={`pill-tab ${dimension === d ? 'active' : ''}`} onClick={() => switchDimension(d)}>
                    {DIM_LABELS[d]}
                  </button>
                ))}
              </div>
            )}
            <button className="icon-btn" onClick={onClose} title="Close (Esc)"><CloseIcon /></button>
          </div>
        </div>

        {error && <div className="error-text" style={{ padding: 24 }}>{error}</div>}
        {!info && !error && <div className="progress-label" style={{ padding: 24 }}>Чтение мира…</div>}

        {info && (
          <>
            <div className="file-editor-tools">
              <button className="btn" onClick={fitAll}>Весь мир</button>
              {info.player && (
                <button className="btn" onClick={() => goTo(info.player, info.player.dimension)}>К игроку</button>
              )}
              {info.spawn && info.dimensions.overworld && (
                <button className="btn" onClick={() => goTo(info.spawn, 'overworld')}>К спавну</button>
              )}
              <label className="snapshot-toggle">
                сетка
                <input type="checkbox" className="switch small" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />
              </label>
              <span className="worldmap-coords">
                {readout ? `X ${readout.x}  Z ${readout.z}` : ''}
              </span>
            </div>
            <div className="worldmap-canvas-wrap" ref={wrapRef}>
              <canvas
                ref={canvasRef}
                className="worldmap-canvas"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onPointerLeave={() => setReadout(null)}
              />
              {pending > 0 && <div className="worldmap-loading">Отрисовка карты…</div>}
              {tileError && (
                <div className="worldmap-note">Failed отрисовать карту: {tileError}</div>
              )}
              {emptyNote && (
                <div className="worldmap-note">
                  Этот мир создан в версии Minecraft до 1.13 — карта поддерживает только миры 1.13 и новее.
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
