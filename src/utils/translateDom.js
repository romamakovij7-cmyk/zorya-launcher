const SKIP_PARENTS = new Set(['PRE', 'CODE', 'SCRIPT', 'STYLE', 'KBD', 'SAMP']);
const BATCH = 80;

function isMostlyCyrillic(text) {
  const letters = text.match(/\p{L}/gu) || [];
  if (!letters.length) return false;
  const cyr = letters.filter((c) => /[- ]/.test(c)).length;
  return cyr / letters.length > 0.5;
}

function collectTextNodes(root) {
  const nodes = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      if (!n.nodeValue.trim() || !/\p{L}/u.test(n.nodeValue)) return NodeFilter.FILTER_REJECT;
      for (let p = n.parentElement; p && p !== root; p = p.parentElement) {
        if (SKIP_PARENTS.has(p.tagName)) return NodeFilter.FILTER_REJECT;
      }
      return isMostlyCyrillic(n.nodeValue) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });
  while (walker.nextNode()) nodes.push(walker.currentNode);
  return nodes;
}

// Translates the visible text of `root` to Russian in place, keeping the
// markup. Originals are remembered on the nodes so restoreDom() can undo it.
// onProgress(done, total) is called between batches.
export async function translateDom(root, onProgress, protect = []) {
  const nodes = collectTextNodes(root);
  const total = nodes.length;
  for (let i = 0; i < nodes.length; i += BATCH) {
    const slice = nodes.slice(i, i + BATCH);
    const texts = slice.map((n) => (n.__orig !== undefined ? n.__orig : n.nodeValue).trim());
    // eslint-disable-next-line no-await-in-loop
    const res = await window.api.translate.texts(texts, protect);
    if (!res?.ok) throw new Error(res?.error || 'failed to translate');
    slice.forEach((n, k) => {
      if (n.__orig === undefined) n.__orig = n.nodeValue;
      const lead = n.__orig.match(/^\s*/)[0];
      const trail = n.__orig.match(/\s*$/)[0];
      n.nodeValue = `${lead}${res.texts[k]}${trail}`;
    });
    onProgress?.(Math.min(i + BATCH, total), total);
  }
  return total;
}

export function restoreDom(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const n = walker.currentNode;
    if (n.__orig !== undefined) { n.nodeValue = n.__orig; n.__orig = undefined; }
  }
}

export async function translateString(text, protect = []) {
  const res = await window.api.translate.texts([text], protect);
  if (!res?.ok) throw new Error(res?.error || 'failed to translate');
  return res.texts[0];
}
