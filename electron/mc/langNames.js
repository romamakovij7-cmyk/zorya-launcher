const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const paths = require('./paths');
const versions = require('./versions');
const { downloadFile } = require('./download');

const cache = new Map(); // mcVersion -> parsed lang object | null

// Russian translations aren't in the client jar — they live in the asset
// index (hashed object files). The launcher downloads those for launching
// anyway; if this version's assets aren't there yet, fetch just the index
// and the one ru_ru.json object.
async function loadRuLang(mcVersion) {
  if (cache.has(mcVersion)) return cache.get(mcVersion);
  let lang = null;
  try {
    const versionJson = await versions.getVersionJson(mcVersion);
    const meta = versionJson.assetIndex;
    if (meta) {
      const indexPath = path.join(paths.assetIndexesDir(), `${meta.id}.json`);
      await downloadFile(meta.url, indexPath, { expectedSize: meta.size, expectedSha1: meta.sha1 });
      const index = JSON.parse(await fsp.readFile(indexPath, 'utf8'));
      const key = Object.keys(index.objects || {}).find((k) => /lang\/ru_ru\.json$/i.test(k));
      if (key) {
        const { hash, size } = index.objects[key];
        const sub = hash.substring(0, 2);
        const dest = path.join(paths.assetObjectsDir(), sub, hash);
        await downloadFile(`https://resources.download.minecraft.net/${sub}/${hash}`, dest, {
          expectedSize: size, expectedSha1: hash,
        });
        lang = JSON.parse(await fsp.readFile(dest, 'utf8'));
      }
    }
  } catch {
    lang = null;
  }
  cache.set(mcVersion, lang);
  return lang;
}

// ids: item ids like "oak_planks" (vanilla only — modded ids carry a
// namespace and are skipped). Returns { id: "Дубовые доски" } for the ones
// that have a translation.
async function getRussianNames(mcVersion, ids) {
  const lang = await loadRuLang(mcVersion);
  const out = {};
  if (!lang) return out;
  for (const id of ids) {
    if (id.includes(':')) continue;
    const name = lang[`item.minecraft.${id}`] || lang[`block.minecraft.${id}`];
    if (typeof name === 'string') out[id] = name;
  }
  return out;
}

module.exports = { getRussianNames };
