// Live resource monitor for running games: CPU and memory of the Java
// process, sampled every ~1.5s by one lightweight helper process per game
// (a PowerShell loop on Windows, a `ps` loop elsewhere) and kept in a small
// ring buffer so the Monitor tab can show history, including after the game
// has closed. Everything here is best-effort — if sampling can't start, the
// tab simply has no data.
const os = require('os');
const { spawn } = require('child_process');

const MAX_SAMPLES = 400;
const INTERVAL_MS = 1500;
const CORES = Math.max(1, os.cpus().length);

const monitors = new Map(); // instanceId -> { proc, samples, startedAt, lastCpuSec, lastAt }

const PS_SCRIPT = (pid, ms) => `
$ErrorActionPreference = 'SilentlyContinue'
$ic = [Globalization.CultureInfo]::InvariantCulture
while ($true) {
  $p = Get-Process -Id ${pid}
  if (-not $p) { break }
  $cpu = 0; if ($p.CPU) { $cpu = $p.CPU }
  [Console]::Out.WriteLine($cpu.ToString($ic) + '|' + $p.WorkingSet64 + '|' + $p.PrivateMemorySize64 + '|' + $p.Threads.Count)
  Start-Sleep -Milliseconds ${ms}
}
`;

function spawnSampler(pid) {
  if (process.platform === 'win32') {
    return spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS_SCRIPT(pid, INTERVAL_MS)], { windowsHide: true });
  }
  // %cpu (of one core, lifetime average on macOS) | rss KB
  const script = `while kill -0 ${pid} 2>/dev/null; do ps -o %cpu=,rss= -p ${pid} | awk '{print $1 "|" $2}'; sleep 1.5; done`;
  return spawn('sh', ['-c', script]);
}

function start(instanceId, pid, onSample) {
  stop(instanceId);
  if (!pid) return;
  const entry = {
    proc: null, samples: [], startedAt: Date.now(), lastCpuSec: null, lastAt: null,
  };
  monitors.set(instanceId, entry);
  let proc;
  try {
    proc = spawnSampler(pid);
  } catch {
    return;
  }
  entry.proc = proc;
  let buffer = '';
  proc.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    let idx;
    // eslint-disable-next-line no-cond-assign
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      const sample = parseLine(entry, line);
      if (!sample) continue;
      entry.samples.push(sample);
      if (entry.samples.length > MAX_SAMPLES) entry.samples.shift();
      try { onSample && onSample(sample); } catch { /* listener errors don't matter */ }
    }
  });
  proc.on('error', () => { /* sampler unavailable */ });
  proc.stderr.on('data', () => { /* ignore */ });
}

function parseLine(entry, line) {
  const parts = line.split('|');
  if (parts.length < 2) return null;
  const now = Date.now();
  let cpuCore = 0; // percent of ONE core (can exceed 100 for multi-threaded work)
  let ramMb;
  let privateMb = null;
  let threads = null;

  if (process.platform === 'win32') {
    const cpuSec = parseFloat(parts[0]);
    ramMb = Number(parts[1]) / 1048576;
    privateMb = Number(parts[2]) / 1048576;
    threads = Number(parts[3]) || null;
    if (Number.isNaN(cpuSec) || Number.isNaN(ramMb)) return null;
    if (entry.lastCpuSec !== null && now > entry.lastAt) {
      cpuCore = Math.max(0, ((cpuSec - entry.lastCpuSec) / ((now - entry.lastAt) / 1000)) * 100);
    }
    entry.lastCpuSec = cpuSec;
    entry.lastAt = now;
  } else {
    cpuCore = parseFloat(parts[0]) || 0;
    ramMb = (Number(parts[1]) || 0) / 1024;
  }
  return {
    t: now,
    cpu: Math.min(100, cpuCore / CORES), // share of the whole machine
    cpuCore,
    ramMb: Math.round(ramMb),
    privateMb: privateMb === null ? null : Math.round(privateMb),
    threads,
    sysFreeMb: Math.round(os.freemem() / 1048576),
    sysTotalMb: Math.round(os.totalmem() / 1048576),
  };
}

function stop(instanceId) {
  const entry = monitors.get(instanceId);
  if (entry?.proc) {
    try { entry.proc.kill(); } catch { /* already gone */ }
    entry.proc = null;
  }
}

function stopAll() {
  for (const id of monitors.keys()) stop(id);
}

function history(instanceId) {
  const entry = monitors.get(instanceId);
  return entry ? { samples: entry.samples, startedAt: entry.startedAt, cores: CORES } : { samples: [], startedAt: null, cores: CORES };
}

module.exports = { start, stop, stopAll, history };
