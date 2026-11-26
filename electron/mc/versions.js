const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const paths = require('./paths');
const { downloadFile, downloadAll } = require('./download');
const { rulesAllow, currentOsName, currentArch } = require('./rules');
const { assertVersionString, safeJoin } = require('./safe');

const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';

let manifestCache = null;

const manifestFile = () => path.join(paths.metaDir(), 'version_manifest_v2.json');

// The list of Minecraft versions. Mojang unreachable (blocked, no internet): the list saved at the last successful visit is used instead of an
// error (a stale list is enough to create a build; a version already downloaded needs no list at all).
async function getVersionManifest(force = false) {
  if (manifestCache && !force) return manifestCache;
  try {
    const res = await fetch(MANIFEST_URL);
    if (!res.ok) throw new Error(require('./netFetch').explainStatus('Failed получить список версий Minecraft', res.status, 'Mojang'));
    const fresh = await res.json();
    if (!fresh || !Array.isArray(fresh.versions)) throw new Error('Mojang вернул странный список версий');
    manifestCache = fresh;
    try { fs.writeFileSync(manifestFile(), JSON.stringify(fresh)); } catch { /* the list just is not saved */ }
    return manifestCache;
  } catch (err) {
    try {
      const saved = JSON.parse(fs.readFileSync(manifestFile(), 'utf8'));
      if (saved && Array.isArray(saved.versions) && saved.versions.length) return saved; // not kept in manifestCache: the next call tries the network again
    } catch { /* no saved list */ }
    throw err;
  }
}

async function getVersionJson(versionId) {
  assertVersionString(versionId, 'Minecraft version'); // goes into a file path below
  const cachePath = path.join(paths.versionsDir(), versionId, `${versionId}.json`);
  if (fs.existsSync(cachePath)) {
    try {
      return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    } catch {
      /* fall through and refetch */
    }
  }
  const manifest = await getVersionManifest();
  const entry = manifest.versions.find((v) => v.id === versionId);
  if (!entry) throw new Error(`Unknown Minecraft version: ${versionId}`);
  const res = await fetch(entry.url);
  if (!res.ok) throw new Error(require('./netFetch').explainStatus('Failed получить данные версии Minecraft', res.status, 'Mojang'));
  const json = await res.json();
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(json));
  return json;
}

function libraryRelPath(lib) {
  if (lib.downloads && lib.downloads.artifact && lib.downloads.artifact.path) {
    return lib.downloads.artifact.path;
  }
  // Fallback: build maven path from name "group:artifact:version[:classifier]"
  const [group, artifact, version, classifier] = lib.name.split(':');
  const dir = group.replace(/\./g, '/');
  const file = classifier
    ? `${artifact}-${version}-${classifier}.jar`
    : `${artifact}-${version}.jar`;
  return `${dir}/${artifact}/${version}/${file}`;
}

function nativeClassifierFor(lib) {
  if (!lib.natives) return null;
  const key = lib.natives[currentOsName()];
  if (!key) return null;
  return key.replace('${arch}', process.arch === 'x64' ? '64' : '32');
}

// Modern version jsons (1.19+) don't use the old lib.natives/classifiers
// scheme at all. Instead every OS+arch native variant is its own top-level
// library entry named "group:artifact:version:natives-<os>[-<arch>]" with a
// plain downloads.artifact. Crucially, Mojang's own `rules` on these entries
// only filter by OS name, not arch (e.g. windows, windows-x86 and
// windows-arm64 all carry the identical `{os:{name:"windows"}}` rule) — so
// without this, every arch variant passes the rule check and ends up on the
// classpath as a regular jar instead of being extracted, and the actually
// wrong-arch native jar can win, leaving LWJGL unable to find its native
// library at runtime (NoClassDefFoundError: MemoryUtil).
const NATIVES_ARCH_SUFFIXES = { '-x86': 'x86', '-arm64': 'arm64', '-x64': 'x64' };
const NATIVES_OS_MAP = { windows: 'windows', linux: 'linux', macos: 'osx' };

function parseModernNativesClassifier(name) {
  if (!name) return null;
  const parts = name.split(':');
  const classifier = parts[3];
  if (!classifier || !classifier.startsWith('natives-')) return null;
  const rest = classifier.slice('natives-'.length);
  for (const [suffix, arch] of Object.entries(NATIVES_ARCH_SUFFIXES)) {
    if (rest.endsWith(suffix)) {
      return { osToken: rest.slice(0, -suffix.length), arch };
    }
  }
  return { osToken: rest, arch: null };
}

function modernNativesMatchesPlatform(parsed) {
  if (NATIVES_OS_MAP[parsed.osToken] !== currentOsName()) return false;
  // No arch suffix = the generic/default build, which Mojang only ships for
  // the common 64-bit desktop architecture.
  return parsed.arch === null ? currentArch() === 'x64' : parsed.arch === currentArch();
}

// Resolves a raw libraries[] array (from a version json or fabric profile json)
// into { classpathLibs, nativeLibs } applicable to the current OS.
function resolveLibraries(libraries) {
  const classpathLibs = [];
  const nativeLibs = [];

  for (const lib of libraries || []) {
    if (!rulesAllow(lib.rules)) continue;

    const modernNatives = parseModernNativesClassifier(lib.name);
    if (modernNatives) {
      if (!modernNativesMatchesPlatform(modernNatives)) continue;
      const art = lib.downloads && lib.downloads.artifact;
      if (art) {
        nativeLibs.push({
          path: art.path, url: art.url, sha1: art.sha1, size: art.size, modern: true,
        });
      }
      continue;
    }

    const classifier = nativeClassifierFor(lib);
    if (classifier && lib.downloads && lib.downloads.classifiers && lib.downloads.classifiers[classifier]) {
      const art = lib.downloads.classifiers[classifier];
      nativeLibs.push({
        path: art.path,
        url: art.url,
        sha1: art.sha1,
        size: art.size,
      });
      continue;
    }

    // Regular classpath artifact
    const relPath = libraryRelPath(lib);
    let url = null;
    let sha1 = null;
    let size = null;
    if (lib.downloads && lib.downloads.artifact) {
      url = lib.downloads.artifact.url;
      sha1 = lib.downloads.artifact.sha1;
      size = lib.downloads.artifact.size;
    } else if (lib.url) {
      url = `${lib.url.replace(/\/$/, '')}/${relPath}`;
    } else {
      url = `https://libraries.minecraft.net/${relPath}`;
    }
    classpathLibs.push({ path: relPath, url, sha1, size, name: lib.name });
  }

  return { classpathLibs, nativeLibs };
}

async function downloadLibraries(libs, onProgress) {
  const tasks = libs.map((lib) => ({
    url: lib.url,
    dest: safeJoin(paths.librariesDir(), lib.path),
    sha1: lib.sha1,
    size: lib.size,
    label: lib.path,
  }));
  await downloadAll(tasks, { concurrency: 10, onProgress });
  return tasks.map((t) => t.dest);
}

// The natives folder is shared by every instance of a version, and a running game keeps its DLLs open (Windows won't let
// them be overwritten). So a file that is already there with the same content is left alone — a second game of the same
// version then starts while the first runs; a locked file of the same size is taken to be the same one.
async function writeNativeFile(file, data) {
  let existing = null;
  try { existing = await fs.promises.stat(file); } catch { /* not there yet */ }
  if (existing && existing.size === data.length) {
    try {
      if (Buffer.compare(await fs.promises.readFile(file), data) === 0) return;
    } catch { return; } // can't even be read: the running game has it, and the size matches
  }
  try {
    await fs.promises.writeFile(file, data);
  } catch (err) {
    if (existing && existing.size === data.length && ['EBUSY', 'EPERM', 'EACCES'].includes(err.code)) return;
    throw err;
  }
}

async function extractNatives(nativeLibs, targetDir) {
  await fs.promises.mkdir(targetDir, { recursive: true });
  for (const lib of nativeLibs) {
    const jarPath = path.join(paths.librariesDir(), lib.path);
    if (!fs.existsSync(jarPath)) continue;
    const zip = new AdmZip(jarPath);
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue;
      if (entry.entryName.startsWith('META-INF/')) continue;
      if (entry.entryName.endsWith('.git') || entry.entryName.endsWith('.sha1')) continue;
      let outPath;
      try { outPath = safeJoin(targetDir, entry.entryName); } catch { continue; } // a jar entry must not climb out of natives/
      // eslint-disable-next-line no-await-in-loop
      await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
      // eslint-disable-next-line no-await-in-loop
      const data = entry.getData();
      // eslint-disable-next-line no-await-in-loop
      await writeNativeFile(outPath, data);
      // Newer LWJGL native jars keep their libraries in nested folders
      // (windows/x64/org/lwjgl/lwjgl.dll), but java.library.path only looks
      // at the top level of the natives dir — without a flat copy LWJGL
      // dies with "Failed to locate library: lwjgl.dll".
      if (/\.(dll|so|dylib|jnilib)$/i.test(entry.entryName) && path.dirname(outPath) !== targetDir) {
        // eslint-disable-next-line no-await-in-loop
        await writeNativeFile(path.join(targetDir, path.basename(entry.entryName)), data);
      }
    }
  }
}

async function downloadClient(versionJson, onProgress) {
  const dl = versionJson.downloads && versionJson.downloads.client;
  if (!dl) throw new Error('Version json has no client download entry');
  const dest = path.join(paths.versionsDir(), versionJson.id, `${versionJson.id}.jar`);
  // The client is ONE file of about 40 MB: a bar that stayed empty until it was all there looked like a freeze. Bytes and speed are reported while it arrives.
  let from = Date.now();
  let fromBytes = 0;
  let speed = 0;
  const onBytes = onProgress ? (received, total) => {
    const now = Date.now();
    if (now - from >= 1000) { speed = ((received - fromBytes) * 1000) / (now - from); from = now; fromBytes = received; }
    onProgress({ bytes: true, completed: received, total: total || dl.size || 0, speed, label: 'client.jar' });
  } : undefined;
  await downloadFile(dl.url, dest, { expectedSize: dl.size, expectedSha1: dl.sha1, onBytes });
  if (onProgress) onProgress({ completed: 1, total: 1, label: 'client.jar' });
  return dest;
}

async function downloadAssets(versionJson, onProgress) {
  const assetIndexMeta = versionJson.assetIndex;
  if (!assetIndexMeta) return null;
  const indexPath = path.join(paths.assetIndexesDir(), `${assetIndexMeta.id}.json`);
  await downloadFile(assetIndexMeta.url, indexPath, {
    expectedSize: assetIndexMeta.size,
    expectedSha1: assetIndexMeta.sha1,
  });
  const indexJson = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  const objects = indexJson.objects || {};
  // Once, not per file: an asset index has 3000-30000 entries, and each lookup of the folder used to read the whole settings file.
  const objectsDir = paths.assetObjectsDir();
  const tasks = Object.entries(objects).map(([name, obj]) => {
    const hash = obj.hash;
    const sub = hash.substring(0, 2);
    return {
      url: `https://resources.download.minecraft.net/${sub}/${hash}`,
      dest: path.join(objectsDir, sub, hash),
      sha1: hash,
      size: obj.size,
      label: name,
    };
  });
  await downloadAll(tasks, { concurrency: 16, onProgress });
  return assetIndexMeta.id;
}

module.exports = {
  getVersionManifest,
  getVersionJson,
  resolveLibraries,
  downloadLibraries,
  extractNatives,
  downloadClient,
  downloadAssets,
  libraryRelPath,
};
