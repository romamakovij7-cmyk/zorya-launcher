// Async extraction of a modpack archive's "overrides" into an instance folder.
//
// The old code did `entry.getData()` + `mkdirSync` + `writeFileSync` in a plain
// loop. All of that is synchronous work on the main process, and `await
// control.gate()` on an already-resolved promise never lets the event loop
// breathe — a pack with a few thousand files froze the whole launcher window
// until the loop finished. Here inflating goes through async zlib (worker
// threads), writing through fs.promises, a few files at a time, so the UI keeps
// running and can show progress.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');

const inflateRaw = promisify(zlib.inflateRaw);
const fsp = fs.promises;
const WORKERS = 4;

// A few KB of zip can inflate to gigabytes. The size the archive declares is
// what we allow (its header can lie, so inflating is capped at it), and never
// more than this per file.
const MAX_ENTRY_BYTES = 1024 * 1024 * 1024;

async function entryData(entry) {
  const raw = entry.getCompressedData();
  if (raw.length === 0) return Buffer.alloc(0);
  const method = entry.header.method;
  const declared = Number(entry.header.size) || 0;
  if (declared > MAX_ENTRY_BYTES) throw new Error(`File в архиве слишком большой: ${entry.entryName}`);
  if (method === 0) return raw; // stored
  if (method === 8) {
    try {
      return await inflateRaw(raw, { maxOutputLength: Math.max(declared, 1) });
    } catch (err) {
      if (err.code === 'ERR_BUFFER_TOO_LARGE') throw new Error(`Архив повреждён или это «бомба» (${entry.entryName})`);
      throw err;
    }
  }
  throw new Error(`Неподдерживаемый способ сжатия в архиве (${method})`);
}

// Entries under any of `prefixes` ('' = the whole archive) -> [{ entry, dest }].
// Where two entries map to the same file the later one wins (same as writing
// them in order), anything that would land outside the instance folder is
// skipped, and `skip(rel)` can leave chosen paths out (rel uses '/').
function collectOverrideJobs(zip, prefixes, gameDir, { skip } = {}) {
  const root = path.resolve(gameDir) + path.sep;
  const byDest = new Map();
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const name = entry.entryName.replace(/\\/g, '/');
    const prefix = prefixes.find((p) => name.startsWith(p));
    if (prefix === undefined) continue;
    const rel = name.substring(prefix.length);
    if (!rel || (skip && skip(rel))) continue;
    const dest = path.resolve(gameDir, rel);
    if (!dest.startsWith(root)) continue;
    byDest.set(dest, entry);
  }
  return [...byDest].map(([dest, entry]) => ({ entry, dest }));
}

async function extractJobs(jobs, { control, onProgress } = {}) {
  const total = jobs.length;
  let next = 0;
  let done = 0;
  let lastReport = 0;
  onProgress?.({ completed: 0, total });

  async function worker() {
    for (;;) {
      if (control) await control.gate(); // pause / cancel (throws when cancelled)
      const job = jobs[next]; // eslint-disable-line no-plusplus
      next += 1;
      if (!job) return;
      const data = await entryData(job.entry);
      await fsp.mkdir(path.dirname(job.dest), { recursive: true });
      await fsp.writeFile(job.dest, data);
      done += 1;
      const now = Date.now();
      if (now - lastReport > 120 || done === total) {
        lastReport = now;
        onProgress?.({ completed: done, total });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(WORKERS, Math.max(1, total)) }, worker));
}

module.exports = { collectOverrideJobs, extractJobs, entryData };
