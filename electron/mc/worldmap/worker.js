// Runs in a worker thread: renders one region file to a PNG on disk, so the
// (CPU-heavy) chunk decoding never blocks the launcher's main process.
const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const { renderRegion, encodePng, SIZE } = require('./regionRender');

try {
  const buf = fs.readFileSync(workerData.file);
  const { rgba, chunks, unsupported } = renderRegion(buf, workerData.dimension);
  if (!chunks) {
    // Nothing renderable (empty or pre-1.13 region): no tile, just the counts.
    parentPort.postMessage({ ok: true, chunks, unsupported });
    return;
  }
  fs.mkdirSync(path.dirname(workerData.out), { recursive: true });
  const tmp = `${workerData.out}.tmp`;
  fs.writeFileSync(tmp, encodePng(rgba, SIZE, SIZE));
  fs.renameSync(tmp, workerData.out);
  parentPort.postMessage({ ok: true, chunks, unsupported });
} catch (err) {
  parentPort.postMessage({ ok: false, error: err.message });
}
