// Automatically installs a small, curated set of proven FPS mods right after
// an instance is created. Uses the same Modrinth endpoints as OptimizeModal.
const API = "https://api.modrinth.com/v2";

const FABRIC = [
  // Fabric API first: Sodium, Lithium and most other mods need it.
  "fabric-api", "sodium", "lithium", "ferrite-core", "immediatelyfast", "entityculling", "modernfix",
];
const FORGE = [
  "embeddium", "ferrite-core", "immediatelyfast", "entityculling", "modernfix",
];
const NEOFORGE = ["sodium", "embeddium", "ferrite-core", "immediatelyfast", "modernfix"];

function slugsFor(loader) {
  if (loader === "fabric" || loader === "quilt") return FABRIC;
  if (loader === "forge") return FORGE;
  if (loader === "neoforge") return NEOFORGE;
  return [];
}

async function findVersion(slug, mcVersion, loaders) {
  const params = new URLSearchParams({
    loaders: JSON.stringify(loaders),
    game_versions: JSON.stringify([mcVersion]),
  });
  const res = await fetch(`${API}/project/${encodeURIComponent(slug)}/version?${params}`);
  if (!res.ok) return null;
  const versions = await res.json();
  if (!versions.length) return null;
  const rank = { release: 0, beta: 1, alpha: 2 };
  versions.sort((a, b) => (rank[a.version_type] - rank[b.version_type])
    || (new Date(b.date_published) - new Date(a.date_published)));
  return versions[0];
}

function primaryFile(v) {
  const f = v.files.find((x) => x.primary) || v.files[0];
  return { url: f.url, filename: f.filename, sha1: f.hashes?.sha1, size: f.size };
}

/** Returns the number of mods actually installed. Never throws to the caller. */
export async function autoOptimize(instance) {
  if (!instance || instance.loader === "horizon" || instance.loader === "vanilla") return 0;
  const slugs = slugsFor(instance.loader);
  if (!slugs.length) return 0;
  const loaders = instance.loader === "quilt" ? ["quilt", "fabric"] : [instance.loader];
  try {
    const listRes = await window.api.content.list(instance.id);
    const installed = new Set();
    for (const it of listRes.ok ? listRes.items : []) {
      if (it.kind === "mod" && it.resolved?.projectId) installed.add(it.resolved.projectId);
      installed.add(it.filename?.replace(/\.disabled$/, ""));
    }
    let count = 0;
    for (const slug of slugs) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const v = await findVersion(slug, instance.mcVersion, loaders);
        if (!v || installed.has(v.project_id)) continue;
        const file = primaryFile(v);
        if (installed.has(file.filename)) continue;
        // eslint-disable-next-line no-await-in-loop
        const res = await window.api.modrinth.installMod(instance.id, file, "mod");
        if (res.ok) { installed.add(v.project_id); installed.add(file.filename); count += 1; }
      } catch { /* one unavailable mod must not stop the rest */ }
    }
    return count;
  } catch {
    return 0;
  }
}
