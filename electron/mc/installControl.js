// Pause / resume / cancel switch for a long download (a modpack install).
// Downloaders call `await control.gate()` between units of work: it waits while
// paused and throws a CANCELLED error once cancelled. `signal` aborts requests
// that are in flight when the user cancels.
class InstallControl {
  constructor() {
    this.cancelled = false;
    this.paused = false;
    this.waiters = [];
    this.controller = new AbortController();
  }

  get signal() { return this.controller.signal; }

  pause() { this.paused = true; }

  resume() {
    this.paused = false;
    const list = this.waiters;
    this.waiters = [];
    list.forEach((r) => r());
  }

  cancel() {
    this.cancelled = true;
    this.controller.abort();
    this.resume();
  }

  async gate() {
    while (this.paused && !this.cancelled) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => this.waiters.push(r));
    }
    if (this.cancelled) throw cancelError();
  }
}

function cancelError() {
  const err = new Error('Loading отменена');
  err.code = 'CANCELLED';
  return err;
}

const isCancel = (err) => !!err && (err.code === 'CANCELLED' || err.name === 'AbortError');

// Removes what a cancelled install left behind (the half-built instance folder).
// Async: deleting a multi-GB half-copied folder with rmSync (and its retry
// sleeps) would freeze the app for as long as it takes.
async function discardPartialInstall(instanceId) {
  if (!instanceId) return;
  const fsp = require('fs').promises;
  const paths = require('./paths');
  const dir = paths.instanceDir(instanceId);
  for (let attempt = 0; attempt < 4; attempt++) {
    try { await fsp.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); return; } catch { /* file still closing — retry */ }
  }
}

module.exports = { InstallControl, cancelError, isCancel, discardPartialInstall };
