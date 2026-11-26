import { useEffect, useMemo, useState } from 'react';

function formatMb(mb) {
  if (mb == null) return '—';
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${Math.round(mb)} MB`;
}

function formatUptime(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h} ? ${m} mine` : m ? `${m} mine ${sec} on` : `${sec} on`;
}

// Area chart of a series over time. `limit` draws a dashed reference line
// (e.g. the memory allocated to the game).
function Chart({
  samples, pick, max, color, limit, limitLabel, unit,
}) {
  const W = 640;
  const H = 150;
  const PAD = 6;
  const values = samples.map(pick);
  const top = Math.max(max, ...values, 1);

  const points = values.map((v, i) => {
    const x = values.length > 1 ? PAD + (i / (values.length - 1)) * (W - PAD * 2) : W / 2;
    const y = H - PAD - (v / top) * (H - PAD * 2);
    return [x, y];
  });
  const line = points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = points.length > 1
    ? `${line} L${points[points.length - 1][0].toFixed(1)},${H - PAD} L${points[0][0].toFixed(1)},${H - PAD} Z`
    : '';
  const limitY = limit ? H - PAD - (Math.min(limit, top) / top) * (H - PAD * 2) : null;
  const last = points[points.length - 1];

  return (
    <svg className="monitor-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={f} x1={0} x2={W} y1={H - PAD - f * (H - PAD * 2)} y2={H - PAD - f * (H - PAD * 2)} className="monitor-grid" />
      ))}
      {area && <path d={area} fill={color} opacity="0.18" />}
      {line && <path d={line} fill="none" stroke={color} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
      {limitY !== null && (
        <>
          <line x1={0} x2={W} y1={limitY} y2={limitY} className="monitor-limit" vectorEffect="non-scaling-stroke" />
          <text x={W - 6} y={Math.max(12, limitY - 5)} textAnchor="end" className="monitor-limit-label">{limitLabel}</text>
        </>
      )}
      {last && <circle cx={last[0]} cy={last[1]} r="4" fill={color} vectorEffect="non-scaling-stroke" />}
      <text x={6} y={12} className="monitor-axis-label">{Math.round(top)}{unit}</text>
    </svg>
  );
}

// Live CPU/memory of the running game (see electron/mc/monitor.js). Keeps
// showing the last session's data after the game closes.
export default function MonitorTab({ instance, running, onOpenSettings }) {
  const [samples, setSamples] = useState([]);
  const [startedAt, setStartedAt] = useState(null);
  const [cores, setCores] = useState(1);
  const [maxMemoryMb, setMaxMemoryMb] = useState(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let cancelled = false;
    setSamples([]);
    window.api.monitor.history(instance.id).then((h) => {
      if (cancelled) return;
      setSamples(h.samples || []);
      setStartedAt(h.startedAt);
      setCores(h.cores || 1);
      setMaxMemoryMb(h.maxMemoryMb);
    });
    const off = window.api.monitor.onSample(({ instanceId, sample }) => {
      if (instanceId !== instance.id) return;
      setSamples((prev) => [...prev.slice(-399), sample]);
    });
    return () => { cancelled = true; off(); };
  }, [instance.id]);

  // A fresh launch starts a fresh series.
  useEffect(() => {
    if (running) {
      window.api.monitor.history(instance.id).then((h) => {
        setSamples(h.samples || []);
        setStartedAt(h.startedAt);
        setMaxMemoryMb(h.maxMemoryMb);
      });
    }
  }, [running, instance.id]);

  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);

  const last = samples[samples.length - 1];
  const stats = useMemo(() => {
    if (!samples.length) return null;
    return {
      peakRam: Math.max(...samples.map((s) => s.ramMb)),
      avgCpu: samples.reduce((sum, s) => sum + s.cpu, 0) / samples.length,
      peakCpu: Math.max(...samples.map((s) => s.cpu)),
    };
  }, [samples]);

  if (!samples.length) {
    return (
      <div className="empty-state">
        <p>{running ? 'Collecting the data... the graph will appear in a few seconds.' : 'Game\'s not running. Run the instance – here will appear graphics of the processor and memory in real time.'}</p>
      </div>
    );
  }

  const uptime = running && startedAt ? now - startedAt : samples[samples.length - 1].t - (startedAt || samples[0].t);
  const ramLimit = maxMemoryMb || null;

  return (
    <div className="monitor-tab">
      {!running && <p className="hint-text" style={{ marginBottom: 12 }}>The game is closed - the data of the last launch is shown.</p>}

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-card-label">Processor (whole system)</div>
          <div className="stat-card-value">{last.cpu.toFixed(1)}%</div>
          <div className="stat-card-note">{Math.round(last.cpuCore)}Percent of one nucleus. {cores} kernel</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">Memory of gameplay</div>
          <div className="stat-card-value">{formatMb(last.ramMb)}</div>
          <div className="stat-card-note">highlighted in the game: {formatMb(ramLimit)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">Free in the system</div>
          <div className="stat-card-value">{formatMb(last.sysFreeMb)}</div>
          <div className="stat-card-note">from {formatMb(last.sysTotalMb)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">{running ? 'At play.' : 'It lasted.'}</div>
          <div className="stat-card-value">{formatUptime(uptime)}</div>
          {last.threads && <div className="stat-card-note">streams {last.threads}</div>}
        </div>
      </div>

      <h2 className="section-heading">Processor</h2>
      <div className="monitor-card">
        <Chart samples={samples} pick={(s) => s.cpu} max={20} color="#7BD88F" unit="%" />
        {stats && <div className="monitor-foot">Average {stats.avgCpu.toFixed(1)}% {stats.peakCpu.toFixed(1)}%</div>}
      </div>

      <h2 className="section-heading">Memory.</h2>
      <div className="monitor-card">
        <Chart
          samples={samples}
          pick={(s) => s.ramMb}
          max={ramLimit || 1024}
          color="#E8A0B0"
          limit={ramLimit}
          limitLabel={ramLimit ? `limit ${formatMb(ramLimit)}` : ''}
          unit=" MB"
        />
        <div className="monitor-foot">
          {stats && <>Peak {formatMb(stats.peakRam)} · </>}
          The process includes Java service memory, so it may slightly exceed the limit.
        </div>
      </div>
      {ramLimit && stats && stats.peakRam >= ramLimit && (
        <p className="hint-text" style={{ marginTop: 12 }}>
          Memory reached a limit - if the game lays or flies, you can highlight more.{' '}
          <button className="btn-text" onClick={onOpenSettings}>Memory settings</button>
        </p>
      )}
    </div>
  );
}
