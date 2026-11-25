// Folder-size lookups for the library tiles. Each one walks a whole instance
// directory in the main process, so run at most two at a time and remember
// results for a while — navigating away and back shouldn't rescan everything.
const TTL_MS = 60_000;
const cache = new Map(); // id -> { at, info }
const pending = new Map(); // id -> Promise
const queue = [];
let active = 0;

function pump() {
  while (active < 2 && queue.length) {
    const job = queue.shift();
    active++;
    window.api.instances.getSize(job.id)
      .then((res) => job.resolve(res?.ok ? res : null))
      .catch(() => job.resolve(null))
      .finally(() => { active--; pump(); });
  }
}

export function getInstanceSize(id) {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL_MS) return Promise.resolve(hit.info);
  if (pending.has(id)) return pending.get(id);
  const promise = new Promise((resolve) => {
    queue.push({
      id,
      resolve: (info) => {
        if (info) cache.set(id, { at: Date.now(), info });
        pending.delete(id);
        resolve(info);
      },
    });
    pump();
  });
  pending.set(id, promise);
  return promise;
}

export function cachedInstanceSize(id) {
  return cache.get(id)?.info || null;
}
