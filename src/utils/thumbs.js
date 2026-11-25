// Screenshot thumbnails: the main process hands over small JPEG bytes (made once, cached on disk). Here they are asked for through a small queue
// (never more than a few at a time, and a card that scrolls out of view before its turn is dropped from the queue).
const LIMIT = 3;
const queue = [];
let running = 0;

function pump() {
  while (running < LIMIT && queue.length) {
    const job = queue.shift();
    if (job.cancelled) { job.resolve(null); continue; }
    running += 1;
    job.started = true;
    window.api.screenshots.thumbnail(job.item.instanceId, job.item.filename)
      .then((r) => job.resolve(r && r.ok && r.bytes ? r.bytes : null), () => job.resolve(null))
      .finally(() => { running -= 1; pump(); });
  }
}

// { promise: Promise<Uint8Array|null>, cancel() } — cancel() only matters while the job still waits in the queue.
export function queueThumb(item) {
  const job = { item, cancelled: false, started: false, resolve: null };
  const promise = new Promise((resolve) => { job.resolve = resolve; });
  queue.push(job);
  pump();
  return { promise, cancel: () => { if (!job.started) job.cancelled = true; } };
}

export function bytesToBlobUrl(bytes) {
  return URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
}

export function bytesToDataUrl(bytes) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(new Blob([bytes], { type: 'image/jpeg' }));
  });
}
