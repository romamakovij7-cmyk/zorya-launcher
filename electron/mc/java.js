const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const paths = require('./paths');
const { downloadAll } = require('./download');
const { safeJoin } = require('./safe');

function checkJava(javaPath) {
  const bin = javaPath && javaPath.trim() ? javaPath.trim() : 'java';
  try {
    // A timeout: this runs on the launcher's main thread, and a path on a dead network drive must not freeze the whole window.
    const result = spawnSync(bin, ['-version'], { encoding: 'utf8', timeout: 6000, windowsHide: true });
    if (result.error) return { ok: false, error: result.error.message };
    const output = (result.stderr || result.stdout || '').split('\n')[0];
    const match = output.match(/version "([^"]+)"/);
    return { ok: true, version: match ? match[1] : output.trim(), raw: output.trim() };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// "1.8.0_51" -> 8, "17.0.15" -> 17, "25" -> 25
function majorOf(versionString) {
  if (!versionString) return null;
  const parts = versionString.split(/[._-]/);
  const first = parseInt(parts[0], 10);
  if (first === 1) return parseInt(parts[1], 10) || null;
  return Number.isNaN(first) ? null : first;
}

// Mojang publishes the exact Java runtimes its own launcher uses. Every
// Minecraft version json names the one it needs (javaVersion.component), so
// each instance gets a matching Java automatically — a mod pack built for 21
// no longer breaks because the system happens to have Java 25 (or vice versa).
const RUNTIME_INDEX_URL = 'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json';

function runtimePlatformKey() {
  if (process.platform === 'win32') {
    if (process.arch === 'arm64') return 'windows-arm64';
    return process.arch === 'ia32' ? 'windows-x86' : 'windows-x64';
  }
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'mac-os-arm64' : 'mac-os';
  return process.arch === 'ia32' ? 'linux-i386' : 'linux';
}

function runtimeRoot(component) {
  return path.join(paths.metaDir(), 'runtime', component);
}

function javaBinIn(dir) {
  return path.join(dir, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
}

const inFlight = new Map(); // component -> Promise

async function ensureManagedRuntime(component, onProgress) {
  const dir = runtimeRoot(component);
  const marker = path.join(dir, '.complete');
  if (fs.existsSync(marker) && fs.existsSync(javaBinIn(dir))) return javaBinIn(dir);
  if (inFlight.has(component)) return inFlight.get(component);

  const job = (async () => {
    const indexRes = await fetch(RUNTIME_INDEX_URL);
    if (!indexRes.ok) throw new Error(`Failed получить список Java (${indexRes.status})`);
    const index = await indexRes.json();
    const entry = index[runtimePlatformKey()]?.[component]?.[0];
    if (!entry) throw new Error(`Для этой системы нет Java «${component}» от Mojang`);

    const manifestRes = await fetch(entry.manifest.url);
    if (!manifestRes.ok) throw new Error(`Failed получить манифест Java (${manifestRes.status})`);
    const manifest = await manifestRes.json();

    const tasks = [];
    const executables = [];
    for (const [rel, file] of Object.entries(manifest.files || {})) {
      const dest = safeJoin(dir, rel);
      if (file.type === 'directory') {
        fs.mkdirSync(dest, { recursive: true });
      } else if (file.type === 'file' && file.downloads?.raw) {
        tasks.push({
          url: file.downloads.raw.url,
          dest,
          sha1: file.downloads.raw.sha1,
          size: file.downloads.raw.size,
          label: rel,
        });
        if (file.executable) executables.push(dest);
      }
    }
    await downloadAll(tasks, { concurrency: 12, onProgress });
    if (process.platform !== 'win32') {
      for (const f of executables) { try { fs.chmodSync(f, 0o755); } catch { /* best effort */ } }
    }
    if (!fs.existsSync(javaBinIn(dir))) throw new Error('В скачанной Java нет исполняемого файла');
    fs.writeFileSync(marker, String(Date.now()));
    return javaBinIn(dir);
  })().finally(() => inFlight.delete(component));

  inFlight.set(component, job);
  return job;
}

// Picks the Java executable for a Minecraft version:
//  1. a custom path from Settings, if the user set one (their choice wins);
//  2. otherwise Mojang's runtime for that version (downloaded once, reused);
//  3. if that download fails, the system Java — but only when its major
//     version is new enough, so a wrong one isn't silently used.
async function resolveJava(vanillaJson, customPath, onProgress) {
  if (customPath && customPath.trim()) return customPath.trim();

  const component = vanillaJson.javaVersion?.component || 'jre-legacy';
  const required = vanillaJson.javaVersion?.majorVersion || 8;
  try {
    return await ensureManagedRuntime(component, onProgress);
  } catch (err) {
    const system = checkJava('');
    const major = system.ok ? majorOf(system.version) : null;
    if (major && major >= required) return 'java';
    throw new Error(
      `Failed получить Java ${required} для этой версии Minecraft: ${err.message}. `
      + `Проверьте интернет или укажите путь к Java ${required} в Настройках.`,
    );
  }
}

// ---------- Java installed on this computer (for the picker in the build's settings) ----------
// Found without running anything where possible: a JDK/JRE folder has a "release" file naming its version and vendor.
function readRelease(home) {
  try {
    const text = fs.readFileSync(path.join(home, 'release'), 'utf8');
    const v = /JAVA_VERSION="?([^"\r\n]+)"?/.exec(text);
    const imp = /IMPLEMENTOR="?([^"\r\n]+)"?/.exec(text);
    return { version: v ? v[1].trim() : null, vendor: imp ? imp[1].trim() : null };
  } catch { return { version: null, vendor: null }; }
}

function subdirs(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => path.join(dir, d.name)); } catch { return []; }
}

function candidateHomes() {
  const homes = new Set();
  const add = (p) => { if (p) homes.add(path.normalize(p)); };
  add(process.env.JAVA_HOME);
  const roots = [];
  if (process.platform === 'win32') {
    const programFiles = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramW6432].filter(Boolean);
    for (const base of new Set(programFiles)) {
      for (const sub of ['Java', 'Eclipse Adoptium', 'Eclipse Foundation', 'Microsoft', 'Zulu', 'BellSoft', 'Amazon Corretto', 'Semeru', 'AdoptOpenJDK', 'OpenJDK', 'Liberica']) roots.push(path.join(base, sub));
      add(path.join(base, 'Android', 'Android Studio', 'jbr'));
    }
    if (process.env.LOCALAPPDATA) roots.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'Eclipse Adoptium'));
    roots.push(path.join(os.homedir(), '.jdks'));
  } else {
    roots.push('/usr/lib/jvm', '/Library/Java/JavaVirtualMachines', path.join(os.homedir(), '.sdkman', 'candidates', 'java'), path.join(os.homedir(), '.jdks'));
  }
  for (const root of roots) for (const d of subdirs(root)) { add(d); add(path.join(d, 'Contents', 'Home')); }
  return homes;
}

let listCache = null;
// [{ path (the java executable), version, major, vendor, source }], newest first. Cached for half a minute.
function listInstalled(force) {
  if (!force && listCache && Date.now() - listCache.at < 30000) return listCache.list;
  const exe = process.platform === 'win32' ? 'java.exe' : 'java';
  const seen = new Set();
  const list = [];
  // Running java -version is only the fallback for a folder without a "release" file; it blocks the main thread, so it has a total budget.
  const started = Date.now();
  for (const home of candidateHomes()) {
    const bin = path.join(home, 'bin', exe);
    let key;
    try { if (!fs.statSync(bin).isFile()) continue; key = fs.realpathSync(bin).toLowerCase(); } catch { continue; }
    if (seen.has(key)) continue;
    seen.add(key);
    let { version, vendor } = readRelease(home);
    if (!version && Date.now() - started < 6000) {
      try {
        const r = spawnSync(bin, ['-version'], { encoding: 'utf8', timeout: 4000, windowsHide: true });
        const m = /version "([^"]+)"/.exec((r.stderr || r.stdout || '').split('\n')[0]);
        version = m ? m[1] : null;
      } catch { /* unknown version: still listed */ }
    }
    list.push({ path: bin, version, major: majorOf(version), vendor, source: 'system' });
  }
  list.sort((a, b) => (b.major || 0) - (a.major || 0) || a.path.localeCompare(b.path));
  listCache = { at: Date.now(), list };
  return list;
}

// Which Java a Minecraft version needs. The version's own json (downloaded at the first launch) says it exactly; before that — the known
// table (1.17: 16, 1.18-1.20.4: 17, 1.20.5-1.21.x: 21, the 26.x numbering: 25, older: 8).
function requiredMajor(mcVersion) {
  const id = String(mcVersion || '');
  if (/^[0-9A-Za-z._+-]{1,40}$/.test(id) && !id.includes('..')) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(paths.versionsDir(), id, `${id}.json`), 'utf8'));
      const n = Number(j.javaVersion && j.javaVersion.majorVersion);
      if (n > 0) return n;
    } catch { /* not downloaded yet */ }
  }
  let m = /^1\.(\d+)(?:\.(\d+))?/.exec(id);
  if (m) {
    const minor = Number(m[1]); const patch = Number(m[2] || 0);
    if (minor >= 21 || (minor === 20 && patch >= 5)) return 21;
    if (minor >= 18) return 17;
    if (minor === 17) return 16;
    return 8;
  }
  m = /^(\d\d)w\d\d/.exec(id);
  if (m) { const y = Number(m[1]); return y >= 24 ? 21 : y >= 21 ? 17 : 8; }
  m = /^(\d+)\./.exec(id);
  if (m && Number(m[1]) >= 26) return 25;
  return null;
}

module.exports = {
  checkJava, resolveJava, majorOf, ensureManagedRuntime, listInstalled, requiredMajor,
  _test: { readRelease, candidateHomes },
};
