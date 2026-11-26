const { explainStatus } = require('./netFetch');

const FABRIC_META = 'https://meta.fabricmc.net/v2/versions';
const QUILT_META = 'https://meta.quiltmc.org/v3/versions';

async function getFabricLoaderVersions(mcVersion, meta = FABRIC_META) {
  const res = await fetch(`${meta}/loader/${encodeURIComponent(mcVersion)}`);
  if (!res.ok) throw new Error(explainStatus('Failed получить список версий Fabric', res.status, 'meta.fabricmc.net'));
  const list = await res.json();
  return list.map((entry) => ({
    loaderVersion: entry.loader.version,
    stable: entry.loader.stable,
  }));
}

async function getFabricProfile(mcVersion, loaderVersion, meta = FABRIC_META) {
  const res = await fetch(`${meta}/loader/${encodeURIComponent(mcVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`);
  if (!res.ok) throw new Error(explainStatus('Failed получить профиль Fabric', res.status, 'meta.fabricmc.net'));
  return res.json();
}

// Orders versions like 0.30.1, 0.30.1-beta.4 by semver (a release is newer
// than its own betas).
function compareSemver(a, b) {
  const parse = (v) => {
    const [core, pre] = v.split('-');
    return { nums: core.split('.').map((n) => parseInt(n, 10) || 0), pre: pre || null };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) {
    const d = (x.nums[i] || 0) - (y.nums[i] || 0);
    if (d) return d;
  }
  if (!x.pre && y.pre) return 1;
  if (x.pre && !y.pre) return -1;
  if (!x.pre && !y.pre) return 0;
  const num = (p) => parseInt((/(\d+)$/.exec(p) || [0, 0])[1], 10);
  return num(x.pre) - num(y.pre);
}

// Quilt's meta API does NOT return versions newest-first (it looked like
// 0.20.0-beta.9, ..., 0.24.0 up top), so "first stable" used to pick an old
// loader whose bundled ASM can't read newer Java class files ("Unsupported
// class file major version 69"). Sort properly so newest stable comes first.
async function getQuiltLoaderVersions(mcVersion) {
  const res = await fetch(`${QUILT_META}/loader/${encodeURIComponent(mcVersion)}`);
  if (!res.ok) throw new Error(explainStatus('Failed получить список версий Quilt', res.status, 'meta.quiltmc.org'));
  const list = await res.json();
  return list
    .map((entry) => ({
      loaderVersion: entry.loader.version,
      stable: !entry.loader.version.includes('beta'),
    }))
    .sort((a, b) => compareSemver(b.loaderVersion, a.loaderVersion));
}

async function getQuiltProfile(mcVersion, loaderVersion) {
  const res = await fetch(`${QUILT_META}/loader/${encodeURIComponent(mcVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`);
  if (!res.ok) throw new Error(explainStatus('Failed получить профиль Quilt', res.status, 'meta.quiltmc.org'));
  return res.json();
}

module.exports = {
  getFabricLoaderVersions,
  getFabricProfile,
  getQuiltLoaderVersions,
  getQuiltProfile,
};
