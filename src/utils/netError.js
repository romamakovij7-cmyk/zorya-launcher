// Plain-language network errors for requests the PAGE makes itself (Modrinth search etc.). The browser says only "Failed to fetch" for a
// blocked or unreachable site and the bare status for a refusal; this says what it probably means and what to do.
export function explainStatus(what, status, host) {
  const code = Number(status);
  let hint = 'Please try again later.';
  if (code === 403 || code === 451) hint = 'Server has denied access: your provider or region may be blocking it. Enable VPN on the entire computer (the browser extension for the launcher does not help) and repeat.';
  else if (code === 429) hint = 'Too many requests. Wait a minute and repeat.';
  else if (code >= 500) hint = 'Server is temporarily down. Repeat after a few minutes.';
  else if (code === 404) hint = 'Not Found: It may no longer be on the server.';
  return `${what}: сервер${host ? ` (${host})` : ''} ответил ${code}. ${hint}`;
}

export function explainFailure(what, host) {
  return `${what}: failed связаться с ${host}. Проверьте интернет. Если сайт открывается в браузере, а лаунчер не может, включите VPN на весь компьютер (расширение браузера лаунчеру не помогает) или смените DNS на 1.1.1.1 / 8.8.8.8. Также сайт могут блокировать фаервол или антивирус: добавьте лаунчер в исключения.`;
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
