// Экономия ресурсов, пока лаунчер не на переднем плане (окно не в фокусе или свёрнуто — например, идёт игра):
//  • на <html> ставится data-inactive="true" — CSS замораживает анимации и выключает стекло (backdrop-filter);
//  • requestAnimationFrame откладывается, поэтому 3D-персонажи, частицы и прочие циклы отрисовки стоят, а при возвращении
//    продолжаются с того же места.
// Включается и выключается настройкой «Save resources in background» (по умолчанию включено).

const DEFERRED_BASE = 1e9; // номера отложенных кадров не пересекаются с настоящими
let installed = false;
let enabled = true;
let inactive = false;
let nextId = DEFERRED_BASE;
const deferred = new Map(); // id → callback
let realRaf = null;
let realCancel = null;

// Frame cap (Settings → Performance → «Animation rate»): requestAnimationFrame callbacks of all loops (3D character, hearts…)
// are collected and run together at most ps times a second. 0 = no cap, as the monitor refreshes. The loops measure time themselves,
// so a lower rate only makes motion less smooth, never slower.
let capMs = 0;
let lastRun = 0;
let capRaf = 0;
const queue = new Map(); // id → callback, waiting for the next allowed frame

function pump(ts) {
  capRaf = 0;
  if (!queue.size) return;
  if (capMs && ts + 4 < lastRun + capMs) { capRaf = realRaf(pump); return; }
  // the next slot is counted from the previous slot, not from "now": on a 100 Hz monitor 60 fps then really is ~60, not 50
  lastRun = capMs && ts - lastRun < capMs * 2 ? lastRun + capMs : ts;
  const list = [...queue.values()];
  queue.clear();
  for (const cb of list) {
    try { cb(ts); } catch (err) { console.error(err); } // one loop failing must not stop the others
  }
}

function flushQueue() {
  if (capRaf) { realCancel(capRaf); capRaf = 0; }
  const list = [...queue.values()];
  queue.clear();
  list.forEach((cb) => realRaf(cb));
}

function apply() {
  const off = enabled && inactive;
  document.documentElement.toggleAttribute('data-inactive', off);
  if (!off && deferred.size) {
    const list = [...deferred.values()];
    deferred.clear();
    list.forEach((cb) => realRaf(cb));
  }
  return off;
}

function evaluate() {
  inactive = document.hidden || !document.hasFocus();
  apply();
}

function install() {
  if (installed) return;
  installed = true;
  realRaf = window.requestAnimationFrame.bind(window);
  realCancel = window.cancelAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => {
    if (enabled && inactive) {
      const id = ++nextId;
      deferred.set(id, cb);
      return id;
    }
    if (capMs) {
      const id = ++nextId;
      queue.set(id, cb);
      if (!capRaf) capRaf = realRaf(pump);
      return id;
    }
    return realRaf(cb);
  };
  window.cancelAnimationFrame = (id) => {
    if (deferred.has(id)) deferred.delete(id);
    else if (queue.has(id)) queue.delete(id);
    else realCancel(id);
  };
  window.addEventListener('blur', evaluate);
  window.addEventListener('focus', evaluate);
  document.addEventListener('visibilitychange', evaluate);
  evaluate();
}

// on = false отключает экономию совсем (всё работает и в фоне, как раньше)
export function setBackgroundSaver(on) {
  enabled = on !== false;
  install();
  apply();
}

// fps: 0 (as the monitor) or a number to cap the animation rate at
export function setFrameCap(fps) {
  install();
  const n = Number(fps);
  capMs = Number.isFinite(n) && n >= 10 && n <= 240 ? 1000 / n : 0;
  if (!capMs) flushQueue();
}
