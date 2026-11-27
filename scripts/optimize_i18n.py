from pathlib import Path

p = Path(__file__).resolve().parents[1] / "src" / "i18n.js"
t = p.read_text(encoding="utf-8")

old = """const ordered = Object.entries(DICT).sort((a, b) => b[0].length - a[0].length);

const originalText = new WeakMap();
const originalAttrs = new WeakMap();
let current = 'en';
let observer = null;

function translateText(text) {
  let out = text;
  for (const [en, uk] of ordered) {
    out = out.replace(new RegExp(`(?<![A-Za-zА-Яа-яІіЇїЄєҐґ])${en.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}(?![A-Za-zА-Яа-яІіЇїЄєҐґ])`, 'g'), uk);
  }
  return out;
}
"""

new = """const ordered = Object.entries(DICT).sort((a, b) => b[0].length - a[0].length);

// Compile once instead of rebuilding ~1500 RegExp objects on every DOM
// mutation — that was making Ukrainian mode noticeably sluggish.
const compiled = ordered.map(([en, uk]) => [
  new RegExp(`(?<![A-Za-zА-Яа-яІіЇїЄєҐґ])${en.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}(?![A-Za-zА-Яа-яІіЇїЄєҐґ])`, 'g'),
  uk,
]);
const cache = new Map();

const originalText = new WeakMap();
const originalAttrs = new WeakMap();
let current = 'en';
let observer = null;

function translateText(text) {
  if (cache.has(text)) return cache.get(text);
  let out = text;
  for (const [re, uk] of compiled) out = out.replace(re, uk);
  if (cache.size > 4000) cache.clear();
  cache.set(text, out);
  return out;
}
"""

if old in t:
    p.write_text(t.replace(old, new), encoding="utf-8")
    print("i18n optimized")
else:
    print("anchor not found")
