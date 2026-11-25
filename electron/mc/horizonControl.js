// Horizon (the Rust game) has its own control socket (docs/api/agent-control.md of Horizon): a local TCP port behind a token that the game writes
// into a file named by --control-socket. One command per text line in, one JSON line out. The overlay uses two of its commands:
//   stats raw reset   every frame time (frame_ms, and cpu_ms / gpu_ms) since the last call — asked ten times a second, so each answer is the
//                     frames of the last tenth of a second
//   status            fps, chunks, mobs and more — asked twice a second
// Only this computer is talked to (127.0.0.1) and only with the token from the file the game made for this launch; the answers are checked
// number by number before anything is used.
const net = require('net');
const fs = require('fs');

const TOKEN = /^[0-9a-f]{32}$/;
const MAX_BUFFER = 4 * 1024 * 1024;
const num = (v, lo, hi, dflt = -1) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : dflt);
const series = (a, cap) => (Array.isArray(a) ? a.slice(-cap).filter((x) => typeof x === 'number' && Number.isFinite(x) && x > 0 && x < 5000) : []);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : -1);

// endpointFile: what the game writes ({"transport":"tcp","port":N,"token":"..."}). Returns { close() }.
// handlers: { onStats({ ft, gpuMs, cpuMs }), onStatus({ fps, chunks, mobs }), onClose() }
function watch(endpointFile, handlers) {
  let closed = false;
  let socket = null;
  let timer = null;
  let poll = null;

  function stop() {
    if (closed) return;
    closed = true;
    if (timer) clearTimeout(timer);
    if (poll) clearInterval(poll);
    try { if (socket) socket.destroy(); } catch { /* gone */ }
    try { handlers.onClose?.(); } catch { /* the owner is gone too */ }
  }

  function connect(endpoint) {
    let buf = '';
    const pending = []; // kinds of the commands that are waiting for their answer, in order
    let authed = false;
    let sinceStatus = 0;
    socket = net.connect({ host: '127.0.0.1', port: endpoint.port });
    socket.setNoDelay(true);
    socket.on('connect', () => { socket.write(`auth ${endpoint.token}\n`); pending.push('auth'); });
    socket.on('data', (d) => {
      buf += d.toString('utf8');
      if (buf.length > MAX_BUFFER) { stop(); return; }
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        const kind = pending.shift();
        let j = null;
        try { j = JSON.parse(line); } catch { continue; }
        if (!j || typeof j !== 'object') continue;
        if (kind === 'auth') {
          if (j.error) { stop(); return; }
          authed = true;
        } else if (kind === 'stats') {
          handlers.onStats?.({
            ft: series(j.frame_ms, 600),
            gpuMs: mean(series(j.gpu_ms, 600)),
            cpuMs: mean(series(j.cpu_ms, 600)),
          });
        } else if (kind === 'status') {
          handlers.onStatus?.({
            fps: num(j.fps, 0, 100000),
            chunks: num(j.chunks, 0, 10000000),
            mobs: num(j.mobs, 0, 10000000),
          });
        }
      }
    });
    socket.on('error', stop);
    socket.on('close', stop);
    // One command at a time: the next is sent when the answer to the last has come, so the answers stay in order
    poll = setInterval(() => {
      if (closed || !authed || pending.length) return;
      sinceStatus += 1;
      if (sinceStatus >= 5) { sinceStatus = 0; pending.push('status'); socket.write('status\n'); } else { pending.push('stats'); socket.write('stats raw reset\n'); }
    }, 100);
  }

  // The game makes the file a moment after it starts: wait for it (up to a minute and a half)
  const until = Date.now() + 90 * 1000;
  (function look() {
    if (closed) return;
    let endpoint = null;
    try {
      const j = JSON.parse(fs.readFileSync(endpointFile, 'utf8'));
      if (j && j.transport === 'tcp' && Number.isInteger(j.port) && j.port >= 1024 && j.port <= 65535 && typeof j.token === 'string' && TOKEN.test(j.token)) endpoint = { port: j.port, token: j.token };
    } catch { /* not there yet */ }
    if (endpoint) { connect(endpoint); return; }
    if (Date.now() > until) { stop(); return; }
    timer = setTimeout(look, 500);
  }());

  return { close: stop };
}

module.exports = { watch };
