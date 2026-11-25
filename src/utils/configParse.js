// Line-based reader for "key = value" style config files (.toml, .cfg, .conf,
// .properties, .ini). It doesn't try to understand every dialect; it finds
// simple `key = value` / `key: value` lines, remembers the comment lines just
// above each one as its description, and lets a single value be rewritten
// without touching anything else in the file (comments, spacing, order).

export const FORM_EXTENSIONS = ['toml', 'cfg', 'conf', 'config', 'properties', 'ini'];

const KEY_RE = /^(\s*)((?:[A-Za-z]:)?(?:"[^"]+"|'[^']+'|[A-Za-z0-9_.\-$]+))(\s*[=:]\s*)(.*)$/;

// Splits "value  # comment" into the value part and the trailing comment,
// keeping '#' inside quoted strings intact.
function splitValue(rest) {
  const trimmedStart = rest.replace(/^\s+/, '');
  const lead = rest.slice(0, rest.length - trimmedStart.length);
  const quote = trimmedStart[0];
  if (quote === '"' || quote === "'") {
    let i = 1;
    while (i < trimmedStart.length) {
      if (trimmedStart[i] === '\\') { i += 2; continue; }
      if (trimmedStart[i] === quote) break;
      i += 1;
    }
    const value = trimmedStart.slice(0, i + 1);
    return { lead, value, suffix: trimmedStart.slice(i + 1) };
  }
  const hash = trimmedStart.search(/\s+#/);
  if (hash >= 0) return { lead, value: trimmedStart.slice(0, hash), suffix: trimmedStart.slice(hash) };
  return { lead, value: trimmedStart.replace(/\s+$/, ''), suffix: trimmedStart.slice(trimmedStart.replace(/\s+$/, '').length) };
}

function classify(value) {
  if (value === 'true' || value === 'false') return 'bool';
  if (/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(value)) return 'number';
  if (/^(".*"|'.*')$/.test(value)) return 'string';
  return 'text';
}

// -> [{ line, prefix, key, value, suffix, type, section, comment }]
export function parseConfig(text) {
  const lines = text.split('\n');
  const items = [];
  let section = '';
  let comment = [];
  lines.forEach((raw, i) => {
    const line = raw.replace(/\r$/, '');
    const t = line.trim();
    if (!t) { comment = []; return; }
    if (/^(#|\/\/|;)/.test(t)) { comment.push(t.replace(/^(#+|\/\/+|;+)\s?/, '')); return; }
    const sec = /^\[+\s*([^\]]+?)\s*\]+\s*$/.exec(t);
    if (sec) { section = sec[1]; comment = []; return; }
    const m = KEY_RE.exec(line);
    if (m && !t.startsWith('{') && !t.startsWith('}')) {
      const { lead, value, suffix } = splitValue(m[4]);
      items.push({
        line: i,
        prefix: `${m[1]}${m[2]}${m[3]}${lead}`,
        key: m[2].replace(/^[A-Za-z]:/, '').replace(/^["']|["']$/g, ''),
        value,
        suffix,
        type: classify(value),
        section,
        comment: comment.join(' '),
      });
    }
    comment = [];
  });
  return items;
}

// Rewrites one item's value in the file text.
export function setConfigValue(text, item, newValue) {
  const lines = text.split('\n');
  const cr = lines[item.line].endsWith('\r') ? '\r' : '';
  lines[item.line] = `${item.prefix}${newValue}${item.suffix}${cr}`;
  return lines.join('\n');
}

export function extensionOf(name) {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}
