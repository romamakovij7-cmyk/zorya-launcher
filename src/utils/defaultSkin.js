// A character to show while an account has no skin of its own: one of Minecraft's default skins (they sit in the skin library,
// marked `vanilla`). The pick depends only on the account, so it does not change from one visit to the next.
export function defaultSkinFor(account, skins) {
  const pool = (skins || []).filter((s) => s && s.vanilla && s.dataUrl);
  if (!account || !pool.length) return null;
  const key = String(account.id || account.name || '');
  let h = 0;
  for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return pool[h % pool.length];
}
