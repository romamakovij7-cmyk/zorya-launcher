// One network layer for everything the launcher fetches (Mojang, Modrinth, CurseForge, Fabric/Forge metadata, GitHub, the Zorya site ...).
//
// Two stacks can make a request:
//   "net"  — Electron's net.fetch, Chromium's network stack: the Windows proxy / VPN settings, secure DNS (see main.js), the Windows
//            certificate store, fast and exact errors. A player whose provider breaks DNS or needs a proxy reaches a site with it, as in a browser.
//   "node" — Node's own fetch (undici): quick for thousands of small files (Chromium keeps only ~6 connections per host: 4× slower in a
//            measurement with 320 asset files), but blind to the system proxy and to secure DNS, and slow to give up (10+ s per DNS failure).
//
// Requests ("api" mode, the default — the global fetch is replaced by it, see install()) try "net" first and then "node"; bulk downloads
// ("bulk" mode, download.js) the other way round. When the first stack fails with a network error the other one gets its turn, and the one
// that worked is remembered for that host for 10 minutes, so a broken stack is not tried again for every file. A caller's own abort
// (cancel, its AbortSignal.timeout) is never retried and keeps its name (AbortError / TimeoutError), because other code tells a cancel from a failure by it.
// When both stacks fail, the error says in plain words what is probably wrong instead of "fetch failed" (the original is kept in err.cause,
// the browser-side reason in err.chromium).
const electron = require('electron'); // outside Electron (plain Node, tests) this is not an object: then only Node's fetch is used
const app = electron && electron.app;
const net = electron && electron.net;

const nodeFetch = typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null; // captured before install() replaces it
// firstTryMs: time to the response headers before the other stack takes over. afterDnsMs: the stack that comes second gets at most this long when
// the first one has said for certain that the address does not exist (waiting 10+ s more for the same answer from Node only delays the error).
const settings = { firstTryMs: 12000, afterDnsMs: 6000, prefTtlMs: 10 * 60 * 1000 };
const prefs = new Map(); // host -> { stack, until }

const stacks = {
  // no cookies / HTTP-auth state of the app's session, and no copies of what is downloaded in Chromium's disk cache
  net: (url, init) => net.fetch(url, { credentials: 'omit', cache: 'no-store', ...init }),
  node: (url, init) => nodeFetch(url, init),
};

const isAbort = (e) => !!e && (e.name === 'AbortError' || e.name === 'TimeoutError');

function parseUrl(input) {
  try {
    if (typeof input === 'string') return new URL(input);
    if (input instanceof URL) return input;
  } catch { /* not an address */ }
  return null; // a Request object and the like: left to Node
}

// A body that can be sent twice (the second stack gets the same one). A stream cannot: such a request goes to Node alone.
function resendable(body) {
  if (body === undefined || body === null) return true;
  return typeof body === 'string' || body instanceof URLSearchParams || body instanceof ArrayBuffer || ArrayBuffer.isView(body)
    || (typeof FormData !== 'undefined' && body instanceof FormData) || (typeof Blob !== 'undefined' && body instanceof Blob);
}

// One try on one stack. headerMs > 0: if the response headers do not arrive in time this try is given up (as a plain error, not an abort).
async function attempt(stack, url, init, headerMs) {
  if (!headerMs) return stacks[stack](url, init);
  const own = new AbortController();
  const signal = init && init.signal ? AbortSignal.any([init.signal, own.signal]) : own.signal;
  let timer = null;
  const gaveUp = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const e = new Error(`нет ответа за ${Math.round(headerMs / 1000)} с`);
      e.code = 'ETRYTIMEOUT';
      own.abort(e);
      reject(e);
    }, headerMs);
  });
  try {
    const run = stacks[stack](url, { ...init, signal });
    run.catch(() => {}); // when the timer wins, the aborted request's rejection must not surface as unhandled
    return await Promise.race([run, gaveUp]);
  } finally {
    clearTimeout(timer);
  }
}

function describe(host, nodeErr, netErr) {
  const nodeCode = nodeErr && nodeErr.cause ? String(nodeErr.cause.code || nodeErr.cause.name || '').toUpperCase() : '';
  const netCode = ((/net::(ERR_[A-Z0-9_]+)/.exec(String((netErr && netErr.message) || '')) || [])[1] || '').toUpperCase();
  const code = netCode || nodeCode;
  let hint = 'Проверьте интернет. Если сайт открывается в браузере, а лаунчер не может, включите VPN на весь компьютер (расширение браузера лаунчеру не помогает).';
  if (/NAME_NOT_RESOLVED|ENOTFOUND|EAI_AGAIN/.test(code)) hint = 'Компьютер не находит адрес сервера (DNS). Смените DNS на 1.1.1.1 / 8.8.8.8 или включите VPN на весь компьютер.';
  else if (/CERT|SSL|TLS|UNABLE_TO_VERIFY|SELF_SIGNED/.test(code)) hint = 'Не проходит защищённое соединение. Проверьте дату и время в Windows; если стоит антивирус с проверкой HTTPS, отключите её для лаунчера.';
  else if (/TIMED_OUT|TIMEOUT|REFUSED|RESET|UNREACHABLE|CLOSED|PROXY|TUNNEL|DISCONNECTED|ETRYTIMEOUT/.test(code + ' ' + String((nodeErr && nodeErr.cause && nodeErr.cause.message) || ''))) {
    hint = 'Соединение с сервером обрывается: его может блокировать провайдер, фаервол или антивирус. Включите VPN на весь компьютер или добавьте лаунчер в исключения.';
  }
  const shown = [...new Set([netCode, nodeCode].filter(Boolean))].join(' / ');
  return `Failed связаться с ${host}. ${hint}${shown ? ` (${shown})` : ''}`;
}

function combine(errors, host) {
  const base = errors.node || errors.net;
  const err = base instanceof Error ? base : new Error(String(base));
  if (errors.net) err.chromium = String((errors.net && errors.net.message) || errors.net);
  err.host = host;
  try { err.message = describe(host, errors.node, errors.net); } catch { /* the original message stays */ }
  return err;
}

async function smartFetch(input, init, mode = 'api') {
  const url = parseUrl(input);
  if (!nodeFetch) throw new Error('fetch недоступен');
  if (!url || !/^https?:$/.test(url.protocol) || !resendable(init && init.body)) return nodeFetch(input, init);

  const dflt = mode === 'bulk' ? 'node' : 'net';
  let order = dflt === 'net' ? ['net', 'node'] : ['node', 'net'];
  if (!app || !app.isReady() || !net || typeof net.fetch !== 'function') order = ['node'];
  const pref = prefs.get(url.host);
  if (pref && pref.until > Date.now() && order.length === 2) order = [pref.stack, pref.stack === 'net' ? 'node' : 'net'];

  const errors = {};
  let dnsSaid = false; // an earlier try failed with "this name does not exist"
  for (let i = 0; i < order.length; i += 1) {
    const stack = order[i];
    try {
      const last = i === order.length - 1;
      const res = await attempt(stack, url.href, init, !last ? settings.firstTryMs : (dnsSaid ? settings.afterDnsMs : 0));
      if (order.length === 2) {
        if (stack === dflt) prefs.delete(url.host);
        else prefs.set(url.host, { stack, until: Date.now() + settings.prefTtlMs });
      }
      return res;
    } catch (err) {
      // the caller cancelled it, or its own time ran out: not a network failure, the other stack would only waste time
      if (init && init.signal && init.signal.aborted) throw err;
      if (isAbort(err)) throw err; // (this layer's own "no response in time" give-up is a plain Error, see attempt())
      errors[stack] = err;
      if (/NAME_NOT_RESOLVED|ENOTFOUND/.test(`${err && err.message} ${(err && err.cause && err.cause.code) || ''}`)) dnsSaid = true;
    }
  }
  throw combine(errors, url.host);
}

// A plain message for an HTTP answer that is not OK: what it means and what to do (instead of "Failed to fetch … (403)").
function explainStatus(what, status, host) {
  const at = host ? ` (${host})` : '';
  const code = Number(status);
  let hint = 'Повторите попытку позже.';
  if (code === 403 || code === 451) hint = 'Server закрыл доступ: возможно, ваш провайдер или регион блокируется. Включите VPN на весь компьютер (расширение браузера лаунчеру не помогает) и повторите.';
  else if (code === 429) hint = 'Слишком много запросов. Подождите минуту и повторите.';
  else if (code === 407) hint = 'Прокси требует авторизацию: проверьте настройки прокси или VPN.';
  else if (code >= 500) hint = 'Server временно не работает. Повторите через несколько минут.';
  else if (code === 404) hint = 'File не найден на сервере: возможно, этой версии больше нет.';
  return `${what}: сервер${at} ответил ${code}. ${hint}`;
}

const apiFetch = (input, init) => smartFetch(input, init, 'api');
const bulkFetch = (input, init) => smartFetch(input, init, 'bulk');

let installed = false;
// The global fetch of the main process becomes the smart one: every module that just calls fetch() gets the fallback without changes.
function install() {
  if (installed || !nodeFetch) return;
  installed = true;
  globalThis.fetch = apiFetch;
}

module.exports = {
  install, apiFetch, bulkFetch, nodeFetch, describe, explainStatus,
  _test: { stacks, prefs, settings, smartFetch },
};
