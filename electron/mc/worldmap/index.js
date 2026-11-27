// World map backend: lists a world's region files + spawn/player position and
// renders region tiles (in worker threads, cached on disk next to the
// launcher's other data, keyed by the region file's modification time).
const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');
const paths = require('../paths');
const { parseNbtFile } = require('../nbt');

// Where each dimension's region files live: the classic layout, and the newer
// one (Minecraft 26.x) that keeps every dimension under dimensions/<ns>/<name>.
const DIMENSIONS = {
  overworld: [path.join('dimensions', 'minecraft', 'overworld', 'region'), 'region'],
  nether: [path.join('dimensions', 'minecraft', 'the_nether', 'region'), path.join('DIM-1', 'region')],
  end: [path.join('dimensions', 'minecraft', 'the_end', 'region'), path.join('DIM1', 'region')],
};
const DIM_BY_ID = { 0: 'overworld', '-1': 'nether', 1: 'end' };
const DIM_BY_NAME = {
  'minecraft:overworld': 'overworld',
  'minecraft:the_nether': 'nether',
  'minecraft:the_end': 'end',
};

const MAX_WORKERS = 2;
let running = 0;
const queue = [];
const inflight = new Map();

function worldDir(instanceId, world) {
  if (!world || world.includes('/') || world.includes('\\') || world === '..' || world === '.') {
    throw new Error('Некорректное имя мира');
  }
  return path.join(paths.instanceGameDir(instanceId), 'saves', world);
}

function safeName(s) {
  return String(s).replace(/[^\w.-]/g, '_');
}

function num(v, fallback = null) {
  const n = typeof v === 'bigint' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}

function regionDir(worldPath, dim) {
  const candidates = DIMENSIONS[dim].map((sub) => path.join(worldPath, sub));
  return candidates.find((d) => fs.existsSync(d)) || candidates[0];
}

function listRegions(dir) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const n of names) {
    const m = /^r\.(-?\d+)\.(-?\d+)\.mca$/.exec(n);
    if (!m) continue;
    let st;
    try { st = fs.statSync(path.join(dir, n)); } catch { continue; }
    if (st.size < 8192) continue; // empty placeholder region
    out.push({ rx: Number(m[1]), rz: Number(m[2]), mtime: Math.round(st.mtimeMs), size: st.size });
  }
  return out;
}

function getInfo(instanceId, world) {
  const dir = worldDir(instanceId, world);
  if (!fs.existsSync(dir)) return { ok: false, error: 'World не найден' };

  const dimensions = {};
  for (const dim of Object.keys(DIMENSIONS)) {
    const regions = listRegions(regionDir(dir, dim));
    if (regions.length) dimensions[dim] = regions;
  }

  let spawn = null;
  let player = null;
  let version = null;
  let level = {};
  try {
    level = parseNbtFile(fs.readFileSync(path.join(dir, 'level.dat'))).Data || {};
    version = level.Version?.Name || null;
    const sx = num(level.SpawnX);
    const sz = num(level.SpawnZ);
    if (sx !== null && sz !== null) spawn = { x: sx, z: sz };
    // 26.x moved the world spawn into a compound.
    const sp = level.spawn?.pos;
    if (Array.isArray(sp) && sp.length >= 3) spawn = { x: num(sp[0], 0), z: num(sp[2], 0) };
  } catch {
    /* level.dat missing or unreadable — the map still works without markers */
  }

  // The player: embedded in level.dat (old), or players/data/<uuid>.dat (new).
  let playerTag = level.Player || null;
  if (!playerTag && Array.isArray(level.singleplayer_uuid) && level.singleplayer_uuid.length === 4) {
    const hex = level.singleplayer_uuid.map((n) => (n >>> 0).toString(16).padStart(8, '0')).join('');
    const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    try {
      playerTag = parseNbtFile(fs.readFileSync(path.join(dir, 'players', 'data', `${uuid}.dat`)));
    } catch { /* no player file yet */ }
  }
  const pos = playerTag?.Pos;
  if (Array.isArray(pos) && pos.length >= 3) {
    const d = playerTag.Dimension;
    player = {
      x: num(pos[0], 0),
      y: num(pos[1], 0),
      z: num(pos[2], 0),
      dimension: typeof d === 'string' ? (DIM_BY_NAME[d] || 'overworld') : (DIM_BY_ID[String(d)] || 'overworld'),
    };
  }
  return { ok: true, dimensions, spawn, player, version };
}

function runJob(job) {
  return new Promise((resolve) => {
    const worker = new Worker(path.join(__dirname, 'worker.js'), { workerData: job });
    let settled = false;
    const done = (res) => {
      if (settled) return;
      settled = true;
      resolve(res);
    };
    worker.once('message', (msg) => { done(msg); worker.terminate(); });
    worker.once('error', (err) => done({ ok: false, error: err.message }));
    worker.once('exit', () => done({ ok: false, error: 'worker exited' }));
  });
}

function schedule(job) {
  return new Promise((resolve) => {
    queue.push({ job, resolve });
    pump();
  });
}

function pump() {
  while (running < MAX_WORKERS && queue.length) {
    const { job, resolve } = queue.shift();
    running += 1;
    runJob(job).then(resolve).finally(() => {
      running -= 1;
      pump();
    });
  }
}

async function getTile(instanceId, world, dimension, rx, rz) {
  try {
    if (!DIMENSIONS[dimension]) return { ok: false, error: 'Неизвестное измерение' };
    rx = Number(rx); rz = Number(rz);
    if (!Number.isInteger(rx) || !Number.isInteger(rz)) return { ok: false, error: 'Bad coords' };
    const file = path.join(regionDir(worldDir(instanceId, world), dimension), `r.${rx}.${rz}.mca`);
    const st = await fs.promises.stat(file).catch(() => null);
    if (!st) return { ok: true, empty: true };

    const cacheDir = path.join(paths.root(), 'worldmap', safeName(instanceId), safeName(world), dimension);
    const prefix = `r.${rx}.${rz}.`;
    const out = path.join(cacheDir, `${prefix}${Math.round(st.mtimeMs)}.png`);

    if (!fs.existsSync(out)) {
      const key = out;
      let pending = inflight.get(key);
      if (!pending) {
        pending = schedule({ file, out, dimension }).finally(() => inflight.delete(key));
        inflight.set(key, pending);
      }
      const res = await pending;
      if (!res.ok) return { ok: false, error: res.error };
      if (!res.chunks) {
        return { ok: true, empty: true, unsupported: res.unsupported || 0 };
      }
      // Drop tiles rendered from older versions of this region.
      try {
        for (const n of fs.readdirSync(cacheDir)) {
          if (n.startsWith(prefix) && path.join(cacheDir, n) !== out) fs.rmSync(path.join(cacheDir, n), { force: true });
        }
      } catch { /* best effort */ }
    }
    const png = await fs.promises.readFile(out);
    return { ok: true, dataUrl: `data:image/png;base64,${png.toString('base64')}` };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { getInfo, getTile };
