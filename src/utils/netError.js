// Plain-language network errors for requests the PAGE makes itself (Modrinth search etc.). The browser says only "Failed to fetch" for a
// blocked or unreachable site and the bare status for a refusal; this says what it probably means and what to do.
export function explainStatus(what, status, host) {
  const code = Number(status);
  let hint = 'Try again later.';
  if (code === 403 || code === 451) hint = 'The server has closed access: your provider or region may be blocked. Turn on the VPN on the entire computer (browser extension launcher does not help) and repeat.';
  else if (code === 429) hint = 'Too many requests. Wait a minute and repeat.';
  else if (code >= 500) hint = 'The server is temporarily down. Repeat in a few minutes.';
  else if (code === 404) hint = 'It may not be on the server anymore.';
  return `${what}: server${host ? ` (${host})` : ''} fromwindpipe ${code}. ${hint}`;
}

export function explainFailure(what, host) {
  return `${what}: Could not contact the ${host}. Check the Internet. If the site opens in the browser and the launcher cannot, turn on the VPN on the entire computer (browser extension does not help the launcher) or change the DNS to 1.1.1.1 / 8.8.8.8. Also, the site can block firewall or antivirus: add launcher in exceptions.`;
}

// fetch() that gives these messages (a cancelled request keeps its own AbortError so callers can tell a cancel from a failure)
export async function friendlyFetch(url, what, host, init) {
  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    if (err && err.name === 'AbortError') throw err;
    throw new Error(explainFailure(what, host));
  }
  if (!res.ok) {
    const e = new Error(explainStatus(what, res.status, host));
    e.status = res.status;
    throw e;
  }
  return res;
}
