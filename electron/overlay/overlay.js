// Draws what the main process sends (see electron/mc/overlay.js). No network, no storage.
(() => {
  const $ = (id) => document.getElementById(id);
  const panel = $('panel');
  const HISTORY_MS = 20000;
  let frames = []; // frame times in ms, oldest first; their sum is the time they cover
  let covered = 0;

  const level = (v, ok, warn) => (v <= ok ? 'var(--ok)' : v <= warn ? 'var(--warn)' : 'var(--bad)');
  const fpsColor = (f) => (f >= 120 ? 'var(--ok)' : f >= 60 ? '#ffffff' : f >= 30 ? 'var(--warn)' : 'var(--bad)');
  const comma = (v, d = 1) => v.toFixed(d).replace('.', ',');
  const mb = (v) => (v >= 10240 ? `${comma(v / 1024)} ГБ` : v >= 1024 ? `${comma(v / 1024, 2)} ГБ` : `${Math.round(v)} МБ`);

  function stats() {
    // average over the last second; 1% low over the last 10 seconds (the mean of the worst 1% of frames)
    let t = 0; let n = 0;
    for (let i = frames.length - 1; i >= 0 && t < 1000; i -= 1) { t += frames[i]; n += 1; }
    const avg = t > 0 ? (n * 1000) / t : -1;
    let t10 = 0; const recent = [];
    for (let i = frames.length - 1; i >= 0 && t10 < 10000; i -= 1) { t10 += frames[i]; recent.push(frames[i]); }
    let low = -1;
    if (recent.length >= 20) {
      recent.sort((a, b) => b - a);
      const k = Math.max(1, Math.floor(recent.length * 0.01));
      let sum = 0; for (let i = 0; i < k; i += 1) sum += recent[i];
      low = 1000 / (sum / k);
    }
    return { avg, low };
  }

  // The frame-time graph: the worst frame of every slice of the last 20 seconds, as a filled line; green / yellow / red by how slow.
  function drawGraph() {
    const c = $('graph');
    const g = c.getContext('2d');
    const W = c.width; const H = c.height;
    g.clearRect(0, 0, W, H);
    if (frames.length < 2) return;
    let max = 0;
    for (const f of frames) if (f > max) max = f;
    const scale = max <= 28 ? 34 : max <= 50 ? 60 : max <= 100 ? 110 : 200; // ms at the top
    const y = (ms) => H - Math.min(1, ms / scale) * (H - 4) - 2;
    // 60 and 30 fps lines
    g.lineWidth = 1; g.setLineDash([6, 6]);
    for (const [ms, col] of [[16.67, 'rgba(61,220,132,0.42)'], [33.33, 'rgba(255,204,51,0.42)']]) {
      if (ms < scale) { g.strokeStyle = col; g.beginPath(); g.moveTo(0, Math.round(y(ms)) + 0.5); g.lineTo(W, Math.round(y(ms)) + 0.5); g.stroke(); }
    }
    g.setLineDash([]);
    // one point per two pixels
    const pts = [];
    let t = 0; let i = 0;
    const cols = Math.floor(W / 2);
    for (let x = 0; x < cols; x += 1) {
      const until = ((x + 1) / cols) * covered;
      let worst = 0;
      while (i < frames.length && t < until) { worst = Math.max(worst, frames[i]); t += frames[i]; i += 1; }
      pts.push(worst > 0 ? worst : (pts.length ? pts[pts.length - 1] : 0));
    }
    const fill = g.createLinearGradient(0, 0, 0, H);
    fill.addColorStop(0, 'rgba(255,159,195,0.38)'); fill.addColorStop(1, 'rgba(255,159,195,0.02)');
    g.beginPath(); g.moveTo(0, H);
    pts.forEach((v, x) => g.lineTo(x * 2, y(v)));
    g.lineTo((pts.length - 1) * 2, H); g.closePath(); g.fillStyle = fill; g.fill();
    g.lineWidth = 2.2; g.lineJoin = 'round';
    for (let x = 1; x < pts.length; x += 1) {
      const v = Math.max(pts[x], pts[x - 1]);
      g.strokeStyle = v <= 16.7 ? '#3ddc84' : v <= 33.4 ? '#ffcc33' : '#ff5a5a';
      g.beginPath(); g.moveTo((x - 1) * 2, y(pts[x - 1])); g.lineTo(x * 2, y(pts[x])); g.stroke();
    }
    // where the 60/30 lines are named: only if they are on the graph
    $('graph').parentElement.querySelector('.t60').style.top = `${Math.max(1, (y(16.67) / H) * 100 - 9)}%`;
    $('graph').parentElement.querySelector('.t30').style.display = 33.33 < scale ? '' : 'none';
    $('graph').parentElement.querySelector('.t30').style.top = `${Math.max(1, (y(33.33) / H) * 100 - 9)}%`;
  }

  function bar(id, pct, ok, warn) {
    const el = $(id);
    el.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    el.style.background = pct >= 0 ? level(pct, ok, warn) : 'transparent';
  }

  let sizeKey = '';
  function reportSize() {
    const key = `${panel.offsetWidth}x${panel.offsetHeight}`;
    if (key !== sizeKey) { sizeKey = key; window.overlay.reportSize(panel.offsetWidth + 16, panel.offsetHeight + 16); }
  }

  window.overlay.onConfig((c) => {
    if (c.mode === 'compact' || c.mode === 'full') panel.dataset.mode = c.mode;
    if (typeof c.opacity === 'number') document.documentElement.style.setProperty('--alpha', String(Math.max(0.3, Math.min(1, c.opacity))));
    if (c.keyLabel) $('hint').textContent = `${c.keyLabel} — скрыть`;
    requestAnimationFrame(reportSize);
  });

  window.overlay.onMetrics((m) => {
    if (m.keyLabel) $('hint').textContent = `${m.keyLabel} — скрыть`;
    for (const f of m.ft || []) { frames.push(f); covered += f; }
    while (covered > HISTORY_MS && frames.length) covered -= frames.shift();
    const s = stats();
    const fps = m.fps >= 0 ? m.fps : Math.round(s.avg);
    $('fps').textContent = fps >= 0 ? String(fps) : '--';
    $('fps').style.color = fpsColor(fps);
    $('avg').textContent = s.avg >= 0 ? Math.round(s.avg) : '--';
    $('low').textContent = s.low >= 0 ? Math.round(s.low) : '--';
    $('low').style.color = s.low >= 0 ? fpsColor(s.low) : '';
    const last = frames.length ? frames[frames.length - 1] : -1;
    $('ft').textContent = last >= 0 ? `${comma(last)} мс` : '--';
    drawGraph();

    $('cpu').textContent = m.cpu >= 0 ? `${Math.round(m.cpu)}%` : '--';
    bar('cpu-bar', m.cpu, 35, 70);
    $('gpu').textContent = m.gpu >= 0 ? `${Math.round(m.gpu)}%` : '--';
    bar('gpu-bar', m.gpu, 50, 85);
    $('gpu-t').textContent = m.gpuTemp >= 0 ? `${m.gpuTemp}°C` : '';
    $('gpu-t').style.color = m.gpuTemp >= 0 ? level(m.gpuTemp, 72, 83) : '';
    $('ram').textContent = m.ramMb >= 0 ? mb(m.ramMb) : '--';
    $('vram').textContent = m.vramMb >= 0 ? mb(m.vramMb) : '--';
    const heapPct = m.hm > 0 ? (m.hu / m.hm) * 100 : -1;
    $('heap-t').textContent = m.hu >= 0 ? `${mb(m.hu)} из ${mb(m.hm)}` : '';
    bar('heap-bar', heapPct, 60, 85);
    $('tps').textContent = m.tps >= 0 ? comma(m.tps) : '--';
    $('tps').style.color = m.tps >= 19 ? 'var(--ok)' : m.tps >= 15 ? 'var(--warn)' : m.tps >= 0 ? 'var(--bad)' : '';
    $('ent').textContent = m.ent >= 0 ? String(m.ent) : '--';
    $('chk').textContent = m.chk >= 0 ? String(m.chk) : '--';
    requestAnimationFrame(reportSize);
  });
})();
