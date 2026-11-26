const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const AdmZip = require('adm-zip');
const paths = require('./paths');
const { downloadFile } = require('./download');
const { assertVersionString, safeJoin } = require('./safe');
const mavenMirror = require('./mavenMirror');

const FORGE_META = 'https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml';
const NEOFORGE_META = 'https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml';

function extractTags(xml, tag) {
  const re = new RegExp(`<${tag}>([^<]*)</${tag}>`, 'g');
  const out = [];
  let m;
  // eslint-disable-next-line no-cond-assign
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}

// Backup source for the LISTS of versions when the official maven hosts can't be reached (some providers block or throttle them): BMCLAPI.
// Only names of versions come from it; a version string is validated (assertVersionString) before it is ever used in a path or an address,
// and the installer itself is downloaded from the official repository only (checked against its published checksum).
const MIRROR = 'https://bmclapi2.bangbang93.com';

const hostOf = (url) => { try { return new URL(url).host; } catch { return String(url); } };
// "fetch failed" says nothing; the cause (timeout, DNS, reset, blocked) is what helps to find out what is wrong
function describeNetError(err) {
  const c = err && err.cause;
  const code = (c && (c.code || c.message)) || '';
  if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) return 'нет ответа за 15 seconds';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'адрес не находится (DNS)';
  if (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET') return 'соединение сброшено';
  if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') return 'соединение не устанавливается';
  if (code === 'ECONNREFUSED') return 'соединение отклонено';
  return (code || (err && err.message) || 'неизвестная error').toString().slice(0, 80);
}

// The official address first. When it does not answer, is cut (403/451/5xx) or answers with something that is not the file (a provider's
// stub page), the same file is asked from the Zorya site's mirror (mavenMirror.js). parse(res) turns the answer into the result.
async function fetchViaMirror(url, parse) {
  let first;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) { const e = new Error(`HTTP ${res.status}`); e.httpStatus = res.status; throw e; }
    return await parse(res);
  } catch (err) { first = err; }
  const mirror = mavenMirror.mirrorFor(url);
  if (!mirror || !mavenMirror.worthMirror(first)) throw first;
  try {
    const res = await fetch(mirror.url, { headers: mirror.headers, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(res.status === 402 ? 'нужна активная подписка' : `HTTP ${res.status}`);
    return await parse(res);
  } catch (second) {
    const e = new Error('mirror failed');
    e.detail = `${hostOf(url)}: ${describeNetError(first)}; ${mirror.host} (зеркало): ${describeNetError(second)}`;
    throw e;
  }
}

async function fetchXml(url) {
  return fetchViaMirror(url, async (res) => {
    const text = await res.text();
    if (!text.includes('<metadata')) throw new Error('пришёл не тот файл'); // e.g. a provider's block page
    return text;
  });
}
async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Runs the sources one after another (the official one first); if every one fails, the error names each host and the reason.
async function firstWorking(label, sources) {
  const failures = [];
  for (const [url, run] of sources) {
    try {
      return await run();
    } catch (err) {
      failures.push(err.detail || `${hostOf(url)}: ${describeNetError(err)}`);
    }
  }
  throw new Error(`Failed получить список версий ${label}. ${failures.join('; ')}. Проверьте интернет, VPN или антивирус/файрвол.`);
}

// Forge's maven-metadata lists every version ever published, across every MC
// version, as "<mcVersion>-<forgeVersion>[-<mcVersion>]". Filter to the ones
// belonging to the requested MC version and strip the prefix down to just the
// Forge build number/version.
async function getForgeLoaderVersions(mcVersion) {
  return firstWorking('Forge', [
    [FORGE_META, () => forgeVersionsFrom(mcVersion, null, FORGE_META)],
    [MIRROR, () => forgeVersionsFromMirror(mcVersion)],
  ]);
}

// Mirror list: [{ version: '52.1.21', branch?: '…' }]; the maven version of old builds is "<version>-<branch>" (1.7.10-10.13.4.1614-1.7.10).
async function forgeVersionsFromMirror(mcVersion) {
  const list = await fetchJson(`${MIRROR}/forge/minecraft/${encodeURIComponent(mcVersion)}`);
  if (!Array.isArray(list)) throw new Error('неожиданный ответ');
  const versions = list.filter((e) => e && typeof e.version === 'string').map((e) => `${mcVersion}-${e.version}${e.branch ? `-${e.branch}` : ''}`);
  return forgeVersionsFrom(mcVersion, versions);
}

async function forgeVersionsFrom(mcVersion, preloaded, metaUrl) {
  // preloaded: version strings already known (mirror); with a meta url (official) they are read from the maven metadata first
  const all = metaUrl ? extractTags(await fetchXml(metaUrl), 'version') : preloaded;
  const prefix = `${mcVersion}-`;
  const matches = all.filter((v) => v.startsWith(prefix));
  // Keep everything after "<mcVersion>-": some old builds carry a trailing
  // "-<mcVersion>" (e.g. 1.8-11.14.0.1237-1.8) that is part of the artifact
  // path, so stripping it would point at a file that doesn't exist.
  const loaderVersions = matches.map((v) => v.slice(prefix.length));
  // Old MC versions are listed newest-first in the maven metadata, newer ones
  // oldest-first; the last entry is treated as the recommended one, so sort
  // by version number to make that always the newest build.
  const numeric = (v) => v.split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  loaderVersions.sort((a, b) => {
    const pa = numeric(a);
    const pb = numeric(b);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d) return d;
    }
    return 0;
  });
  return loaderVersions.map((lv, i) => ({ loaderVersion: lv, stable: i === loaderVersions.length - 1 }));
}

// NeoForge versions are of the form "<mcMinorMajor>.<mcPatch>.<build>" (the
// leading "1." of the MC version is dropped), e.g. MC 1.21.1 -> "21.1.*".
// NeoForge only supports 1.20.2 and up. For the new numbering (26.1, 26.1.2, 26.3) the version is
// "<mc>.<build>" with a patch of 0 when the game version has none: MC 26.1 -> "26.1.0.*", MC 26.1.2 -> "26.1.2.*".
function neoForgePrefixFor(mcVersion) {
  const parts = mcVersion.split('.');
  if (parts[0] === '1') {
    if (parts.length < 2) return null;
    const minor = parts[1];
    const patch = parts[2] || '0';
    return `${minor}.${patch}.`;
  }
  if (/^\d{2}$/.test(parts[0]) && /^\d+$/.test(parts[1] || '')) return `${parts[0]}.${parts[1]}.${/^\d+$/.test(parts[2] || '') ? parts[2] : '0'}.`;
  return null;
}

function neoForgeVersionsFrom(prefix, all) {
  const matches = all.filter((v) => v.startsWith(prefix));
  // the recommended one is the last full release (alpha/beta builds are listed too and stay "нестабильная")
  const lastRelease = (() => { for (let i = matches.length - 1; i >= 0; i -= 1) if (!/[-+]/.test(matches[i])) return i; return matches.length - 1; })();
  return matches.map((lv, i) => ({ loaderVersion: lv, stable: i === lastRelease }));
}

async function getNeoForgeLoaderVersions(mcVersion) {
  const prefix = neoForgePrefixFor(mcVersion);
  if (!prefix) return [];
  return firstWorking('NeoForge', [
    [NEOFORGE_META, async () => neoForgeVersionsFrom(prefix, extractTags(await fetchXml(NEOFORGE_META), 'version'))],
    [MIRROR, async () => {
      const list = await fetchJson(`${MIRROR}/neoforge/list/${encodeURIComponent(mcVersion)}`);
      if (!Array.isArray(list)) throw new Error('неожиданный ответ');
      return neoForgeVersionsFrom(prefix, list.map((e) => e && e.version).filter((v) => typeof v === 'string'));
    }],
  ]);
}

// Instances created before the list kept the trailing "-<mcVersion>" hold a
// shortened version (11.14.0.1237); find the real maven version that starts
// with it.
async function resolveForgeVersion(mcVersion, loaderVersion) {
  try {
    const all = extractTags(await fetchXml(FORGE_META), 'version');
    const exact = `${mcVersion}-${loaderVersion}`;
    if (all.includes(exact)) return loaderVersion;
    const longer = all.find((v) => v.startsWith(`${exact}-`));
    if (longer) return longer.slice(`${mcVersion}-`.length);
  } catch { /* offline: fall back to what we have */ }
  return loaderVersion;
}

// Pre-1.13 installers can't run headless (--installClient is unknown to
// them). Their install_profile.json carries the finished version json
// ("versionInfo") plus the Forge jar itself, so "installing" is just writing
// that json and dropping the jar into libraries/.
function readLegacyInstallProfile(installerPath) {
  const zip = new AdmZip(installerPath);
  const entry = zip.getEntry('install_profile.json');
  if (!entry) return null;
  const json = JSON.parse(entry.getData().toString('utf8'));
  if (!json.versionInfo || !json.install) return null;
  return { zip, json };
}

// Legacy profiles pass game arguments as one "minecraftArguments" string
// that repeats all of vanilla's. Keep just the loader-specific bit
// (--tweakClass ...); vanilla's own arguments come from the vanilla json.
function withLegacyArguments(profile) {
  if (profile.arguments || !profile.minecraftArguments) return profile;
  const tokens = profile.minecraftArguments.split(' ').filter(Boolean);
  const game = [];
  tokens.forEach((tok, i) => {
    if (tok === '--tweakClass' && tokens[i + 1]) game.push(tok, tokens[i + 1]);
  });
  return { ...profile, arguments: { game } };
}

function installLegacyForge({ zip, json }) {
  const { install, versionInfo } = json;
  const libraries = (versionInfo.libraries || [])
    .filter((lib) => lib.clientreq !== false)
    .map((lib) => (lib.url
      ? { ...lib, url: lib.url.replace(/^http:\/\/files\.minecraftforge\.net\/maven\/?/, 'https://maven.minecraftforge.net/').replace(/^http:/, 'https:') }
      : lib));
  const profile = { ...versionInfo, libraries };

  const versionDir = path.join(paths.versionsDir(), profile.id);
  fs.mkdirSync(versionDir, { recursive: true });
  fs.writeFileSync(path.join(versionDir, `${profile.id}.json`), JSON.stringify(profile, null, 2));

  const jarEntry = zip.getEntry(install.filePath);
  if (!jarEntry) throw new Error(`В установщике нет файла ${install.filePath}`);
  const [group, artifact, version] = install.path.split(':');
  const dest = safeJoin(paths.librariesDir(), ...group.split('.'), artifact, version, `${artifact}-${version}.jar`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, jarEntry.getData());

  return withLegacyArguments(profile);
}

function installerUrlFor(kind, mcVersion, loaderVersion) {
  if (kind === 'forge') {
    const full = `${mcVersion}-${loaderVersion}`;
    return `https://maven.minecraftforge.net/net/minecraftforge/forge/${full}/forge-${full}-installer.jar`;
  }
  return `https://maven.neoforged.net/releases/net/neoforged/neoforge/${loaderVersion}/neoforge-${loaderVersion}-installer.jar`;
}

function idCachePath() {
  return path.join(paths.metaDir(), 'forge-install-cache.json');
}

function readIdCache() {
  try {
    return JSON.parse(fs.readFileSync(idCachePath(), 'utf8'));
  } catch {
    return {};
  }
}

function writeIdCache(cache) {
  fs.writeFileSync(idCachePath(), JSON.stringify(cache, null, 2));
}

// The Forge/NeoForge installers refuse to run unless the target folder looks
// like a .minecraft that the official launcher has already used ("There is no
// minecraft launcher profile ... you need to run the launcher first!"), i.e.
// it contains a launcher_profiles.json. An empty profile list is enough.
function ensureLauncherProfiles(targetDir) {
  const file = path.join(targetDir, 'launcher_profiles.json');
  if (fs.existsSync(file)) return;
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    profiles: {},
    settings: {},
    version: 3,
  }, null, 2));
}

function runInstaller(javaPath, installerPath, targetDir, onLine) {
  ensureLauncherProfiles(targetDir);
  return new Promise((resolve, reject) => {
    const bin = javaPath && javaPath.trim() ? javaPath.trim() : 'java';
    const child = spawn(bin, ['-jar', installerPath, '--installClient', targetDir], { cwd: os.tmpdir() });
    let output = '';
    // Forward the installer's own output (throttled) so the UI can show what
    // it's doing — it has no percentage to report, just log lines.
    let lastSent = 0;
    const onData = (b) => {
      const text = b.toString();
      output += text;
      const now = Date.now();
      if (!onLine || now - lastSent < 400) return;
      const line = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop();
      if (line) { lastSent = now; onLine(line.slice(0, 140)); }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Установщик ${path.basename(installerPath)} завершился с ошибкой (код ${code}):\n${output.slice(-2000)}`));
    });
  });
}

// Runs the official Forge/NeoForge installer in headless "--installClient"
// mode against our shared meta/ directory (which already has the same
// versions/ + libraries/ layout a real .minecraft folder has), rather than
// re-implementing the installer's own binary-patching/processor pipeline
// ourselves. Caches the resulting version id so repeat launches skip
// re-running the installer entirely.
async function installLoaderProfile(kind, mcVersion, loaderVersion, javaPath, onProgress) {
  assertVersionString(mcVersion, 'Minecraft version');
  assertVersionString(loaderVersion, 'loader version');
  const cacheKey = `${kind}:${mcVersion}:${loaderVersion}`;
  const idCache = readIdCache();
  const cachedId = idCache[cacheKey];
  if (cachedId) {
    const jsonPath = path.join(paths.versionsDir(), cachedId, `${cachedId}.json`);
    if (fs.existsSync(jsonPath)) {
      return withLegacyArguments(JSON.parse(fs.readFileSync(jsonPath, 'utf8')));
    }
  }

  onProgress && onProgress({ step: 'download-installer' });
  const fullVersion = kind === 'forge' ? await resolveForgeVersion(mcVersion, loaderVersion) : loaderVersion;
  assertVersionString(fullVersion, 'loader version');
  const installerUrl = installerUrlFor(kind, mcVersion, fullVersion);
  // A private temp folder per run: the installer is executed with Java, so it must
  // not live at a predictable shared path where something else could swap it
  // (or where a stale half-written file from an earlier run would be reused).
  const installDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'zorya-installer-'));
  try {
    const installerPath = path.join(installDir, `${kind}-installer.jar`);
    // The installer is a program that Java runs: it comes from the official repository, or from the Zorya site's mirror (our own server, over
    // https, the same bytes — checked against the .sha1 the repository publishes). A third-party mirror is never used for it.
    let got;
    const installerSha1 = await publishedSha1(installerUrl);
    try {
      got = await downloadFile(installerUrl, installerPath, { expectedSha1: installerSha1 });
    } catch (err) {
      const hasMirror = !!mavenMirror.mirrorFor(installerUrl);
      throw new Error(`Failed скачать установщик ${kind === 'forge' ? 'Forge' : 'NeoForge'} с ${hostOf(installerUrl)}: ${describeNetError(err)}.${hasMirror ? ' Зеркало сайта тоже не ответило.' : ' Войдите в аккаунт сайта: тогда лаунчер сможет взять файлы через сайт.'} Проверьте интернет, VPN или антивирус/файрвол.`);
    }
    // The official address was out of reach: the libraries the installer would fetch from that address are fetched here, through the
    // site, with the checksums written in the installer itself; the installer then finds them in place and downloads nothing.
    if (got && got.viaMirror) {
      // From the mirror an installer is never run without its checksum (the official address was out of reach, so the .sha1 must have come with it)
      if (!installerSha1) throw new Error('Failed получить контрольную сумму установщика через сайт: без неё запускать его небезопасно.');
      await prefetchLibraries(installerPath, onProgress);
    }

    // Old (pre-1.13) installers can't be run headless — install them by hand.
    const legacy = readLegacyInstallProfile(installerPath);
    if (legacy) {
      onProgress && onProgress({ step: 'install-legacy' });
      const legacyProfile = installLegacyForge(legacy);
      idCache[cacheKey] = legacyProfile.id;
      writeIdCache(idCache);
      return legacyProfile;
    }

    const before = new Set(fs.existsSync(paths.versionsDir()) ? fs.readdirSync(paths.versionsDir()) : []);

    onProgress && onProgress({ step: 'run-installer' });
    await runInstaller(javaPath, installerPath, paths.metaDir(),
      (line) => onProgress && onProgress({ step: 'run-installer', line }));

    return finishInstall(cacheKey, loaderVersion, before, idCache);
  } finally {
    fs.promises.rm(installDir, { recursive: true, force: true }).catch(() => {});
  }
}

// The maven repositories publish "<file>.sha1" next to every artifact (when the official address is out of reach: the same file from the site's mirror).
async function publishedSha1(url) {
  try {
    return await fetchViaMirror(`${url}.sha1`, async (res) => {
      const m = /^[0-9a-f]{40}/i.exec((await res.text()).trim());
      if (!m) throw new Error('пришёл не тот файл');
      return m[0];
    });
  } catch {
    return undefined;
  }
}

// Libraries named in the installer (install_profile.json + version.json) that live in a repository the mirror covers: downloaded through the
// site into the shared libraries folder, each checked against the sha1 from the installer. Files already there and valid are skipped.
async function prefetchLibraries(installerPath, onProgress) {
  const zip = new AdmZip(installerPath);
  const byPath = new Map();
  for (const name of ['install_profile.json', 'version.json']) {
    const entry = zip.getEntry(name);
    if (!entry) continue;
    let json;
    try { json = JSON.parse(entry.getData().toString('utf8')); } catch { continue; }
    for (const lib of json.libraries || []) {
      const art = lib && lib.downloads && lib.downloads.artifact;
      if (!art || typeof art.url !== 'string' || !art.url || typeof art.path !== 'string') continue;
      if (!/^[0-9a-f]{40}$/i.test(String(art.sha1 || ''))) continue; // no checksum, no download of ours
      if (!mavenMirror.mirrorFor(art.url)) continue; // other hosts (Mojang's) are left to the installer
      byPath.set(art.path, art);
    }
  }
  const list = [...byPath.values()];
  let done = 0;
  let next = 0;
  const failed = [];
  async function worker() {
    while (next < list.length) {
      const art = list[next]; next += 1;
      try {
        await downloadFile(art.url, safeJoin(paths.librariesDir(), art.path), { expectedSha1: art.sha1, expectedSize: art.size, mirrorFirst: true });
      } catch (err) {
        failed.push(`${path.basename(art.path)}: ${describeNetError(err)}`);
      }
      done += 1;
      onProgress && onProgress({ step: 'run-installer', line: `Библиотеки через сайт: ${done} из ${list.length}` });
    }
  }
  await Promise.all(Array.from({ length: Math.min(6, Math.max(1, list.length)) }, worker));
  if (failed.length) throw new Error(`Failed скачать ${failed.length} библиотек через сайт: ${failed.slice(0, 3).join('; ')}`);
}

// Which version folder the installer just created, and its parsed profile.
function finishInstall(cacheKey, loaderVersion, before, idCache) {
  const after = fs.readdirSync(paths.versionsDir());
  const newIds = after.filter((d) => !before.has(d));
  // Prefer a freshly created folder, but fall back to an existing one for
  // this loader version (e.g. left over from an earlier, half-finished run).
  const newId = newIds.find((d) => d.includes(loaderVersion))
    || after.find((d) => d.includes(loaderVersion))
    || newIds[0];
  if (!newId) {
    throw new Error('Установщик завершился без ошибок, но новая версия не найдена. Проверьте версию Java.');
  }

  const jsonPath = path.join(paths.versionsDir(), newId, `${newId}.json`);
  const profile = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

  idCache[cacheKey] = newId;
  writeIdCache(idCache);

  return profile;
}

module.exports = {
  getForgeLoaderVersions,
  getNeoForgeLoaderVersions,
  installLoaderProfile,
};
