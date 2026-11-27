// A request to the Zorya site (and to the update feed on it) goes through Chromium's network stack first — the one a browser uses: the Windows
// proxy / VPN settings, secure DNS (see main.js) and the Windows certificate store. A player whose provider blocks the site's name or address
// often reaches it in a browser this way and not with Node's own resolver. Node's fetch is the second try.
// makeInit() gives a fresh set of options (and timeout) for each try. When both fail, the error of the second carries the browser-side reason in
// err.chromium ("net::ERR_NAME_NOT_RESOLVED"), which is the more exact one.
const { app, net } = require('electron');
const { nodeFetch } = require('./netFetch'); // Node's own fetch (the global one is the two-stack netFetch, which would try Chromium again)

async function siteFetch(url, makeInit) {
  const href = typeof url === 'string' ? url : url.href;
  let first = null;
  if (net && typeof net.fetch === 'function' && app.isReady()) {
    try { return await net.fetch(href, makeInit()); } catch (err) { first = err; }
  }
  try {
    return await nodeFetch(href, makeInit());
  } catch (err) {
    if (first) err.chromium = String((first && first.message) || first);
    throw err;
  }
}

module.exports = { siteFetch };
